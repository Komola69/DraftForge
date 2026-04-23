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
 */

import type { ScoredHero, MatchupBreakdown, CounterFilter, Hero, HeroTag, BuildEntry } from './types';
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

const DENIAL_WEIGHT = 2.5;

/** 
 * STRATEGIC INTERACTION MATRIX 
 * Defines how specific mechanics counter each other mathematically.
 */
const TAG_INTERACTIONS: Array<{ attacker: HeroTag; victim: HeroTag; bonus: number }> = [
  // Anti-Mobility
  { attacker: 'ANTI_DASH', victim: 'DASH', bonus: 4.5 },
  { attacker: 'ANTI_DASH', victim: 'BLINK', bonus: 4.5 },
  { attacker: 'ANTI_DASH', victim: 'CABLE', bonus: 6.5 },
  { attacker: 'SUPPRESS', victim: 'CABLE', bonus: 7.0 },
  { attacker: 'SUPPRESS', victim: 'DIVE', bonus: 5.0 },
  { attacker: 'GROUNDED', victim: 'BLINK', bonus: 5.0 },

  // Anti-Sustain
  { attacker: 'ANTI_HEAL', victim: 'HEAL', bonus: 5.5 },
  { attacker: 'ANTI_HEAL', victim: 'REGEN', bonus: 4.5 },
  { attacker: 'SHIELD_SHRED', victim: 'SHIELD', bonus: 5.5 },
  { attacker: 'TRUE_DAMAGE', victim: 'HIGH_DEFENSE', bonus: 4.0 },
  { attacker: 'TRUE_DAMAGE', victim: 'DAMAGE_REDUCTION', bonus: 3.5 },
  { attacker: 'PERCENT_HP_DMG', victim: 'HIGH_DEFENSE', bonus: 5.0 },

  // Engagement / Backline
  { attacker: 'DIVE', victim: 'ARTILLERY', bonus: 5.5 },
  { attacker: 'BACKLINE_ACCESS', victim: 'ARTILLERY', bonus: 6.0 },
  { attacker: 'BACKLINE_ACCESS', victim: 'POKE', bonus: 4.0 },
  { attacker: 'DIVE', victim: 'POKE', bonus: 3.5 },

  // Game Phase
  { attacker: 'EARLY_GAME', victim: 'LATE_GAME', bonus: 2.0 },
];

/** 
 * ITEM COUNTER MATRIX
 */
const ITEM_COUNTER_MAP: Array<{ victim: HeroTag; items: string[]; damageType?: 'Physical' | 'Magic' }> = [
  { victim: 'HEAL', items: ['Sea Halberd', 'Dominance Ice'], damageType: 'Physical' },
  { victim: 'REGEN', items: ['Sea Halberd', 'Dominance Ice'], damageType: 'Physical' },
  { victim: 'HEAL', items: ['Necklace of Durance', 'Glowing Wand'], damageType: 'Magic' },
  { victim: 'REGEN', items: ['Necklace of Durance', 'Glowing Wand'], damageType: 'Magic' },
  { victim: 'SHIELD', items: ['Sea Halberd'], damageType: 'Physical' },
  { victim: 'SHIELD', items: ['Necklace of Durance'], damageType: 'Magic' },
  { victim: 'HIGH_DEFENSE', items: ['Malefic Roar', 'Demon Hunter Sword'], damageType: 'Physical' },
  { victim: 'HIGH_DEFENSE', items: ['Divine Glaive', 'Genius Wand'], damageType: 'Magic' },
  { victim: 'PERCENT_HP_DMG', items: ['Athena\'s Shield', 'Radiant Armor'] },
  { victim: 'BURST', items: ['Antique Cuirass', 'Athena\'s Shield', 'Immortality'] },
  { victim: 'BLINK', items: ['Winter Crown', 'Wind of Nature'] },
  { victim: 'DASH', items: ['Winter Crown', 'Wind of Nature'] },
];

function getDynamicBuild(data: DataLoader, hero: Hero, enemyHeroes: Hero[]): BuildEntry | null {
  const baseBuild = data.getBuild(hero.id);
  if (!baseBuild) return null;
  const dynamicBuild: BuildEntry = { core: [...baseBuild.core], situational: { ...baseBuild.situational } };
  const enemyTags = new Set<HeroTag>();
  enemyHeroes.forEach(e => e.tags.forEach(t => enemyTags.add(t)));
  const counterItems = new Set<string>();
  for (const map of ITEM_COUNTER_MAP) {
    if (enemyTags.has(map.victim)) {
      if (!map.damageType || map.damageType === hero.primaryDamageType) {
        map.items.forEach(item => counterItems.add(item));
      }
    }
  }
  if (counterItems.size > 0) dynamicBuild.situational['vs_draft'] = Array.from(counterItems).slice(0, 3);
  return dynamicBuild;
}

