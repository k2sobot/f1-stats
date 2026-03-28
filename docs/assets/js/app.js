/**
 * F1 Stats - Static data with auto-update
 */

// Team color mapping
const TEAM_COLORS = {
    'Mercedes': 'mercedes',
    'Ferrari': 'ferrari',
    'Red Bull Racing': 'redbull',
    'Red Bull': 'redbull',
    'McLaren': 'mclaren',
    'Alpine F1 Team': 'alpine',
    'Alpine': 'alpine',
    'Aston Martin F1 Team': 'astonmartin',
    'Aston Martin': 'astonmartin',
    'Haas F1 Team': 'haas',
    'Haas': 'haas',
    'Williams': 'williams',
    'Audi': 'audi',
    'Cadillac': 'cadillac',
    'Racing Bulls': 'racingbulls',
    'RB': 'racingbulls',
    'Visa RB': 'racingbulls',
};

// Cache for loaded data
let dataCache = {
    drivers: null,
    constructors: null,
    schedule: null,
    qualifying: null,
    results: null
};

/**
 * Load local JSON data
 */
async function loadLocalData(file) {
    const resp = await fetch(`data/${file}.json`);
    if (!resp.ok) return null;
    return resp.json();
}

/**
 * Get driver standings
 */
async function getDriverStandings() {
    if (!dataCache.drivers) {
        dataCache.drivers = await loadLocalData('drivers');
    }
    if (!dataCache.drivers) return { standings: [], round: 0 };
    
    const standingsTable = dataCache.drivers.MRData?.StandingsTable?.StandingsLists?.[0];
    if (!standingsTable) return { standings: [], round: 0 };
    
    const standings = standingsTable.DriverStandings.map(s => ({
        position: parseInt(s.position),
        driver: s.Driver.code || `${s.Driver.givenName[0]}. ${s.Driver.familyName}`,
        team: s.Constructors[0]?.name || 'Unknown',
        points: parseInt(s.points),
        wins: parseInt(s.wins)
    }));
    
    return { standings, round: parseInt(standingsTable.round) };
}

/**
 * Get constructor standings
 */
async function getConstructorStandings() {
    if (!dataCache.constructors) {
        dataCache.constructors = await loadLocalData('constructors');
    }
    if (!dataCache.constructors) return [];
    
    const standingsTable = dataCache.constructors.MRData?.StandingsTable?.StandingsLists?.[0];
    if (!standingsTable) return [];
    
    return standingsTable.ConstructorStandings.map(s => ({
        position: parseInt(s.position),
        constructor: s.Constructor.name,
        points: parseInt(s.points),
        wins: parseInt(s.wins)
    }));
}

/**
 * Get next race
 */
async function getNextRace() {
    if (!dataCache.schedule) {
        dataCache.schedule = await loadLocalData('schedule');
    }
    if (!dataCache.schedule) return null;
    
    const races = dataCache.schedule.MRData?.RaceTable?.Races || [];
    const now = new Date();
    
    // Find next race
    const nextRace = races.find(r => {
        const raceDate = new Date(`${r.date}T${r.time || '00:00:00Z'}`);
        return raceDate > now;
    });
    
    if (!nextRace) return null;
    
    const raceDate = new Date(`${nextRace.date}T${nextRace.time || '00:00:00Z'}`);
    
    // Build session times based on typical Suzuka schedule
    // Race is Sunday, so FP1/FP2 on Friday, FP3/Quali on Saturday
    const friday = addDays(raceDate, -2);
    const saturday = addDays(raceDate, -1);
    
    // Suzuka 2026 schedule (UTC times)
    const sessions = [
        { name: 'FP1', date: new Date('2026-03-27T01:30:00Z') },
        { name: 'FP2', date: new Date('2026-03-27T05:00:00Z') },
        { name: 'FP3', date: new Date('2026-03-28T04:30:00Z') },
        { name: 'Qualifying', date: new Date('2026-03-28T08:00:00Z') },
        { name: 'Race', date: raceDate }
    ];
    
    // Find current session status
    const currentSession = sessions.find(s => {
        const sessionEnd = new Date(s.date.getTime() + 60 * 60 * 1000); // Assume 1hr duration
        return now >= s.date && now < sessionEnd;
    });
    
    return {
        name: nextRace.raceName,
        date: raceDate,
        circuit: nextRace.Circuit?.circuitName || '',
        country: nextRace.Circuit?.Location?.country || '',
        sessions: sessions,
        currentSession: currentSession
    };
}

/**
 * Add days to a date
 */
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

/**
 * Set time on a date
 */
function setDateTime(date, timeStr) {
    const d = new Date(date);
    const [hours, mins] = timeStr.split(':');
    d.setUTCHours(parseInt(hours), parseInt(mins), 0, 0);
    return d;
}

/**
 * Get latest session results
 */
