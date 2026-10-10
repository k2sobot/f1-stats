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
  
  const data = await fetchWithRetry(`${ERGAST_BASE}/f1/${YEAR}/${round}/results.json?limit=100`);
  const race = data?.MRData?.RaceTable?.Races?.[0];
  
  if (race) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'results.json'),
      JSON.stringify(data, null, 2)
    );
    console.log(`Updated results for ${race.raceName}`);
  }
}

function resortStandings(rows) {
  rows.sort((a, b) => {
    const pts = Number(b.points) - Number(a.points);
    if (pts) return pts;
    const wins = Number(b.wins) - Number(a.wins);
    if (wins) return wins;
    return Number(a.position) - Number(b.position);
  });
  rows.forEach((row, i) => {
    const pos = String(i + 1);
    row.position = pos;
    row.positionText = pos;
  });
}

async function applyPendingSprintPoints() {
  const driversPath = path.join(DATA_DIR, 'drivers.json');
  const constructorsPath = path.join(DATA_DIR, 'constructors.json');
  const schedulePath = path.join(DATA_DIR, 'schedule.json');
  const driverData = JSON.parse(fs.readFileSync(driversPath, 'utf8'));
  const constructorData = JSON.parse(fs.readFileSync(constructorsPath, 'utf8'));
  const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));

  const driverList = driverData?.MRData?.StandingsTable?.StandingsLists?.[0];
  const constructorList = constructorData?.MRData?.StandingsTable?.StandingsLists?.[0];
  const races = schedule?.MRData?.RaceTable?.Races || [];
  if (!driverList || !constructorList) return;

  const standingsRound = parseInt(driverList.round, 10);
  const now = new Date();
  const pendingRaces = races.filter((race) => {
    const round = parseInt(race.round, 10);
    if (round <= standingsRound) return false;
    const raceDate = new Date(`${race.date}T${race.time || '23:59:59Z'}`);
    return raceDate.getTime() <= now.getTime() + 36 * 60 * 60 * 1000;
  });
  if (!pendingRaces.length) return;

  const meetings = await fetchJSON(`https://api.openf1.org/v1/meetings?year=${YEAR}`);
  let applied = false;

  for (const race of pendingRaces) {
    const meeting = meetings.find((m) => m.meeting_name === race.raceName)
      || meetings.find((m) => race.raceName.startsWith(m.meeting_name));
    if (!meeting) {
      console.log(`No OpenF1 meeting for ${race.raceName}`);
      continue;
    }

    const sessions = await fetchJSON(`https://api.openf1.org/v1/sessions?meeting_key=${meeting.meeting_key}`);
    const sprint = sessions.find((s) => s.session_name === 'Sprint' || s.session_type === 'Sprint');
    if (!sprint || new Date(sprint.date_end) > now) {
      console.log(`Sprint not complete for ${race.raceName}`);
      continue;
    }

    const [results, drivers] = await Promise.all([
      fetchJSON(`https://api.openf1.org/v1/session_result?session_key=${sprint.session_key}`),
      fetchJSON(`https://api.openf1.org/v1/drivers?session_key=${sprint.session_key}`)
    ]);

    const codeByNumber = {};
    for (const driver of drivers) codeByNumber[driver.driver_number] = driver.name_acronym;

    const pointsByCode = {};
    for (const result of results) {
      const pts = Number(result.points) || 0;
      if (!pts) continue;
      const code = codeByNumber[result.driver_number];
      if (!code) throw new Error(`No driver code for car ${result.driver_number}`);
      pointsByCode[code] = (pointsByCode[code] || 0) + pts;
    }
    if (!Object.keys(pointsByCode).length) continue;

    const constructorById = {};
    for (const row of constructorList.ConstructorStandings) {
      constructorById[row.Constructor.constructorId] = row;
    }

    for (const [code, pts] of Object.entries(pointsByCode)) {
      const row = driverList.DriverStandings.find((s) => s.Driver.code === code);
      if (!row) throw new Error(`Sprint points for ${code} but driver is missing from standings`);
      row.points = String(Number(row.points) + pts);
      const ctorId = row.Constructors?.[0]?.constructorId;
      if (!constructorById[ctorId]) throw new Error(`No constructor standings row for ${code}`);
      constructorById[ctorId].points = String(Number(constructorById[ctorId].points) + pts);
      console.log(`Sprint points: ${code} +${pts}`);
    }

    resortStandings(driverList.DriverStandings);
    resortStandings(constructorList.ConstructorStandings);
    const updatedAt = new Date().toISOString();
    driverData.lastUpdated = updatedAt;
    constructorData.lastUpdated = updatedAt;
    applied = true;
    console.log(`Applied sprint points for ${race.raceName} (standings still through round ${standingsRound})`);
  }

  if (applied) {
    fs.writeFileSync(driversPath, JSON.stringify(driverData, null, 2) + '\n');
    fs.writeFileSync(constructorsPath, JSON.stringify(constructorData, null, 2) + '\n');
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
    
    // Jolpica often lags sprint points until after the grand prix.
    await applyPendingSprintPoints();

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
