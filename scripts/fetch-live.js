/**
 * Fetch live F1 session data and save to JSON
 * Run: node scripts/fetch-live.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../docs/data/live');
const API_TIMEOUT = 10000;

// Session priority (higher = more important for "latest")
const SESSION_PRIORITY = {
    'Race': 10,
    'Sprint': 9,
    'Qualifying': 8,
    'Sprint Qualifying': 7,
    'Practice 3': 6,
    'Practice 2': 5,
    'Practice 1': 4
};

async function fetchWithTimeout(url, timeout = API_TIMEOUT) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        return resp.ok ? resp.json() : null;
    } catch {
        return null;
    }
}

async function fetchCurrentMeeting() {
    const now = new Date();
    const year = now.getFullYear();
    
    const meetings = await fetchWithTimeout(`https://api.openf1.org/v1/meetings?year=${year}`);
    if (!meetings?.length) return null;
    
    let currentMeeting = null;
    for (const m of meetings) {
        const start = new Date(m.date_start);
        const end = new Date(m.date_end);
        if (now >= start && now <= end) {
            currentMeeting = m;
            break;
        }
    }
    
    if (!currentMeeting) {
        const past = meetings.filter(m => new Date(m.date_end) < now)
            .sort((a, b) => new Date(b.date_end) - new Date(a.date_end));
        if (past.length) currentMeeting = past[0];
    }
    
    return currentMeeting;
}

async function fetchSessionResults(meeting) {
    if (!meeting) return null;
    
    const sessions = await fetchWithTimeout(`https://api.openf1.org/v1/sessions?meeting_key=${meeting.meeting_key}`);
    if (!sessions?.length) return null;
    
    const now = new Date();
    const completed = sessions.filter(s => new Date(s.date_end) < now)
        .sort((a, b) => new Date(b.date_end) - new Date(a.date_end));
    
    if (!completed.length) return null;
    
    const results = [];
    
    for (const session of completed) {
        const sessionResults = await fetchSessionResult(session, meeting);
        if (sessionResults) {
            results.push(sessionResults);
        }
    }
    
    // Sort by priority (highest first), then by date (most recent first)
    results.sort((a, b) => {
        const priA = SESSION_PRIORITY[a.session_type] || 0;
        const priB = SESSION_PRIORITY[b.session_type] || 0;
        if (priA !== priB) return priB - priA;
        return new Date(b.date_end) - new Date(a.date_end);
    });
    
    return results.length ? results : null;
}

async function fetchSessionResult(session, meeting) {
    const [positions, drivers, laps] = await Promise.all([
        fetchWithTimeout(`https://api.openf1.org/v1/position?session_key=${session.session_key}`),
        fetchWithTimeout(`https://api.openf1.org/v1/drivers?session_key=${session.session_key}`),
        fetchWithTimeout(`https://api.openf1.org/v1/laps?session_key=${session.session_key}`)
    ]);
    
    if (!positions?.length) return null;
    
    const driverMap = {};
    if (drivers) for (const d of drivers) driverMap[d.driver_number] = d;
    
    // Build driver best laps
    const driverBestLaps = {};
    if (laps) {
        for (const lap of laps) {
            if (!lap.lap_duration) continue;
            const dr = lap.driver_number;
            if (!driverBestLaps[dr] || lap.lap_duration < driverBestLaps[dr]) {
                driverBestLaps[dr] = lap.lap_duration;
            }
        }
    }
    
    // Get final positions
    const finalPositions = {};
    for (const p of positions) {
        if (!finalPositions[p.driver_number] || p.date > finalPositions[p.driver_number].date) {
            finalPositions[p.driver_number] = p;
        }
    }
    
    const sorted = Object.values(finalPositions).sort((a, b) => a.position - b.position);
    
    // Winner's fastest lap for gap calculation
    const winnerNum = sorted[0]?.driver_number;
    const winnerBestLap = driverBestLaps[winnerNum] || null;
    
    // Determine if this is a race session
    const isRace = ['Race', 'Sprint'].includes(session.session_type);
    
    const resultsWithTimes = sorted.map((r, idx) => {
        const dr = r.driver_number;
        const bestLap = driverBestLaps[dr];
        let gap = null;
        let timeStr = null;
        
        if (bestLap) {
            if (idx === 0) {
                timeStr = formatLapTime(bestLap);
            } else if (winnerBestLap) {
                gap = bestLap - winnerBestLap;
                timeStr = `+${gap.toFixed(3)}`;
            }
        }
        
        return {
            position: r.position,
            driver_number: dr,
            driver_code: driverMap[dr]?.name_acronym || null,
            driver_name: driverMap[dr]?.first_name 
                ? `${driverMap[dr].first_name} ${driverMap[dr].last_name}`
                : null,
            team: driverMap[dr]?.team_name || null,
            best_lap: bestLap || null,
            best_lap_time: timeStr,
            gap_to_fastest: gap
        };
    });
    
    return {
        session_key: session.session_key,
        session_name: session.session_name,
        session_type: session.session_type,
        date_start: session.date_start,
        date_end: session.date_end,
        meeting_key: meeting.meeting_key,
        meeting_name: meeting.meeting_name,
        location: meeting.location,
        country: meeting.country,
        is_race: isRace,
        results: resultsWithTimes
    };
}

function formatLapTime(seconds) {
    if (!seconds) return null;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}:${secs.toFixed(3).padStart(6, '0')}` : secs.toFixed(3);
}

function saveData(data) {
    if (!data) return;
    
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    for (const session of data) {
        const filename = `${session.meeting_key}_${session.session_key}_${session.session_name.toLowerCase().replace(/\s+/g, '_')}.json`;
        const filepath = path.join(DATA_DIR, filename);
        fs.writeFileSync(filepath, JSON.stringify(session, null, 2));
        console.log(`Saved: ${filename}`);
    }
    
    // Latest is now the first (highest priority) session
    const latest = data[0];
    const latestPath = path.join(DATA_DIR, 'latest.json');
    fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2));
    console.log('Updated: latest.json');
}

async function main() {
    console.log('Fetching current meeting...');
    const meeting = await fetchCurrentMeeting();
    
    if (!meeting) {
        console.log('No meeting data available');
        return;
    }
    
    console.log(`Meeting: ${meeting.meeting_name || meeting.location}`);
    
    const results = await fetchSessionResults(meeting);
    if (results) {
        saveData(results);
    } else {
        console.log('No session results available');
    }
}

main().catch(console.error);
