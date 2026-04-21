import fs from 'fs';
import path from 'path';

const DIR_RAW = path.resolve('./data/raw');
const DIR_PROCESSED = path.resolve('./data/processed');

const rawMeta = JSON.parse(fs.readFileSync(path.join(DIR_RAW, 'hero-meta-final.json'), 'utf8'));

// We will build a completely new Hero DB and Matchup DB
const heroesList = [];
const nameToId = new Map();
const matchups = {};
let currentId = 1;

// 1. Process Heroes
for (const rawHero of rawMeta.data) {
  if (rawHero.hero_name === "None") continue;

  const id = currentId++;
  const name = rawHero.hero_name;
  
  // Parse roles
  const roles = (rawHero.class || "fighter")
    .split(',')
    .map(r => r.trim().toLowerCase());
    
  // Parse lanes
  let lanes = [];
  if (rawHero.laning && Array.isArray(rawHero.laning)) {
    const rawLanes = rawHero.laning.join(',').split(',');
    lanes = rawLanes.map(l => {
      let clean = l.trim().toLowerCase();
      if (clean.includes('exp')) return 'exp';
      if (clean.includes('gold')) return 'gold';
      if (clean.includes('mid')) return 'mid';
      if (clean.includes('jungle')) return 'jungle';
      if (clean.includes('roam')) return 'roam';
      return clean;
    }).filter(Boolean);
  }
  
  if (lanes.length === 0) {
    if (roles.includes('tank') || roles.includes('support')) lanes.push('roam');
    else if (roles.includes('assassin')) lanes.push('jungle');
    else if (roles.includes('mage')) lanes.push('mid');
    else if (roles.includes('marksman')) lanes.push('gold');
    else lanes.push('exp');
  }

  // Deduplicate lanes
  lanes = [...new Set(lanes)];

  heroesList.push({
    id,
    name,
    roles,
    lanes,
    tier: "A", // Default tier, engine will adjust
    base_wr: 50.0 // Default WR
  });
  
  nameToId.set(name.toLowerCase(), id);
  matchups[id] = {};
}

// 2. Build Intelligent Matchups
// We loop again now that we have all IDs
for (const rawHero of rawMeta.data) {
  if (rawHero.hero_name === "None") continue;
  
  const targetId = nameToId.get(rawHero.hero_name.toLowerCase());
  if (!targetId) continue;
  
  // Counters array: These heroes COUNTER the target
  if (Array.isArray(rawHero.counters)) {
    for (const c of rawHero.counters) {
      const counterId = nameToId.get(c.heroname.toLowerCase());
      if (counterId) {
        matchups[counterId][targetId] = 7; // Counter wins vs Target (+7)
        matchups[targetId][counterId] = -7; // Target loses vs Counter (-7)
      }
    }
  }
  
  // Synergies array: These heroes work WELL WITH the target
  if (Array.isArray(rawHero.synergies)) {
    for (const s of rawHero.synergies) {
      const synergyId = nameToId.get(s.heroname.toLowerCase());
      if (synergyId) {
        // Synergy is represented as a different structure usually, 
        // but wait! DraftForge engine uses negative scores for enemies.
        // We can create an entirely new matrix for "synergies" if we want,
        // but let's stick to matchups for now. We can store synergy as a meta field later.
      }
    }
  }
}

// 3. Write output
const heroesOutput = {
  schema_version: "1.0.0",
  game_version: "1.8.44",
  generated_at: new Date().toISOString(),
  data_source: "auto_compiled",
  hero_count: heroesList.length,
  heroes: heroesList
};

const matchupsOutput = {
  schema_version: "1.0.0",
  game_version: "1.8.44",
  generated_at: new Date().toISOString(),
  note: "Generated from raw hero metadata. Scores: +/-7 for strong counters.",
  matchups: matchups
};

// Replace v1 files to instantly apply
fs.writeFileSync(path.join(DIR_PROCESSED, 'v1_heroes.json'), JSON.stringify(heroesOutput, null, 2));
fs.writeFileSync(path.join(DIR_PROCESSED, 'v1_matchups.json'), JSON.stringify(matchupsOutput, null, 2));

console.log(`[SUCCESS] Compiled ${heroesList.length} heroes from raw metadata!`);
console.log(`[SUCCESS] Built complete matchup matrix.`);
