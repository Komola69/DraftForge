import fs from 'fs';
import path from 'path';

const DIR_RAW = path.resolve('./data/raw');
const DIR_PROCESSED = path.resolve('./data/processed');

const rawMeta = JSON.parse(fs.readFileSync(path.join(DIR_RAW, 'hero-meta-final.json'), 'utf8'));
const metaOverrides = JSON.parse(fs.readFileSync(path.join(DIR_RAW, 'meta_overrides.json'), 'utf8'));
const synergiesData = JSON.parse(fs.readFileSync(path.join(DIR_RAW, 'synergies.json'), 'utf8'));

/**
 * DNA DICTIONARY - THE ULTIMATE TRUTH
 */
const MASTER_DNA = {
  // Mobility & Counters
  'Fanny': ['CABLE', 'BLINK', 'DIVE', 'EARLY_GAME', 'BUFF_DEPENDENT'],
  'Ling': ['BLINK', 'DIVE', 'LATE_GAME', 'BUFF_DEPENDENT'],
  'Benedetta': ['BLINK', 'DASH', 'AOE', 'BACKLINE_ACCESS'],
  'Lancelot': ['BLINK', 'DASH', 'EARLY_GAME'],
  'Phoveus': ['ANTI_DASH', 'AOE', 'SHIELD', 'MID_GAME'],
  'Minsitthar': ['ANTI_DASH', 'GROUNDED', 'STUN', 'SUSTAIN'],
  'Khufra': ['ANTI_DASH', 'STUN', 'HIGH_DEFENSE', 'DIVE'],
  'Saber': ['SUPPRESS', 'SINGLE_TARGET', 'EARLY_GAME', 'BACKLINE_ACCESS'],
  'Kaja': ['SUPPRESS', 'SINGLE_TARGET', 'DIVE', 'EARLY_GAME'],
  'Franco': ['SUPPRESS', 'SINGLE_TARGET', 'DIVE'],

  // Sustain & Anti-Sustain
  'Estes': ['HEAL', 'REGEN', 'AOE', 'BUFF_DEPENDENT'],
  'Floryn': ['HEAL', 'REGEN', 'AOE'],
  'Angela': ['HEAL', 'SHIELD', 'BUFF_DEPENDENT'],
  'Baxia': ['ANTI_HEAL', 'REGEN', 'HIGH_DEFENSE', 'DIVE'],
  'Esmeralda': ['SHIELD', 'REGEN', 'AOE', 'SHIELD_SHRED', 'MID_GAME'],
  'Thamuz': ['REGEN', 'TRUE_DAMAGE', 'DASH', 'EARLY_GAME', 'SUSTAIN'],
  'Karrie': ['TRUE_DAMAGE', 'PERCENT_HP_DMG', 'DASH', 'LATE_GAME'],
  'Claude': ['BLINK', 'AOE', 'LATE_GAME', 'PERCENT_HP_DMG'],
  'Carmilla': ['SHIELD_SHRED', 'AOE', 'SUSTAIN', 'LATE_GAME'],
  'Uranus': ['REGEN', 'SUSTAIN', 'HIGH_DEFENSE', 'AOE', 'SHIELD'],
  'Harith': ['BLINK', 'DASH', 'SHIELD', 'MID_GAME', 'AOE'],
  'Mathilda': ['BLINK', 'DASH', 'SHIELD', 'EARLY_GAME', 'HEAL'],
  'Lolita': ['SHIELD', 'STUN', 'HIGH_DEFENSE', 'AOE'],
  'Hanabi': ['SHIELD', 'AOE', 'LATE_GAME', 'POKE'],

  // Artillery & Burst
  'Vexana': ['AOE', 'STUN', 'POKE', 'BURST'],
  'Nana': ['AOE', 'STUN', 'POKE'],
  'Chang\'e': ['ARTILLERY', 'POKE', 'AOE', 'SHIELD'],
  'Pharsa': ['ARTILLERY', 'AOE', 'BLINK', 'BURST'],
  'Novaria': ['ARTILLERY', 'POKE', 'BACKLINE_ACCESS', 'BLINK'],
  'Eudora': ['BURST', 'STUN', 'SINGLE_TARGET', 'EARLY_GAME'],
  'Aurora': ['AOE', 'STUN', 'BURST', 'POKE'],

  // Defense & CC Setters
  'Tigreal': ['AOE', 'STUN', 'HIGH_DEFENSE', 'DIVE', 'EARLY_GAME'],
  'Atlas': ['AOE', 'STUN', 'HIGH_DEFENSE', 'DIVE', 'MID_GAME'],
  'Grock': ['AOE', 'STUN', 'HIGH_DEFENSE', 'DIVE', 'EARLY_GAME'],
  'Terizla': ['AOE', 'STUN', 'DAMAGE_REDUCTION', 'EARLY_GAME', 'SUSTAIN'],
  'Edith': ['AOE', 'STUN', 'HIGH_DEFENSE', 'TRUE_DAMAGE'],
  'Minotaur': ['AOE', 'STUN', 'HEAL', 'SUSTAIN'],

  // High-Tier DPS DNA
  'Brody': ['SINGLE_TARGET', 'POKE', 'EARLY_GAME', 'PENETRATION'],
  'Bruno': ['SINGLE_TARGET', 'DASH', 'LATE_GAME', 'PENETRATION'],
  'Moskov': ['BLINK', 'LATE_GAME', 'AOE', 'PENETRATION'],
};

