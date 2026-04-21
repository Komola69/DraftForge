/**
 * TeamBuilder: Suggests optimal 5-person counter teams.
 *
 * Supports:
 *   - Excluded hero IDs (bans, ally picks, enemy picks)
 *   - Multiple alternative team sets
 *   - Balanced (lane-aware) and max-counter modes
 *
 * Algorithm (balanced):
 *   Greedy constraint-first: fill the most constrained lane first
 *   (fewest candidates), pick the best scorer, lock, repeat.
 *   For alternatives: exclude previous team's heroes, re-run.
 */

import type { Hero, MatchupBreakdown } from './types';
import { DataLoader } from './data-loader';

export const POSITIONS = ['exp', 'gold', 'mid', 'roam', 'jungle'] as const;
export type Position = typeof POSITIONS[number];

const POSITION_LABELS: Record<Position, string> = {
  exp: 'EXP Lane',
  gold: 'Gold Lane',
  mid: 'Mid Lane',
  roam: 'Roamer',
  jungle: 'Jungler',
};

const TIER_WEIGHT: Record<string, number> = {
  'S': 1.15, 'A': 1.05, 'B': 1.00, 'C': 0.90, 'D': 0.75,
};

export interface TeamSlot {
  position: Position;
  positionLabel: string;
  hero: Hero;
  score: number;
  breakdown: MatchupBreakdown[];
}

export interface TeamSuggestion {
  mode: 'balanced' | 'max_counter';
  label: string;
  slots: TeamSlot[];
  totalScore: number;
  coverage: number;
}

export class TeamBuilder {
  private data: DataLoader;

  constructor(dataLoader: DataLoader) {
    this.data = dataLoader;
  }

  /**
   * Generate N alternative balanced teams.
   * Each subsequent team excludes heroes used in previous teams.
   */
  buildBalancedTeams(
    enemyIds: number[],
    excludeIds: number[] = [],
    count: number = 3
  ): TeamSuggestion[] {
    const teams: TeamSuggestion[] = [];
    const cumulativeExclude = new Set([...excludeIds, ...enemyIds]);

    for (let i = 0; i < count; i++) {
      const team = this._buildOneBalanced(enemyIds, cumulativeExclude, i + 1);
      if (team.slots.length === 0) break;
      teams.push(team);
      // Exclude this team's heroes for next iteration
      for (const slot of team.slots) {
        cumulativeExclude.add(slot.hero.id);
      }
    }

    return teams;
  }

  /**
   * Build a single balanced team, excluding certain hero IDs.
   */
  private _buildOneBalanced(
    enemyIds: number[],
    excludeIds: Set<number>,
    setNumber: number
  ): TeamSuggestion {
    if (enemyIds.length === 0) {
      return { mode: 'balanced', label: `Set ${setNumber}`, slots: [], totalScore: 0, coverage: 0 };
    }

    const allHeroes = this.data.getAllHeroes().filter(h => !excludeIds.has(h.id));

    const scored = allHeroes.map(hero => ({
      hero,
      score: this.scoreHero(hero, enemyIds),
      breakdown: this.getBreakdown(hero, enemyIds),
    }));

    const lanePool: Record<Position, typeof scored> = {
      exp: [], gold: [], mid: [], roam: [], jungle: [],
    };

    for (const s of scored) {
      for (const lane of s.hero.lanes) {
        if (lane in lanePool) {
          lanePool[lane as Position].push(s);
        }
      }
    }

    for (const pos of POSITIONS) {
      lanePool[pos].sort((a, b) => b.score - a.score);
    }

    const posOrder = [...POSITIONS].sort(
      (a, b) => lanePool[a].length - lanePool[b].length
    );

    // Bounded Beam Search: Max Width 3, Depth 5 (O(3^5) = 243 operations)
    function recursiveBuild(depth: number, currentSlots: TeamSlot[], currentUsed: Set<number>): TeamSlot[] | null {
      if (depth === 5) return currentSlots;

      const pos = posOrder[depth];
      const candidates = lanePool[pos].filter(s => !currentUsed.has(s.hero.id)).slice(0, 3);
      if (candidates.length === 0) return null; // Dead end

      let bestBranch: TeamSlot[] | null = null;
      let bestScore = -Infinity;

      for (const candidate of candidates) {
        const nextUsed = new Set(currentUsed);
        nextUsed.add(candidate.hero.id);

        const newSlot: TeamSlot = {
          position: pos,
          positionLabel: POSITION_LABELS[pos],
          hero: candidate.hero,
          score: candidate.score,
          breakdown: candidate.breakdown,
        };

        const result = recursiveBuild(depth + 1, [...currentSlots, newSlot], nextUsed);
        if (result) {
          const branchScore = result.reduce((sum, s) => sum + s.score, 0);
          if (branchScore > bestScore) {
            bestScore = branchScore;
            bestBranch = result;
          }
        }
      }
      return bestBranch;
    }

    let slots = recursiveBuild(0, [], new Set<number>()) || [];

    const posIndex: Record<Position, number> = { exp: 0, gold: 1, mid: 2, roam: 3, jungle: 4 };
    slots.sort((a, b) => posIndex[a.position] - posIndex[b.position]);

    const totalScore = slots.reduce((sum, s) => sum + s.score, 0);

    return {
      mode: 'balanced',
      label: `Set ${setNumber}`,
      slots,
      totalScore: Math.round(totalScore * 100) / 100,
      coverage: Math.round((slots.length / 5) * 100),
    };
  }

