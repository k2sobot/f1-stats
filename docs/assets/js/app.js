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

// Cache for loaded data (in-memory)
let dataCache = {
    drivers: null,
    constructors: null,
    schedule: null,
    qualifying: null,
    results: null
};

// Countdown state
let countdownInterval = null;
let nextRaceDate = null;

// LocalStorage cache key and expiry
const CACHE_KEY = 'f1-data-cache';
const CACHE_EXPIRY_DAYS = 7; // Cache for 7 days - fresh enough between race weekends

// Short-term cache for live data (weather, pitstops)
const LIVE_CACHE_KEY = 'f1-live-cache';
const LIVE_CACHE_MINUTES = 5; // 5-minute cache for live data

/**
 * Get cached data from localStorage
 */
function getCachedData() {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;
        
        const data = JSON.parse(cached);
        const now = new Date();
        const cachedAt = new Date(data.timestamp);
        
        // Check if cache is expired
        const daysSinceCache = (now - cachedAt) / (1000 * 60 * 60 * 24);
        if (daysSinceCache > CACHE_EXPIRY_DAYS) {
            localStorage.removeItem(CACHE_KEY);
            return null;
        }
        
        return data;
    } catch (e) {
        return null;
    }
}

/**
 * Save data to localStorage cache
 */
function setCachedData(data) {
    try {
        const cacheData = {
            timestamp: new Date().toISOString(),
            drivers: data.drivers,
            constructors: data.constructors,
            schedule: data.schedule,
            qualifying: data.qualifying,
            results: data.results
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (e) {
        // localStorage might be full or disabled
    }
}

/**
 * Load local JSON data with caching
 */
async function loadLocalData(file) {
    // Check localStorage cache first
    const cached = getCachedData();
    if (cached && cached[file]) {
        return cached[file];
    }
    
    // Fetch from server
    const resp = await fetch(`data/${file}.json`);
    if (!resp.ok) return null;
    return resp.json();
}

/**
 * Get live data cache (5-minute expiry)
 */
function getLiveCache(type) {
    try {
        const cached = localStorage.getItem(LIVE_CACHE_KEY);
        if (!cached) return null;
        
        const data = JSON.parse(cached);
        if (!data[type]) return null;
        
        const now = new Date();
        const cachedAt = new Date(data[type].timestamp);
        const minutesSinceCache = (now - cachedAt) / (1000 * 60);
        
        if (minutesSinceCache > LIVE_CACHE_MINUTES) {
            delete data[type];
            localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(data));
            return null;
        }
        
        return data[type].data;
    } catch (e) {
        return null;
    }
}

/**
 * Set live data cache
 */
function setLiveCache(type, data) {
    try {
        let cache = {};
        const existing = localStorage.getItem(LIVE_CACHE_KEY);
        if (existing) cache = JSON.parse(existing);
        
        cache[type] = {
            timestamp: new Date().toISOString(),
            data: data
        };
        
        localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        // localStorage might be full
    }
}

/**
 * Fetch weather data from OpenF1 (live during sessions)
 */
async function getWeather(sessionKey) {
    // Check cache first
    const cached = getLiveCache('weather');
    if (cached) return cached;
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const resp = await fetch(`https://api.openf1.org/v1/weather?session_key=${sessionKey}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!resp.ok) return null;
        
        const data = await resp.json();
        if (data && data.length > 0) {
            // Get latest weather reading
            const latest = data[data.length - 1];
            const weather = {
                airTemp: latest.air_temperature,
                trackTemp: latest.track_temperature,
                humidity: latest.humidity,
                windSpeed: latest.wind_speed,
                rainfall: latest.rainfall || 0
            };
            
            setLiveCache('weather', weather);
            return weather;
        }
    } catch (e) {
        console.log('Weather fetch failed:', e.message);
    }
    
    return null;
}

/**
 * Fetch pit stop data from OpenF1 (live during race)
 */
async function getPitStops(sessionKey) {
    // Check cache first
    const cached = getLiveCache('pitstops');
    if (cached) return cached;
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        const [stopsResp, driversResp] = await Promise.all([
            fetch(`https://api.openf1.org/v1/pit?session_key=${sessionKey}`, {
                signal: controller.signal
            }),
            fetch(`https://api.openf1.org/v1/drivers?session_key=${sessionKey}`, {
                signal: controller.signal
            })
        ]);
        clearTimeout(timeoutId);
        
        if (!stopsResp.ok || !driversResp.ok) return null;
        
        const stops = await stopsResp.json();
        const drivers = await driversResp.json();
        
        // Build driver lookup
        const driverMap = {};
        for (const d of drivers) {
            driverMap[d.driver_number] = d.name_acronym || d.first_name?.substring(0, 3).toUpperCase() || `D${d.driver_number}`;
        }
        
        // Sort by lap number, get latest stops
        const sorted = stops.sort((a, b) => b.lap_number - a.lap_number);
        const pitstops = sorted.slice(0, 15).map(s => ({
            lap: s.lap_number,
            driver: driverMap[s.driver_number] || `D${s.driver_number}`,
            duration: s.pit_duration ? `${s.pit_duration.toFixed(2)}s` : '-',
            tire: s.tyre_compound || '-'
        }));
        
        setLiveCache('pitstops', pitstops);
        return pitstops;
    } catch (e) {
        console.log('Pit stops fetch failed:', e.message);
    }
    
    return null;
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
 * Update countdown timer display
 */
