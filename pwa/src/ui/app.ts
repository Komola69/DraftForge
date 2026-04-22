/**
 * App UI — wires engine + state + UI.
 * Supports Quick Mode and Draft Mode with bans/ally picks.
 */

import { DataLoader, DraftEngine, TeamBuilder, BanAdvisor, VisionEngine } from '../engine';
import type { HeroDatabase, MatchupMatrix, BuildDatabase, SynergyDatabase, ScoredHero, Hero } from '../engine';
import { store } from './state';
import { Capacitor } from '@capacitor/core';

import heroData from '../../../data/processed/v1_heroes.json';
import buildData from '../../../data/processed/v1_builds.json';
import synergyData from '../../../data/processed/v1_synergies.json';
import portraitMap from '../../../data/processed/v1_portraits.json';
import v1MatchupData from '../../../data/processed/v1_matchups.json';

function normalizeDynamicMatchups(payload: any): MatchupMatrix {
  // v1 shape already matches MatchupMatrix.
  if (payload && typeof payload.schema_version === 'string' && payload.matchups) {
    return payload as MatchupMatrix;
  }

  // v2 schema from update_meta.go omits schema_version/game_version.
  if (payload && payload.matchups && typeof payload.matchups === 'object') {
    return {
      schema_version: '2.0.0',
      game_version: (heroData as any).game_version || 'unknown',
      generated_at: payload.generated_at || new Date().toISOString(),
      matchups: payload.matchups,
    } as MatchupMatrix;
  }

  throw new Error('Unsupported dynamic matchup schema format');
}

export let engine: DraftEngine;
export let loader: DataLoader;
export let teamBuilder: TeamBuilder;
export let banAdvisor: BanAdvisor;
export let vision: VisionEngine;

export function getRoleClass(hero: Hero): string {
  return `hero-avatar--${hero.roles[0] || 'fighter'}`;
}

