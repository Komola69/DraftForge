/**
 * Core type definitions for the DraftForge engine.
 * These types define the shape of all data flowing through the system.
 * Every other module depends on these — change carefully.
 */

export interface Hero {
  id: number;
  name: string;
  roles: string[];
  lanes: string[];
  tier: string;
  base_wr: number;
  /** 1-10 scale: higher means hero is heavily farm-dependent */
  goldReliance: number;
  /** Core buff dependency for map resource conflict checks */
  buffDependency: 'Purple' | 'Red' | 'None';
}

export interface HeroDatabase {
  schema_version: string;
  game_version: string;
  generated_at: string;
  hero_count: number;
  heroes: Hero[];
}

/**
 * Matchup matrix format:
 * Key = hero ID (as string, JSON limitation)
 * Value = object where key = enemy hero ID, value = score (-10 to +10)
 * 
 * Positive score = this hero is STRONG against that enemy
 * Negative score = this hero is WEAK against that enemy
 * Missing entry = neutral matchup (score 0)
 */
export interface MatchupMatrix {
  schema_version: string;
  game_version: string;
  generated_at: string;
  matchups: Record<string, Record<string, number>>;
}

export interface BuildEntry {
  core: string[];
  situational: Record<string, string[]>;
}

export interface BuildDatabase {
  schema_version: string;
  game_version: string;
  generated_at: string;
  builds: Record<string, BuildEntry>;
}

/**
 * Result returned by the scoring engine for each candidate hero.
 */
export interface ScoredHero {
  hero: Hero;
  /** Raw sum of matchup scores against all selected enemies */
  raw_score: number;
  /** Score after tier weighting */
  weighted_score: number;
  /** Individual breakdown: how this hero performs vs each enemy */
  breakdown: MatchupBreakdown[];
  /** Suggested items if available */
  build: BuildEntry | null;
}

export interface MatchupBreakdown {
  enemy_id: number;
  enemy_name: string;
  score: number;
}

/**
 * Filter options for narrowing counter-pick results.
 */
export interface CounterFilter {
  /** Only show heroes with these roles */
  roles?: string[];
  /** Only show heroes for these lanes */
  lanes?: string[];
  /** Minimum tier (S > A > B > C > D) */
  min_tier?: string;
  /** Maximum results to return */
  limit?: number;
}