function getHeuristicDNA(hero) {
  const tags = new Set();
  const roles = hero.roles.map(r => r.toLowerCase());
  if (roles.includes('assassin')) tags.add('DIVE').add('BLINK').add('EARLY_GAME').add('SINGLE_TARGET');
  if (roles.includes('marksman')) tags.add('LATE_GAME').add('SINGLE_TARGET').add('POKE');
  if (roles.includes('tank')) tags.add('HIGH_DEFENSE').add('STUN').add('AOE');
  if (roles.includes('mage')) tags.add('AOE').add('POKE').add('MID_GAME');
  if (roles.includes('support')) tags.add('HEAL').add('AOE').add('EARLY_GAME');
  if (roles.includes('fighter')) tags.add('SUSTAIN').add('DASH').add('MID_GAME');
  return Array.from(tags);
}

function inferGoldReliance(rawHero, roles) {
  const key = String(rawHero.hero_name || '').toLowerCase();
  const VERY_HIGH_GOLD = ['aldous', 'cecilion', 'claude', 'miya'];
  if (VERY_HIGH_GOLD.includes(key)) return 9;
  if (roles.includes('marksman')) return 7;
  if (roles.includes('tank') || roles.includes('support')) return 3;
  return 5;
}

function inferBuffDependency(rawHero) {
  const key = String(rawHero.hero_name || '').toLowerCase();
  if (['fanny', 'ling', 'hayabusa'].includes(key)) return 'Purple';
  if (['karrie', 'clint', 'miya'].includes(key)) return 'Red';
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

const heroesList = [];
const nameToId = new Map();
const matchups = {};
let currentId = 1;

for (const rawHero of rawMeta.data) {
  if (rawHero.hero_name === "None") continue;
  const id = currentId++;
  const name = rawHero.hero_name;
  const roles = (rawHero.class || "fighter").split(',').map(r => r.trim().toLowerCase());
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
  lanes = [...new Set(lanes)];

  const heroObj = {
    id,
    name,
    roles,
    lanes,
    tier: inferTier(name),
    base_wr: 50.0,
    goldReliance: inferGoldReliance(rawHero, roles),
    buffDependency: inferBuffDependency(rawHero),
    primaryDamageType: inferDamageType(name, roles)
  };

  heroObj.tags = MASTER_DNA[name] || getHeuristicDNA(heroObj);

  heroesList.push(heroObj);
  nameToId.set(name.toLowerCase(), id);
  matchups[id] = {};
}

const STRENGTH_COUNTER = 7.0;
for (const rawHero of rawMeta.data) {
  if (rawHero.hero_name === "None") continue;
  const targetId = nameToId.get(rawHero.hero_name.toLowerCase());
  if (!targetId) continue;
  if (Array.isArray(rawHero.counters)) {
    for (const c of rawHero.counters) {
      const counterId = nameToId.get(c.heroname.toLowerCase());
      if (counterId) {
        matchups[counterId][targetId] = STRENGTH_COUNTER;
        matchups[targetId][counterId] = -STRENGTH_COUNTER;
      }
    }
  }
}

const synergyOutput = { schema_version: "1.0.0", combos: {} };
for (const [heroName, combos] of Object.entries(synergiesData.combos)) {
  const heroId = nameToId.get(heroName.toLowerCase());
  if (heroId) {
    synergyOutput.combos[heroId] = combos.map(c => {
      const partnerId = nameToId.get(c.partner.toLowerCase());
      return { partnerId, strength: c.strength };
    }).filter(c => c.partnerId !== undefined);
  }
}

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
  matchups: matchups
};

fs.writeFileSync(path.join(DIR_PROCESSED, 'v1_heroes.json'), JSON.stringify(heroesOutput, null, 2));
fs.writeFileSync(path.join(DIR_PROCESSED, 'v1_matchups.json'), JSON.stringify(matchupsOutput, null, 2));
fs.writeFileSync(path.join(DIR_PROCESSED, 'v1_synergies.json'), JSON.stringify(synergyOutput, null, 2));

console.log(`[SUCCESS] Compiled DNA-aware database.`);