export function getInitials(name: string): string {
  const parts = name.split(/[\s'-]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

export function getPortraitUrl(hero: Hero): string | null {
  const key = hero.name.toLowerCase();
  return (portraitMap as Record<string, string>)[key] || null;
}

export function renderAvatar(hero: Hero, size: number = 48): string {
  const url = getPortraitUrl(hero);
  const initials = getInitials(hero.name);
  const roleClass = getRoleClass(hero);
  if (url) {
    return `<div class="hero-avatar ${roleClass}" style="width:${size}px;height:${size}px">
      <img src="${url}" alt="${hero.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
      <span class="hero-avatar__fallback" style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:${Math.round(size * 0.33)}px;font-weight:700">${initials}</span>
    </div>`;
  }
  return `<div class="hero-avatar ${roleClass}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.33)}px">${initials}</div>`;
}

export function getRoleColor(role: string): string {
  const colors: Record<string, string> = {
    tank: 'var(--role-tank)', fighter: 'var(--role-fighter)',
    assassin: 'var(--role-assassin)', mage: 'var(--role-mage)',
    marksman: 'var(--role-marksman)', support: 'var(--role-support)',
  };
  return colors[role] || 'var(--text-muted)';
}

export async function initApp(): Promise<void> {
  const app = document.getElementById('app')!;
  
  // 1. Immediate loading state
  app.innerHTML = `
    <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text-muted);">
      <div style="width:40px; height:40px; border:3px solid rgba(99, 102, 241, 0.2); border-top-color:var(--accent); border-radius:50%; animation:spin 1s linear infinite;"></div>
      <p style="margin-top:16px; font-weight:500; letter-spacing:0.5px;">INITIALIZING ENGINE...</p>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    </div>
  `;

  const timestamp = new Date().getTime();
  let dynamicMatchupData;
  let supportedSchemas = ['1.0.0'];

  // Point 1 Fix: Fetch dynamic system config
  try {
    const configRes = await fetch(`/data/raw/config.json?bust=${timestamp}`);
    if (configRes.ok) {
       const config = await configRes.json();
       supportedSchemas = config.supported_schemas;
       console.log('[DraftForge] Config loaded:', config);
    }
  } catch (e) {
    console.warn('[DraftForge] Config unavailable, using core defaults.');
  }
  
  // 2. Data loading with Point 6 Sync Validation
  try {
    const res = await fetch(`/data/processed/v2_schema.json?bust=${timestamp}`);
    const contentType = res.headers.get('content-type') || '';
    
    if (!res.ok || contentType.includes('text/html')) {
      throw new Error('v2_schema.json missing (fallback to v1)');
    }
    
    dynamicMatchupData = normalizeDynamicMatchups(await res.json());
    console.log('[DraftForge] V2 High-Intelligence Matrix active.');
  } catch (e) {
    console.log('[DraftForge] V1 Base Matrix active.');
    dynamicMatchupData = v1MatchupData;
  }

  // 3. Component initialization
  loader = new DataLoader(supportedSchemas);
  loader.load(
    heroData as unknown as HeroDatabase,
    dynamicMatchupData as unknown as MatchupMatrix,
    buildData as unknown as BuildDatabase,
    synergyData as unknown as SynergyDatabase
  );

  engine = new DraftEngine(loader);
  teamBuilder = new TeamBuilder(loader);
  banAdvisor = new BanAdvisor(loader);
  vision = new VisionEngine(loader);
  
  // 4. Async vision init
  vision.init().catch(e => console.error('[VisionEngine] Failed to init:', e));

  // 5. Render Main UI
  app.innerHTML = `
    <header class="header" id="header">
      <div class="header__logo">
        <div class="header__icon">DF</div>
        <span class="header__title">DraftForge</span>
      </div>
      <div class="header__actions">
        <input type="file" id="ocr-upload" accept="image/*" style="display:none" />
        <button class="draft-toggle" id="ocr-btn" style="background: var(--warning); color: #000; margin-right: 8px;">📷 Scan Screen</button>
        <button class="draft-toggle" id="overlay-toggle" style="background: var(--accent); margin-right: 8px;">📱 Overlay</button>
        <button class="draft-toggle" id="draft-toggle">⚔️ Draft Mode</button>
        <span class="header__version">v${heroData.game_version}</span>
      </div>
    </header>

    <div class="draft-bar" id="draft-bar" style="display:none">
      <div class="draft-bar__phase-indicator" id="draft-phase-indicator">Phase: Ban 1</div>
      <div class="draft-bar__section">
        <span class="draft-bar__label">BANS</span>
        <div class="draft-bar__slots" id="ban-slots"></div>
      </div>
      <div class="draft-bar__section">
        <span class="draft-bar__label">ALLY</span>
        <div class="draft-bar__slots" id="ally-slots"></div>
      </div>
      <div class="tap-actions" id="tap-actions">
        <button class="tap-btn tap-btn--active" data-action="enemy_pick">🎯 Enemy</button>
        <button class="tap-btn tap-btn--ban" data-action="ban">🚫 Ban</button>
        <button class="tap-btn tap-btn--ally" data-action="ally_pick">🤝 Ally</button>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="draft-reset-btn" id="draft-undo" style="background: var(--bg-card); display: none;">Undo</button>
        <button class="draft-reset-btn" id="draft-reset">Reset Draft</button>
      </div>
    </div>

    <div class="enemy-bar" id="enemy-bar">
      <span class="enemy-bar__label">Enemy<br/>Team</span>
      <div class="enemy-bar__slots" id="enemy-slots"></div>
      <button class="enemy-bar__clear" id="clear-btn" disabled>Clear</button>
    </div>

    <div class="main" id="main">
      <div class="hero-panel" id="hero-panel">
        <div class="hero-panel__toolbar">
          <div class="search-box">
            <span class="search-box__icon">🔍</span>
            <input class="search-box__input" id="search-input" type="text" placeholder="Search heroes..." autocomplete="off" />
          </div>
          <div class="role-filters" id="role-filters"></div>
        </div>
        <div class="hero-grid" id="hero-grid"></div>
      </div>

      <div class="results-panel" id="results-panel">
        <div class="results-panel__header">
          <span class="results-panel__title">Counter Picks</span>
          <span class="results-panel__score-badge" id="max-score-badge"></span>
        </div>
        <div class="results-tabs">
          <button class="results-tab results-tab--active" id="tab-counters" data-tab="counters">✅ Best Picks</button>
          <button class="results-tab results-tab--warn" id="tab-avoid" data-tab="avoid">⚠️ Avoid</button>
          <button class="results-tab" id="tab-team" data-tab="team">🏆 Team</button>
          <button class="results-tab" id="tab-bans" data-tab="bans" style="display:none">🚫 Ban Suggest</button>
        </div>
        <div class="results-list" id="results-list"></div>
      </div>
    </div>
  `;

  initDraftToggle();
  initDraftBar();
  initEnemyBar();
  initRoleFilters();
  initHeroGrid();
  initResultsPanel();
  initSearch();
  initTeamTab();
  initVisionScanner();

  console.log(`[DraftForge] Ready. ${loader.heroCount} heroes loaded.`);
}

// ============================================================
// Draft Mode Toggle
// ============================================================
function initDraftToggle(): void {
  const btn = document.getElementById('draft-toggle')!;
  const draftBar = document.getElementById('draft-bar')!;

  btn.addEventListener('click', () => {
    const active = !store.get().draftActive;
    store.set('draftActive', active);
  });

  store.on('draftActive', () => {
    const { draftActive } = store.get();
    btn.classList.toggle('draft-toggle--active', draftActive);
    btn.textContent = draftActive ? '✕ Exit Draft' : '⚔️ Draft Mode';
    draftBar.style.display = draftActive ? 'flex' : 'none';
    // Show/hide ban suggest tab
    const banTab = document.getElementById('tab-bans');
    if (banTab) banTab.style.display = draftActive ? '' : 'none';
    if (!draftActive) {
      store.set('tapAction', 'enemy_pick');
      if (store.get().resultsTab === 'bans') store.set('resultsTab', 'counters');
    }
  });

  const overlayBtn = document.getElementById('overlay-toggle')!;
  if (!Capacitor.isNativePlatform()) {
    overlayBtn.style.display = 'none';
  } else {
    overlayBtn.addEventListener('click', async () => {
      try {
        const floatingOverlay = (Capacitor as any).Plugins?.FloatingOverlay;
        if (!floatingOverlay?.startOverlay) {
          alert('Floating overlay plugin is unavailable on this build.');
          return;
        }
        await floatingOverlay.startOverlay();
      } catch (e) {
        alert('Failed to start overlay. Permission needed.');
      }
    });
  }
}

// ============================================================
// Draft Bar (Bans + Ally Picks + Tap Actions)
// ============================================================
function initDraftBar(): void {
  const banSlots = document.getElementById('ban-slots')!;
  const allySlots = document.getElementById('ally-slots')!;
  const tapActions = document.getElementById('tap-actions')!;
  const resetBtn = document.getElementById('draft-reset')!;
  const undoBtn = document.getElementById('draft-undo')!;
  const phaseIndicator = document.getElementById('draft-phase-indicator')!;

  resetBtn.addEventListener('click', () => store.resetDraft());
  undoBtn.addEventListener('click', () => store.undoLastAction());

  tapActions.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.tap-btn') as HTMLElement | null;
    if (!btn) return;
    
    const action = btn.dataset.action as any;
    store.set('tapAction', action);
    
    // Automatically switch the results tab to match the current draft action
    if (action === 'ban') store.set('resultsTab', 'bans');
    else if (action === 'ally_pick') store.set('resultsTab', 'team');
    else if (action === 'enemy_pick') store.set('resultsTab', 'counters');
  });

  function renderBans(): void {
    const { bannedIds } = store.get();
    let html = '';
    for (let i = 0; i < 6; i++) {
      if (i < bannedIds.length) {
        const hero = loader.getHero(bannedIds[i])!;
        html += `<div class="mini-slot mini-slot--ban" title="${hero.name}">
          ${renderAvatar(hero, 28)}
          <button class="mini-slot__x" data-unban-id="${hero.id}">✕</button>
        </div>`;
      } else {
        html += `<div class="mini-slot mini-slot--empty">🚫</div>`;
      }
    }
    banSlots.innerHTML = html;
    banSlots.querySelectorAll<HTMLButtonElement>('.mini-slot__x').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        store.removeBan(parseInt(btn.dataset.unbanId!));
      });
    });
  }

  function renderAlly(): void {
    const { allyPickIds } = store.get();
    let html = '';
    for (let i = 0; i < 5; i++) {
      if (i < allyPickIds.length) {
        const hero = loader.getHero(allyPickIds[i])!;
        html += `<div class="mini-slot mini-slot--ally" title="${hero.name}">
          ${renderAvatar(hero, 28)}
          <button class="mini-slot__x" data-unally-id="${hero.id}">✕</button>
        </div>`;
      } else {
        html += `<div class="mini-slot mini-slot--empty">🤝</div>`;
      }
    }
    allySlots.innerHTML = html;
    allySlots.querySelectorAll<HTMLButtonElement>('.mini-slot__x').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        store.removeAllyPick(parseInt(btn.dataset.unallyId!));
      });
    });
  }

  function renderTapActions(): void {
    const { tapAction } = store.get();
    tapActions.querySelectorAll('.tap-btn').forEach(btn => {
      const action = (btn as HTMLElement).dataset.action;
      btn.classList.toggle('tap-btn--active', action === tapAction);
    });
  }

  function renderPhase(): void {
    const { draftPhase } = store.get();
    const phaseNames: Record<string, string> = {
      'ban1': 'Phase: Ban 1',
      'pick1': 'Phase: Pick 1',
      'ban2': 'Phase: Ban 2',
      'pick2': 'Phase: Pick 2',
      'done': 'Draft Complete'
    };
    phaseIndicator.textContent = phaseNames[draftPhase] || 'Draft';
  }

  store.on('bannedIds', renderBans);
  store.on('allyPickIds', renderAlly);
  store.on('tapAction', renderTapActions);
  store.on('draftPhase', renderPhase);
  store.on('history', () => {
    const { history } = store.get();
    undoBtn.style.display = history.length > 0 ? 'block' : 'none';
  });
  renderBans();
  renderAlly();
  renderPhase();
}

