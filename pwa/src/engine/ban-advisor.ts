/**
 * BanAdvisor: Suggests which heroes YOUR team should ban.
 *
 * Two-phase logic matching MLBB ranked draft:
 *
 * Phase 1 — Pre-pick bans (no allies picked yet):
 *   Score = tier_dominance × (1 / counter_accessibility)
 *   Bans S/A-tier heroes that are hardest to counter.
 *   "Ban Ling because he's S-tier and only 3 heroes counter him well"
 *
 * Phase 2 — Post-pick bans (allies already picked):
 *   Score = Σ threat(hero, ally_i) + tier_bonus
 *   Bans heroes that specifically destroy your team's composition.
 *   "Ban Khufra because he hard-counters your Fanny (+8.5) and Gusion (+6.2)"
 *
 * All suggestions include human-readable reasoning.
 */

import type { Hero } from './types';
import { DataLoader } from './data-loader';

const TIER_WEIGHT: Record<string, number> = {
  'S': 1.30, 'A': 1.10, 'B': 1.00, 'C': 0.85, 'D': 0.70,
};

/** Threshold: a hero is "countered" if someone scores >= this against them */
const COUNTER_THRESHOLD = 3.0;

export interface BanSuggestion {
  hero: Hero;
  score: number;
  reason: string;
  threats: { allyName: string; threat: number }[];
  phase: 'meta' | 'protect';
}

export class BanAdvisor {
  private data: DataLoader;
  /** Cache: heroId → number of heroes that counter them effectively */
  private counterCountCache: Map<number, number> = new Map();

  constructor(dataLoader: DataLoader) {
    this.data = dataLoader;
    this.data.onLoad(() => this.buildCounterCountCache());
  }

  /**
   * Pre-compute how many heroes can effectively counter each hero.
   * A hero with few counters is more ban-worthy.
   */
  private buildCounterCountCache(): void {
    if (this.counterCountCache.size > 0) return; // Already built
    const allHeroes = this.data.getAllHeroes();

    for (const target of allHeroes) {
      let counterCount = 0;
      for (const candidate of allHeroes) {
        if (candidate.id === target.id) continue;
        const score = this.data.getMatchupScore(candidate.id, target.id);
        if (score >= COUNTER_THRESHOLD) {
          counterCount++;
        }
      }
      this.counterCountCache.set(target.id, counterCount);
    }
  }

  /**
   * Phase 1 — Meta bans (before any ally picks).
   * Suggests banning high-tier heroes that have few effective counters.
   */
  getMetaBans(
    alreadyUnavailable: number[] = [],
    limit: number = 5
  ): BanSuggestion[] {
    const unavailable = new Set(alreadyUnavailable);
    const allHeroes = this.data.getAllHeroes().filter(h => !unavailable.has(h.id));

    const scored: BanSuggestion[] = allHeroes.map(hero => {
      const tierW = TIER_WEIGHT[hero.tier] ?? 1.0;
      const counterCount = this.counterCountCache.get(hero.id) ?? 0;

      // Inverse counter accessibility: fewer counters = higher ban value
      // Use 0.1 for 0 to heavily penalize uncounterable heroes
      const counterAccessibility = counterCount === 0 ? 0.1 : counterCount;
      const banScore = tierW * (10 / counterAccessibility);

      // Build reason
      const tierLabel = hero.tier;
      let reason: string;
      if (counterCount <= 2) {
        reason = `${hero.name} is Tier ${tierLabel} with almost no counters (${counterCount} effective counter${counterCount !== 1 ? 's' : ''})`;
      } else if (counterCount <= 5) {
        reason = `${hero.name} is Tier ${tierLabel} with few counters (${counterCount}). Hard to deal with if picked.`;
      } else {
        reason = `${hero.name} is Tier ${tierLabel} — a strong meta pick.`;
      }

      return {
        hero,
        score: Math.round(banScore * 100) / 100,
        reason,
        threats: [],
        phase: 'meta' as const,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Phase 2 — Protective bans (after ally picks are known).
   * Suggests banning heroes that threaten your team the most.
   *
   * threat(candidate, ally) = how well candidate performs vs ally
   * Total = sum across all allies + tier bonus
   */
  getProtectiveBans(
    allyPickIds: number[],
    alreadyUnavailable: number[] = [],
    limit: number = 5
  ): BanSuggestion[] {
    if (allyPickIds.length === 0) {
      return this.getMetaBans(alreadyUnavailable, limit);
    }

    const unavailable = new Set(alreadyUnavailable);
    const allHeroes = this.data.getAllHeroes().filter(h => !unavailable.has(h.id));

    // Get ally hero names for display
    const allyHeroes = allyPickIds
      .map(id => this.data.getHero(id))
      .filter((h): h is Hero => h !== undefined);

    const scored: BanSuggestion[] = allHeroes.map(candidate => {
      const tierW = TIER_WEIGHT[candidate.tier] ?? 1.0;

      // Calculate how much this candidate threatens each ally
      const threats: { allyName: string; threat: number }[] = [];
      let totalThreat = 0;

      for (const ally of allyHeroes) {
        // Positive score means candidate counters the ally
        const threat = this.data.getMatchupScore(candidate.id, ally.id);
        if (threat > 0) {
          threats.push({ allyName: ally.name, threat });
          totalThreat += threat;
        }
      }

      // Final score: total threat to allies × tier weight
      const banScore = totalThreat * tierW;

      // Build reason string
      let reason: string;
      if (threats.length > 0) {
        const threatStrs = threats
          .sort((a, b) => b.threat - a.threat)
          .slice(0, 3)
          .map(t => `${t.allyName} (+${t.threat.toFixed(1)})`);
        reason = `Threatens your ${threatStrs.join(', ')}`;
      } else {
        reason = `Tier ${candidate.tier} meta threat`;
      }

      return {
        hero: candidate,
        score: Math.round(banScore * 100) / 100,
        reason,
        threats,
        phase: 'protect' as const,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Smart bans — automatically picks the right phase.
   * If allies are picked → protective bans.
   * Otherwise → meta bans.
   */
  getSuggestedBans(
    allyPickIds: number[],
    enemyPickIds: number[],
    existingBanIds: number[],
    limit: number = 5
  ): BanSuggestion[] {
    const unavailable = [...allyPickIds, ...enemyPickIds, ...existingBanIds];

    if (allyPickIds.length > 0) {
      return this.getProtectiveBans(allyPickIds, unavailable, limit);
    }

    return this.getMetaBans(unavailable, limit);
  }
}
