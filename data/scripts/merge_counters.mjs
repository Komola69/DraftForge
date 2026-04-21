import fs from 'fs';
import path from 'path';

// Resolve paths
const DIR_PROCESSED = path.resolve('./data/processed');
const DIR_RAW = path.resolve('./data/raw');

const heroesPath = path.join(DIR_PROCESSED, 'v1_heroes.json');
const matchupsPath = path.join(DIR_PROCESSED, 'v1_matchups.json');
const apiCountersPath = path.join(DIR_RAW, 'api_counters.json');

// 1. Load Data
const heroesData = JSON.parse(fs.readFileSync(heroesPath, 'utf8'));
const matchupsData = JSON.parse(fs.readFileSync(matchupsPath, 'utf8'));
const apiCounters = JSON.parse(fs.readFileSync(apiCountersPath, 'utf8'));

// 2. Map Hero Names to IDs
const nameToId = new Map();
for (const hero of heroesData.heroes) {
  // exact match + lowercase match just in case
  nameToId.set(hero.name.toLowerCase(), String(hero.id));
}

let newMatchupsAdded = 0;
const matchups = matchupsData.matchups;

// Helper to set score if not exists or if we want to average it
function setMatchup(heroId, enemyId, score) {
  if (!matchups[heroId]) matchups[heroId] = {};
  if (matchups[heroId][enemyId] === undefined) {
    matchups[heroId][enemyId] = score;
    newMatchupsAdded++;
  }
}

// 3. Process API Counters
// Format: "TargetHero": ["CounterHero1", "CounterHero2"]
// Meaning: CounterHero1 is STRONG vs TargetHero
for (const [targetName, counterNames] of Object.entries(apiCounters.counters)) {
  const targetId = nameToId.get(targetName.toLowerCase());
  if (!targetId) {
    console.warn(`[WARN] Unknown target hero: ${targetName}`);
    continue;
  }

  for (const counterName of counterNames) {
    const counterId = nameToId.get(counterName.toLowerCase());
    if (!counterId) {
      console.warn(`[WARN] Unknown counter hero: ${counterName}`);
      continue;
    }

    // Counter is STRONG vs Target (+6 score)
    setMatchup(counterId, targetId, 6);
    
    // Target is WEAK vs Counter (-6 score)
    setMatchup(targetId, counterId, -6);
  }
}

// 4. Save merged matrix
fs.writeFileSync(matchupsPath, JSON.stringify(matchupsData, null, 2), 'utf8');

console.log(`[SUCCESS] Data enrichment complete.`);
console.log(`Added ${newMatchupsAdded} new directional matchup scores from API.`);
console.log(`The DraftForge engine is now significantly smarter!`);