// ============================================================
// Enemy Bar
// ============================================================
function initEnemyBar(): void {
  const slotsEl = document.getElementById('enemy-slots')!;
  const clearBtn = document.getElementById('clear-btn')! as HTMLButtonElement;

  clearBtn.addEventListener('click', () => store.clearEnemies());

  function render(): void {
    const { enemyIds } = store.get();
    clearBtn.disabled = enemyIds.length === 0;

    let html = '';
    for (let i = 0; i < 5; i++) {
      if (i < enemyIds.length) {
        const hero = loader.getHero(enemyIds[i])!;
        html += `
          <div class="enemy-slot enemy-slot--filled" data-enemy-idx="${i}" title="${hero.name}">
            ${renderAvatar(hero, 48)}
            <button class="enemy-slot__remove" data-remove-id="${hero.id}" aria-label="Remove ${hero.name}">✕</button>
          </div>`;
      } else {
        html += `<div class="enemy-slot enemy-slot--empty">+</div>`;
      }
    }
    slotsEl.innerHTML = html;

    slotsEl.querySelectorAll<HTMLButtonElement>('.enemy-slot__remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        store.removeEnemy(parseInt(btn.dataset.removeId!));
      });
    });
  }

  store.on('enemyIds', render);
  render();
}

// ============================================================
// Role Filters
// ============================================================
function initRoleFilters(): void {
  const container = document.getElementById('role-filters')!;
  const roles = ['all', 'tank', 'fighter', 'assassin', 'mage', 'marksman', 'support'];
  const labels: Record<string, string> = {
    all: 'All', tank: '🛡 Tank', fighter: '⚔️ Fighter',
    assassin: '🗡 Assassin', mage: '🔮 Mage',
    marksman: '🏹 Marksman', support: '💚 Support',
  };

  container.innerHTML = roles.map(r =>
    `<button class="role-btn${r === 'all' ? ' role-btn--active' : ''}" data-role="${r}">${labels[r]}</button>`
  ).join('');

  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.role-btn') as HTMLElement | null;
    if (!btn) return;
    store.set('roleFilter', btn.dataset.role === 'all' ? null : btn.dataset.role!);
  });

  store.on('roleFilter', () => {
    const { roleFilter } = store.get();
    container.querySelectorAll('.role-btn').forEach(btn => {
      const r = (btn as HTMLElement).dataset.role!;
      btn.classList.toggle('role-btn--active', roleFilter === null ? r === 'all' : r === roleFilter);
    });
  });
}

