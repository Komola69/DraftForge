/**
 * DraftEngine: The core scoring algorithm.
 * 
 * Given a set of enemy heroes, this engine computes which heroes
 * counter them best by aggregating 1v1 matchup scores.
 * 
 * Performance target: < 1ms for 5 enemies against 125 heroes.
 * Actual: ~0.01ms (625 lookups + 125 sorts).
 * 
 * Algorithm:
 *   For each candidate hero H (not in enemy list):
 *     raw_score = SUM of matchup_score(H, enemy_i) for all enemies
 *     weighted_score = raw_score * tier_weight(H.tier)
 *   Sort candidates by weighted_score descending.
 *   Return top N.
 * 
 * Tier weights exist because an S-tier counter is more reliable
 * than a C-tier hero that theoretically counters but lacks base stats.
 */

import type { ScoredHero, MatchupBreakdown, CounterFilter, Hero } from './types';
import { DataLoader } from './data-loader';

/** Tier weights: S-tier heroes get a slight boost, C/D get penalized */
const TIER_WEIGHT: Record<string, number> = {
  'S': 1.15,
  'A': 1.05,
  'B': 1.00,
  'C': 0.90,
  'D': 0.75,
};

/** Tier ranking for filtering (lower = better) */
const TIER_RANK: Record<string, number> = {
  'S': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4,
};

export function calculateHeroScore(
  data: DataLoader,
  hero: Hero,
  enemyIds: number[],
  allyIds: number[] = []
): { rawScore: number; weightedScore: number; minScore: number; breakdown: MatchupBreakdown[] } {
  const breakdown: MatchupBreakdown[] = [];
  let rawScore = 0;
  let minScore = 0;

  for (const enemyId of enemyIds) {
    const score = data.getMatchupScore(hero.id, enemyId);
    rawScore += score;
    if (score < minScore) {
      minScore = score;
    }

    const enemy = data.getHero(enemyId);
    breakdown.push({
      enemy_id: enemyId,
      enemy_name: enemy?.name ?? `Unknown(${enemyId})`,
      score,
    });
  }

  // Add synergy scores from allies
  for (const allyId of allyIds) {
    const synScore = (data as any).getSynergyScore ? (data as any).getSynergyScore(hero.id, allyId) : 0; 
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
  if (enemyIds.length <= 1) { // 0 or 1 enemy showing (Turns 1 and 2)
    let counterCount = 0;
    const allHeroes = data.getAllHeroes();
    for (const h of allHeroes) {
      if (h.id === hero.id) continue;
      // If an enemy has a strong matchup (+3.0 or more) against this hero, they counter it.
      if (data.getMatchupScore(h.id, hero.id) >= 3.0) {
        counterCount++;
      }
    }
    // Heavy penalty for highly counterable heroes during early draft
    const safetyPenalty = counterCount * 1.5;
    weightedScore -= safetyPenalty;
    
    // Add base WR boost to differentiate heroes when enemyIds is 0
    // Safeguard against NaN in case base_wr is missing from the JSON schema
    if (enemyIds.length === 0) {
       const safeWr = (typeof hero.base_wr === 'number' && !isNaN(hero.base_wr)) ? hero.base_wr : 50;
       weightedScore += (safeWr - 50); // Usually around -5 to +5
    }
  }

  return {
    rawScore,
    weightedScore: Math.round(weightedScore * 100) / 100,
    minScore,
    breakdown
  };
}

export class DraftEngine {
  private data: DataLoader;

  constructor(dataLoader: DataLoader) {
    if (!dataLoader.loaded) {
      throw new Error('DraftEngine: DataLoader must be loaded before creating engine');
    }
    this.data = dataLoader;
  }

  /**
   * Main entry point: get counter picks for a set of enemy heroes.
   * 
   * @param enemyIds - Array of 1-5 enemy hero IDs
   * @param filter - Optional filtering (roles, lanes, tier, limit)
   * @returns Sorted array of ScoredHero, best counters first
   */
  getCounterPicks(enemyIds: number[], allyIds: number[] = [], filter?: CounterFilter): ScoredHero[] {
    if (enemyIds.length > 5) { // Allow length 0 for Turn 1 blind picks
      return [];
    }

    const limit = filter?.limit ?? 10;
    const enemySet = new Set(enemyIds);
    const candidates = this.data.getAllHeroes();
    const results: ScoredHero[] = [];

    for (const hero of candidates) {
      // Skip heroes that are in the enemy team
      if (enemySet.has(hero.id)) continue;

      // Apply filters before scoring (skip early = faster)
      if (!this.passesFilter(hero, filter)) continue;

      const { rawScore, weightedScore, breakdown } = calculateHeroScore(this.data, hero, enemyIds, allyIds);

      results.push({
        hero,
        raw_score: rawScore,
        weighted_score: weightedScore,
        breakdown,
        build: this.data.getBuild(hero.id),
      });
    }

    // Sort by weighted score descending
    results.sort((a, b) => b.weighted_score - a.weighted_score);

    return results.slice(0, limit);
  }

  /**
   * Get heroes that are WEAK against the given enemies.
   * Useful for "don't pick these" warnings.
   */
  getWeakPicks(enemyIds: number[], limit: number = 5): ScoredHero[] {
    if (enemyIds.length === 0 || enemyIds.length > 5) return [];

    const enemySet = new Set(enemyIds);
    const candidates = this.data.getAllHeroes();
    const results: ScoredHero[] = [];

    for (const hero of candidates) {
      if (enemySet.has(hero.id)) continue;

      const breakdown: MatchupBreakdown[] = [];
      let rawScore = 0;

      for (const enemyId of enemyIds) {
        const score = this.data.getMatchupScore(hero.id, enemyId);
        rawScore += score;
        const enemy = this.data.getHero(enemyId);
        breakdown.push({
          enemy_id: enemyId,
          enemy_name: enemy?.name ?? `Unknown(${enemyId})`,
          score,
        });
      }

      results.push({
        hero,
        raw_score: rawScore,
        weighted_score: rawScore,
        breakdown,
        build: null,
      });
    }

    // Sort ascending — worst scores first
    results.sort((a, b) => a.weighted_score - b.weighted_score);

    return results.slice(0, limit);
  }

  private passesFilter(hero: Hero, filter?: CounterFilter): boolean {
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
}
