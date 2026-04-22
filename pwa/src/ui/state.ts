/**
 * Simple reactive state manager.
 * No framework dependency. Pub/sub pattern with typed events.
 * All UI components subscribe to state changes and re-render only what changed.
 *
 * Supports two modes:
 *   1. Quick Mode (original) — just select enemies, see counters
 *   2. Draft Mode — full draft tracker with bans, ally/enemy picks, phases
 */

/** Draft phases matching MLBB ranked draft flow */
export type DraftPhase =
  | 'ban1'     // Ban phase 1: 3 bans per team
  | 'pick1'    // Pick phase 1: alternating picks
  | 'ban2'     // Ban phase 2: 1 ban per team
  | 'pick2'    // Pick phase 2: remaining picks
  | 'done';    // Draft complete

/** What tapping a hero does in draft mode */
export type TapAction = 'enemy_pick' | 'ally_pick' | 'ban';

export interface AppState {
  // ===== Quick Mode =====
  /** IDs of selected enemy heroes (max 5) */
  enemyIds: number[];
  /** Current search query */
  searchQuery: string;
  /** Active role filter (null = all) */
  roleFilter: string | null;
  /** Currently active results tab */
  resultsTab: 'counters' | 'avoid' | 'team' | 'bans';
  /** Team mode: balanced or max_counter */
  teamMode: 'balanced' | 'max_counter';
  /** ID of expanded result card (null = none) */
  expandedResultId: number | null;

  // ===== Draft Mode =====
  /** Whether draft mode is active */
  draftActive: boolean;
  /** Current draft phase */
  draftPhase: DraftPhase;
  /** What tapping a hero does */
  tapAction: TapAction;
  /** Banned hero IDs */
  bannedIds: number[];
  /** Ally team picked hero IDs */
  allyPickIds: number[];
  /** Which team set is being viewed (0-indexed) */
  activeTeamSet: number;
  /** Team's comfort/priority hero IDs */
  priorityHeroIds: number[];
  /** Undo history stack */
  history: string[];
}

type StateKey = keyof AppState;
type Listener = (state: AppState, changedKey: StateKey) => void;

const initialState: AppState = {
  enemyIds: [],
  searchQuery: '',
  roleFilter: null,
  resultsTab: 'counters',
  teamMode: 'balanced',
  expandedResultId: null,

  draftActive: false,
  draftPhase: 'ban1',
  tapAction: 'enemy_pick',
  bannedIds: [],
  allyPickIds: [],
  priorityHeroIds: [],
  activeTeamSet: 0,
  history: [],
};

class StateManager {
  private state: AppState;
  private listeners: Map<string, Set<Listener>> = new Map();
  private globalListeners: Set<Listener> = new Set();
  /** Registry of all active unsubscribe handles for bulk teardown */
  private subscriptionRegistry: Set<() => void> = new Set();

  constructor() {
    this.state = { ...initialState };
  }

  get(): Readonly<AppState> {
    return this.state;
  }

  set<K extends StateKey>(key: K, value: AppState[K], skipHistory = false): void {
    if (this.state[key] === value) return;

    // Save history for relevant drafting actions
    const historyKeys: StateKey[] = ['enemyIds', 'bannedIds', 'allyPickIds', 'draftPhase'];
    if (!skipHistory && historyKeys.includes(key)) {
      this.saveHistory();
    }

    this.state = { ...this.state, [key]: value };
    this.notify(key);
  }

  private saveHistory(): void {
    const snapshot = JSON.stringify({
      enemyIds: this.state.enemyIds,
      bannedIds: this.state.bannedIds,
      allyPickIds: this.state.allyPickIds,
      priorityHeroIds: this.state.priorityHeroIds,
      draftPhase: this.state.draftPhase,
      tapAction: this.state.tapAction,
      resultsTab: this.state.resultsTab
    });
    
    const newHistory = [...this.state.history, snapshot];
    if (newHistory.length > 20) newHistory.shift();
    this.state.history = newHistory;
  }

  undoLastAction(): void {
    if (this.state.history.length === 0) return;
    
    const history = [...this.state.history];
    const snapshot = JSON.parse(history.pop()!);
    
    this.state = { 
      ...this.state, 
      ...snapshot,
      history
    };

    // Notify all changed keys
    Object.keys(snapshot).forEach(key => this.notify(key as StateKey));
    this.notify('history');
  }