// ============================================================
// Search
// ============================================================
function initSearch(): void {
  const input = document.getElementById('search-input') as HTMLInputElement;
  let debounceTimer: ReturnType<typeof setTimeout>;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      store.set('searchQuery', input.value.trim().toLowerCase());
    }, 80);
  });
}

// ============================================================
// Hero Grid (supports ban/ally/enemy states)
// ============================================================
function initHeroGrid(): void {
  const grid = document.getElementById('hero-grid')!;
  const allHeroes = loader.getAllHeroes().sort((a, b) => a.name.localeCompare(b.name));

  function render(): void {
    const { enemyIds, searchQuery, roleFilter, bannedIds, allyPickIds, priorityHeroIds } = store.get();
    const enemySet = new Set(enemyIds);
    const banSet = new Set(bannedIds);
    const allySet = new Set(allyPickIds);
    const prioritySet = new Set(priorityHeroIds);

    let filtered = allHeroes;
    if (searchQuery) filtered = filtered.filter(h => h.name.toLowerCase().includes(searchQuery));
    if (roleFilter) filtered = filtered.filter(h => h.roles.includes(roleFilter));

    let html = '';
    for (const hero of filtered) {
      const isEnemy = enemySet.has(hero.id);
      const isBanned = banSet.has(hero.id);
      const isAlly = allySet.has(hero.id);
      const isPriority = prioritySet.has(hero.id);

      let cls = 'hero-card';
      if (isBanned) cls += ' hero-card--banned';
      else if (isEnemy) cls += ' hero-card--enemy';
      else if (isAlly) cls += ' hero-card--ally';
      if (isPriority) cls += ' hero-card--priority';

      html += `
        <div class="${cls}" data-hero-id="${hero.id}" id="hero-card-${hero.id}" title="Right-click to mark as team priority">
          ${renderAvatar(hero, 48)}
          <span class="hero-card__name">${hero.name}</span>
          <span class="hero-card__tier tier--${hero.tier.toLowerCase()}">${hero.tier}</span>
          ${isPriority ? '<span class="hero-card__priority-star">⭐</span>' : ''}
        </div>`;
    }

    if (filtered.length === 0) {
      html = '<div class="no-results-text">No heroes match your filter</div>';
    }
    grid.innerHTML = html;
  }

  grid.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.hero-card') as HTMLElement | null;
    if (!card) return;
    const heroId = parseInt(card.dataset.heroId!);

    if (card.classList.contains('hero-card--banned') ||
        card.classList.contains('hero-card--ally')) return;

    const { draftActive } = store.get();
    if (draftActive) {
      store.draftTap(heroId);
    } else {
      store.toggleEnemy(heroId);
    }
  });

  grid.addEventListener('contextmenu', (e) => {
    const card = (e.target as HTMLElement).closest('.hero-card') as HTMLElement | null;
    if (!card) return;
    e.preventDefault();
    const heroId = parseInt(card.dataset.heroId!);
    store.togglePriorityHero(heroId);
  });

  store.on('enemyIds', render);
  store.on('searchQuery', render);
  store.on('roleFilter', render);
  store.on('bannedIds', render);
  store.on('allyPickIds', render);
  store.on('priorityHeroIds', render);
  render();
}

