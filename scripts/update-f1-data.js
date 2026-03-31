#!/usr/bin/env node
/**
 * Update F1 data from Ergast API
 * Fetches: drivers standings, constructors standings, schedule, results, qualifying
 */

const fs = require('fs');
const path = require('path');

const YEAR = new Date().getFullYear();
const DATA_DIR = path.join(__dirname, '..', 'docs', 'data');

// API endpoints
const ERGAST_BASE = 'https://api.jolpi.ca/ergast';

async function fetchJSON(url) {
  console.log(`Fetching: ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${url}`);
  }
  return resp.json();
}

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchJSON(url);
    } catch (e) {
      console.log(`Attempt ${i + 1} failed: ${e.message}`);
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw e;
      }
    }
  }
}

async function updateDriverStandings() {
  const data = await fetchWithRetry(`${ERGAST_BASE}/f1/${YEAR}/driverstandings.json`);
  const round = data?.MRData?.StandingsTable?.StandingsLists?.[0]?.round;
  
  if (round) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'drivers.json'),
      JSON.stringify(data, null, 2)
    );
    console.log(`Updated driver standings (round ${round})`);
    return parseInt(round);
  }
  console.log('No driver standings update available');
  return 0;
}

async function updateConstructorStandings(round) {
  const data = await fetchWithRetry(`${ERGAST_BASE}/f1/${YEAR}/constructorstandings.json`);
  const dataRound = data?.MRData?.StandingsTable?.StandingsLists?.[0]?.round;
  
  if (dataRound) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'constructors.json'),
      JSON.stringify(data, null, 2)
    );
    console.log(`Updated constructor standings (round ${dataRound})`);
  }
}

async function updateSchedule() {
  const data = await fetchWithRetry(`${ERGAST_BASE}/f1/${YEAR}.json`);
  const races = data?.MRData?.RaceTable?.Races;
  
  if (races && races.length > 0) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'schedule.json'),
      JSON.stringify(data, null, 2)
    );
    console.log(`Updated schedule (${races.length} races)`);
  }
}

async function updateResults(round) {
  if (round < 1) return;
  
  const data = await fetchWithRetry(`${ERGAST_BASE}/f1/${YEAR}/${round}/results.json`);
  const race = data?.MRData?.RaceTable?.Races?.[0];
  
  if (race) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'results.json'),
      JSON.stringify(data, null, 2)
    );
    console.log(`Updated results for ${race.raceName}`);
  }
}

async function updateQualifying(round) {
  if (round < 1) return;
  
  const data = await fetchWithRetry(`${ERGAST_BASE}/f1/${YEAR}/${round}/qualifying.json`);
  const race = data?.MRData?.RaceTable?.Races?.[0];
  
  if (race) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'qualifying.json'),
      JSON.stringify(data, null, 2)
    );
    console.log(`Updated qualifying for ${race.raceName}`);
  }
}

async function main() {
  console.log(`Updating F1 data for ${YEAR}...`);
  console.log(`Data directory: ${DATA_DIR}`);
  
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  try {
    // Update standings first to get current round
    const round = await updateDriverStandings();
    
    // Update other data in parallel
    await Promise.all([
      updateConstructorStandings(round),
      updateSchedule(),
    ]);
    
    // Update race results based on current round
    await updateResults(round);
    await updateQualifying(round);
    
    console.log('✅ F1 data update complete!');
  } catch (e) {
    console.error('❌ Update failed:', e.message);
    process.exit(1);
  }
}

main();
