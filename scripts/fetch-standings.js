/**
 * Fetch current driver and constructor standings from Ergast
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../docs/data');
const ERGAST_BASE = 'https://api.jolpi.ca/ergast/f1/current';

async function fetchJSON(url) {
    const resp = await fetch(url);
    return resp.ok ? resp.json() : null;
}

async function fetchStandings() {
    console.log('Fetching standings from Ergast...');
    
    const [drivers, constructors] = await Promise.all([
        fetchJSON(`${ERGAST_BASE}/driverStandings.json`),
        fetchJSON(`${ERGAST_BASE}/constructorStandings.json`)
    ]);
    
    const driverData = drivers?.MRData?.StandingsTable?.StandingsLists?.[0];
    const constructorData = constructors?.MRData?.StandingsTable?.StandingsLists?.[0];
    
    if (!driverData) {
        console.log('No driver standings data');
        return;
    }
    
    // Add lastUpdated timestamp to the data
    const now = new Date().toISOString();
    
    const driverOutput = {
        ...drivers,
        lastUpdated: now
    };
    
    // Save drivers
    fs.writeFileSync(
        path.join(DATA_DIR, 'drivers.json'),
        JSON.stringify(driverOutput, null, 2)
    );
    console.log(`Updated driver standings (round ${driverData.round})`);
    
    // Save constructors
    if (constructorData) {
        const constructorOutput = {
            ...constructors,
            lastUpdated: now
        };
        fs.writeFileSync(
            path.join(DATA_DIR, 'constructors.json'),
            JSON.stringify(constructorOutput, null, 2)
        );
        console.log(`Updated constructor standings (round ${constructorData.round})`);
    }
    
    console.log('Done.');
}

fetchStandings().catch(console.error);
