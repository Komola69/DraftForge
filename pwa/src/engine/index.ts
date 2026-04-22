/**
 * Engine module — public API surface.
 * Import everything from here, never from individual files.
 */
export type {
  Hero,
  HeroDatabase,
  MatchupMatrix,
  BuildDatabase,
  SynergyDatabase,
  BuildEntry,
  ScoredHero,
  MatchupBreakdown,
  CounterFilter,
} from './types';

export { DataLoader } from './data-loader';
export { DraftEngine } from './draft-engine';
export { TeamBuilder, POSITIONS } from './team-builder';
export type { TeamSlot, TeamSuggestion, Position } from './team-builder';
export { BanAdvisor } from './ban-advisor';
export type { BanSuggestion } from './ban-advisor';
export { VisionEngine } from './vision-engine';
