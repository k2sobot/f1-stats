/**
 * F1 Stats - Live session data with Tailwind CSS rendering
 */

const TEAM_COLORS = {
    'Mercedes': 'mercedes', 'Ferrari': 'ferrari', 'Red Bull Racing': 'redbull', 'Red Bull': 'redbull',
    'McLaren': 'mclaren', 'Alpine F1 Team': 'alpine', 'Alpine': 'alpine', 'Aston Martin F1 Team': 'astonmartin',
    'Aston Martin': 'astonmartin', 'Haas F1 Team': 'haas', 'Haas': 'haas', 'Williams': 'williams',
    'Audi': 'audi', 'Cadillac': 'cadillac', 'Cadillac F1 Team': 'cadillac', 'Racing Bulls': 'racingbulls', 'RB': 'racingbulls', 'RB F1 Team': 'racingbulls',
};

const TEAM_BG_COLORS = {
    'mercedes': 'bg-teal-500',
    'ferrari': 'bg-red-600',
    'redbull': 'bg-blue-700',
    'mclaren': 'bg-orange-500',
    'alpine': 'bg-blue-500',
    'astonmartin': 'bg-green-800',
    'haas': 'bg-gray-400',
    'williams': 'bg-blue-600',
    'audi': 'bg-red-800',
    'cadillac': 'bg-gray-300',
    'racingbulls': 'bg-gray-600',
};

let dataCache = { drivers: null, constructors: null, schedule: null, qualifying: null, results: null, driverMap: null };

async function loadLocalData(file) {
    try {
        const resp = await fetch(`data/${file}.json`);
        return resp.ok ? resp.json() : null;
    } catch { return null; }
}

async function loadLiveData() {
    try {
        const resp = await fetch('data/live/latest.json');
        return resp.ok ? resp.json() : null;
    } catch { return null; }
}

async function loadDriverMap() {
    if (dataCache.driverMap) return dataCache.driverMap;
    const data = await loadLocalData('drivers_2026');
    if (!data?.drivers) return {};
    dataCache.driverMap = {};
    for (const d of data.drivers) {
        dataCache.driverMap[d.driver_number] = d;
    }
    return dataCache.driverMap;
}

