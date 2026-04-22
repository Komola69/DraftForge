import fs from 'fs';
import path from 'path';

const DIR_RAW = path.resolve('./data/raw');
const DIR_PROCESSED = path.resolve('./data/processed');

const rawMeta = JSON.parse(fs.readFileSync(path.join(DIR_RAW, 'hero-meta-final.json'), 'utf8'));
const metaOverrides = JSON.parse(fs.readFileSync(path.join(DIR_RAW, 'meta_overrides.json'), 'utf8'));
const synergiesData = JSON.parse(fs.readFileSync(path.join(DIR_RAW, 'synergies.json'), 'utf8'));

function inferGoldReliance(rawHero, roles) {
  const explicit = Number(rawHero.goldReliance);
  if (!Number.isNaN(explicit) && explicit > 0) {
    return Math.max(1, Math.min(10, Math.round(explicit)));
  }

  const key = String(rawHero.hero_name || '').toLowerCase();
  
  const VERY_HIGH_GOLD = ['aldous', 'cecilion', 'claude', 'miya'];
  if (VERY_HIGH_GOLD.includes(key)) return 9;
  
  const HIGH_GOLD = ['karrie', 'kimmy', 'granger', 'brody', 'beatrix', 'natan', 'ixia', 'lukas'];
  if (HIGH_GOLD.includes(key)) return 8;

  const LOW_GOLD = ['tigreal', 'franco', 'angela', 'estes', 'floryn', 'rafaela', 'diggie', 'atlas', 'khufra', 'johnson', 'lolita', 'hylos', 'baxia', 'belerick', 'grock', 'uranus', 'chip'];
  if (LOW_GOLD.includes(key)) return 3;

  if (metaOverrides.gold_reliance[key]) return metaOverrides.gold_reliance[key];
  
  if (roles.includes('marksman')) return 7;
  if (roles.includes('assassin')) return 6;
  if (roles.includes('mage')) return 6;
  if (roles.includes('tank') || roles.includes('support')) return 3;
  return 5;
}

function inferBuffDependency(rawHero) {
  const explicit = rawHero.buffDependency;
  if (explicit === 'Purple' || explicit === 'Red' || explicit === 'None') {
    return explicit;
  }

  const key = String(rawHero.hero_name || '').toLowerCase();
  
  const PURPLE_DEPENDENT = ['fanny', 'ling', 'hayabusa', 'alucard'];
  if (PURPLE_DEPENDENT.includes(key)) return 'Purple';

  const RED_DEPENDENT = ['karrie', 'kimmy', 'clint', 'brody', 'beatrix', 'natan', 'ixia', 'granger', 'claude', 'miya', 'hanabi'];
  if (RED_DEPENDENT.includes(key)) return 'Red';

  if (metaOverrides.buff_dependencies[key]) return metaOverrides.buff_dependencies[key];
  return 'None';
}

function inferTier(heroName) {
  return metaOverrides.tiers[heroName.toLowerCase()] || 'B';
}

function inferDamageType(heroName, roles) {
  const key = heroName.toLowerCase();
  if (metaOverrides.damage_types[key]) return metaOverrides.damage_types[key];
  if (roles.includes('mage')) return 'Magic';
  return 'Physical';
}

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
    tier: inferTier(name),
    base_wr: 50.0, // Default WR
    goldReliance: inferGoldReliance(rawHero, roles),
    buffDependency: inferBuffDependency(rawHero),
    primaryDamageType: inferDamageType(name, roles)
  });
  
  nameToId.set(name.toLowerCase(), id);
  matchups[id] = {};
}

// 2. Build Intelligent Matchups
// We loop again now that we have all IDs
const STRENGTH_COUNTER = 7.0; // Point 5 Fix: Define mathematical weight

for (const rawHero of rawMeta.data) {
  if (rawHero.hero_name === "None") continue;
  
  const targetId = nameToId.get(rawHero.hero_name.toLowerCase());
  if (!targetId) continue;
  
  // Counters array: These heroes COUNTER the target
  if (Array.isArray(rawHero.counters)) {
    for (const c of rawHero.counters) {
      const counterId = nameToId.get(c.heroname.toLowerCase());
      if (counterId) {
        matchups[counterId][targetId] = STRENGTH_COUNTER; // Counter wins vs Target
        matchups[targetId][counterId] = -STRENGTH_COUNTER; // Target loses vs Counter
      }
    }
  }
}

// 3. Process Synergies (Combos)
const synergyOutput = {
  schema_version: "1.0.0",
  combos: {}
};

for (const [heroName, combos] of Object.entries(synergiesData.combos)) {
  const heroId = nameToId.get(heroName.toLowerCase());
  if (heroId) {
    synergyOutput.combos[heroId] = combos.map(c => {
      const partnerId = nameToId.get(c.partner.toLowerCase());
      return { partnerId, strength: c.strength };
    }).filter(c => c.partnerId !== undefined);
  }
}

// 4. Write output
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
fs.writeFileSync(path.join(DIR_PROCESSED, 'v1_synergies.json'), JSON.stringify(synergyOutput, null, 2));

console.log(`[SUCCESS] Compiled ${heroesList.length} heroes from raw metadata!`);
console.log(`[SUCCESS] Built complete matchup matrix and synergies.`);
