/**
 * F1 Stats - Client-side API handling with caching
 */

const OPENF1_BASE = 'https://api.openf1.org/v1';

// Cache configuration
const cache = {
    standings: { data: null, timestamp: 0, ttl: 5 * 60 * 1000 },      // 5 min
    schedule: { data: null, timestamp: 0, ttl: 60 * 60 * 1000 },      // 1 hour
    latestSession: { data: null, timestamp: 0, ttl: 2 * 60 * 1000 },  // 2 min
};

// F1 points system
const POINTS = { 1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1 };

// Team color mapping
const TEAM_COLORS = {
    'Mercedes': 'mercedes',
    'Ferrari': 'ferrari',
    'Red Bull Racing': 'redbull',
    'McLaren': 'mclaren',
    'Alpine': 'alpine',
    'Aston Martin': 'astonmartin',
    'Haas F1 Team': 'haas',
    'Williams': 'williams',
    'Audi': 'audi',
    'Cadillac': 'cadillac',
    'Racing Bulls': 'racingbulls',
    'RB': 'racingbulls',
};

/**
 * Fetch with caching
 */
async function fetchWithCache(key, fetcher) {
    const cached = cache[key];
    if (cached.data && (Date.now() - cached.timestamp) < cached.ttl) {
        updateCacheStatus(key, cached.timestamp);
        return cached.data;
    }
    
    const data = await fetcher();
    cache[key] = { data, timestamp: Date.now(), ttl: cached.ttl };
    updateCacheStatus(key, Date.now());
    return data;
}

/**
 * Update cache status display
 */
