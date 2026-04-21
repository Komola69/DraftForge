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
  getCounterPicks(enemyIds: number[], filter?: CounterFilter): ScoredHero[] {
    if (enemyIds.length === 0 || enemyIds.length > 5) {
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

      // Score this hero against all enemies
      const breakdown: MatchupBreakdown[] = [];
      let rawScore = 0;
      let minScore = 0;

      for (const enemyId of enemyIds) {
        const score = this.data.getMatchupScore(hero.id, enemyId);
        rawScore += score;
        if (score < minScore) {
          minScore = score;
        }

        const enemy = this.data.getHero(enemyId);
        breakdown.push({
          enemy_id: enemyId,
          enemy_name: enemy?.name ?? `Unknown(${enemyId})`,
          score,
        });
      }

      const tierWeight = TIER_WEIGHT[hero.tier] ?? 1.0;
      let weightedScore = rawScore * tierWeight;

      // The Esmeralda-Aldous Rule: Exponential Penalty for Hard Counters
      if (minScore <= -3) {
        weightedScore -= (minScore * minScore);
      }

      results.push({
        hero,
        raw_score: rawScore,
        weighted_score: Math.round(weightedScore * 100) / 100,
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
    if (enemyIds.length === 0) return [];

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