export function calculateHeroScore(
  data: DataLoader,
  hero: Hero,
  enemyIds: number[],
  allyIds: number[] = [],
  turnIndex: number = 5 // Default to late draft
): { rawScore: number; weightedScore: number; minScore: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; breakdown: MatchupBreakdown[]; dynamicBuild: BuildEntry | null } {
  const breakdown: MatchupBreakdown[] = [];
  let rawScore = 0;
  let minScore = 0;
  let dataPoints = 0;

  const enemyHeroes = enemyIds.map(id => data.getHero(id)).filter((h): h is Hero => !!h);

  for (const enemy of enemyHeroes) {
    let baseMatchupScore = data.getMatchupScore(hero.id, enemy.id);
    if (baseMatchupScore !== 0) dataPoints++;
    
    let enemyStrategicBonus = 0;
    for (const interaction of TAG_INTERACTIONS) {
      if (hero.tags.includes(interaction.attacker) && enemy.tags.includes(interaction.victim)) {
        enemyStrategicBonus += interaction.bonus;
      }
    }
    
    const combinedScore = baseMatchupScore + (enemyStrategicBonus * 0.7);
    rawScore += combinedScore;
    if (combinedScore < minScore) minScore = combinedScore;

    breakdown.push({
      enemy_id: enemy.id,
      enemy_name: enemy.name,
      score: Math.round(combinedScore * 10) / 10,
    });
  }

  // Turn-Aware Blind Pick Logic
  // Early draft (turns 0-3) penalizes counterable heroes heavily.
  // Late draft (turns 4+) prioritizes hard counters.
  const isEarlyDraft = turnIndex < 4;
  
  const tierWeight = TIER_WEIGHT[hero.tier] ?? 1.0;
  let weightedScore = (rawScore * tierWeight);

  // Synergy with allies
  for (const allyId of allyIds) {
    const synScore = data.getSynergyScore(hero.id, allyId);
    if (synScore > 0) {
      weightedScore += (synScore * 0.6);
    }
  }

  // Hard Counter Penalty (Esmeralda-Aldous Rule)
  if (minScore <= -3) {
    weightedScore -= (minScore * minScore);
  }

  // Blind-Pick Vulnerability (only relevant if we haven't seen the whole enemy team)
  if (enemyIds.length < 5) {
    let counterCount = 0;
    const allHeroes = data.getAllHeroes();
    for (const h of allHeroes) {
      if (h.id === hero.id) continue;
      if (data.getMatchupScore(h.id, hero.id) >= 3.0) counterCount++;
    }
    
    // Scale penalty by how much "blind" space is left
    const blindFactor = (5 - enemyIds.length) / 5;
    const earlyPenaltyMultiplier = isEarlyDraft ? 2.5 : 1.0;
    const safetyPenalty = counterCount * 1.2 * blindFactor * earlyPenaltyMultiplier;
    weightedScore -= safetyPenalty;
    
    if (enemyIds.length === 0) {
       const safeWr = (typeof hero.base_wr === 'number' && !isNaN(hero.base_wr)) ? hero.base_wr : 50;
       weightedScore += (safeWr - 50);
    }
  }

  // Confidence Calculation
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  if (enemyIds.length === 0) {
      confidence = 'MEDIUM'; // Base WR is decent
  } else {
      const density = dataPoints / enemyIds.length;
      if (density > 0.8) confidence = 'HIGH';
      else if (density > 0.4) confidence = 'MEDIUM';
  }

  return {
    rawScore,
    weightedScore: Math.round(weightedScore * 100) / 100,
    minScore,
    confidence,
    breakdown,
    dynamicBuild: getDynamicBuild(data, hero, enemyHeroes)
  };
}

export class DraftEngine {
  private data: DataLoader;
  private worker: Worker | null = null;
  private pendingRequests: Map<string, { resolve: (data: any) => void; reject: (err: any) => void }> = new Map();
  private workerReady = false;
  private requestCounter = 0;

