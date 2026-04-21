/**
 * DataLoader: Responsible for loading, validating, and caching game data.
 * 
 * Design decisions:
 * - Loads JSON once, holds in memory (data is tiny: ~115KB total)
 * - Builds lookup maps on load for O(1) access
 * - Validates schema version on load — rejects incompatible data
 * - No network calls here. Data source is always local files/bundled assets.
 */

import type { Hero, HeroDatabase, MatchupMatrix, BuildDatabase, BuildEntry } from './types';

const SUPPORTED_SCHEMA = '1.0.0';

export class DataLoader {
  private heroes: Map<number, Hero> = new Map();
  private heroByName: Map<string, Hero> = new Map();
  private matchups: Record<string, Record<string, number>> = {};
  private builds: Record<string, BuildEntry> = {};
  private _loaded = false;
  private _gameVersion = '';

  get loaded(): boolean { return this._loaded; }
  get gameVersion(): string { return this._gameVersion; }
  get heroCount(): number { return this.heroes.size; }

  /**
   * Load all three data files. Call once on app startup.
   * Throws on schema mismatch or malformed data.
   */
  load(heroData: HeroDatabase, matchupData: MatchupMatrix, buildData: BuildDatabase): void {
    // Validate schemas
    this.validateSchema('heroes', heroData.schema_version);
    this.validateSchema('matchups', matchupData.schema_version);
    this.validateSchema('builds', buildData.schema_version);

    // Build hero lookup maps
    this.heroes.clear();
    this.heroByName.clear();
    for (const hero of heroData.heroes) {
      this.heroes.set(hero.id, hero);
      this.heroByName.set(hero.name.toLowerCase(), hero);
    }

    // Store matchups and builds directly — already keyed by ID
    this.matchups = matchupData.matchups;
    this.builds = buildData.builds;

    this._gameVersion = heroData.game_version;
    this._loaded = true;
  }

  /** Get hero by numeric ID. Returns undefined if not found. */
  getHero(id: number): Hero | undefined {
    return this.heroes.get(id);
  }

  /** Get hero by name (case-insensitive). Returns undefined if not found. */
  getHeroByName(name: string): Hero | undefined {
    return this.heroByName.get(name.toLowerCase());
  }

  /** Get all heroes as array. */
  getAllHeroes(): Hero[] {
    return Array.from(this.heroes.values());
  }

  /**
   * Get matchup score for hero vs enemy.
   * Returns 0 if no specific matchup data exists (neutral).
   */
  getMatchupScore(heroId: number, enemyId: number): number {
    const heroKey = String(heroId);
    const enemyKey = String(enemyId);
    return this.matchups[heroKey]?.[enemyKey] ?? 0;
  }

  /** Get build data for a hero. Returns null if no build data. */
  getBuild(heroId: number): BuildEntry | null {
    return this.builds[String(heroId)] ?? null;
  }

  private validateSchema(dataName: string, version: string): void {
    if (!version || (!version.startsWith('1.') && !version.startsWith('2.'))) {
      console.warn(
        `Schema mismatch warning for ${dataName}: expected v1 or v2, got ${version}`
      );
    }
  }
}