// ============================================================
// Results Panel
// ============================================================
function initResultsPanel(): void {
  const panel = document.getElementById('results-panel')!;
  const heroPanel = document.getElementById('hero-panel')!;
  const list = document.getElementById('results-list')!;
  const badge = document.getElementById('max-score-badge')!;
  const tabCounters = document.getElementById('tab-counters')!;
  const tabAvoid = document.getElementById('tab-avoid')!;
  const tabTeam = document.getElementById('tab-team')!;
  const tabBans = document.getElementById('tab-bans')!;

  tabCounters.addEventListener('click', () => store.set('resultsTab', 'counters'));
  tabAvoid.addEventListener('click', () => store.set('resultsTab', 'avoid'));
  tabTeam.addEventListener('click', () => store.set('resultsTab', 'team'));
  tabBans.addEventListener('click', () => store.set('resultsTab', 'bans'));

  function renderResults(): void {
    const { enemyIds, resultsTab, expandedResultId, bannedIds, allyPickIds, priorityHeroIds } = store.get();

    const hasEnemies = enemyIds.length > 0;
    const hasDraftAction = bannedIds.length > 0 || allyPickIds.length > 0;
    const showPanel = hasEnemies || resultsTab === 'bans' || resultsTab === 'team' || hasDraftAction;
    panel.classList.toggle('results-panel--open', showPanel);
    heroPanel.classList.toggle('hero-panel--shrunk', showPanel);

    tabCounters.classList.toggle('results-tab--active', resultsTab === 'counters');
    tabAvoid.classList.toggle('results-tab--active', resultsTab === 'avoid');
    tabTeam.classList.toggle('results-tab--active', resultsTab === 'team');
    tabBans.classList.toggle('results-tab--active', resultsTab === 'bans');

    // Ban suggestions work even without enemies
    if (resultsTab === 'bans') {
      renderBanSuggestions(list, badge, allyPickIds, enemyIds, bannedIds, priorityHeroIds);
      return;
    }

    if (!hasEnemies) {
      list.innerHTML = `
        <div class="results-empty">
          <div class="results-empty__icon">⚔️</div>
          <div class="results-empty__text">Select enemy heroes to see counter-pick suggestions</div>
        </div>`;
      badge.textContent = '';
      return;
    }

    if (resultsTab === 'team') {
      renderTeamComp(list, badge, enemyIds);
      return;
    }

    // Exclude bans + ally picks from suggestions
    const excludeSet = new Set([...bannedIds, ...allyPickIds]);

    let results: ScoredHero[];
    if (resultsTab === 'counters') {
      results = engine.getCounterPicks(enemyIds, allyPickIds, { limit: 15 });
    } else {
      results = engine.getWeakPicks(enemyIds, 10);
    }
    // Filter out unavailable heroes
    results = results.filter(r => !excludeSet.has(r.hero.id));

    if (results.length > 0) {
      badge.textContent = `Max: ${Math.abs(results[0].weighted_score).toFixed(1)}`;
    }

    let html = '';
    const maxAbs = results.length > 0 ? Math.max(...results.map(r => Math.abs(r.weighted_score)), 1) : 1;

    results.forEach((result, i) => {
      const rank = i + 1;
      const rankClass = rank === 1 ? 'result-card__rank--gold' : rank === 2 ? 'result-card__rank--silver' : rank === 3 ? 'result-card__rank--bronze' : '';
      const scoreClass = result.weighted_score > 0 ? 'result-card__score-value--positive' : result.weighted_score < 0 ? 'result-card__score-value--negative' : 'result-card__score-value--neutral';
      const isExpanded = expandedResultId === result.hero.id;
      const tierLower = result.hero.tier.toLowerCase();
      const barPct = Math.round((Math.abs(result.weighted_score) / maxAbs) * 100);
      const barClass = result.weighted_score >= 0 ? 'result-card__score-fill--positive' : 'result-card__score-fill--negative';

      html += `
        <div class="result-card${isExpanded ? ' result-card--expanded' : ''}" data-result-id="${result.hero.id}" data-rank="${rank}" style="animation-delay: ${i * 30}ms">
          <span class="result-card__rank ${rankClass}">${rank}</span>
          ${renderAvatar(result.hero, 40)}
          <div class="result-card__info">
            <div class="result-card__name">${result.hero.name}</div>
            <div class="result-card__meta">
              ${result.hero.roles.map(r => `<span class="result-card__role-tag" style="background:${getRoleColor(r)}20;color:${getRoleColor(r)}">${r}</span>`).join('')}
              <span>${result.hero.lanes.join(', ')}</span>
            </div>
            <div class="result-card__score-bar"><div class="result-card__score-fill ${barClass}" style="width:${barPct}%"></div></div>
            <div class="result-card__breakdown">
              ${result.breakdown.map(b => {
                const chipClass = b.score > 0 ? 'breakdown-chip--positive' : b.score < 0 ? 'breakdown-chip--negative' : 'breakdown-chip--neutral';
                return `<span class="breakdown-chip ${chipClass}">vs ${b.enemy_name}: ${b.score > 0 ? '+' : ''}${b.score}</span>`;
              }).join('')}
            </div>
            ${result.build ? `
              <div class="result-card__build">
                <div class="build-label">Core Build</div>
                <div class="build-items">
                  ${result.build.core.map(item => `<span class="build-item">${item}</span>`).join('')}
                </div>
                ${result.build.situational && Object.keys(result.build.situational).length > 0 ? `
                  <div class="build-label" style="margin-top: 6px;">Situational</div>
                  <div class="build-items">
                    ${Object.entries(result.build.situational).map(([sit, items]) => 
                      `<span class="build-item" title="${sit.replace('vs_', 'Vs ')}: ${items.join(', ')}">${items[0]}${items.length > 1 ? '+' : ''}</span>`
                    ).join('')}
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </div>
          <div class="result-card__score">
            <span class="result-card__score-value ${scoreClass}">${result.weighted_score > 0 ? '+' : ''}${result.weighted_score.toFixed(1)}</span>
            <span class="result-card__tier tier--${tierLower}">Tier ${result.hero.tier}</span>
          </div>
        </div>`;
    });

    list.innerHTML = html;
  }

  list.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.result-card') as HTMLElement | null;
    if (!card) return;
    const id = parseInt(card.dataset.resultId!);
    const { expandedResultId } = store.get();
    store.set('expandedResultId', expandedResultId === id ? null : id);
  });

  store.on('enemyIds', renderResults);
  store.on('resultsTab', renderResults);
  store.on('expandedResultId', renderResults);
  store.on('teamMode', renderResults);
  store.on('bannedIds', renderResults);
  store.on('allyPickIds', renderResults);
  store.on('activeTeamSet', renderResults);
  store.on('history', renderResults);
}

