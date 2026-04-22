import fs from 'fs';
import path from 'path';

const DIR_PROCESSED = path.resolve('./data/processed');
const heroesPath = path.join(DIR_PROCESSED, 'v1_heroes.json');

const heroesData = JSON.parse(fs.readFileSync(heroesPath, 'utf8'));

/**
 * MASTER DNA TAGGING MAP
 * High-quality mechanical classification based on current MLBB meta knowledge.
 */
const DNA_MAP = {
  // Mobility & Anti-Mobility
  'Fanny': ['CABLE', 'BLINK', 'DIVE', 'EARLY_GAME', 'BUFF_DEPENDENT'],
  'Ling': ['BLINK', 'DIVE', 'LATE_GAME', 'BUFF_DEPENDENT'],
  'Benedetta': ['BLINK', 'DASH', 'AOE', 'BACKLINE_ACCESS'],
  'Lancelot': ['BLINK', 'DASH', 'SINGLE_TARGET', 'EARLY_GAME'],
  'Phoveus': ['ANTI_DASH', 'AOE', 'SHIELD'],
  'Minsitthar': ['ANTI_DASH', 'GROUNDED', 'STUN', 'DIVE'],
  'Khufra': ['ANTI_DASH', 'STUN', 'DIVE', 'HIGH_DEFENSE'],
  'Saber': ['SUPPRESS', 'SINGLE_TARGET', 'EARLY_GAME', 'BACKLINE_ACCESS'],
  'Kaja': ['SUPPRESS', 'SINGLE_TARGET', 'DIVE'],
  'Franco': ['SUPPRESS', 'SINGLE_TARGET', 'DIVE'],

  // Sustain & Counter-Sustain
  'Estes': ['HEAL', 'REGEN', 'AOE', 'BUFF_DEPENDENT'],
  'Floryn': ['HEAL', 'REGEN', 'AOE'],
  'Angela': ['HEAL', 'SHIELD', 'BUFF_DEPENDENT'],
  'Baxia': ['ANTI_HEAL', 'REGEN', 'HIGH_DEFENSE', 'DIVE'],
  'Esmeralda': ['SHIELD', 'REGEN', 'AOE', 'SHIELD_SHRED'],
  'Thamuz': ['REGEN', 'TRUE_DAMAGE', 'DASH', 'EARLY_GAME'],
  'Karrie': ['TRUE_DAMAGE', 'PERCENT_HP_DMG', 'DASH', 'LATE_GAME'],
  'Claude': ['BLINK', 'AOE', 'LATE_GAME', 'PERCENT_HP_DMG'],

  // Artillery & Burst
  'Vexana': ['AOE', 'STUN', 'POKE'],
  'Nana': ['AOE', 'STUN', 'POKE'],
  'Chang\'e': ['ARTILLERY', 'POKE', 'AOE', 'SHIELD'],
  'Pharsa': ['ARTILLERY', 'AOE', 'BLINK', 'BURST'],
  'Novaria': ['ARTILLERY', 'POKE', 'BACKLINE_ACCESS'],

  // Defense & Shred
  'Tigreal': ['AOE', 'STUN', 'HIGH_DEFENSE', 'DIVE'],
  'Atlas': ['AOE', 'STUN', 'HIGH_DEFENSE', 'DIVE'],
  'Grock': ['AOE', 'STUN', 'HIGH_DEFENSE', 'DIVE'],
  'Terizla': ['AOE', 'STUN', 'DAMAGE_REDUCTION', 'EARLY_GAME'],
  'Edith': ['AOE', 'STUN', 'HIGH_DEFENSE', 'TRUE_DAMAGE'],
  
  // High Tier Carry DNA
  'Brody': ['SINGLE_TARGET', 'POKE', 'EARLY_GAME', 'PENETRATION'],
  'Bruno': ['SINGLE_TARGET', 'DASH', 'LATE_GAME', 'PENETRATION'],
};

// Default heuristics for heroes not in the master map
function getHeuristicTags(hero) {
  const tags = new Set();
  const roles = hero.roles;
  
  if (roles.includes('assassin')) tags.add('DIVE').add('BLINK').add('EARLY_GAME');
  if (roles.includes('marksman')) tags.add('LATE_GAME').add('SINGLE_TARGET');
  if (roles.includes('tank')) tags.add('HIGH_DEFENSE').add('STUN');
  if (roles.includes('mage')) tags.add('AOE').add('POKE');
  if (roles.includes('support')) tags.add('HEAL').add('SHIELD');
  
  return Array.from(tags);
}

for (const hero of heroesData.heroes) {
  hero.tags = DNA_MAP[hero.name] || getHeuristicTags(hero);
}

fs.writeFileSync(heroesPath, JSON.stringify(heroesData, null, 2));

console.log(`[SUCCESS] Hero DNA Enrichment complete.`);
console.log(`Tagged ${heroesData.heroes.length} heroes with mechanical DNA.`);
