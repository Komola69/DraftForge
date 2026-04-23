/**
 * DraftForge Engine Worker
 *
 * Offloads heavy combinatorics (counter-pick scoring, team building)
 * off the main UI thread to prevent WebKit stuttering during
 * gameplay or overlay animations.
 */

import { calculateHeroScore } from './draft-engine';
import type { Hero, MatchupMatrix } from './types';

// ============================================================
// Worker-side DataLoader Shim
// ============================================================
class WorkerDataLoader {
  heroes: Hero[] = [];
  matchups: MatchupMatrix['matchups'] = {};
  synergies: Record<string, { partnerId: number; strength: number }[]> = {};
  loaded = true;

  getAllHeroes(): Hero[] { return this.heroes; }
  getHero(id: number): Hero | undefined { return this.heroes.find(h => h.id === id); }
  getBuild(_id: number): null { return null; }
  
  getMatchupScore(heroId: number, enemyId: number): number {
    return this.matchups[String(heroId)]?.[String(enemyId)] ?? 0;
  }

  getSynergies(heroId: number): { partnerId: number; strength: number }[] {
    return this.synergies[String(heroId)] || [];
  }

  getSynergyScore(heroId: number, partnerId: number): number {
    const heroSyns = this.getSynergies(heroId);
    const match = heroSyns.find(s => s.partnerId === partnerId);
    if (match) return match.strength;

    const partnerSyns = this.getSynergies(partnerId);
    const reverseMatch = partnerSyns.find(s => s.partnerId === heroId);
    return reverseMatch ? reverseMatch.strength : 0;
  }
}

const data = new WorkerDataLoader();
const TIER_RANK: Record<string, number> = { 'S': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4 };

self.onmessage = (e: MessageEvent) => {
  const { type, id, payload } = e.data;

  if (type === 'init') {
    data.heroes = payload.heroes;
    data.matchups = payload.matchups;
    data.synergies = payload.synergies || {};
    self.postMessage({ type: 'ready', id });
    return;
  }

  if (type === 'counterPicks') {
    const { enemyIds, allyIds, filter, limit, turnIndex } = payload;
    const enemySet = new Set(enemyIds);
    const results = [];

    for (const hero of data.heroes) {
      if (enemySet.has(hero.id)) continue;

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

      const scoreResult = calculateHeroScore(data as any, hero, enemyIds, allyIds, turnIndex);

      results.push({
        hero,
        raw_score: scoreResult.rawScore,
        weighted_score: scoreResult.weightedScore,
        confidence: scoreResult.confidence,
        breakdown: scoreResult.breakdown,
      });
    }

    results.sort((a, b) => b.weighted_score - a.weighted_score);
    self.postMessage({ type: 'result', id, data: results.slice(0, limit) });
  }

  if (type === 'weakPicks') {
    const { enemyIds, allyIds, limit, turnIndex } = payload;
    const enemySet = new Set(enemyIds);
    const results = [];

    for (const hero of data.heroes) {
      if (enemySet.has(hero.id)) continue;

      const scoreResult = calculateHeroScore(data as any, hero, enemyIds, allyIds, turnIndex);

      results.push({
        hero,
        raw_score: scoreResult.rawScore,
        weighted_score: scoreResult.weightedScore,
        confidence: scoreResult.confidence,
        breakdown: scoreResult.breakdown,
      });
    }

    results.sort((a, b) => a.weighted_score - b.weighted_score);
    self.postMessage({ type: 'result', id, data: results.slice(0, limit) });
  }
};
