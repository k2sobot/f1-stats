/**
 * F1 Poll - Race Winner Prediction
 * Uses localStorage for vote persistence
 */

// Poll storage key
const POLL_STORAGE_KEY = 'f1-votes';

/**
 * Check if we're currently in a race weekend
 */
function isRaceWeekend() {
    const now = new Date();
    const year = now.getFullYear();
    
    // Get schedule from cache or return conservative estimate
    // Race weekends are typically Fri-Sun
    const day = now.getDay(); // 0=Sun, 5=Fri, 6=Sat
    
    // Simple heuristic: show poll on Fri/Sat/Sun
    // More accurate: check against actual schedule
    return day === 0 || day === 5 || day === 6;
}

/**
 * Get current race name from schedule
 */
async function getCurrentRaceName() {
    if (!dataCache.schedule) {
        dataCache.schedule = await loadLocalData('schedule');
    }
    if (!dataCache.schedule) return 'this race';
    
    const races = dataCache.schedule.MRData?.RaceTable?.Races || [];
    const now = new Date();
    
    // Find current/upcoming race
    for (const race of races) {
        const raceDate = new Date(`${race.date}T${race.time || '00:00:00Z'}`);
        const friday = new Date(raceDate);
        friday.setDate(friday.getDate() - 2);
        const mondayAfter = new Date(raceDate);
        mondayAfter.setDate(mondayAfter.getDate() + 1);
        
        if (now >= friday && now <= mondayAfter) {
            return race.raceName;
        }
    }
    
    return 'this race';
}

/**
 * Get stored votes
 */
function getStoredVotes() {
    try {
        const stored = localStorage.getItem(POLL_STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.error('Error reading poll data:', e);
    }
    return {};
}

/**
 * Save vote
 */
function saveVote(driverId, raceKey) {
    const votes = getStoredVotes();
    
    if (!votes[raceKey]) {
        votes[raceKey] = {};
    }
    
    votes[raceKey][driverId] = (votes[raceKey][driverId] || 0) + 1;
    votes[raceKey]._lastVote = new Date().toISOString();
    
    localStorage.setItem(POLL_STORAGE_KEY, JSON.stringify(votes));
    
    return votes[raceKey];
}

/**
 * Check if user has voted for a specific race
 */
function getUserVote(raceKey) {
    const votes = getStoredVotes();
    if (votes[raceKey] && votes[raceKey]._userVote) {
        return votes[raceKey]._userVote;
    }
    return null;
}

/**
 * Record user's single vote
 */
function recordUserVote(driverId, raceKey) {
    const votes = getStoredVotes();
    
    if (!votes[raceKey]) {
        votes[raceKey] = {};
    }
    
    // Store user's choice
    votes[raceKey]._userVote = driverId;
    
    // Increment vote count for this driver
    votes[raceKey][driverId] = (votes[raceKey][driverId] || 0) + 1;
    votes[raceKey]._lastVote = new Date().toISOString();
    
    localStorage.setItem(POLL_STORAGE_KEY, JSON.stringify(votes));
    
    return votes[raceKey];
}

/**
 * Calculate vote percentages
 */
function calculatePercentages(votes, drivers) {
    const total = drivers.reduce((sum, d) => sum + (votes[d.driver] || 0), 0);
    
    if (total === 0) {
        // Seed with initial votes for visualization
        return drivers.map((d, i) => ({
            ...d,
            votes: 0,
            percentage: 0
        }));
    }
    
    return drivers.map(d => ({
        ...d,
        votes: votes[d.driver] || 0,
        percentage: Math.round(((votes[d.driver] || 0) / total) * 100)
    }));
}

/**
 * Get race key for current weekend
 */
async function getRaceKey() {
    const raceName = await getCurrentRaceName();
    const year = new Date().getFullYear();
    // Normalize race name for key
    return `${year}-${raceName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

/**
 * Render poll UI
 */
async function renderPoll() {
    const pollContainer = document.getElementById('poll-container');
    if (!pollContainer) return;
    
    // Check if race weekend
    const isWeekend = isRaceWeekend();
    
    // Show poll during race weekends (or override for demo)
    const showPoll = isWeekend || localStorage.getItem('f1-poll-debug') === 'true';
    
    if (!showPoll) {
        pollContainer.style.display = 'none';
        return;
    }
    
    pollContainer.style.display = 'block';
    
    // Get driver standings for top 10
    const { standings } = await getDriverStandings();
    if (!standings?.length) {
        pollContainer.innerHTML = '<div class="error-message">Unable to load poll</div>';
        return;
    }
    
    const raceKey = await getRaceKey();
    const raceName = await getCurrentRaceName();
    const userVote = getUserVote(raceKey);
    const storedVotes = getStoredVotes();
    const raceVotes = storedVotes[raceKey] || {};
    
    // Calculate percentages
    const results = calculatePercentages(raceVotes, standings.slice(0, 10));
    
    // Render
    const pollTitle = document.getElementById('poll-title');
    const pollSubtitle = document.getElementById('poll-subtitle');
    const pollResults = document.getElementById('poll-results');
    const pollVote = document.getElementById('poll-vote');
    
    if (pollTitle) pollTitle.textContent = '🏎️ Race Winner Poll';
    if (pollSubtitle) pollSubtitle.textContent = `Who will win ${raceName}?`;
    
    if (userVote) {
        // Show results
        if (pollVote) pollVote.style.display = 'none';
        if (pollResults) {
            pollResults.style.display = 'block';
            pollResults.innerHTML = `
                <div class="poll-voted">You voted: <strong>${userVote}</strong></div>
                <div class="poll-breakdown">
                    ${results.map((d, i) => `
                        <div class="poll-row ${d.driver === userVote ? 'voted' : ''}">
                            <div class="poll-driver">
                                <span class="poll-pos">${i + 1}</span>
                                <span class="poll-name">${d.driver}</span>
                                <span class="team-tag team-${TEAM_COLORS[d.team] || 'default'}">${d.team.substring(0, 3).toUpperCase()}</span>
                            </div>
                            <div class="poll-bar-container">
                                <div class="poll-bar" style="width: ${Math.max(d.percentage, userVote === d.driver ? 5 : 0)}%"></div>
                            </div>
                            <span class="poll-pct">${d.percentage}%</span>
                        </div>
                    `).join('')}
                </div>
                <div class="poll-total">Total votes: ${results.reduce((sum, d) => sum + d.votes, 0)}</div>
            `;
        }
    } else {
        // Show voting options
        if (pollVote) {
            pollVote.style.display = 'block';
            pollVote.innerHTML = `
                <div class="poll-options">
                    ${standings.slice(0, 10).map((d, i) => `
                        <button class="poll-option" data-driver="${d.driver}" data-team="${d.team}">
                            <span class="poll-pos">${i + 1}</span>
                            <span class="poll-name">${d.driver}</span>
                            <span class="team-tag team-${TEAM_COLORS[d.team] || 'default'}">${d.team.substring(0, 3).toUpperCase()}</span>
                        </button>
                    `).join('')}
                </div>
            `;
            
            // Add click handlers
            pollVote.querySelectorAll('.poll-option').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const driver = btn.dataset.driver;
                    const raceKey = await getRaceKey();
                    recordUserVote(driver, raceKey);
                    renderPoll(); // Re-render to show results
                });
            });
        }
        if (pollResults) pollResults.style.display = 'none';
    }
}

// Initialize poll on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure standings are loaded
    setTimeout(renderPoll, 500);
});

// Refresh poll with other data
window.refreshPoll = renderPoll;