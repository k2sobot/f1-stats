/**
 * F1 Stats - Static data with live weekend sessions
 */

const TEAM_COLORS = {
    'Mercedes': 'mercedes', 'Ferrari': 'ferrari', 'Red Bull Racing': 'redbull', 'Red Bull': 'redbull',
    'McLaren': 'mclaren', 'Alpine F1 Team': 'alpine', 'Alpine': 'alpine', 'Aston Martin F1 Team': 'astonmartin',
    'Aston Martin': 'astonmartin', 'Haas F1 Team': 'haas', 'Haas': 'haas', 'Williams': 'williams',
    'Audi': 'audi', 'Cadillac': 'cadillac', 'Racing Bulls': 'racingbulls', 'RB': 'racingbulls', 'Visa RB': 'racingbulls',
};

let dataCache = { drivers: null, constructors: null, schedule: null, qualifying: null, results: null };

async function loadLocalData(file) {
    const resp = await fetch(`data/${file}.json`);
    if (!resp.ok) return null;
    return resp.json();
}

async function fetchWithTimeout(url, timeout = 5000) {
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

async function getDriverStandings() {
    if (!dataCache.drivers) dataCache.drivers = await loadLocalData('drivers');
    if (!dataCache.drivers) return { standings: [], round: 0 };
    const table = dataCache.drivers.MRData?.StandingsTable?.StandingsLists?.[0];
    if (!table) return { standings: [], round: 0 };
    return {
        standings: table.DriverStandings.map(s => ({
            position: parseInt(s.position),
            driver: s.Driver.code || `${s.Driver.givenName[0]}. ${s.Driver.familyName}`,
            team: s.Constructors[0]?.name || 'Unknown',
            points: parseInt(s.points), wins: parseInt(s.wins)
        })),
        round: parseInt(table.round)
    };
}

async function getConstructorStandings() {
    if (!dataCache.constructors) dataCache.constructors = await loadLocalData('constructors');
    if (!dataCache.constructors) return [];
    const table = dataCache.constructors.MRData?.StandingsTable?.StandingsLists?.[0];
    if (!table) return [];
    return table.ConstructorStandings.map(s => ({
        position: parseInt(s.position), constructor: s.Constructor.name,
        points: parseInt(s.points), wins: parseInt(s.wins)
    }));
}

async function getNextRace() {
    if (!dataCache.schedule) dataCache.schedule = await loadLocalData('schedule');
    if (!dataCache.schedule) return null;
    const races = dataCache.schedule.MRData?.RaceTable?.Races || [];
    const now = new Date();
    const nextRace = races.find(r => new Date(`${r.date}T${r.time || '00:00:00Z'}`) > now);
    if (!nextRace) return null;
    
    const raceDate = new Date(`${nextRace.date}T${nextRace.time || '00:00:00Z'}`);
    const sessions = [];
    
    if (nextRace.FirstPractice) sessions.push({ name: 'FP1', date: new Date(`${nextRace.FirstPractice.date}T${nextRace.FirstPractice.time || '00:00:00Z'}`) });
    if (nextRace.SecondPractice) sessions.push({ name: 'FP2', date: new Date(`${nextRace.SecondPractice.date}T${nextRace.SecondPractice.time || '00:00:00Z'}`) });
    if (nextRace.ThirdPractice) sessions.push({ name: 'FP3', date: new Date(`${nextRace.ThirdPractice.date}T${nextRace.ThirdPractice.time || '00:00:00Z'}`) });
    if (nextRace.SprintQualifying) sessions.push({ name: 'Sprint Quali', date: new Date(`${nextRace.SprintQualifying.date}T${nextRace.SprintQualifying.time || '00:00:00Z'}`) });
    if (nextRace.Sprint) sessions.push({ name: 'Sprint', date: new Date(`${nextRace.Sprint.date}T${nextRace.Sprint.time || '00:00:00Z'}`) });
    if (nextRace.Qualifying) sessions.push({ name: 'Qualifying', date: new Date(`${nextRace.Qualifying.date}T${nextRace.Qualifying.time || '00:00:00Z'}`) });
    sessions.push({ name: 'Race', date: raceDate });
    sessions.sort((a, b) => a.date - b.date);
    
    return { name: nextRace.raceName, date: raceDate, circuit: nextRace.Circuit?.circuitName || '', country: nextRace.Circuit?.Location?.country || '', sessions };
}

async function getLatestSession() {
    // Try OpenF1 for live weekend data with timeout
    const liveSession = await getLiveWeekendSession();
    if (liveSession) return liveSession;
    
    // Fallback to static data
    if (!dataCache.qualifying) dataCache.qualifying = await loadLocalData('qualifying');
    if (!dataCache.results) dataCache.results = await loadLocalData('results');
    
    const standingsData = dataCache.drivers || await loadLocalData('drivers');
    const currentRound = standingsData?.MRData?.StandingsTable?.StandingsLists?.[0]?.round || 1;
    
    const raceData = dataCache.results?.MRData?.RaceTable?.Races?.[0];
    const raceRound = dataCache.results?.MRData?.RaceTable?.round;
    
    if (raceData?.Results && raceRound <= currentRound) {
        const fl = raceData.Results.find(r => r.FastestLap?.rank === '1');
        return {
            sessionName: 'Race', raceName: raceData.raceName,
            results: raceData.Results.slice(0, 10).map(r => ({
                position: parseInt(r.position), driver: r.Driver.code || `${r.Driver.givenName[0]}. ${r.Driver.familyName}`,
                team: r.Constructor.name, time: r.Time?.time || r.status, fastestLap: r.FastestLap?.rank === '1'
            })),
            fastestLap: fl ? { driver: fl.Driver.code, time: fl.FastestLap?.Time?.time } : null, live: false
        };
    }
    
    const qualiRace = dataCache.qualifying?.MRData?.RaceTable?.Races?.[0];
    if (qualiRace?.QualifyingResults) {
        return {
            sessionName: 'Qualifying', raceName: qualiRace.raceName,
            results: qualiRace.QualifyingResults.slice(0, 10).map((r, i) => ({
                position: i + 1, driver: r.Driver.code || `${r.Driver.givenName[0]}. ${r.Driver.familyName}`,
                team: r.Constructor.name, time: r.Q3 || r.Q2 || r.Q1 || '-', fastestLap: false
            })),
            fastestLap: null, live: false
        };
    }
    return null;
}

async function getLiveWeekendSession() {
    const now = new Date();
    
    // Get current year's meetings
    const meetings = await fetchWithTimeout(`https://api.openf1.org/v1/meetings?year=${now.getFullYear()}`);
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
        // Get most recent past meeting
        const past = meetings.filter(m => new Date(m.date_end) < now).sort((a, b) => new Date(b.date_end) - new Date(a.date_end));
        if (past.length) currentMeeting = past[0];
    }
    
    if (!currentMeeting) return null;
    
    // Get sessions for this meeting
    const sessions = await fetchWithTimeout(`https://api.openf1.org/v1/sessions?meeting_key=${currentMeeting.meeting_key}`);
    if (!sessions?.length) return null;
    
    // Find completed sessions
    const completed = sessions.filter(s => new Date(s.date_end) < now).sort((a, b) => new Date(b.date_end) - new Date(a.date_end));
    if (!completed.length) return null;
    
    // Get results from most recent completed session
    const lastSession = completed[0];
    const results = await fetchWithTimeout(`https://api.openf1.org/v1/position?session_key=${lastSession.session_key}`);
    
    if (!results?.length) return null;
    
    // Get drivers for names
    const drivers = await fetchWithTimeout(`https://api.openf1.org/v1/drivers?session_key=${lastSession.session_key}`);
    const driverMap = {};
    if (drivers) for (const d of drivers) driverMap[d.driver_number] = d;
    
    // Process results - get final positions
    const finalPositions = {};
    for (const r of results) {
        if (!finalPositions[r.driver_number] || r.date > finalPositions[r.driver_number].date) {
            finalPositions[r.driver_number] = r;
        }
    }
    
    const sorted = Object.values(finalPositions).sort((a, b) => a.position - b.position);
    
    return {
        sessionName: lastSession.session_name || 'Session',
        raceName: `${currentMeeting.meeting_name || currentMeeting.location}`,
        results: sorted.slice(0, 10).map(r => ({
            position: r.position,
            driver: driverMap[r.driver_number]?.name_acronym || driverMap[r.driver_number]?.first_name || `#${r.driver_number}`,
            team: driverMap[r.driver_number]?.team_name || 'Unknown',
            time: '', // OpenF1 doesn't provide lap times in position endpoint
            fastestLap: false
        })),
        fastestLap: null,
        live: true,
        meetingCountry: currentMeeting.country || currentMeeting.location
    };
}

function formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(date) {
    const offset = -new Date().getTimezoneOffset() / 60;
    const offsetStr = offset >= 0 ? `UTC+${offset}` : `UTC${offset}`;
    const day = date.toLocaleDateString('en-US', { weekday: 'short' });
    const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day} ${time} (${offsetStr})`;
}

function formatUTC(date) {
    const day = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
    return `${day} ${time} UTC`;
}

function renderDriverStandings(data) {
    const container = document.getElementById('driver-standings');
    if (!data?.standings?.length) { container.innerHTML = '<div class="error-message">No standings</div>'; return; }
    container.innerHTML = data.standings.slice(0, 10).map(s => `
        <div class="driver-row">
            <div class="position ${s.position <= 3 ? 'p' + s.position : ''}">${s.position}</div>
            <div class="driver-info">
                <span class="driver-name">${s.driver}</span>
                <span class="team-tag team-${TEAM_COLORS[s.team] || 'default'}">${s.team.substring(0, 3).toUpperCase()}</span>
            </div>
            <div class="driver-points">${s.points} pts</div>
        </div>
    `).join('');
}

function renderConstructorStandings(standings) {
    const container = document.getElementById('constructor-standings');
    if (!standings?.length) { container.innerHTML = '<div class="error-message">No standings</div>'; return; }
    container.innerHTML = standings.slice(0, 10).map(s => `
        <div class="driver-row">
            <div class="position ${s.position <= 3 ? 'p' + s.position : ''}">${s.position}</div>
            <div class="driver-info"><span class="driver-name">${s.constructor}</span></div>
            <div class="driver-points">${s.points} pts</div>
        </div>
    `).join('');
}

function renderNextRace(race) {
    if (!race) { document.getElementById('next-race-name').textContent = 'No upcoming races'; return; }
    document.getElementById('next-race-name').textContent = race.name;
    document.getElementById('next-race-date').textContent = formatDate(race.date);
    document.getElementById('next-race-circuit').textContent = `📍 ${race.circuit}${race.country ? ', ' + race.country : ''}`;
    document.getElementById('session-times').innerHTML = race.sessions.map(s => `
        <div class="session-item">
            <span class="session-name">${s.name}</span>
            <span class="session-time">${formatDateTime(s.date)}</span>
            <span class="session-utc">${formatUTC(s.date)}</span>
        </div>
    `).join('');
}

function renderLatestResults(data) {
    const header = document.getElementById('results-header');
    const tbody = document.getElementById('latest-results');
    
    if (!data) {
        header.textContent = 'No session results';
        tbody.innerHTML = '<tr><td colspan="3" class="loading-cell">Check back after a session</td></tr>';
        return;
    }
    
    const liveBadge = data.live ? '<span class="live-badge">🔴 LIVE</span>' : '';
    header.innerHTML = `${data.sessionName} - ${data.raceName} ${liveBadge}`;
    
    if (data.fastestLap) {
        header.innerHTML += ` <span class="fastest-lap-header"><span class="fl-badge">FL</span> ${data.fastestLap.driver} (${data.fastestLap.time})</span>`;
    }
    
    tbody.innerHTML = data.results.map(r => `
        <tr>
            <td><div class="position ${r.position <= 3 ? 'p' + r.position : ''}">${r.position}</div></td>
            <td>${r.driver} ${r.fastestLap ? '<span class="fl-badge">FL</span>' : ''} <span class="team-tag team-${TEAM_COLORS[r.team] || 'default'}">${r.team.substring(0, 3).toUpperCase()}</span></td>
            <td>${r.time || '-'}</td>
        </tr>
    `).join('');
}

function showError(container, message) {
    container.innerHTML = `<div class="error-message">${message}</div>`;
}

async function loadAll() {
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn?.classList.add('loading');
    
    try {
        const [driverStandings, constructorStandings, nextRace, latestSession] = await Promise.all([
            getDriverStandings().catch(e => ({ standings: [] })),
            getConstructorStandings().catch(e => []),
            getNextRace().catch(e => null),
            getLatestSession().catch(e => null)
        ]);
        
        renderDriverStandings(driverStandings);
        renderConstructorStandings(constructorStandings);
        renderNextRace(nextRace);
        renderLatestResults(latestSession);
        updateCountdown(nextRace);
    } catch (error) {
        console.error('Failed to load:', error);
        showError(document.getElementById('driver-standings'), 'Failed to load');
        showError(document.getElementById('constructor-standings'), 'Failed to load');
    } finally {
        refreshBtn?.classList.remove('loading');
    }
}

function updateCountdown(race) {
    const countdownRace = document.getElementById('countdown-race');
    const countdownDays = document.getElementById('countdown-days');
    const countdownHours = document.getElementById('countdown-hours');
    const countdownMinutes = document.getElementById('countdown-minutes');
    const countdownSeconds = document.getElementById('countdown-seconds');
    
    if (!race || !countdownDays) return;
    if (countdownRace) countdownRace.textContent = race.name;
    
    function tick() {
        const diff = race.date - new Date();
        if (diff <= 0) {
            countdownDays.textContent = countdownHours.textContent = countdownMinutes.textContent = countdownSeconds.textContent = '00';
            return;
        }
        countdownDays.textContent = String(Math.floor(diff / 86400000)).padStart(2, '0');
        countdownHours.textContent = String(Math.floor((diff % 86400000) / 3600000)).padStart(2, '0');
        countdownMinutes.textContent = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
        countdownSeconds.textContent = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
        requestAnimationFrame(tick);
    }
    tick();
}

document.addEventListener('DOMContentLoaded', loadAll);
document.getElementById('season-year').textContent = `${new Date().getFullYear()} Season`;