async function getDriverStandings() {
    if (!dataCache.drivers) dataCache.drivers = await loadLocalData('drivers');
    if (!dataCache.drivers) return { standings: [], round: 0, lastUpdated: null };
    const table = dataCache.drivers.MRData?.StandingsTable?.StandingsLists?.[0];
    if (!table) return { standings: [], round: 0, lastUpdated: null };
    return {
        standings: table.DriverStandings.map(s => ({
            position: parseInt(s.position),
            driver: s.Driver.code || `${s.Driver.givenName[0]}. ${s.Driver.familyName}`,
            team: s.Constructors[0]?.name || 'Unknown',
            points: parseInt(s.points), wins: parseInt(s.wins)
        })),
        round: parseInt(table.round),
        lastUpdated: dataCache.drivers.lastUpdated || null
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
    const liveData = await loadLiveData();
    if (liveData?.results?.length) {
        const driverMap = await loadDriverMap();
        return {
            sessionName: liveData.session_name || 'Session',
            raceName: liveData.meeting_name || liveData.location || 'Grand Prix',
            isRace: liveData.is_race || false,
            results: liveData.results.slice(0, 10).map(r => {
                const num = String(r.driver_number);
                const mapped = driverMap[num];
                return {
                    position: r.position,
                    driver: r.driver_code || mapped?.driver_code || r.driver_name?.split(' ').pop() || `#${num}`,
                    team: r.team || mapped?.team || 'Unknown',
                    time: r.best_lap_time || '',
                    fastestLap: false
                };
            }),
            fastestLap: null,
            live: false,
            cached: true
        };
    }
    
    if (!dataCache.qualifying) dataCache.qualifying = await loadLocalData('qualifying');
    if (!dataCache.results) dataCache.results = await loadLocalData('results');
    
    const standingsData = dataCache.drivers || await loadLocalData('drivers');
    const currentRound = parseInt(standingsData?.MRData?.StandingsTable?.StandingsLists?.[0]?.round) || 1;
    
    const raceData = dataCache.results?.MRData?.RaceTable?.Races?.[0];
    const raceRound = parseInt(dataCache.results?.MRData?.RaceTable?.round) || 0;
    const raceDate = raceData ? new Date(`${raceData.date}T${raceData.time || '23:59:59Z'}`) : null;
    const raceHappened = raceDate && raceDate < new Date();
    
    if (raceData?.Results && raceRound <= currentRound && raceHappened) {
        const fl = raceData.Results.find(r => r.FastestLap?.rank === '1');
        return {
            sessionName: 'Race',
            raceName: raceData.raceName,
            isRace: true,
            results: raceData.Results.slice(0, 10).map(r => ({
                position: parseInt(r.position),
                driver: r.Driver.code || `${r.Driver.givenName[0]}. ${r.Driver.familyName}`,
                team: r.Constructor.name,
                time: r.Time?.time || '-',
                fastestLap: r.FastestLap?.rank === '1'
            })),
            fastestLap: fl ? { driver: fl.Driver.code, time: fl.FastestLap?.Time?.time } : null,
            live: false
        };
    }
    
    const qualiRace = dataCache.qualifying?.MRData?.RaceTable?.Races?.[0];
    if (qualiRace?.QualifyingResults) {
        return {
            sessionName: 'Qualifying', raceName: qualiRace.raceName, isRace: false,
            results: qualiRace.QualifyingResults.slice(0, 10).map((r, i) => ({
                position: i + 1, driver: r.Driver.code || `${r.Driver.givenName[0]}. ${r.Driver.familyName}`,
                team: r.Constructor.name, time: r.Q3 || r.Q2 || r.Q1 || '-', fastestLap: false
            })),
            fastestLap: null, live: false
        };
    }
    return null;
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

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function getTeamBadgeClass(team) {
    const key = TEAM_COLORS[team] || 'default';
    return TEAM_BG_COLORS[key] || 'bg-gray-600';
}

function getPositionClass(pos) {
    if (pos === 1) return 'pos-1';
    if (pos === 2) return 'pos-2';
    if (pos === 3) return 'pos-3';
    return 'bg-gray-700';
}

function renderDriverStandings(data) {
    const container = document.getElementById('driver-standings');
    if (!data?.standings?.length) {
        container.innerHTML = '<div class="text-center text-gray-500 py-8">No standings available</div>';
        return;
    }
    
    let lastUpdatedHtml = '';
    if (data.lastUpdated) {
        const date = new Date(data.lastUpdated);
        lastUpdatedHtml = `<div class="mt-4 pt-3 border-t border-gray-800 text-right text-xs text-gray-500" title="${date.toLocaleString()}">Updated ${getTimeAgo(date)}</div>`;
    }
    
    container.innerHTML = data.standings.slice(0, 10).map(s => `
        <div class="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-800/50 transition-colors">
            <div class="w-8 h-8 rounded-md ${getPositionClass(s.position)} flex items-center justify-center font-bold text-sm">${s.position}</div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <span class="font-semibold truncate">${s.driver}</span>
                    <span class="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${getTeamBadgeClass(s.team)} text-white">${s.team.substring(0, 3).toUpperCase()}</span>
                </div>
            </div>
            <div class="text-sm font-medium text-gray-400">${s.points}<span class="text-gray-600 ml-1">pts</span></div>
        </div>
    `).join('') + lastUpdatedHtml;
}

function renderConstructorStandings(standings) {
    const container = document.getElementById('constructor-standings');
    if (!standings?.length) {
        container.innerHTML = '<div class="text-center text-gray-500 py-8">No standings available</div>';
        return;
    }
    
    container.innerHTML = standings.slice(0, 10).map(s => `
        <div class="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-800/50 transition-colors">
            <div class="w-8 h-8 rounded-md ${getPositionClass(s.position)} flex items-center justify-center font-bold text-sm">${s.position}</div>
            <div class="flex-1 min-w-0">
                <span class="font-semibold truncate">${s.constructor}</span>
            </div>
            <div class="text-sm font-medium text-gray-400">${s.points}<span class="text-gray-600 ml-1">pts</span></div>
        </div>
    `).join('');
}

function renderNextRace(race) {
    if (!race) {
        document.getElementById('next-race-name').textContent = 'No upcoming races';
        return;
    }
    document.getElementById('next-race-name').textContent = race.name;
    document.getElementById('next-race-date').textContent = formatDate(race.date);
    document.getElementById('next-race-circuit').textContent = `📍 ${race.circuit}${race.country ? ', ' + race.country : ''}`;
    
    // Separate Race from other sessions
    const raceSession = race.sessions.find(s => s.name === 'Race');
    const otherSessions = race.sessions.filter(s => s.name !== 'Race');
    
    // Build HTML: 2-column grid for other sessions, Race spans both columns
    let html = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">';
    
    // Other sessions in 2-column grid
    otherSessions.forEach(s => {
        html += `
            <div class="flex flex-col px-3 py-2 bg-gray-800/50 rounded-lg border border-gray-700/50 text-center">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-500">${s.name}</span>
                <span class="text-sm font-semibold mt-0.5">${formatDateTime(s.date)}</span>
                <span class="text-[10px] text-gray-600 mt-0.5">${formatUTC(s.date)}</span>
            </div>`;
    });
    
    html += '</div>';
    
    // Race session - spans both columns, more prominent
    if (raceSession) {
        html += `
            <div class="mt-3 flex flex-col px-4 py-3 bg-gradient-to-br from-ferrari/20 to-red-900/30 rounded-xl border-2 border-ferrari/40 text-center">
                <span class="text-xs font-bold uppercase tracking-widest text-ferrari">🏁 Race</span>
                <span class="text-lg font-bold mt-1">${formatDateTime(raceSession.date)}</span>
                <span class="text-xs text-gray-400 mt-0.5">${formatUTC(raceSession.date)}</span>
            </div>`;
    }
    
    document.getElementById('session-times').innerHTML = html;
}

function renderLatestResults(data) {
    const header = document.getElementById('results-header');
    const tbody = document.getElementById('latest-results');
    
    if (!data) {
        header.textContent = 'No session results';
        tbody.innerHTML = '<tr><td colspan="3" class="py-8 text-center text-gray-500">Check back after a session</td></tr>';
        return;
    }
    
    const cacheBadge = data.cached ? '<span class="ml-2 px-2 py-0.5 text-[10px] bg-gray-700 rounded font-medium">💾 Cached</span>' : '';
    header.innerHTML = `<span class="font-semibold text-white">${data.sessionName}</span> - ${data.raceName}${cacheBadge}`;
    
    if (data.fastestLap) {
        header.innerHTML += ` <span class="ml-2 text-purple-400 text-xs"><span class="px-1.5 py-0.5 bg-purple-500 rounded text-white font-bold">FL</span> ${data.fastestLap.driver}</span>`;
    }
    
    tbody.innerHTML = data.results.map(r => `
        <tr class="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30 transition-colors">
            <td class="py-2.5"><div class="w-7 h-7 rounded-md ${getPositionClass(r.position)} flex items-center justify-center font-bold text-xs">${r.position}</div></td>
            <td class="py-2.5">
                <span class="font-medium">${r.driver}</span>
                ${r.fastestLap ? '<span class="ml-1 px-1.5 py-0.5 bg-purple-500 rounded text-[10px] font-bold">FL</span>' : ''}
                <span class="ml-2 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${getTeamBadgeClass(r.team)} text-white">${r.team.substring(0, 3).toUpperCase()}</span>
            </td>
            <td class="py-2.5 text-right text-gray-400 font-mono text-sm">${r.time || '-'}</td>
        </tr>
    `).join('');
}

function showError(container, message) {
    container.innerHTML = `<div class="text-center text-red-400 py-8">${message}</div>`;
}

async function loadAll() {
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

// Pull to Refresh
(function() {
    const indicator = document.getElementById('pull-indicator');
    if (!indicator) return;
    
    let startY = 0;
    let currentY = 0;
    let pulling = false;
    let refreshing = false;
    const threshold = 80;
    
    function isAtTop() {
        return (window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0) <= 1;
    }
    
    document.addEventListener('touchstart', (e) => {
        if (!isAtTop() || refreshing) return;
        startY = e.touches[0].clientY;
        pulling = true;
    }, { passive: true });
    
    document.addEventListener('touchmove', (e) => {
        if (!pulling || refreshing) return;
        currentY = e.touches[0].clientY;
        const diff = Math.max(0, currentY - startY);
        
        if (diff > 0 && isAtTop()) {
            indicator.style.transform = `translateY(${Math.min(diff, threshold + 20)}px)`;
            indicator.style.opacity = Math.min(diff / threshold, 1);
            indicator.classList.toggle('rotate', diff >= threshold);
        }
    }, { passive: true });
    
    document.addEventListener('touchend', async (e) => {
        if (!pulling) return;
        pulling = false;
        
        const diff = currentY - startY;
        
        if (diff >= threshold && !refreshing) {
            refreshing = true;
            indicator.innerHTML = '<div class="animate-spin w-6 h-6 border-2 border-gray-600 border-t-ferrari rounded-full"></div>';
            
            try {
                dataCache = { drivers: null, constructors: null, schedule: null, qualifying: null, results: null, driverMap: null };
                await loadAll();
                await loadNews();
            } catch (err) {
                console.error('Refresh failed:', err);
            }
            
            setTimeout(() => {
                indicator.style.transform = '';
                indicator.style.opacity = '0';
                indicator.innerHTML = '<span class="text-2xl">↓</span>';
                refreshing = false;
            }, 300);
        } else {
            indicator.style.transform = '';
            indicator.style.opacity = '0';
        }
        
        startY = 0;
        currentY = 0;
    }, { passive: true });
})();