function updateCacheStatus(key, timestamp) {
    const status = document.getElementById('cache-status');
    const age = Math.round((Date.now() - timestamp) / 1000);
    status.textContent = `Last updated: ${age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`}`;
}

/**
 * Fetch all sessions for the year
 */
async function fetchSessions() {
    const year = new Date().getFullYear();
    const resp = await fetch(`${OPENF1_BASE}/sessions?year=${year}`);
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
}

/**
 * Get driver standings
 */
async function getDriverStandings() {
    return fetchWithCache('standings', async () => {
        const sessions = await fetchSessions();
        const now = new Date();
        
        // Find completed races
        const raceSessions = sessions
            .filter(s => s.session_type === 'Race' && !s.session_name?.includes('Sprint'))
            .filter(s => s.date_end && new Date(s.date_end) < now)
            .map(s => s.session_key);
        
        const standings = {};
        const allDrivers = {};
        
        for (const sessionKey of raceSessions) {
            // Get driver info
            const driversResp = await fetch(`${OPENF1_BASE}/drivers?session_key=${sessionKey}`);
            const drivers = await driversResp.json();
            
            for (const d of drivers) {
                const num = d.driver_number;
                if (num && !allDrivers[num]) {
                    allDrivers[num] = {
                        name: d.name_acronym || `Driver ${num}`,
                        team: d.team_name || 'Unknown'
                    };
                }
            }
            
            // Get final positions
            const posResp = await fetch(`${OPENF1_BASE}/position?session_key=${sessionKey}`);
            const positions = await posResp.json();
            
            const final = {};
            for (const p of positions) {
                const driver = p.driver_number;
                const pos = p.position;
                const date = p.date;
                if (driver && pos) {
                    if (!final[driver] || date > final[driver].date) {
                        final[driver] = { pos, date };
                    }
                }
            }
            
            // Add points
            for (const [driver, { pos }] of Object.entries(final)) {
                const points = POINTS[pos] || 0;
                if (!standings[driver]) {
                    const driverData = allDrivers[driver] || { name: `Driver ${driver}`, team: 'Unknown' };
                    standings[driver] = { points: 0, name: driverData.name, team: driverData.team };
                }
                standings[driver].points += points;
            }
        }
        
        // Sort by points
        const sorted = Object.entries(standings)
            .sort((a, b) => b[1].points - a[1].points)
            .map(([driver, data], i) => ({
                position: i + 1,
                driver: data.name,
                team: data.team,
                points: data.points
            }));
        
        return { standings: sorted, round: raceSessions.length };
    });
}

/**
 * Get constructor standings from driver standings
 */
async function getConstructorStandings() {
    const { standings } = await getDriverStandings();
    
    const constructorPoints = {};
    for (const s of standings) {
        const team = s.team;
        if (!constructorPoints[team]) constructorPoints[team] = 0;
        constructorPoints[team] += s.points;
    }
    
    return Object.entries(constructorPoints)
        .sort((a, b) => b[1] - a[1])
        .map(([constructor, points], i) => ({
            position: i + 1,
            constructor,
            points
        }));
}

/**
 * Get next race
 */
async function getNextRace() {
    return fetchWithCache('schedule', async () => {
        const sessions = await fetchSessions();
        const now = new Date();
        
        // Find next race session
        const futureRaces = sessions
            .filter(s => s.session_type === 'Race' && !s.session_name?.includes('Sprint'))
            .filter(s => s.date_start && new Date(s.date_start) > now)
            .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
        
        if (futureRaces.length === 0) return null;
        
        const race = futureRaces[0];
        const raceDate = new Date(race.date_start);
        
        // Get all sessions for this race weekend
        const raceSessions = sessions
            .filter(s => s.meeting_key === race.meeting_key)
            .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
        
        return {
            name: race.meeting_name || 'Grand Prix',
            date: raceDate,
            circuit: race.location || '',
            sessions: raceSessions.map(s => ({
                name: formatSessionName(s.session_name || s.session_type),
                time: new Date(s.date_start)
            }))
        };
    });
}

/**
 * Get latest session results
 */
async function getLatestSession() {
    return fetchWithCache('latestSession', async () => {
        const sessions = await fetchSessions();
        const now = new Date();
        
        // Find most recent completed session
        const completedSessions = sessions
            .filter(s => s.date_end && new Date(s.date_end) < now)
            .sort((a, b) => new Date(b.date_end) - new Date(a.date_end));
        
        if (completedSessions.length === 0) return null;
        
        const latest = completedSessions[0];
        const sessionKey = latest.session_key;
        
        // Get drivers
        const driversResp = await fetch(`${OPENF1_BASE}/drivers?session_key=${sessionKey}`);
        const drivers = await driversResp.json();
        const driverMap = Object.fromEntries(drivers.map(d => [d.driver_number, d]));
        
        // Get laps
        const lapsResp = await fetch(`${OPENF1_BASE}/laps?session_key=${sessionKey}`);
        const laps = await lapsResp.json();
        
        // Find best lap per driver
        const bestLaps = {};
        for (const lap of laps) {
            const driver = lap.driver_number;
            const duration = lap.lap_duration;
            if (duration && (!bestLaps[driver] || duration < bestLaps[driver])) {
                bestLaps[driver] = duration;
            }
        }
        
        // Sort by lap time
        const results = Object.entries(bestLaps)
            .sort((a, b) => a[1] - b[1])
            .slice(0, 10)
            .map(([driver, duration], i) => {
                const driverInfo = driverMap[driver] || {};
                return {
                    position: i + 1,
                    driver: driverInfo.name_acronym || `Driver ${driver}`,
                    team: driverInfo.team_name || 'Unknown',
                    time: formatLapTime(duration)
                };
            });
        
        return {
            session: latest,
            results
        };
    });
}

/**
 * Format session name
 */
function formatSessionName(name) {
    const names = {
        'Practice 1': 'FP1',
        'Practice 2': 'FP2',
        'Practice 3': 'FP3',
        'Qualifying': 'Qualifying',
        'Sprint Qualifying': 'Sprint Quali',
        'Sprint': 'Sprint',
        'Race': 'Race'
    };
    return names[name] || name;
}

/**
 * Format lap time (seconds to M:SS.mmm)
 */
function formatLapTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(3).padStart(6, '0')}`;
}

