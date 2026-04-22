/**
 * DataLoader: Responsible for loading, validating, and caching game data.
 * 
 * Design decisions:
 * - Loads JSON once, holds in memory (data is tiny: ~115KB total)
 * - Builds lookup maps on load for O(1) access
 * - Validates schema version on load — rejects incompatible data
 * - No network calls here. Data source is always local files/bundled assets.
 */

import type { Hero, HeroDatabase, MatchupMatrix, BuildDatabase, BuildEntry, SynergyDatabase } from './types';

const DEFAULT_GOLD_RELIANCE = 5;

function normalizeGoldReliance(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_GOLD_RELIANCE;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function normalizeBuffDependency(value: unknown): Hero['buffDependency'] {
  return value === 'Purple' || value === 'Red' || value === 'None' ? value : 'None';
}

function normalizeDamageType(value: unknown): Hero['primaryDamageType'] {
  return value === 'Magic' ? 'Magic' : 'Physical';
}

export class DataLoader {
  private heroes: Map<number, Hero> = new Map();
  private heroByName: Map<string, Hero> = new Map();
  private matchups: Record<string, Record<string, number>> = {};
  private builds: Record<string, BuildEntry> = {};
  private synergies: Record<string, { partnerId: number; strength: number }[]> = {};
  private _loaded = false;
  private _gameVersion = '';
  private onLoadCallbacks: Array<() => void> = [];
  private supportedSchemas: string[];

  /**
   * @param supportedSchemas - Address Point 1: Decouple schemas from source code.
   */
  constructor(supportedSchemas: string[] = ['1.0.0', '2.0.0']) {
    this.supportedSchemas = supportedSchemas;
  }

  onLoad(callback: () => void) {
    if (this._loaded) {
      callback();
    } else {
      this.onLoadCallbacks.push(callback);
    }
  }

  get loaded(): boolean { return this._loaded; }
  get gameVersion(): string { return this._gameVersion; }
  get heroCount(): number { return this.heroes.size; }

  /**
   * Load all data files. Call once on app startup.
   * Throws on schema mismatch or malformed data.
   */
  load(
    heroData: HeroDatabase,
    matchupData: MatchupMatrix,
    buildData: BuildDatabase,
    synergyData?: SynergyDatabase
  ): void {
    // ============================================================
    // Phase 1: Schema version validation
    // ============================================================
    this.validateSchema('heroes', heroData.schema_version);
    this.validateSchema('matchups', matchupData.schema_version);
    this.validateSchema('builds', buildData.schema_version);
    if (synergyData) this.validateSchema('synergies', synergyData.schema_version);

    // ============================================================
    // Phase 2: Runtime structural validation (Zero-Trust)
    // ============================================================
    this.validateHeroStructure(heroData);
    this.validateMatchupStructure(matchupData);
    this.validateBuildStructure(buildData);

    // ============================================================
    // Phase 3: Commit to cache (only reached if validation passes)
    // ============================================================
    this.heroes.clear();
    this.heroByName.clear();
    for (const rawHero of heroData.heroes) {
      const hero: Hero = {
        ...rawHero,
        goldReliance: normalizeGoldReliance((rawHero as Partial<Hero>).goldReliance),
        buffDependency: normalizeBuffDependency((rawHero as Partial<Hero>).buffDependency),
        primaryDamageType: normalizeDamageType((rawHero as Partial<Hero>).primaryDamageType),
      };

      this.heroes.set(hero.id, hero);
      this.heroByName.set(hero.name.toLowerCase(), hero);
    }

    // Store matchups and builds directly — already keyed by ID
    this.matchups = matchupData.matchups;
    this.builds = buildData.builds;
    this.synergies = synergyData?.combos || {};

    this._gameVersion = heroData.game_version;
    this._loaded = true;
    this.onLoadCallbacks.forEach(cb => cb());
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

  /** Get synergies for a hero. */
  getSynergies(heroId: number): { partnerId: number; strength: number }[] {
    return this.synergies[String(heroId)] || [];
  }

  /**
   * Calculate synergy score between two heroes.
   */
  getSynergyScore(heroId: number, partnerId: number): number {
    const heroSyns = this.getSynergies(heroId);
    const match = heroSyns.find(s => s.partnerId === partnerId);
    if (match) return match.strength;

    // Check reverse direction
    const partnerSyns = this.getSynergies(partnerId);
    const reverseMatch = partnerSyns.find(s => s.partnerId === heroId);
    return reverseMatch ? reverseMatch.strength : 0;
  }

  private validateSchema(dataName: string, version: string): void {
    if (!version || !this.supportedSchemas.includes(version)) {
      throw new Error(`Fatal: Schema mismatch for ${dataName}. Expected one of ${this.supportedSchemas.join(', ')}, got ${version}`);
    }
  }

  private validateHeroStructure(data: HeroDatabase): void {
    if (!data || typeof data !== 'object') {
      throw new Error('DataLoader: heroData is null or not an object');
    }
    if (!Array.isArray(data.heroes)) {
      throw new Error('DataLoader: heroData.heroes is not an array');
    }
    if (data.heroes.length === 0) {
      throw new Error('DataLoader: heroData.heroes is empty — refusing to load a blank hero database');
    }
    if (!data.game_version || typeof data.game_version !== 'string') {
      throw new Error('DataLoader: heroData.game_version is missing or invalid');
    }

    const sample = data.heroes[0];
    if (typeof sample.id !== 'number' || typeof sample.name !== 'string') {
      throw new Error(`DataLoader: Hero at index 0 is malformed (id=${sample.id}, name=${sample.name})`);
    }
    if (!Array.isArray(sample.roles) || !Array.isArray(sample.lanes)) {
      throw new Error(`DataLoader: Hero "${sample.name}" has invalid roles/lanes arrays`);
    }
    if (typeof sample.tier !== 'string' || !['S', 'A', 'B', 'C', 'D'].includes(sample.tier)) {
      throw new Error(`DataLoader: Hero "${sample.name}" has invalid tier "${sample.tier}"`);
    }
  }

  private validateMatchupStructure(data: MatchupMatrix): void {
    if (!data || typeof data !== 'object') {
      throw new Error('DataLoader: matchupData is null or not an object');
    }
    if (!data.matchups || typeof data.matchups !== 'object') {
      throw new Error('DataLoader: matchupData.matchups is missing or not an object');
    }
    const keys = Object.keys(data.matchups);
    if (keys.length === 0) {
      throw new Error('DataLoader: matchupData.matchups is empty — no hero matchup data found');
    }
    const firstEntry = data.matchups[keys[0]];
    if (typeof firstEntry !== 'object' || firstEntry === null) {
      throw new Error(`DataLoader: matchup entry for hero ${keys[0]} is not a valid object`);
    }
  }

  private validateBuildStructure(data: BuildDatabase): void {
    if (!data || typeof data !== 'object') {
      throw new Error('DataLoader: buildData is null or not an object');
    }
    if (!data.builds || typeof data.builds !== 'object') {
      throw new Error('DataLoader: buildData.builds is missing or not an object');
    }
    const keys = Object.keys(data.builds);
    if (keys.length > 0) {
      const sample = data.builds[keys[0]];
      if (!Array.isArray(sample.core)) {
        throw new Error(`DataLoader: Build entry for hero ${keys[0]} has no 'core' array`);
      }
    }
  }
}
