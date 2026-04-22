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

import type { Hero, HeroTag, MatchupBreakdown } from './types';
import { DataLoader } from './data-loader';
import { calculateHeroScore } from './draft-engine';

export const POSITIONS = ['exp', 'gold', 'mid', 'roam', 'jungle'] as const;
export type Position = typeof POSITIONS[number];

const POSITION_LABELS: Record<Position, string> = {
  exp: 'EXP Lane',
  gold: 'Gold Lane',
  mid: 'Mid Lane',
  roam: 'Roamer',
  jungle: 'Jungler',
};

const MAX_SAFE_GOLD_RELIANCE = 35;
const GOLD_STARVATION_PENALTY = 35.0;

interface CompositionValidationResult {
  valid: boolean;
  scorePenalty: number;
}

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

/** 
 * TEAM SYNERGY MATRIX
 * Defines how hero mechanics should ideally pair up in a team.
 */
const DNA_SYNERGY: Array<{ a: HeroTag; b: HeroTag; bonus: number }> = [
  { a: 'DIVE', b: 'AOE', bonus: 3.5 },          // Engage + Follow up
  { a: 'STUN', b: 'BURST', bonus: 4.0 },        // Setup + Execute
  { a: 'ARTILLERY', b: 'HIGH_DEFENSE', bonus: 3.0 }, // Frontline protection for Artillery
  { a: 'SUPPRESS', b: 'SINGLE_TARGET', bonus: 4.5 }, // Isolated pickoff
  { a: 'HEAL', b: 'SUSTAIN', bonus: 3.5 },      // Infinite brawling potential
];

export class TeamBuilder {
  private data: DataLoader;

  constructor(dataLoader: DataLoader) {
    this.data = dataLoader;
  }