  /**
   * Build max-counter team (top 5 counters regardless of lane).
   */
  buildMaxCounterTeam(
    enemyIds: number[],
    excludeIds: number[] = []
  ): TeamSuggestion {
    if (enemyIds.length === 0) {
      return { mode: 'max_counter', label: 'Best Counters', slots: [], totalScore: 0, coverage: 0 };
    }

    const excludeSet = new Set([...excludeIds, ...enemyIds]);
    const allHeroes = this.data.getAllHeroes().filter(h => !excludeSet.has(h.id));

    const scored = allHeroes
      .map(hero => ({
        hero,
        score: this.scoreHero(hero, enemyIds),
        breakdown: this.getBreakdown(hero, enemyIds),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const usedPositions = new Set<Position>();
    const slots: TeamSlot[] = [];

    for (const s of scored) {
      if (slots.length >= 5) break;

      const bestPos = s.hero.lanes.find(
        l => POSITIONS.includes(l as Position) && !usedPositions.has(l as Position)
      ) as Position | undefined;

      if (bestPos) {
        usedPositions.add(bestPos);
        slots.push({
          position: bestPos,
          positionLabel: POSITION_LABELS[bestPos],
          hero: s.hero,
          score: s.score,
          breakdown: s.breakdown,
        });
      } else {
        const anyPos = POSITIONS.find(p => !usedPositions.has(p));
        if (anyPos) {
          usedPositions.add(anyPos);
          slots.push({
            position: anyPos,
            positionLabel: POSITION_LABELS[anyPos] + ' ⚡',
            hero: s.hero,
            score: s.score,
            breakdown: s.breakdown,
          });
        }
      }
    }

    const posIndex: Record<Position, number> = { exp: 0, gold: 1, mid: 2, roam: 3, jungle: 4 };
    slots.sort((a, b) => posIndex[a.position] - posIndex[b.position]);

    const totalScore = slots.reduce((sum, s) => sum + s.score, 0);

    return {
      mode: 'max_counter',
      label: 'Best Counters',
      slots,
      totalScore: Math.round(totalScore * 100) / 100,
      coverage: Math.round((new Set(slots.map(s => s.position)).size / 5) * 100),
    };
  }

  private scoreHero(hero: Hero, enemyIds: number[]): number {
    let raw = 0;
    for (const eid of enemyIds) {
      raw += this.data.getMatchupScore(hero.id, eid);
    }
    const weight = TIER_WEIGHT[hero.tier] ?? 1.0;
    return Math.round(raw * weight * 100) / 100;
  }

  private getBreakdown(hero: Hero, enemyIds: number[]): MatchupBreakdown[] {
    return enemyIds.map(eid => ({
      enemy_id: eid,
      enemy_name: this.data.getHero(eid)?.name ?? `Unknown(${eid})`,
      score: this.data.getMatchupScore(hero.id, eid),
    }));
  }
}