// ============================================================
// Team Composition Renderer (Multiple Sets)
// ============================================================
function renderTeamComp(list: HTMLElement, badge: HTMLElement, enemyIds: number[]): void {
  const { teamMode, bannedIds, allyPickIds, activeTeamSet } = store.get();
  const excludeIds = [...bannedIds, ...allyPickIds];

  if (teamMode === 'balanced') {
    const teams = teamBuilder.buildBalancedTeams(enemyIds, excludeIds, 3);
    if (teams.length === 0) {
      list.innerHTML = '<div class="no-results-text">Not enough heroes available</div>';
      return;
    }
    const idx = Math.min(activeTeamSet, teams.length - 1);
    const team = teams[idx];
    badge.textContent = `Total: +${team.totalScore.toFixed(1)}`;

    let setTabs = '';
    teams.forEach((t, i) => {
      setTabs += `<button class="set-tab${i === idx ? ' set-tab--active' : ''}" data-set="${i}">Set ${i + 1} <small>(+${t.totalScore.toFixed(0)})</small></button>`;
    });

    list.innerHTML = `
      <div class="team-section">
        <div class="team-header">
          <div class="team-header__title">
            ⚖️ Balanced Draft
            <span class="team-header__score">+${team.totalScore.toFixed(1)}</span>
          </div>
          <div class="team-toggle">
            <button class="team-toggle__btn team-toggle__btn--active" data-mode="balanced">⚖️ Balanced</button>
            <button class="team-toggle__btn" data-mode="max_counter">⚡ Max Counter</button>
          </div>
        </div>
        <div class="set-tabs">${setTabs}</div>
        <div class="team-slots">${renderTeamSlots(team)}</div>
      </div>`;
  } else {
    const team = teamBuilder.buildMaxCounterTeam(enemyIds, excludeIds);
    badge.textContent = `Total: +${team.totalScore.toFixed(1)}`;

    list.innerHTML = `
      <div class="team-section">
        <div class="team-header">
          <div class="team-header__title">
            ⚡ Max Counter
            <span class="team-header__score">+${team.totalScore.toFixed(1)}</span>
          </div>
          <div class="team-toggle">
            <button class="team-toggle__btn" data-mode="balanced">⚖️ Balanced</button>
            <button class="team-toggle__btn team-toggle__btn--active" data-mode="max_counter">⚡ Max Counter</button>
          </div>
        </div>
        <div class="team-slots">${renderTeamSlots(team)}</div>
      </div>`;
  }
}