  /**
   * Macro composition validation:
   * 1) Penalize teams that over-index into farm-dependent late-game carries.
   * 2) Invalidate drafts with hard buff contention (multiple strict Purple heroes).
   * 3) Zero-Initiative Trap: Penalize all-backline comps with no engage/CC frontline.
   * 4) Wave-Clear Deficiency: Penalize all-melee burst comps that can't defend base.
   */
  private compositionValidator(slots: TeamSlot[]): CompositionValidationResult {
    if (slots.length !== 5) {
      return { valid: true, scorePenalty: 0 };
    }

    let scorePenalty = 0;

    // 1. Gold Reliance & Buff Contention
    const totalGoldReliance = slots.reduce((sum, slot) => {
      const parsed = Number(slot.hero.goldReliance);
      return sum + (Number.isFinite(parsed) ? parsed : 5);
    }, 0);
    const strictPurpleCount = slots.reduce((sum, slot) => sum + (slot.hero.buffDependency === 'Purple' ? 1 : 0), 0);

    if (strictPurpleCount > 1) return { valid: false, scorePenalty: 0 };
    if (totalGoldReliance > MAX_SAFE_GOLD_RELIANCE) scorePenalty -= GOLD_STARVATION_PENALTY;

    // 2. Zero-Initiative Trap (Frontline check)
    const hasTank = slots.some(s => s.hero.roles.includes('tank') || s.hero.tags.includes('HIGH_DEFENSE'));
    const hasInitiator = slots.some(s => s.hero.tags.includes('DIVE') || s.hero.tags.includes('STUN'));
    if (!hasTank && !hasInitiator) scorePenalty -= 25.0;

    // 3. Siege Potential (High Ground / Turrets)
    const hasMarksman = slots.some(s => s.hero.roles.includes('marksman'));
    const hasArtillery = slots.some(s => s.hero.tags.includes('ARTILLERY'));
    if (!hasMarksman && !hasArtillery) {
      scorePenalty -= 20.0; // "The Siege Trap": Cannot end the game
    }

    // 4. Wave-Clear Check (Base Defense)
    const hasAoE = slots.some(s => s.hero.tags.includes('AOE'));
    const mageCount = slots.filter(s => s.hero.roles.includes('mage')).length;
    if (!hasAoE && mageCount === 0) {
      scorePenalty -= 15.0; // Vulnerable to Lord pushes
    }

    // 5. Objective Secure (Lord/Turtle)
    const jungler = slots.find(s => s.position === 'jungle');
    if (jungler) {
      const hasObjectiveDNA = jungler.hero.tags.includes('BURST') || jungler.hero.tags.includes('SINGLE_TARGET') || jungler.hero.tags.includes('TRUE_DAMAGE');
      if (!hasObjectiveDNA) scorePenalty -= 10.0; // Risky Retribution fights
    }

    return { valid: true, scorePenalty };
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

    const scored = allHeroes.map(hero => {
      const { weightedScore, breakdown } = calculateHeroScore(this.data, hero, enemyIds);
      return {
        hero,
        score: weightedScore,
        breakdown,
      };
    });

    const lanePool: Record<Position, typeof scored> = {
      exp: [], gold: [], mid: [], roam: [], jungle: [],
    };

    for (const s of scored) {
      for (const pos of POSITIONS) {
        if (s.hero.lanes.includes(pos)) {
          lanePool[pos].push(s);
        } else {
          // The Flex-Pick Fix: Allow off-role but apply a strict mathematical penalty
          // This allows top-tier counters to flex if necessary, without breaking the lane structure.
          lanePool[pos].push({
            ...s,
            score: s.score - 7.5 
          });
        }
      }
    }

    for (const pos of POSITIONS) {
      lanePool[pos].sort((a, b) => {
        const aNative = a.hero.lanes.includes(pos) ? 1 : 0;
        const bNative = b.hero.lanes.includes(pos) ? 1 : 0;
        if (aNative !== bNative) {
          return bNative - aNative;
        }
        return b.score - a.score;
      });
    }

    // Sort by most constrained lane first, ignoring flex-pick padding
    const posOrder = [...POSITIONS].sort((a, b) => {
      const aNativeCount = lanePool[a].filter(s => s.hero.lanes.includes(a)).length;
      const bNativeCount = lanePool[b].filter(s => s.hero.lanes.includes(b)).length;
      return aNativeCount - bNativeCount;
    });

    // Bounded Beam Search: Max Width 3, Depth 5 (O(3^5) = 243 operations)
    const recursiveBuild = (depth: number, currentSlots: TeamSlot[], currentUsed: Set<number>): TeamSlot[] | null => {
      if (depth === 5) return currentSlots;

      const pos = posOrder[depth];
      const candidates = lanePool[pos].filter(s => !currentUsed.has(s.hero.id)).slice(0, 3);
      if (candidates.length === 0) return null; // Dead end (forces backtracking, no illegal 4-man teams)

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
          let branchScore = result.reduce((sum, s) => sum + s.score, 0);

          // ============================================================
          // TEAM DNA SYNERGY: Bonus for mechanically cohesive teams
          // ============================================================
          if (depth === 0 && result.length === 5) {
            let synergyTotal = 0;
            for (let i = 0; i < result.length; i++) {
              for (let j = i + 1; j < result.length; j++) {
                const hA = result[i].hero;
                const hB = result[j].hero;
                for (const syn of DNA_SYNERGY) {
                   const match = (hA.tags.includes(syn.a) && hB.tags.includes(syn.b)) ||
                                (hA.tags.includes(syn.b) && hB.tags.includes(syn.a));
                   if (match) synergyTotal += syn.bonus;
                }
              }
            }
            branchScore += synergyTotal;
          }
          
          // The Damage-Type Monopoly Fix: Penalize compositions skewed heavily to one damage type
          // Dynamically map damage types using roles (Mage = Magic) and known non-Mage magic users.
          if (depth === 0 && result.length === 5) {
            let magicCount = 0;
            let physCount = 0;
            for (const slot of result) {
               if (slot.hero.primaryDamageType === 'Magic') {
                 magicCount++;
               } else {
                 physCount++;
               }
            }
            if (magicCount > 3 || physCount > 3) {
               branchScore -= 25.0; // Heavy penalty for bad damage spread
            }
          }

          if (depth === 0 && result.length === 5) {
            const validation = this.compositionValidator(result);
            if (!validation.valid) {
              continue;
            }
            branchScore += validation.scorePenalty;
          }

          if (branchScore > bestScore) {
            bestScore = branchScore;
            bestBranch = result;
          }
        }
      }
      return bestBranch;
    };

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
    if (enemyIds.length > 5) { // Removed empty check to allow first pick blind draft
      return { mode: 'max_counter', label: 'Best Counters', slots: [], totalScore: 0, coverage: 0 };
    }

    const excludeSet = new Set([...excludeIds, ...enemyIds]);
    const allHeroes = this.data.getAllHeroes().filter(h => !excludeSet.has(h.id));

    const allScored = allHeroes
      .map(hero => {
        const { weightedScore, breakdown } = calculateHeroScore(this.data, hero, enemyIds);
        return {
          hero,
          score: weightedScore,
          breakdown,
        };
      })
      .sort((a, b) => b.score - a.score);

    const scored = allScored.slice(0, 10);

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
      }
      // If no valid lane is left, skip this hero instead of forcing them into an illegal role.
    }

    // If we couldn't find 5 valid lane matches from the top counters, pad with best available flex picks
    if (slots.length < 5) {
       for (const s of allScored) {
          if (slots.length >= 5) break;
          const anyPos = POSITIONS.find(p => !usedPositions.has(p));
          if (anyPos && !slots.some(slot => slot.hero.id === s.hero.id)) {
            usedPositions.add(anyPos);
            slots.push({
              position: anyPos,
              positionLabel: POSITION_LABELS[anyPos] + ' ⚡',
              hero: s.hero,
              score: s.score - 7.5,
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

}
