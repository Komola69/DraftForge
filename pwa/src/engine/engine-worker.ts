/**
 * DraftForge Engine Worker
 *
 * Offloads heavy combinatorics (counter-pick scoring, team building)
 * off the main UI thread to prevent WebKit stuttering during
 * gameplay or overlay animations.
 *
 * Communication protocol:
 *   Main Thread → Worker:  { type: 'counterPicks' | 'weakPicks', payload: {...} }
 *   Worker → Main Thread:  { type: 'result', id: string, data: ScoredHero[] }
 *
 * The worker holds its own copy of the matchup matrix and hero data
 * to avoid structured-clone overhead on every request.
 */

// ============================================================
// Inline Engine Logic (no imports in Workers without bundler support)
// ============================================================

interface HeroData {
  id: number;
  name: string;
  roles: string[];
  lanes: string[];
  tier: string;
  base_wr: number;
  goldReliance: number;
  buffDependency: string;
}

interface MatchupBreakdown {
  enemy_id: number;
  enemy_name: string;
  score: number;
}

interface ScoredHeroResult {
  hero: HeroData;
  raw_score: number;
  weighted_score: number;
  breakdown: MatchupBreakdown[];
}

const TIER_WEIGHT: Record<string, number> = {
  'S': 1.15, 'A': 1.05, 'B': 1.00, 'C': 0.90, 'D': 0.75,
};

const TIER_RANK: Record<string, number> = {
  'S': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4,
};

const DENIAL_WEIGHT = 2.5;

// ============================================================
// Worker State
// ============================================================
let heroes: HeroData[] = [];
let heroMap: Map<number, HeroData> = new Map();
let matchups: Record<string, Record<string, number>> = {};
let synergies: Record<string, { partnerId: number; strength: number }[]> = {};
let initialized = false;

function getMatchupScore(heroId: number, enemyId: number): number {
  return matchups[String(heroId)]?.[String(enemyId)] ?? 0;
}

function getSynergyScore(heroId: number, partnerId: number): number {
  const heroSyns = synergies[String(heroId)] || [];
  const match = heroSyns.find(s => s.partnerId === partnerId);
  if (match) return match.strength;

  const partnerSyns = synergies[String(partnerId)] || [];
  const reverseMatch = partnerSyns.find(s => s.partnerId === heroId);
  return reverseMatch ? reverseMatch.strength : 0;
}

function scoreHero(
  hero: HeroData,
  enemyIds: number[],
  allyIds: number[] = []
): { rawScore: number; weightedScore: number; minScore: number; breakdown: MatchupBreakdown[] } {
  const breakdown: MatchupBreakdown[] = [];
  let rawScore = 0;
  let minScore = 0;

  for (const enemyId of enemyIds) {
    const score = getMatchupScore(hero.id, enemyId);
    rawScore += score;
    if (score < minScore) minScore = score;

    const enemy = heroMap.get(enemyId);
    breakdown.push({
      enemy_id: enemyId,
      enemy_name: enemy?.name ?? `Unknown(${enemyId})`,
      score,
    });
  }

  // Synergy with allies
  for (const allyId of allyIds) {
    const synScore = getSynergyScore(hero.id, allyId);
    if (synScore > 0) {
      rawScore += (synScore * 0.5);
    }
  }

  const tierWeight = TIER_WEIGHT[hero.tier] ?? 1.0;
  let weightedScore = rawScore * tierWeight;

  // The Esmeralda-Aldous Rule: Exponential Penalty for Hard Counters
  if (minScore <= -3) {
    weightedScore -= (minScore * minScore);
  }

  // Blind-Pick Vulnerability (Turn-Order Ignorance)
  if (enemyIds.length <= 1) {
    let counterCount = 0;
    for (const h of heroes) {
      if (h.id === hero.id) continue;
      if (getMatchupScore(h.id, hero.id) >= 3.0) {
        counterCount++;
      }
    }
    const safetyPenalty = counterCount * 1.5;
    weightedScore -= safetyPenalty;
    
    if (enemyIds.length === 0) {
       const safeWr = (typeof hero.base_wr === 'number' && !isNaN(hero.base_wr)) ? hero.base_wr : 50;
       weightedScore += (safeWr - 50);
    }
  }

  // Draft Denial
  if (enemyIds.length > 0) {
    let denialScore = 0;
    for (const enemyId of enemyIds) {
      const synScore = getSynergyScore(hero.id, enemyId);
      if (synScore > 0) denialScore += synScore;
    }
    if (denialScore > 0) {
      weightedScore += denialScore * DENIAL_WEIGHT;
    }
  }

  return {
    rawScore,
    weightedScore: Math.round(weightedScore * 100) / 100,
    minScore,
    breakdown
  };
}

// ============================================================
// Message Routing
// ============================================================

self.onmessage = (e: MessageEvent) => {
  const { type, id, payload } = e.data;

  if (type === 'init') {
    heroes = payload.heroes;
    matchups = payload.matchups;
    synergies = payload.synergies || {};
    heroMap.clear();
    heroes.forEach(h => heroMap.set(h.id, h));
    initialized = true;
    self.postMessage({ type: 'ready', id });
    return;
  }

  if (!initialized) {
    self.postMessage({ type: 'error', id, error: 'Worker not initialized' });
    return;
  }

  if (type === 'counterPicks') {
    const { enemyIds, allyIds, filter, limit } = payload;
    const enemySet = new Set(enemyIds);
    const results: ScoredHeroResult[] = [];

    for (const hero of heroes) {
      if (enemySet.has(hero.id)) continue;

      // Simple filters (role, lane, tier)
      if (filter) {
        if (filter.roles && filter.roles.length > 0) {
          if (!hero.roles.some(r => filter.roles.includes(r))) continue;
        }
        if (filter.lanes && filter.lanes.length > 0) {
          if (!hero.lanes.some(l => filter.lanes.includes(l))) continue;
        }
        if (filter.min_tier) {
          const minRank = TIER_RANK[filter.min_tier] ?? 4;
          const heroRank = TIER_RANK[hero.tier] ?? 4;
          if (heroRank > minRank) continue;
        }
      }

      const { rawScore, weightedScore, breakdown } = scoreHero(hero, enemyIds, allyIds);

      results.push({
        hero,
        raw_score: rawScore,
        weighted_score: weightedScore,
        breakdown,
      });
    }

    results.sort((a, b) => b.weighted_score - a.weighted_score);
    self.postMessage({ type: 'result', id, data: results.slice(0, limit) });
  }

  if (type === 'weakPicks') {
    const { enemyIds, limit } = payload;
    const enemySet = new Set(enemyIds);
    const results: ScoredHeroResult[] = [];

    for (const hero of heroes) {
      if (enemySet.has(hero.id)) continue;

      const { rawScore, weightedScore, breakdown } = scoreHero(hero, enemyIds);

      results.push({
        hero,
        raw_score: rawScore,
        weighted_score: weightedScore,
        breakdown,
      });
    }

    results.sort((a, b) => a.weighted_score - b.weighted_score);
    self.postMessage({ type: 'result', id, data: results.slice(0, limit) });
  }
};