/**
 * Format date for display
 */
function formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format time for display (SAST = UTC+2)
 */
function formatTime(date) {
    return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Africa/Johannesburg'
    }) + ' SAST';
}

/**
 * Render driver standings
 */
function renderDriverStandings(standings) {
    const container = document.getElementById('driver-standings');
    container.innerHTML = standings.slice(0, 10).map(s => `
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

/**
 * Render constructor standings
 */
function renderConstructorStandings(standings) {
    const container = document.getElementById('constructor-standings');
    container.innerHTML = standings.slice(0, 10).map(s => `
        <div class="driver-row">
            <div class="position ${s.position <= 3 ? 'p' + s.position : ''}">${s.position}</div>
            <div class="driver-info">
                <span class="driver-name">${s.constructor}</span>
            </div>
            <div class="driver-points">${s.points} pts</div>
        </div>
    `).join('');
}

/**
 * Render next race
 */
function renderNextRace(race) {
    if (!race) {
        document.getElementById('next-race-name').textContent = 'No upcoming races';
        return;
    }
    
    document.getElementById('next-race-name').textContent = race.name;
    document.getElementById('next-race-date').textContent = formatDate(race.date);
    document.getElementById('next-race-circuit').textContent = `📍 ${race.circuit}`;
    
    const sessionsContainer = document.getElementById('session-times');
    sessionsContainer.innerHTML = race.sessions.map(s => `
        <div class="session-item">
            <span class="session-name">${s.name}</span>
            <span class="session-time">${formatTime(s.time)}</span>
        </div>
    `).join('');
}

/**
 * Render latest session results
 */
function renderLatestResults(data) {
    if (!data) {
        document.getElementById('results-header').textContent = 'No completed sessions';
        return;
    }
    
    const sessionName = data.session.meeting_name || data.session.session_name || 'Session';
    document.getElementById('results-header').textContent = `${data.session.session_name || 'Session'} - ${sessionName}`;
    
    const tbody = document.getElementById('latest-results');
    tbody.innerHTML = data.results.map(r => `
        <tr>
            <td><div class="position ${r.position <= 3 ? 'p' + r.position : ''}">${r.position}</div></td>
            <td>${r.driver} <span class="team-tag team-${TEAM_COLORS[r.team] || 'default'}">${r.team.substring(0, 3).toUpperCase()}</span></td>
            <td>${r.time}</td>
        </tr>
    `).join('');
}

/**
 * Show error state
 */
function showError(container, message) {
    container.innerHTML = `<div class="error-message">${message}</div>`;
}

/**
 * Load all data
 */
async function loadAll() {
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.classList.add('loading');
    
    try {
        // Load in parallel
        const [driverStandings, constructorStandings, nextRace, latestSession] = await Promise.all([
            getDriverStandings().catch(e => ({ standings: [], error: e.message })),
            getConstructorStandings().catch(e => ({ standings: [], error: e.message })),
            getNextRace().catch(e => null),
            getLatestSession().catch(e => null)
        ]);
        
        renderDriverStandings(driverStandings.standings);
        renderConstructorStandings(constructorStandings);
        renderNextRace(nextRace);
        renderLatestSession(latestSession);
        
    } catch (error) {
        console.error('Failed to load data:', error);
        showError(document.getElementById('driver-standings'), 'Failed to load standings');
        showError(document.getElementById('constructor-standings'), 'Failed to load standings');
    } finally {
        refreshBtn.classList.remove('loading');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    
    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
        // Clear cache
        Object.keys(cache).forEach(key => {
            cache[key].data = null;
            cache[key].timestamp = 0;
        });
        loadAll();
    });
});

// Update season year
document.getElementById('season-year').textContent = `${new Date().getFullYear()} Season`;
