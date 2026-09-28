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

function driverInfo(driverMap, driverNumber) {
    const dr = driverMap[driverNumber];
    return {
        driver_code: dr?.name_acronym || null,
        driver_name: dr?.first_name ? `${dr.first_name} ${dr.last_name}` : null,
        team: dr?.team_name || null
    };
}

function lastValue(value) {
    if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
            if (value[i] != null) return value[i];
        }
        return null;
    }
    return value ?? null;
}

function formatLapTime(seconds) {
    if (seconds == null || Number.isNaN(Number(seconds))) return null;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}:${secs.toFixed(3).padStart(6, '0')}` : secs.toFixed(3);
}

function formatRaceTime(seconds) {
    if (seconds == null || Number.isNaN(Number(seconds))) return null;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const secStr = secs.toFixed(3).padStart(6, '0');
    if (hours > 0) return `${hours}:${String(mins).padStart(2, '0')}:${secStr}`;
    return `${mins}:${secStr}`;
}

function formatGap(gap) {
    if (gap == null) return null;
    if (typeof gap === 'string') {
        const trimmed = gap.trim();
        if (!trimmed) return null;
        return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
    }
    if (typeof gap === 'number') {
        return `+${gap.toFixed(3)}`;
    }
    return null;
}

function classifyTime(result, isRace, isLeader) {
    if (result.dsq) return { timeStr: 'DSQ', gap: null, bestLap: null };
    if (result.dns) return { timeStr: 'DNS', gap: null, bestLap: null };
    if (result.dnf) return { timeStr: 'DNF', gap: null, bestLap: null };

    const duration = lastValue(result.duration);
    const gap = lastValue(result.gap_to_leader);

    if (typeof gap === 'string' && /lap/i.test(gap)) {
        return { timeStr: formatGap(gap), gap: null, bestLap: duration };
    }

    if (isRace) {
        if (isLeader || gap === 0) {
            return { timeStr: formatRaceTime(duration), gap: 0, bestLap: duration };
        }
        const gapStr = formatGap(gap);
        if (gapStr) return { timeStr: gapStr, gap: typeof gap === 'number' ? gap : null, bestLap: duration };
        if (duration) return { timeStr: formatRaceTime(duration), gap: null, bestLap: duration };
        return { timeStr: null, gap: null, bestLap: null };
    }

    // Practice / qualifying: show the relevant lap time
    return {
        timeStr: formatLapTime(duration),
        gap: typeof gap === 'number' ? gap : null,
        bestLap: typeof duration === 'number' ? duration : null
    };
}

function mapOfficialResults(sessionResults, driverMap, isRace) {
    const sorted = [...sessionResults].sort((a, b) => {
        const pa = a.position == null ? 999 : a.position;
        const pb = b.position == null ? 999 : b.position;
        if (pa !== pb) return pa - pb;
        return (b.number_of_laps || 0) - (a.number_of_laps || 0);
    });

    return sorted.map((r, idx) => {
        const isLeader = idx === 0;
        const { timeStr, gap, bestLap } = classifyTime(r, isRace, isLeader);
        const info = driverInfo(driverMap, r.driver_number);
        return {
            position: r.position ?? idx + 1,
            driver_number: r.driver_number,
            driver_code: info.driver_code,
            driver_name: info.driver_name,
            team: info.team,
            best_lap: bestLap,
            best_lap_time: timeStr,
            gap_to_fastest: gap
        };
    });
}

async function mapFallbackLapResults(session, driverMap) {
    const [positions, laps] = await Promise.all([
        fetchWithTimeout(`https://api.openf1.org/v1/position?session_key=${session.session_key}`),
        fetchWithTimeout(`https://api.openf1.org/v1/laps?session_key=${session.session_key}`)
    ]);

    if (!positions?.length) return null;

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

    const finalPositions = {};
    for (const p of positions) {
        if (!finalPositions[p.driver_number] || p.date > finalPositions[p.driver_number].date) {
            finalPositions[p.driver_number] = p;
        }
    }

    const sorted = Object.values(finalPositions).sort((a, b) => a.position - b.position);
    const winnerNum = sorted[0]?.driver_number;
    const winnerBestLap = driverBestLaps[winnerNum] || null;

    return sorted.map((r, idx) => {
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

        const info = driverInfo(driverMap, dr);
        return {
            position: r.position,
            driver_number: dr,
            driver_code: info.driver_code,
            driver_name: info.driver_name,
            team: info.team,
            best_lap: bestLap || null,
            best_lap_time: timeStr,
            gap_to_fastest: gap
        };
    });
}

async function fetchSessionResult(session, meeting) {
    const [sessionResults, drivers] = await Promise.all([
        fetchWithTimeout(`https://api.openf1.org/v1/session_result?session_key=${session.session_key}`),
        fetchWithTimeout(`https://api.openf1.org/v1/drivers?session_key=${session.session_key}`)
    ]);

    const driverMap = {};
    if (drivers) for (const d of drivers) driverMap[d.driver_number] = d;

    const isRace = ['Race', 'Sprint'].includes(session.session_type);
    let resultsWithTimes = null;

    if (sessionResults?.length) {
        resultsWithTimes = mapOfficialResults(sessionResults, driverMap, isRace);
    } else {
        resultsWithTimes = await mapFallbackLapResults(session, driverMap);
    }

    if (!resultsWithTimes?.length) return null;

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