  on(key: StateKey, listener: Listener): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener);
    const unsub = () => {
      this.listeners.get(key)?.delete(listener);
      this.subscriptionRegistry.delete(unsub);
    };
    this.subscriptionRegistry.add(unsub);
    return unsub;
  }

  onAny(listener: Listener): () => void {
    this.globalListeners.add(listener);
    const unsub = () => {
      this.globalListeners.delete(listener);
      this.subscriptionRegistry.delete(unsub);
    };
    this.subscriptionRegistry.add(unsub);
    return unsub;
  }

  /**
   * Teardown: Unsubscribe ALL active listeners.
   * Call this when the floating overlay is dismissed/destroyed to prevent
   * orphaned listeners from leaking memory on the Android WebView thread.
   */
  unsubscribeAll(): void {
    // Snapshot to avoid mutation during iteration
    const handles = [...this.subscriptionRegistry];
    for (const unsub of handles) {
      unsub();
    }
    this.subscriptionRegistry.clear();
    this.listeners.clear();
    this.globalListeners.clear();
  }

  /**
   * Full disposal: unsubscribe all listeners AND reset state.
   * Use when the overlay WebView is being fully destroyed.
   */
  dispose(): void {
    this.unsubscribeAll();
    this.state = { ...initialState };
  }

  /** Current subscription count (for diagnostics) */
  get subscriptionCount(): number {
    return this.subscriptionRegistry.size;
  }

  /** All unavailable hero IDs (enemies + bans + ally picks) */
  getUnavailableIds(): number[] {
    const { enemyIds, bannedIds, allyPickIds } = this.state;
    return [...enemyIds, ...bannedIds, ...allyPickIds];
  }

  /** Toggle enemy hero selection */
  toggleEnemy(heroId: number): void {
    const current = [...this.state.enemyIds];
    const idx = current.indexOf(heroId);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else if (current.length < 5) {
      current.push(heroId);
    } else {
      return;
    }
    this.set('enemyIds', current);
    this.updateDraftPhase();
  }

  /** Remove a specific enemy */
  removeEnemy(heroId: number): void {
    this.set('enemyIds', this.state.enemyIds.filter(id => id !== heroId));
    this.updateDraftPhase();
  }

  /** Clear all enemies */
  clearEnemies(): void {
    this.set('enemyIds', []);
    this.set('expandedResultId', null);
    this.updateDraftPhase();
  }

  /** Add a hero as banned */
  addBan(heroId: number): void {
    if (this.state.bannedIds.includes(heroId)) return;
    if (this.state.bannedIds.length >= 10) return; // Max 10 bans in ranked
    this.set('bannedIds', [...this.state.bannedIds, heroId]);
    this.updateDraftPhase();
  }

  /** Remove a ban */
  removeBan(heroId: number): void {
    this.set('bannedIds', this.state.bannedIds.filter(id => id !== heroId));
    this.updateDraftPhase();
  }

  /** Add ally pick */
  addAllyPick(heroId: number): void {
    if (this.state.allyPickIds.includes(heroId)) return;
    if (this.state.allyPickIds.length >= 5) return;
    this.set('allyPickIds', [...this.state.allyPickIds, heroId]);
    this.updateDraftPhase();
  }

  /** Remove ally pick */
  removeAllyPick(heroId: number): void {
    this.set('allyPickIds', this.state.allyPickIds.filter(id => id !== heroId));
    this.updateDraftPhase();
  }

  /** Toggle hero priority status */
  togglePriorityHero(heroId: number): void {
    const current = [...this.state.priorityHeroIds];
    const idx = current.indexOf(heroId);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(heroId);
    }
    this.set('priorityHeroIds', current);
  }

  /** Calculate current draft phase based on bans/picks */
  private updateDraftPhase(): void {
    const { bannedIds, allyPickIds, enemyIds } = this.state;
    const totalPicks = allyPickIds.length + enemyIds.length;
    const totalBans = bannedIds.length;

    let phase: DraftPhase = 'ban1';

    if (totalBans < 6) {
      phase = 'ban1';
    } else if (totalPicks < 6) {
      phase = 'pick1';
    } else if (totalBans < 10) {
      phase = 'ban2';
    } else if (totalPicks < 10) {
      phase = 'pick2';
    } else {
      phase = 'done';
    }

    if (phase !== this.state.draftPhase) {
      this.set('draftPhase', phase);
      
      // Auto-switch tap action depending on phase to save clicks
      if (phase === 'ban1' || phase === 'ban2') {
        this.set('tapAction', 'ban');
        this.set('resultsTab', 'bans');
      } else if (phase === 'pick1' || phase === 'pick2') {
        // We do not auto-switch back to enemy pick, as the user could be picking ally
      }
    }
  }

  /** Handle hero tap in draft mode based on current tap action */
  draftTap(heroId: number): void {
    const unavailable = this.getUnavailableIds();
    if (unavailable.includes(heroId)) return;

    switch (this.state.tapAction) {
      case 'enemy_pick':
        this.toggleEnemy(heroId);
        break;
      case 'ban':
        this.addBan(heroId);
        break;
      case 'ally_pick':
        this.addAllyPick(heroId);
        break;
    }
  }

  /** Reset draft (bans + ally picks), keep enemies if specified */
  resetDraft(keepEnemies = false): void {
    this.set('bannedIds', []);
    this.set('allyPickIds', []);
    this.set('draftPhase', 'ban1');
    this.set('activeTeamSet', 0);
    if (!keepEnemies) {
      this.set('enemyIds', []);
    }
    this.set('expandedResultId', null);
  }

  /** Full reset */
  reset(): void {
    this.state = { ...initialState };
    for (const key of Object.keys(initialState) as StateKey[]) {
      this.notify(key);
    }
  }

  private notify(key: StateKey): void {
    const keyListeners = this.listeners.get(key);
    if (keyListeners) {
      for (const listener of keyListeners) {
        listener(this.state, key);
      }
    }
    for (const listener of this.globalListeners) {
      listener(this.state, key);
    }
  }
}

export const store = new StateManager();
