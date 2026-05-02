/**
 * Fetch live F1 session data and save to JSON
 * Run: node scripts/fetch-live.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../docs/data/live');
const API_TIMEOUT = 10000;

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
    
    // Get all meetings for the year
    const meetings = await fetchWithTimeout(`https://api.openf1.org/v1/meetings?year=${year}`);
    if (!meetings?.length) return null;
    
    // Find current or most recent meeting
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
        // Most recent past meeting
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
    
    return results.length ? results : null;
}

async function fetchSessionResult(session, meeting) {
    const [positions, drivers] = await Promise.all([
        fetchWithTimeout(`https://api.openf1.org/v1/position?session_key=${session.session_key}`),
        fetchWithTimeout(`https://api.openf1.org/v1/drivers?session_key=${session.session_key}`)
    ]);
    
    if (!positions?.length) return null;
    
    const driverMap = {};
    if (drivers) for (const d of drivers) driverMap[d.driver_number] = d;
    
    // Get final positions
    const finalPositions = {};
    for (const p of positions) {
        if (!finalPositions[p.driver_number] || p.date > finalPositions[p.driver_number].date) {
            finalPositions[p.driver_number] = p;
        }
    }
    
    const sorted = Object.values(finalPositions).sort((a, b) => a.position - b.position);
    
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
        results: sorted.map(r => ({
            position: r.position,
            driver_number: r.driver_number,
            driver_code: driverMap[r.driver_number]?.name_acronym || null,
            driver_name: driverMap[r.driver_number]?.first_name 
                ? `${driverMap[r.driver_number].first_name} ${driverMap[r.driver_number].last_name}`
                : null,
            team: driverMap[r.driver_number]?.team_name || null
        }))
    };
}

function saveData(data) {
    if (!data) return;
    
    // Ensure directory exists
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    // Save each session
    for (const session of data) {
        const filename = `${session.meeting_key}_${session.session_key}_${session.session_name.toLowerCase().replace(/\s+/g, '_')}.json`;
        const filepath = path.join(DATA_DIR, filename);
        fs.writeFileSync(filepath, JSON.stringify(session, null, 2));
        console.log(`Saved: ${filename}`);
    }
    
    // Save latest session reference
    const latest = data[data.length - 1];
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
