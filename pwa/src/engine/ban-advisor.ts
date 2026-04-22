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

const PHASE2_ALLY_LOCK_COUNT = 1;
const TARGETED_THREAT_SCALE = 12;

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
   * Resolve directional gaps in matchup data by checking both directions.
   * If candidate->ally is missing, ally->candidate negative score still implies threat.
   */
  private getThreatAgainstAlly(candidateId: number, allyId: number): number {
    const direct = this.data.getMatchupScore(candidateId, allyId);
    const reverse = this.data.getMatchupScore(allyId, candidateId);
    return Math.max(0, direct, -reverse);
  }

  /**
   * Phase 1 — Meta bans (before any ally picks).
   * Suggests banning high-tier heroes that have few effective counters.
   */
  getMetaBans(
    enemyPickIds: number[] = [],
    alreadyUnavailable: number[] = [],
    priorityHeroIds: number[] = [],
    limit: number = 5
  ): BanSuggestion[] {
    const unavailable = new Set([...alreadyUnavailable, ...priorityHeroIds]);
    const allHeroes = this.data.getAllHeroes().filter(h => !unavailable.has(h.id));
    const enemyHeroes = enemyPickIds
      .map(id => this.data.getHero(id))
      .filter((h): h is Hero => h !== undefined);

    const scored: BanSuggestion[] = allHeroes.map(hero => {
      const tierW = TIER_WEIGHT[hero.tier] ?? 1.0;
      const counterCount = this.counterCountCache.get(hero.id) ?? 0;

      const counterAccessibility = counterCount === 0 ? 0.1 : counterCount;
      let banScore = tierW * (10 / counterAccessibility);

      // Early Draft Denial logic: if enemy picked half of a combo, suggest banning the other half
      let denialBonus = 0;
      for (const enemy of enemyHeroes) {
        const syn = (this.data as any).getSynergyScore ? (this.data as any).getSynergyScore(hero.id, enemy.id) : 0;
        if (syn > 0) denialBonus += syn;
      }
      banScore += denialBonus * 2.0;

      const tierLabel = hero.tier;
      let reason: string;
      if (denialBonus > 0) {
        reason = `Draft denial: prevent enemy from completing a strong combo`;
      } else if (counterCount <= 2) {
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
   * Phase 2 — Protective bans (after ally picks OR priority heroes are known).
   * Suggests banning heroes that threaten your team the most.
   *
   * threat(candidate, target) = how well candidate performs vs target
   * Total = sum across all targets + tier bonus
   */
  getProtectiveBans(
    allyPickIds: number[] = [],
    enemyPickIds: number[] = [],
    alreadyUnavailable: number[] = [],
    priorityHeroIds: number[] = [],
    limit: number = 5
  ): BanSuggestion[] {
    if (allyPickIds.length === 0 && priorityHeroIds.length === 0) {
      return this.getMetaBans(enemyPickIds, alreadyUnavailable, priorityHeroIds, limit);
    }

    const unavailable = new Set([...alreadyUnavailable]);
    const allHeroes = this.data.getAllHeroes().filter(h => !unavailable.has(h.id));
    
    // We protect both locked allies and heroes our team WANTS to play (priority)
    const targets = [...new Set([...allyPickIds, ...priorityHeroIds])]
      .map(id => this.data.getHero(id))
      .filter((h): h is Hero => h !== undefined);

    const isTargetedPhase = targets.length >= PHASE2_ALLY_LOCK_COUNT;

    const enemyHeroes = enemyPickIds
      .map(id => this.data.getHero(id))
      .filter((h): h is Hero => h !== undefined);

    const scored: BanSuggestion[] = allHeroes.map(candidate => {
      const tierW = TIER_WEIGHT[candidate.tier] ?? 1.0;

      // Calculate how much this candidate threatens each target
      const threats: { allyName: string; threat: number }[] = [];
      let totalThreat = 0;

      for (const target of targets) {
        const threat = this.getThreatAgainstAlly(candidate.id, target.id);
        if (threat > 0) {
          threats.push({ allyName: target.name, threat });
          totalThreat += threat;
        }
      }

      // Phase-2 targeted boost: amplify candidates that hard-counter current/priority allies.
      const targetedThreatModifier = isTargetedPhase
        ? 1 + (totalThreat / TARGETED_THREAT_SCALE)
        : 1;

      let enemySynergy = 0;
      let counterDenial = 0;

      for (const enemy of enemyHeroes) {
        // Synergy: Does the candidate combo with the enemy? (draft denial)
        const syn = (this.data as any).getSynergyScore ? (this.data as any).getSynergyScore(candidate.id, enemy.id) : 0;
        if (syn > 0) enemySynergy += syn;

        // We DO NOT want to ban our best counter-picks against the enemy team!
        const counterScore = this.data.getMatchupScore(candidate.id, enemy.id);
        if (counterScore > 0) counterDenial += counterScore;
      }

      // Final score: weighted threats + optional phase-2 baseline - counter potential
      const phase2Baseline = isTargetedPhase ? tierW * 0.25 : 0;
      let banScore = ((totalThreat + enemySynergy) * tierW * targetedThreatModifier) + phase2Baseline;
      banScore -= (counterDenial * 1.5); // Penalty: don't ban our own good counters
      banScore = Math.max(0, banScore); // Clamp to 0

      // Build reason string
      let reason: string;
      if (enemySynergy > 0 && enemySynergy > totalThreat) {
        reason = `Draft denial: strong combo potential with enemy picks`;
      } else if (threats.length > 0) {
        const sortedThreats = threats.sort((a, b) => b.threat - a.threat);
        const topThreat = sortedThreats[0];
        
        // Differentiate between locked allies and priority heroes in the text
        const isPriority = priorityHeroIds.includes(this.data.getHeroByName(topThreat.allyName)?.id || -1);
        const prefix = isPriority ? "Priority protection" : "Phase 2 targeted ban";
        
        const threatStrs = sortedThreats
          .slice(0, 3)
          .map(t => `${t.allyName} (+${t.threat.toFixed(1)})`);
          
        reason = `${prefix}: hard-counters your ${threatStrs.join(', ')}`;
      } else {
        reason = isTargetedPhase
          ? `Protective phase: no direct hard-counter found, prioritize flexible denial`
          : `Tier ${candidate.tier} meta threat`;
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
   * If allies are picked OR priority heroes set → protective bans.
   * Otherwise → meta bans.
   */
  getSuggestedBans(
    allyPickIds: number[] = [],
    enemyPickIds: number[] = [],
    existingBanIds: number[] = [],
    priorityHeroIds: number[] = [],
    limit: number = 5
  ): BanSuggestion[] {
    const unavailable = [...allyPickIds, ...enemyPickIds, ...existingBanIds];

    // Trigger protective logic if we have locked picks OR if the user marked heroes they want to play
    if (allyPickIds.length >= PHASE2_ALLY_LOCK_COUNT || priorityHeroIds.length > 0) {
      return this.getProtectiveBans(allyPickIds, enemyPickIds, unavailable, priorityHeroIds, limit);
    }

    return this.getMetaBans(enemyPickIds, unavailable, priorityHeroIds, limit);
  }
}