  constructor(dataLoader: DataLoader) {
    if (!dataLoader.loaded) throw new Error('DraftEngine: DataLoader must be loaded before creating engine');
    this.data = dataLoader;
    this.initWorker();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => {
        const { type, id, data, error } = e.data;
        const pending = this.pendingRequests.get(id);
        if (!pending) return;
        this.pendingRequests.delete(id);
        if (type === 'ready') { this.workerReady = true; pending.resolve(true); }
        else if (type === 'error') { pending.reject(new Error(error)); }
        else if (type === 'result') { pending.resolve(data); }
      };
      this.worker.onerror = (err) => {
        console.warn('[DraftEngine] Worker failed, falling back to main thread:', err.message);
        this.worker = null;
        this.workerReady = false;
      };
      const heroes = this.data.getAllHeroes();
      const matchups: Record<string, Record<string, number>> = {};
      for (const hero of heroes) {
        const heroKey = String(hero.id);
        matchups[heroKey] = {};
        for (const other of heroes) {
          if (hero.id === other.id) continue;
          const score = this.data.getMatchupScore(hero.id, other.id);
          if (score !== 0) matchups[heroKey][String(other.id)] = score;
        }
      }
      const initId = this.nextId();
      this.pendingRequests.set(initId, { resolve: () => { this.workerReady = true; }, reject: () => { this.workerReady = false; } });
      this.worker.postMessage({ type: 'init', id: initId, payload: { heroes, matchups, synergies: (this.data as any).synergies } });
    } catch (e) {
      console.warn('[DraftEngine] Web Workers unavailable:', e);
      this.worker = null;
    }
  }

  private nextId(): string { return `req_${++this.requestCounter}_${Date.now()}`; }

  async getCounterPicksAsync(enemyIds: number[], allyIds: number[] = [], filter?: CounterFilter): Promise<ScoredHero[]> {
    if (this.worker && this.workerReady) {
      const id = this.nextId();
      const limit = filter?.limit ?? 10;
      const turnIndex = allyIds.length + enemyIds.length;
      return new Promise((resolve, reject) => {
        this.pendingRequests.set(id, {
          resolve: (data) => {
            const enriched: ScoredHero[] = data.map((r: any) => {
                const enemyHeroes = enemyIds.map(id => this.data.getHero(id)).filter((h): h is Hero => !!h);
                return { ...r, build: getDynamicBuild(this.data, r.hero, enemyHeroes) };
            });
            resolve(enriched);
          },
          reject
        });
        this.worker!.postMessage({ type: 'counterPicks', id, payload: { enemyIds, allyIds, filter, limit, turnIndex } });
      });
    }
    return this.getCounterPicks(enemyIds, allyIds, filter);
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
      this.pendingRequests.clear();
    }
  }

  getCounterPicks(enemyIds: number[], allyIds: number[] = [], filter?: CounterFilter): ScoredHero[] {
    if (enemyIds.length > 5) return [];
    const limit = filter?.limit ?? 10;
    const enemySet = new Set(enemyIds);
    const candidates = this.data.getAllHeroes();
    const results: ScoredHero[] = [];
    const turnIndex = allyIds.length + enemyIds.length;
    for (const hero of candidates) {
      if (enemySet.has(hero.id)) continue;
      if (!this.passesFilter(hero, filter)) continue;
      const { rawScore, weightedScore, confidence, breakdown, dynamicBuild } = calculateHeroScore(this.data, hero, enemyIds, allyIds, turnIndex);
      results.push({ hero, raw_score: rawScore, weighted_score: weightedScore, confidence, breakdown, build: dynamicBuild });
    }
    results.sort((a, b) => b.weighted_score - a.weighted_score);
    return results.slice(0, limit);
  }

  getWeakPicks(enemyIds: number[], allyIds: number[] = [], limit: number = 5): ScoredHero[] {
    if (enemyIds.length === 0 || enemyIds.length > 5) return [];
    const enemySet = new Set(enemyIds);
    const candidates = this.data.getAllHeroes();
    const results: ScoredHero[] = [];
    const turnIndex = allyIds.length + enemyIds.length;
    for (const hero of candidates) {
      if (enemySet.has(hero.id)) continue;
      const { rawScore, weightedScore, confidence, breakdown, dynamicBuild } = calculateHeroScore(this.data, hero, enemyIds, allyIds, turnIndex);
      results.push({ hero, raw_score: rawScore, weighted_score: weightedScore, confidence, breakdown, build: dynamicBuild });
    }
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