function updateCountdown() {
    if (!nextRaceDate) return;
    
    const now = new Date();
    const diff = nextRaceDate - now;
    
    if (diff <= 0) {
        // Race time!
        document.getElementById('countdown-days').textContent = '00';
        document.getElementById('countdown-hours').textContent = '00';
        document.getElementById('countdown-minutes').textContent = '00';
        document.getElementById('countdown-seconds').textContent = '00';
        document.getElementById('countdown-banner').classList.add('race-time');
        
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        return;
    }
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    document.getElementById('countdown-days').textContent = String(days).padStart(2, '0');
    document.getElementById('countdown-hours').textContent = String(hours).padStart(2, '0');
    document.getElementById('countdown-minutes').textContent = String(minutes).padStart(2, '0');
    document.getElementById('countdown-seconds').textContent = String(seconds).padStart(2, '0');
}

/**
 * Start countdown timer
 */
function startCountdown(raceDate, raceName) {
    // Clear existing interval if any
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }
    
    nextRaceDate = raceDate;
    
    // Update race name
    document.getElementById('countdown-race').textContent = raceName;
    
    // Remove race-time class if present
    document.getElementById('countdown-banner').classList.remove('race-time');
    
    // Initial update
    updateCountdown();
    
    // Update every second
    countdownInterval = setInterval(updateCountdown, 1000);
}

/**
 * Render next race
 */
function renderNextRace(race) {
    if (!race) {
        document.getElementById('next-race-name').textContent = 'No upcoming races';
        document.getElementById('countdown-race').textContent = 'Season Complete';
        return;
    }
    
    document.getElementById('next-race-name').textContent = race.name;
    document.getElementById('next-race-date').textContent = formatDate(race.date);
    document.getElementById('next-race-circuit').textContent = `📍 ${race.circuit}${race.country ? ', ' + race.country : ''}`;
    
    // Start countdown timer
    startCountdown(race.date, race.name);
    
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
 * Render weather data
 */
function renderWeather(weather) {
    const container = document.getElementById('weather-card');
    const content = document.getElementById('weather-content');
    
    if (!weather) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    const rainIcon = weather.rainfall > 0 ? '🌧️' : (weather.humidity > 70 ? '⛅' : '☀️');
    
    content.innerHTML = `
        <div class="weather-item">
            <span class="weather-icon">${rainIcon}</span>
            <span class="weather-label">Conditions</span>
            <span class="weather-value">${weather.rainfall > 0 ? 'Rain' : (weather.humidity > 70 ? 'Overcast' : 'Clear')}</span>
        </div>
        <div class="weather-item">
            <span class="weather-icon">🌡️</span>
            <span class="weather-label">Air Temp</span>
            <span class="weather-value">${weather.airTemp}°C</span>
        </div>
        <div class="weather-item">
            <span class="weather-icon">🏁</span>
            <span class="weather-label">Track Temp</span>
            <span class="weather-value">${weather.trackTemp}°C</span>
        </div>
        <div class="weather-item">
            <span class="weather-icon">💧</span>
            <span class="weather-label">Humidity</span>
            <span class="weather-value">${weather.humidity}%</span>
        </div>
        <div class="weather-item">
            <span class="weather-icon">💨</span>
            <span class="weather-label">Wind</span>
            <span class="weather-value">${weather.windSpeed} km/h</span>
        </div>
    `;
}

/**
 * Render pit stops data
 */
function renderPitStops(pitstops) {
    const container = document.getElementById('pitstops-card');
    const tbody = document.getElementById('pitstops-results');
    
    if (!pitstops || pitstops.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    tbody.innerHTML = pitstops.map(s => `
        <tr>
            <td>${s.lap}</td>
            <td>${s.driver}</td>
            <td>${s.duration}</td>
            <td><span class="tire-${s.tire?.toLowerCase()}">${s.tire}</span></td>
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
        // Check localStorage cache first
        const cached = getCachedData();
        
        if (cached) {
            // Use cached data
            dataCache = {
                drivers: cached.drivers,
                constructors: cached.constructors,
                schedule: cached.schedule,
                qualifying: cached.qualifying,
                results: cached.results
            };
        }
        
        const [driverStandings, constructorStandings, nextRace, latestSession] = await Promise.all([
            getDriverStandings().catch(e => ({ standings: [], error: e.message })),
            getConstructorStandings().catch(e => []),
            getNextRace().catch(e => null),
            getLatestSession().catch(e => null)
        ]);
        
        // Save to localStorage cache
        setCachedData(dataCache);
        
        renderDriverStandings(driverStandings);
        renderConstructorStandings(constructorStandings);
        renderNextRace(nextRace);
        renderLatestResults(latestSession);
        
        // Fetch live data if in a race weekend
        const weekendState = await getWeekendState();
        if (weekendState.inWeekend && weekendState.lastCompleted) {
            const sessionKey = weekendState.lastCompleted.session_key;
            
            // Fetch weather and pitstops in parallel (non-blocking)
            const [weather, pitstops] = await Promise.all([
                getWeather(sessionKey).catch(() => null),
                getPitStops(sessionKey).catch(() => null)
            ]);
            
            renderWeather(weather);
            renderPitStops(pitstops);
        } else {
            // Hide live data cards outside race weekends
            document.getElementById('weather-card').style.display = 'none';
            document.getElementById('pitstops-card').style.display = 'none';
        }
        
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