function renderTeamSlots(team: import('../engine').TeamSuggestion): string {
  return team.slots.map((slot, i) => {
    const scoreClass = slot.score >= 0 ? '' : 'team-slot__score--negative';
    return `
      <div class="team-slot" style="animation-delay: ${i * 50}ms">
        <div class="team-slot__pos team-slot__pos--${slot.position}">${slot.positionLabel}</div>
        ${renderAvatar(slot.hero, 36)}
        <div class="team-slot__info">
          <div class="team-slot__name">${slot.hero.name}</div>
          <div class="team-slot__roles">${slot.hero.roles.join(', ')} • ${slot.hero.lanes.join(', ')}</div>
        </div>
        <div class="team-slot__score ${scoreClass}">${slot.score > 0 ? '+' : ''}${slot.score.toFixed(1)}</div>
      </div>`;
  }).join('');
}

// ============================================================
// Team Tab Toggle + Set Switching
// ============================================================
function initTeamTab(): void {
  const list = document.getElementById('results-list')!;

  list.addEventListener('click', (e) => {
    const toggleBtn = (e.target as HTMLElement).closest('.team-toggle__btn') as HTMLElement | null;
    if (toggleBtn) {
      store.set('teamMode', toggleBtn.dataset.mode as 'balanced' | 'max_counter');
      store.set('activeTeamSet', 0);
      return;
    }
    const setTab = (e.target as HTMLElement).closest('.set-tab') as HTMLElement | null;
    if (setTab) {
      store.set('activeTeamSet', parseInt(setTab.dataset.set!));
    }
  });
}

