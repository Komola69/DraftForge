import fs from 'fs';
import path from 'path';

const DIR_RAW = path.resolve('./data/raw');
const DIR_PROCESSED = path.resolve('./data/processed');

const rawMeta = JSON.parse(fs.readFileSync(path.join(DIR_RAW, 'hero-meta-final.json'), 'utf8'));

const PURPLE_DEPENDENT_HEROES = new Set(['fanny', 'ling', 'hayabusa', 'alucard']);
const RED_DEPENDENT_HEROES = new Set(['karrie', 'kimmy', 'clint', 'brody', 'beatrix', 'natan', 'ixia', 'granger', 'claude', 'miya', 'hanabi']);

const VERY_HIGH_GOLD_HEROES = new Set(['aldous', 'cecilion', 'claude', 'miya']);
const HIGH_GOLD_HEROES = new Set(['karrie', 'kimmy', 'granger', 'brody', 'beatrix', 'natan', 'ixia', 'lukas']);
const LOW_GOLD_HEROES = new Set(['tigreal', 'franco', 'angela', 'estes', 'floryn', 'rafaela', 'diggie', 'atlas', 'khufra', 'johnson', 'lolita', 'hylos', 'baxia', 'belerick', 'grock', 'uranus', 'chip']);

const HERO_TIERS = {
  // S-Tier
  'chip': 'S', 'chou': 'S', 'fredrinn': 'S', 'valentina': 'S', 'novaria': 'S', 'zetian': 'S', 'kalea': 'S', 'joy': 'S', 'nolan': 'S', 'ling': 'S', 'fanny': 'S', 'khufra': 'S', 'gusion': 'S', 'kagura': 'S', 'atlas': 'S',
  // A-Tier
  'lancelot': 'A', 'benedetta': 'A', 'hayabusa': 'A', 'franco': 'A', 'mathilda': 'A', 'selena': 'A', 'lunox': 'A', 'esmeralda': 'A', 'phoveus': 'A', 'baxia': 'A', 'edith': 'A', 'julian': 'A', 'arlott': 'A', 'aamon': 'A', 'beatrix': 'A', 'brody': 'A', 'granger': 'A', 'karrie': 'A', 'claude': 'A', 'yi sun-shin': 'A', 'wanwan': 'A', 'harith': 'A', 'silvanna': 'A', 'kaja': 'A', 'barats': 'A', 'hilda': 'A', 'paquito': 'A', 'lapu-lapu': 'A', 'martis': 'A', 'masha': 'A', 'thamuz': 'A', 'x.borg': 'A', 'yu zhong': 'A', 'dyrroth': 'A', 'leomord': 'A', 'guinevere': 'A', 'gloo': 'A', 'jawhead': 'A', 'terizla': 'A', 'alpha': 'A', 'badang': 'A', 'cecilion': 'A', 'carmilla': 'A', 'diggie': 'A', 'angela': 'A',
  // B-Tier
  'alucard': 'B', 'argus': 'B', 'balmond': 'B', 'roger': 'B', 'freya': 'B', 'zilong': 'B', 'sun': 'B', 'cici': 'B', 'khaleed': 'B', 'yin': 'B', 'saber': 'B', 'karina': 'B', 'aulus': 'B', 'natalia': 'B', 'hanzo': 'B', 'helcurt': 'B', 'aldous': 'B', 'lesley': 'B', 'moskov': 'B', 'bruno': 'B', 'clint': 'B', 'hanabi': 'B', 'irithel': 'B', 'miya': 'B', 'layla': 'B', 'popol and kupa': 'B', 'kimmy': 'B', 'natan': 'B', 'melissa': 'B', 'ixia': 'B', 'lukas': 'B', 'suyou': 'B', 'aurora': 'B', 'cyclops': 'B', 'eudora': 'B', 'gord': 'B', 'kadita': 'B', 'lylia': 'B', 'odette': 'B', 'pharsa': 'B', 'vale': 'B', 'vexana': 'B', 'xavier': 'B', 'yve': 'B', 'zhask': 'B', 'alice': 'B', 'bane': 'B', 'hylos': 'B', 'luo yi': 'B', 'valir': 'B', 'estes': 'B', 'floryn': 'B', 'rafaela': 'B', 'nana': 'B', 'faramis': 'B', 'chang\'e': 'B', 'obsidia': 'B', 'zhuxin': 'B',
  // C-Tier
  'minsitthar': 'C', 'belerick': 'C', 'gatotkaca': 'C', 'minotaur': 'C', 'ruby': 'C', 'tigreal': 'C', 'akai': 'C', 'johnson': 'C', 'lolita': 'C', 'grock': 'C', 'uranus': 'C', 'marcel': 'C', 'sora': 'C'
};

function inferGoldReliance(rawHero, roles) {
  const explicit = Number(rawHero.goldReliance);
  if (!Number.isNaN(explicit) && explicit > 0) {
    return Math.max(1, Math.min(10, Math.round(explicit)));
  }

  const key = String(rawHero.hero_name || '').toLowerCase();
  if (VERY_HIGH_GOLD_HEROES.has(key)) return 9;
  if (HIGH_GOLD_HEROES.has(key)) return 8;
  if (LOW_GOLD_HEROES.has(key)) return 3;
  
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
  if (PURPLE_DEPENDENT_HEROES.has(key)) return 'Purple';
  if (RED_DEPENDENT_HEROES.has(key)) return 'Red';
  return 'None';
}

function inferTier(heroName) {
  return HERO_TIERS[heroName.toLowerCase()] || 'B';
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
    buffDependency: inferBuffDependency(rawHero)
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
