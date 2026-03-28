/**
 * F1 Stats - Static data with GitHub Actions auto-update
 * Data is fetched from Jolpica API and committed to repo
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
    lastUpdate: null
};

/**
 * Load local JSON data
 */
async function loadLocalData(file) {
    const resp = await fetch(`data/${file}.json`);
    if (!resp.ok) throw new Error(`Failed to load ${file}`);
    return resp.json();
}

/**
 * Get driver standings
 */
async function getDriverStandings() {
    if (!dataCache.drivers) {
        const data = await loadLocalData('drivers');
        dataCache.drivers = data;
    }
    
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
        const data = await loadLocalData('constructors');
        dataCache.constructors = data;
    }
    
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
        const data = await loadLocalData('schedule');
        dataCache.schedule = data;
    }
    
    const races = dataCache.schedule.MRData?.RaceTable?.Races || [];
    const now = new Date();
    
    // Find next race
    const nextRace = races.find(r => {
        const raceDate = new Date(`${r.date}T${r.time || '00:00:00Z'}`);
        return raceDate > now;
    });
    
    if (!nextRace) return null;
    
    const raceDate = new Date(`${nextRace.date}T${nextRace.time || '00:00:00Z'}`);
    
    // Build session times (approximate based on typical schedule)
    const sessions = [
        { name: 'FP1', date: addDays(raceDate, -2) },
        { name: 'FP2', date: addDays(raceDate, -2) },
        { name: 'FP3', date: addDays(raceDate, -1) },
        { name: 'Qualifying', date: addDays(raceDate, -1) },
        { name: 'Race', date: raceDate }
    ];
    
    return {
        name: nextRace.raceName,
        date: raceDate,
        circuit: nextRace.Circuit?.circuitName || '',
        country: nextRace.Circuit?.Location?.country || '',
        sessions: sessions.map(s => ({
            name: s.name,
            time: s.date
        }))
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
    
    const sessionsContainer = document.getElementById('session-times');
    sessionsContainer.innerHTML = race.sessions.map(s => `
        <div class="session-item">
            <span class="session-name">${s.name}</span>
            <span class="session-time">${formatTime(s.time)}</span>
        </div>
    `).join('');
}

/**
 * Render latest results (placeholder - would need results data)
 */
function renderLatestResults() {
    document.getElementById('results-header').textContent = 'Race Results';
    document.getElementById('latest-results').innerHTML = '<tr><td colspan="3" class="loading-cell">Data updates after each race</td></tr>';
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
        const [driverStandings, constructorStandings, nextRace] = await Promise.all([
            getDriverStandings().catch(e => ({ standings: [], error: e.message })),
            getConstructorStandings().catch(e => []),
            getNextRace().catch(e => null)
        ]);
        
        renderDriverStandings(driverStandings);
        renderConstructorStandings(constructorStandings);
        renderNextRace(nextRace);
        renderLatestResults();
        
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