// ============================================================
// Experimental Vision Scanner (OCR)
// ============================================================
function initVisionScanner(): void {
  const btn = document.getElementById('ocr-btn');
  const input = document.getElementById('ocr-upload') as HTMLInputElement;

  if (!btn || !input) return;

  btn.addEventListener('click', () => {
    input.click();
  });

  input.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const img = new Image();
    img.onload = () => {
      const heroId = vision.identifyHero(img);
      
      if (heroId) {
        const hero = loader.getHero(heroId);
        alert(`Vision Engine detected: ${hero?.name}! Added to enemies.`);
        store.toggleEnemy(heroId);
      } else {
        alert('Vision Engine could not match this image to any hero.');
      }
      input.value = ''; // Reset
    };
    img.src = URL.createObjectURL(file);
  });
}

// ============================================================
// Ban Suggestion Renderer
// ============================================================
function renderBanSuggestions(
  list: HTMLElement,
  badge: HTMLElement,
  allyPickIds: number[] = [],
  enemyPickIds: number[] = [],
  existingBanIds: number[] = [],
  priorityHeroIds: number[] = []
): void {
  const suggestions = banAdvisor.getSuggestedBans(
    allyPickIds ?? [], enemyPickIds ?? [], existingBanIds ?? [], priorityHeroIds ?? [], 6
  );

  const phase = suggestions[0]?.phase === 'protect' ? 'Protective' : 'Meta';
  badge.textContent = `${phase} Bans`;

  if (suggestions.length === 0) {
    list.innerHTML = '<div class="no-results-text">No ban suggestions available</div>';
    return;
  }

  let html = `
    <div class="ban-suggest-header">
      <span class="ban-suggest-phase">${phase === 'Meta' ? '🌐' : '🛡️'} ${phase} Ban Phase</span>
      <span class="ban-suggest-hint">${phase === 'Meta'
        ? 'Ban high-tier heroes that are hard to counter'
        : 'Ban heroes that threaten your team\'s picks'
      }</span>
    </div>`;

  suggestions.forEach((sug, i) => {
    const tierLower = sug.hero.tier.toLowerCase();
    html += `
      <div class="ban-card" style="animation-delay: ${i * 40}ms">
        <span class="ban-card__rank">${i + 1}</span>
        ${renderAvatar(sug.hero, 40)}
        <div class="ban-card__info">
          <div class="ban-card__name">${sug.hero.name}</div>
          <div class="ban-card__reason">${sug.reason}</div>
          ${sug.threats.length > 0 ? `
            <div class="ban-card__threats">
              ${sug.threats.slice(0, 3).map(t =>
                `<span class="threat-chip">⚠️ ${t.allyName} <strong>+${t.threat.toFixed(1)}</strong></span>`
              ).join('')}
            </div>
          ` : ''}
        </div>
        <div class="ban-card__actions">
          <span class="ban-card__score">🔥 ${sug.score.toFixed(1)}</span>
          <span class="result-card__tier tier--${tierLower}">Tier ${sug.hero.tier}</span>
          <button class="ban-card__btn" data-ban-hero-id="${sug.hero.id}">Ban</button>
        </div>
      </div>`;
  });

  list.innerHTML = html;

  // Wire up 1-tap ban buttons
  list.querySelectorAll<HTMLButtonElement>('.ban-card__btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const heroId = parseInt(btn.dataset.banHeroId!);
      store.addBan(heroId);
    });
  });
}
