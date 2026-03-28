/**
 * F1 Poll - Race Winner Prediction
 * Uses localStorage for vote persistence
 */

// Poll storage key
const POLL_STORAGE_KEY = 'f1-votes';

/**
 * Get current race info from schedule
 * Returns { raceName, raceKey, isRaceWeekend } or null if not in a race weekend
 */
async function getCurrentRaceInfo() {
    // Ensure schedule is loaded
    if (!dataCache.schedule) {
        dataCache.schedule = await loadLocalData('schedule');
    }
    if (!dataCache.schedule) return null;
    
    const races = dataCache.schedule.MRData?.RaceTable?.Races || [];
    const now = new Date();
    const year = now.getFullYear();
    
    for (const race of races) {
        const raceDate = new Date(`${race.date}T${race.time || '00:00:00Z'}`);
        
        // Race weekend: Friday (2 days before) to Monday after
        const friday = new Date(raceDate);
        friday.setDate(friday.getDate() - 2);
        friday.setHours(0, 0, 0, 0);
        
        const mondayAfter = new Date(raceDate);
        mondayAfter.setDate(mondayAfter.getDate() + 1);
        mondayAfter.setHours(23, 59, 59, 999);
        
        if (now >= friday && now <= mondayAfter) {
            const raceName = race.raceName;
            const raceKey = `${year}-${raceName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
            const round = parseInt(race.round || '0');
            
            return {
                raceName,
                raceKey,
                round,
                raceDate,
                isRaceWeekend: true
            };
        }
    }
    
    return null;
}

/**
 * Clean up old poll data from localStorage
 * Keeps only current and future races, removes past races
 */
function cleanupOldPollData() {
    try {
        const stored = localStorage.getItem(POLL_STORAGE_KEY);
        if (!stored) return;
        
        const votes = JSON.parse(stored);
        const now = new Date();
        const currentYear = now.getFullYear();
        
        // Keep track of valid keys
        const validKeys = new Set();
        
        // Get valid race keys from schedule if available
        // We'll also keep any key that starts with current or future years
        for (const key of Object.keys(votes)) {
            // Extract year from key (format: YYYY-race-name)
            const match = key.match(/^(\d{4})-/);
            if (match) {
                const keyYear = parseInt(match[1]);
                // Keep current year and future years
                if (keyYear >= currentYear) {
                    validKeys.add(key);
                }
            }
        }
        
        // Remove entries for past races
        const cleaned = {};
        for (const [key, value] of Object.entries(votes)) {
            if (validKeys.has(key)) {
                cleaned[key] = value;
            }
        }
        
        // Only update if something changed
        if (Object.keys(cleaned).length !== Object.keys(votes).length) {
            localStorage.setItem(POLL_STORAGE_KEY, JSON.stringify(cleaned));
            console.log('Cleaned up old poll data');
        }
    } catch (e) {
        console.error('Error cleaning up poll data:', e);
    }
}

/**
 * Get all race keys from schedule for cleanup
 */
async function getValidRaceKeys() {
    if (!dataCache.schedule) {
        dataCache.schedule = await loadLocalData('schedule');
    }
    if (!dataCache.schedule) return [];
    
    const races = dataCache.schedule.MRData?.RaceTable?.Races || [];
    const year = new Date().getFullYear();
    
    return races.map(race => {
        const raceName = race.raceName;
        return `${year}-${raceName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    });
}

/**
 * Clean up old polls based on actual schedule
 */
async function cleanupPollsBySchedule() {
    try {
        const validKeys = await getValidRaceKeys();
        const stored = localStorage.getItem(POLL_STORAGE_KEY);
        if (!stored) return;
        
        const votes = JSON.parse(stored);
        const cleaned = {};
        
        for (const [key, value] of Object.entries(votes)) {
            // Keep keys that are in the schedule or start with current/future year
            const yearMatch = key.match(/^(\d{4})-/);
            const currentYear = new Date().getFullYear();
            
            if (validKeys.includes(key) || (yearMatch && parseInt(yearMatch[1]) >= currentYear)) {
                cleaned[key] = value;
            }
        }
        
        if (Object.keys(cleaned).length !== Object.keys(votes).length) {
            localStorage.setItem(POLL_STORAGE_KEY, JSON.stringify(cleaned));
        }
    } catch (e) {
        console.error('Error in schedule-based cleanup:', e);
    }
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
        return drivers.map((d) => ({
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
 * Render poll UI
 */
async function renderPoll() {
    const pollContainer = document.getElementById('poll-container');
    if (!pollContainer) return;
    
    // Clean up old poll data first
    await cleanupPollsBySchedule();
    
    // Check if we're in an actual race weekend
    const raceInfo = await getCurrentRaceInfo();
    
    // Show poll during actual race weekends (or override for demo)
    const showPoll = raceInfo?.isRaceWeekend || localStorage.getItem('f1-poll-debug') === 'true';
    
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
    
    const raceKey = raceInfo?.raceKey || 'unknown-race';
    const raceName = raceInfo?.raceName || 'this race';
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
    if (pollSubtitle) pollSubtitle.textContent = `Who will win the ${raceName}?`;
    
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