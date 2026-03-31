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
    
    // Suzuka 2026 schedule (UTC times) - based on actual F1 schedule
    const sessions = [
        { name: 'FP1', date: new Date('2026-03-27T01:30:00Z') },
        { name: 'FP2', date: new Date('2026-03-27T05:00:00Z') },
        { name: 'FP3', date: new Date('2026-03-28T04:30:00Z') },
        { name: 'Qualifying', date: new Date('2026-03-28T06:00:00Z') },  // 08:00 SAST
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
 * Check if we're in a race weekend and get weekend state
 */
async function getWeekendState() {
    const now = new Date();
    const year = now.getFullYear();
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const resp = await fetch(`https://api.openf1.org/v1/sessions?year=${year}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!resp.ok) {
            return { inWeekend: false };
        }
        
        const sessions = await resp.json();
        
        // Group sessions by meeting
        const meetings = {};
        for (const s of sessions) {
            const meetingKey = s.meeting_key;
            if (!meetings[meetingKey]) {
                meetings[meetingKey] = {
                    country: s.country_name,
                    circuit: s.circuit_short_name,
                    sessions: []
                };
            }
            meetings[meetingKey].sessions.push(s);
        }
        
        // Check each meeting
        for (const [meetingKey, meeting] of Object.entries(meetings)) {
            const sessionTimes = [];
            for (const s of meeting.sessions) {
                if (s.date_start) {
                    try { sessionTimes.push(new Date(s.date_start)); } catch {}
                }
                if (s.date_end) {
                    try { sessionTimes.push(new Date(s.date_end)); } catch {}
                }
            }
            
            if (sessionTimes.length === 0) continue;
            
            const weekendStart = new Date(Math.min(...sessionTimes));
            weekendStart.setHours(weekendStart.getHours() - 12); // Start 12hrs before first session
            const weekendEnd = new Date(Math.max(...sessionTimes));
            weekendEnd.setHours(weekendEnd.getHours() + 6); // End 6hrs after last session
            
            if (now >= weekendStart && now <= weekendEnd) {
                // We're in this weekend! Find session states
                let currentSession = null;
                let lastCompleted = null;
                let nextSession = null;
                
                // Sort sessions by start time
                const sortedSessions = meeting.sessions.sort((a, b) => 
                    new Date(a.date_start) - new Date(b.date_start)
                );
                
                for (const s of sortedSessions) {
                    if (!s.date_start || !s.date_end) continue;
                    
                    try {
                        const start = new Date(s.date_start);
                        const end = new Date(s.date_end);
                        
                        if (start <= now && now <= end) {
                            currentSession = s;
                        } else if (end < now) {
                            lastCompleted = s;
                        } else if (start > now && !nextSession) {
                            nextSession = s;
                        }
                    } catch {}
                }
                
                return {
                    inWeekend: true,
                    country: meeting.country,
                    circuit: meeting.circuit,
                    meetingKey: meetingKey,
                    currentSession: currentSession,
                    lastCompleted: lastCompleted,
                    nextSession: nextSession
                };
            }
        }
        
        return { inWeekend: false };
    } catch (e) {
        console.error('Failed to get weekend state:', e);
        return { inWeekend: false };
    }
}

/**
 * Fetch live session results from OpenF1
 */
async function fetchLiveSessionResults(sessionKey) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        const [driversResp, lapsResp] = await Promise.all([
            fetch(`https://api.openf1.org/v1/drivers?session_key=${sessionKey}`, { signal: controller.signal }),
            fetch(`https://api.openf1.org/v1/laps?session_key=${sessionKey}`, { signal: controller.signal })
        ]);
        
        clearTimeout(timeoutId);
        
        const drivers = await driversResp.json();
        const laps = await lapsResp.json();
        
        // Build driver lookup
        const driverMap = {};
        for (const d of drivers) {
            driverMap[d.driver_number] = {
                name: d.name_acronym || `D${d.driver_number}`,
                team: d.team_name || 'Unknown'
            };
        }
        
        // Find best lap per driver
        const bestLaps = {};
        for (const lap of laps) {
            const driverNum = lap.driver_number;
            const duration = lap.lap_duration;
            if (duration && (!bestLaps[driverNum] || duration < bestLaps[driverNum].duration)) {
                bestLaps[driverNum] = { duration };
            }
        }
        
        // Sort by lap time
        const results = Object.entries(bestLaps)
            .sort((a, b) => a[1].duration - b[1].duration)
            .slice(0, 10)
            .map(([driverNum, data], i) => ({
                position: i + 1,
                driver: driverMap[driverNum]?.name || `D${driverNum}`,
                team: driverMap[driverNum]?.team || 'Unknown',
                time: formatLapTime(data.duration),
                fastestLap: false
            }));
        
        return results;
    } catch (e) {
        console.error('Failed to fetch live session:', e);
        return null;
    }
}

/**
 * Format lap time from seconds
 */
function formatLapTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(3).padStart(6, '0')}`;
}

/**
 * Get latest session results - now with weekend context
 */
async function getLatestSession() {
    // First check if we're in a race weekend
    const weekendState = await getWeekendState();
    
    if (weekendState.inWeekend && weekendState.lastCompleted) {
        // During a race weekend - fetch live data for last completed session
        const sessionKey = weekendState.lastCompleted.session_key;
        const sessionName = weekendState.lastCompleted.session_name || 'Session';
        const results = await fetchLiveSessionResults(sessionKey);
        
        if (results && results.length > 0) {
            return {
                sessionName: sessionName,
                raceName: `${weekendState.country}GP`,
                results: results,
                fastestLap: null,
                weekendContext: {
                    inWeekend: true,
                    country: weekendState.country,
                    circuit: weekendState.circuit,
                    lastCompleted: weekendState.lastCompleted.session_name,
                    currentSession: weekendState.currentSession?.session_name || null,
                    nextSession: weekendState.nextSession?.session_name || null
                }
            };
        }
    }
    
    // Outside race weekend or live data failed - use static data
    if (!dataCache.qualifying) {
        dataCache.qualifying = await loadLocalData('qualifying');
    }
    if (!dataCache.results) {
        dataCache.results = await loadLocalData('results');
    }
    
    const standingsData = dataCache.drivers || await loadLocalData('drivers');
    const currentRound = standingsData?.MRData?.StandingsTable?.StandingsLists?.[0]?.round || 1;
    
    const qualiRace = dataCache.qualifying?.MRData?.RaceTable?.Races?.[0];
    const qualiRound = dataCache.qualifying?.MRData?.RaceTable?.round;
    
    const raceData = dataCache.results?.MRData?.RaceTable?.Races?.[0];
    const raceRound = dataCache.results?.MRData?.RaceTable?.round;
    
    if (raceData?.Results && raceRound <= currentRound) {
        const fastestLapDriver = raceData.Results.find(r => r.FastestLap?.rank === '1');
        
        return {
            sessionName: 'Race',
            raceName: raceData.raceName,
            results: raceData.Results.slice(0, 10).map(r => ({
                position: parseInt(r.position),
                driver: r.Driver.code || `${r.Driver.givenName[0]}. ${r.Driver.familyName}`,
                team: r.Constructor.name,
                time: r.Time?.time || r.status,
                fastestLap: r.FastestLap?.rank === '1'
            })),
            fastestLap: fastestLapDriver ? {
                driver: fastestLapDriver.Driver.code,
                time: fastestLapDriver.FastestLap?.Time?.time
            } : null,
            weekendContext: { inWeekend: false }
        };
    }
    
    if (qualiRace?.QualifyingResults) {
        return {
            sessionName: 'Qualifying',
            raceName: qualiRace.raceName,
            results: qualiRace.QualifyingResults.slice(0, 10).map((r, i) => ({
                position: i + 1,
                driver: r.Driver.code || `${r.Driver.givenName[0]}. ${r.Driver.familyName}`,
                team: r.Constructor.name,
                time: r.Q3 || r.Q2 || r.Q1 || '-',
                fastestLap: false
            })),
            fastestLap: null,
            weekendContext: { inWeekend: false }
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
    
    // Just show session times (no redundant live indicator)
    const sessionsContainer = document.getElementById('session-times');
    sessionsContainer.innerHTML = race.sessions.map(s => `
        <div class="session-item ${s.name === race.currentSession?.name ? 'active' : ''}">
            <span class="session-name">${s.name}</span>
            <span class="session-time">${formatDateTime(s.date)}</span>
            <span class="session-utc">${formatUTC(s.date)}</span>
        </div>
    `).join('');
}

/**
 * Render latest session results
 */
function renderLatestResults(data) {
    const header = document.getElementById('results-header');
    const tbody = document.getElementById('latest-results');
    const liveBanner = document.getElementById('live-banner');
    const liveText = document.getElementById('live-text');
    
    if (!data) {
        header.textContent = 'No session results available';
        tbody.innerHTML = '<tr><td colspan="3" class="loading-cell">Check back after a session</td></tr>';
        return;
    }
    
    // Handle weekend context
    if (data.weekendContext?.inWeekend) {
        const ctx = data.weekendContext;
        
        // Show live banner with context
        if (ctx.currentSession) {
            liveBanner.style.display = 'flex';
            liveText.textContent = `${ctx.currentSession} LIVE - ${ctx.country}GP`;
        } else if (ctx.nextSession) {
            liveBanner.style.display = 'flex';
            liveBanner.classList.add('upcoming');
            liveText.textContent = `Next: ${ctx.nextSession} - ${ctx.country}GP`;
        } else {
            liveBanner.style.display = 'none';
        }
        
        // Show session context in results header
        header.innerHTML = `<span class="session-label">${data.sessionName}</span> Results <span class="race-location">${ctx.country}GP</span>`;
    } else {
        liveBanner.style.display = 'none';
        header.textContent = `${data.sessionName} - ${data.raceName}`;
    }
    
    // Add fastest lap info if available
    if (data.fastestLap) {
        header.innerHTML = `${data.sessionName} - ${data.raceName} <span class="fastest-lap-header"><span class="fl-badge">FL</span> ${data.fastestLap.driver} (${data.fastestLap.time})</span>`;
    }
    
    tbody.innerHTML = data.results.map(r => `
        <tr>
            <td><div class="position ${r.position <= 3 ? 'p' + r.position : ''}">${r.position}</div></td>
            <td>${r.driver} ${r.fastestLap ? '<span class="fl-badge" title="Fastest Lap">FL</span>' : ''} <span class="team-tag team-${TEAM_COLORS[r.team] || 'default'}">${r.team.substring(0, 3).toUpperCase()}</span></td>
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
        
        // Refresh poll if available
        if (typeof window.refreshPoll === 'function') {
            window.refreshPoll();
        }
        
    } catch (error) {
        console.error('Failed to load data:', error);
        showError(document.getElementById('driver-standings'), 'Failed to load');
        showError(document.getElementById('constructor-standings'), 'Failed to load');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Update season year
    document.getElementById('season-year').textContent = `${new Date().getFullYear()} Season`;
    loadAll();
});
