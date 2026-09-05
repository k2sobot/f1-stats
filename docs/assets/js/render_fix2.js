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
    
    // Build HTML: flex-wrap for other sessions, Race spans full width
    let html = '<div class="flex flex-wrap gap-2">';
    
    // Other sessions - each takes half width on desktop, full on mobile
    otherSessions.forEach(s => {
        html += `
            <div class="flex flex-col px-3 py-2 bg-gray-800/50 rounded-lg border border-gray-700/50 text-center flex-1 min-w-[140px]">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-500">${s.name}</span>
                <span class="text-sm font-semibold mt-0.5">${formatDateTime(s.date)}</span>
                <span class="text-[10px] text-gray-600 mt-0.5">${formatUTC(s.date)}</span>
            </div>`;
    });
    
    html += '</div>';
    
    // Race session - full width, more prominent
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
