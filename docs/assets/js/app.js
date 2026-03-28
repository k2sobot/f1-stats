/**
 * F1 Stats - Client-side API handling with caching
 * Uses Jolpica API via CORS proxy for browser compatibility
 */

// CORS proxy for browser requests
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';

// Helper to fetch with CORS proxy
async function fetchAPI(url) {
    const proxyUrl = `${CORS_PROXY}${encodeURIComponent(url)}`;
    const resp = await fetch(proxyUrl);
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
}

// Cache configuration
const cache = {
    standings: { data: null, timestamp: 0, ttl: 5 * 60 * 1000 },
    schedule: { data: null, timestamp: 0, ttl: 60 * 60 * 1000 },
    results: { data: null, timestamp: 0, ttl: 2 * 60 * 1000 },
};

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
 * Get driver standings from Jolpica/Ergast
 */
async function getDriverStandings() {
    return fetchWithCache('standings', async () => {
        const year = new Date().getFullYear();
        const data = await fetchAPI(`${JOLPICA_BASE}/${year}/driverStandings.json`);
        
        const standingsTable = data.MRData?.StandingsTable?.StandingsLists?.[0];
        if (!standingsTable) return { standings: [], round: 0 };
        
        const standings = standingsTable.DriverStandings.map(s => ({
            position: parseInt(s.position),
            driver: s.Driver.code || `${s.Driver.givenName[0]}. ${s.Driver.familyName}`,
            team: s.Constructors[0]?.name || 'Unknown',
            points: parseInt(s.points),
            wins: parseInt(s.wins)
        }));
        
        return { standings, round: parseInt(standingsTable.round) };
    });
}

/**
 * Get constructor standings from Jolpica/Ergast
 */
async function getConstructorStandings() {
    return fetchWithCache('standings', async () => {
        const year = new Date().getFullYear();
        const data = await fetchAPI(`${JOLPICA_BASE}/${year}/constructorStandings.json`);
        
        const standingsTable = data.MRData?.StandingsTable?.StandingsLists?.[0];
        if (!standingsTable) return [];
        
        return standingsTable.ConstructorStandings.map(s => ({
            position: parseInt(s.position),
            constructor: s.Constructor.name,
            points: parseInt(s.points),
            wins: parseInt(s.wins)
        }));
    });
}

/**
 * Get next race from Jolpica/Ergast
 */
async function getNextRace() {
    return fetchWithCache('schedule', async () => {
        const year = new Date().getFullYear();
        const data = await fetchAPI(`${JOLPICA_BASE}/${year}.json`);
        
        const races = data.MRData?.RaceTable?.Races || [];
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
    });
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
 * Get latest race results
 */
async function getLatestResults() {
    return fetchWithCache('results', async () => {
        const year = new Date().getFullYear();
        
        // Get current round from standings
        const standingsData = await fetchAPI(`${JOLPICA_BASE}/${year}/driverStandings.json`);
        const round = standingsData.MRData?.StandingsTable?.StandingsLists?.[0]?.round || 1;
        
        if (round <= 1) {
            // Try to get qualifying results for first race
            const qualiData = await fetchAPI(`${JOLPICA_BASE}/${year}/1/qualifying.json`);
            const race = qualiData.MRData?.RaceTable?.Races?.[0];
            
            if (race?.QualifyingResults) {
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
        
        // Get last race results
        const data = await fetchAPI(`${JOLPICA_BASE}/${year}/${round}/results.json`);
        const race = data.MRData?.RaceTable?.Races?.[0];
        
        if (!race?.Results) return null;
        
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
    });
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
 * Render latest results
 */
function renderLatestResults(data) {
    if (!data) {
        document.getElementById('results-header').textContent = 'No completed sessions';
        document.getElementById('latest-results').innerHTML = '<tr><td colspan="3" class="loading-cell">No results yet</td></tr>';
        return;
    }
    
    document.getElementById('results-header').textContent = `${data.sessionName} - ${data.raceName}`;
    
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
        const [driverStandings, constructorStandings, nextRace, latestResults] = await Promise.all([
            getDriverStandings().catch(e => ({ standings: [], error: e.message })),
            getConstructorStandings().catch(e => []),
            getNextRace().catch(e => null),
            getLatestResults().catch(e => null)
        ]);
        
        renderDriverStandings(driverStandings);
        renderConstructorStandings(constructorStandings);
        renderNextRace(nextRace);
        renderLatestResults(latestResults);
        
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
    
    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
        Object.keys(cache).forEach(key => {
            cache[key].data = null;
            cache[key].timestamp = 0;
        });
        loadAll();
    });
});

// Update season year
document.getElementById('season-year').textContent = `${new Date().getFullYear()} Season`;