async function getLatestSession() {
    // Try to load qualifying and race results
    if (!dataCache.qualifying) {
        dataCache.qualifying = await loadLocalData('qualifying');
    }
    if (!dataCache.results) {
        dataCache.results = await loadLocalData('results');
    }
    
    // Prefer race results if available
    if (dataCache.results?.MRData?.RaceTable?.Races?.[0]?.Results) {
        const race = dataCache.results.MRData.RaceTable.Races[0];
        return {
            sessionName: 'Race',
            raceName: race.raceName,
            results: race.Results.slice(0, 10).map(r => ({
                position: parseInt(r.position),
                driver: r.Driver.code || `${r.Driver.givenName[0]}. ${r.Driver.familyName}`,
                team: r.Constructor.name,
                time: r.Time?.time || r.status
            }))
        };
    }
    
    // Fall back to qualifying
    if (dataCache.qualifying?.MRData?.RaceTable?.Races?.[0]?.QualifyingResults) {
        const race = dataCache.qualifying.MRData.RaceTable.Races[0];
        return {
            sessionName: 'Qualifying',
            raceName: race.raceName,
            results: race.QualifyingResults.slice(0, 10).map((r, i) => ({
                position: i + 1,
                driver: r.Driver.code || `${r.Driver.givenName[0]}. ${r.Driver.familyName}`,
                team: r.Constructor.name,
                time: r.Q3 || r.Q2 || r.Q1 || '-'
            }))
        };
    }
    
    return null;
}

/**
 * Format date for display
 */
function formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format date and time for display in user's local timezone
 */
function formatDateTime(date) {
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const userOffset = -new Date().getTimezoneOffset() / 60;
    const offsetStr = userOffset >= 0 ? `UTC+${userOffset}` : `UTC${userOffset}`;
    
    const day = date.toLocaleDateString('en-US', { weekday: 'short' });
    const time = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false
    });
    
    return `${day} ${time} (${offsetStr})`;
}

/**
 * Format UTC time for display
 */
function formatUTC(date) {
    const day = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const time = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC'
    });
    return `${day} ${time} UTC`;
}

/**
 * Render driver standings
 */
function renderDriverStandings(data) {
    const container = document.getElementById('driver-standings');
    if (!data?.standings?.length) {
        container.innerHTML = '<div class="error-message">No standings available</div>';
        return;
    }
    
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

/**
 * Render constructor standings
 */
function renderConstructorStandings(standings) {
    const container = document.getElementById('constructor-standings');
    if (!standings?.length) {
        container.innerHTML = '<div class="error-message">No standings available</div>';
        return;
    }
    
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
    document.getElementById('next-race-circuit').textContent = `📍 ${race.circuit}${race.country ? ', ' + race.country : ''}`;
    
    // Show/hide live banner at top
    const liveBanner = document.getElementById('live-banner');
    const liveText = document.getElementById('live-text');
    
    if (race.currentSession) {
        liveBanner.style.display = 'flex';
        liveText.textContent = `${race.currentSession.name} in progress - ${race.name}`;
    } else {
        liveBanner.style.display = 'none';
    }
    
    // Show session in progress indicator in card
    if (race.currentSession) {
        const sessionsContainer = document.getElementById('session-times');
        sessionsContainer.innerHTML = `
            <div class="session-live">
                <span class="live-indicator">🔴 LIVE</span>
                <span class="live-session">${race.currentSession.name} in progress</span>
            </div>
        ` + race.sessions.map(s => `
            <div class="session-item ${s.name === race.currentSession.name ? 'active' : ''}">
                <span class="session-name">${s.name}</span>
                <span class="session-time">${formatDateTime(s.date)}</span>
                <span class="session-utc">${formatUTC(s.date)}</span>
            </div>
        `).join('');
    } else {
        const sessionsContainer = document.getElementById('session-times');
        sessionsContainer.innerHTML = race.sessions.map(s => `
            <div class="session-item">
                <span class="session-name">${s.name}</span>
                <span class="session-time">${formatDateTime(s.date)}</span>
                <span class="session-utc">${formatUTC(s.date)}</span>
            </div>
        `).join('');
    }
}

/**
 * Render latest session results
 */
function renderLatestResults(data) {
    const header = document.getElementById('results-header');
    const tbody = document.getElementById('latest-results');
    
    if (!data) {
        header.textContent = 'No session results available';
        tbody.innerHTML = '<tr><td colspan="3" class="loading-cell">Check back after a session</td></tr>';
        return;
    }
    
    header.textContent = `${data.sessionName} - ${data.raceName}`;
    
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
        const [driverStandings, constructorStandings, nextRace, latestSession] = await Promise.all([
            getDriverStandings().catch(e => ({ standings: [], error: e.message })),
            getConstructorStandings().catch(e => []),
            getNextRace().catch(e => null),
            getLatestSession().catch(e => null)
        ]);
        
        renderDriverStandings(driverStandings);
        renderConstructorStandings(constructorStandings);
        renderNextRace(nextRace);
        renderLatestResults(latestSession);
        
        // Update cache status
        const status = document.getElementById('cache-status');
        status.textContent = 'Data updated via GitHub Actions';
        
    } catch (error) {
        console.error('Failed to load data:', error);
        showError(document.getElementById('driver-standings'), 'Failed to load');
        showError(document.getElementById('constructor-standings'), 'Failed to load');
    } finally {
        refreshBtn.classList.remove('loading');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadAll();
});

// Update season year
document.getElementById('season-year').textContent = `${new Date().getFullYear()} Season`;
