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

// ============================================================
// Worker State
// ============================================================
let heroes: HeroData[] = [];
let heroMap: Map<number, HeroData> = new Map();
let matchups: Record<string, Record<string, number>> = {};
let initialized = false;

function getMatchupScore(heroId: number, enemyId: number): number {
  return matchups[String(heroId)]?.[String(enemyId)] ?? 0;
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

  const tierWeight = TIER_WEIGHT[hero.tier] ?? 1.0;
  let weightedScore = rawScore * tierWeight;

  // Esmeralda-Aldous Rule
  if (minScore <= -3) {
    weightedScore -= (minScore * minScore);
  }

  // Blind-Pick Vulnerability
  if (enemyIds.length <= 1) {
    let counterCount = 0;
    for (const h of heroes) {
      if (h.id === hero.id) continue;
      if (getMatchupScore(h.id, hero.id) >= 3.0) counterCount++;
    }
    weightedScore -= counterCount * 1.5;

    if (enemyIds.length === 0) {
      const safeWr = (typeof hero.base_wr === 'number' && !isNaN(hero.base_wr)) ? hero.base_wr : 50;
      weightedScore += (safeWr - 50);
    }
  }

  return {
    rawScore,
    weightedScore: Math.round(weightedScore * 100) / 100,
    minScore,
    breakdown
  };
}

function passesFilter(hero: HeroData, filter?: { roles?: string[]; lanes?: string[]; min_tier?: string }): boolean {
  if (!filter) return true;
  if (filter.roles && filter.roles.length > 0) {
    if (!hero.roles.some(r => filter.roles!.includes(r))) return false;
  }
  if (filter.lanes && filter.lanes.length > 0) {
    if (!hero.lanes.some(l => filter.lanes!.includes(l))) return false;
  }
  if (filter.min_tier) {
    const minRank = TIER_RANK[filter.min_tier] ?? 4;
    const heroRank = TIER_RANK[hero.tier] ?? 4;
    if (heroRank > minRank) return false;
  }
  return true;
}

// ============================================================
// Message Handler
// ============================================================
self.onmessage = (e: MessageEvent) => {
  const { type, id, payload } = e.data;

  switch (type) {
    case 'init': {
      heroes = payload.heroes;
      matchups = payload.matchups;
      heroMap = new Map(heroes.map(h => [h.id, h]));
      initialized = true;
      (self as any).postMessage({ type: 'ready', id });
      break;
    }

    case 'counterPicks': {
      if (!initialized) {
        (self as any).postMessage({ type: 'error', id, error: 'Worker not initialized' });
        return;
      }

      const { enemyIds, allyIds = [], filter, limit = 10 } = payload;
      const enemySet = new Set(enemyIds);
      const results: ScoredHeroResult[] = [];

      for (const hero of heroes) {
        if (enemySet.has(hero.id)) continue;
        if (!passesFilter(hero, filter)) continue;

        const { rawScore, weightedScore, breakdown } = scoreHero(hero, enemyIds, allyIds);
        results.push({ hero, raw_score: rawScore, weighted_score: weightedScore, breakdown });
      }

      results.sort((a, b) => b.weighted_score - a.weighted_score);
      (self as any).postMessage({ type: 'result', id, data: results.slice(0, limit) });
      break;
    }

    case 'weakPicks': {
      if (!initialized) {
        (self as any).postMessage({ type: 'error', id, error: 'Worker not initialized' });
        return;
      }

      const { enemyIds, limit = 5 } = payload;
      const enemySet = new Set(enemyIds as number[]);
      const results: ScoredHeroResult[] = [];

      for (const hero of heroes) {
        if (enemySet.has(hero.id)) continue;
        const breakdown: MatchupBreakdown[] = [];
        let rawScore = 0;
        for (const eid of enemyIds as number[]) {
          const score = getMatchupScore(hero.id, eid);
          rawScore += score;
          breakdown.push({ enemy_id: eid, enemy_name: heroMap.get(eid)?.name ?? `Unknown(${eid})`, score });
        }
        results.push({ hero, raw_score: rawScore, weighted_score: rawScore, breakdown });
      }

      results.sort((a, b) => a.weighted_score - b.weighted_score);
      (self as any).postMessage({ type: 'result', id, data: results.slice(0, limit) });
      break;
    }
  }
};
