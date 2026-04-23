/**
 * App UI — Total Restoration.
 * Reverts to the original high-fidelity structural blueprints while
 * retaining advanced 10-ban and DNA logic.
 */

import { DataLoader, DraftEngine, TeamBuilder, BanAdvisor, VisionEngine } from '../engine';
import type { MatchupMatrix, Hero } from '../engine';
import { store } from './state';

import heroData from '../../../data/processed/v1_heroes.json';
import buildData from '../../../data/processed/v1_builds.json';
import synergyData from '../../../data/processed/v1_synergies.json';
import portraitMap from '../../../data/processed/v1_portraits.json';
import v1MatchupData from '../../../data/processed/v1_matchups.json';

function normalizeDynamicMatchups(payload: any): MatchupMatrix {
  if (payload && typeof payload.schema_version === 'string' && payload.matchups) return payload as MatchupMatrix;
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

export function getRoleColor(role: string): string {
  const colors: Record<string, string> = {
    tank: 'var(--role-tank)', fighter: 'var(--role-fighter)',
    assassin: 'var(--role-assassin)', mage: 'var(--role-mage)',
    marksman: 'var(--role-marksman)', support: 'var(--role-support)',
  };
  return colors[role] || 'var(--text-muted)';
}

export function renderAvatar(hero: Hero, size: number = 48): string {
  const url = (portraitMap as Record<string, string>)[hero.name.toLowerCase()] || null;
  const initials = hero.name.substring(0, 2).toUpperCase();
  const roleClass = `hero-avatar--${hero.roles[0] || 'fighter'}`;
  
  if (url) {
    return `<div class="hero-avatar ${roleClass}" style="width:${size}px;height:${size}px">
      <img src="${url}" alt="${hero.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
      <span class="hero-avatar__fallback" style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:${Math.round(size * 0.33)}px;font-weight:700">${initials}</span>
    </div>`;
  }
  return `<div class="hero-avatar ${roleClass}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.33)}px">${initials}</div>`;
}

export async function initApp(): Promise<void> {
  if (engine) engine.dispose();
  store.dispose();

  const app = document.getElementById('app')!;
  app.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">INITIALIZING ENGINE...</div>`;

  const timestamp = Date.now();
  let dynamicData;
  try {
    const res = await fetch(`/data/processed/v2_schema.json?bust=${timestamp}`);
    if (res.ok) dynamicData = normalizeDynamicMatchups(await res.json());
  } catch (e) {}
  if (!dynamicData) dynamicData = v1MatchupData;

  loader = new DataLoader(['1.0.0', '2.0.0']);
  loader.load(heroData as any, dynamicData as any, buildData as any, synergyData as any);
  engine = new DraftEngine(loader);
  teamBuilder = new TeamBuilder(loader);
  banAdvisor = new BanAdvisor(loader);
  vision = new VisionEngine(loader);
  vision.init().catch(console.error);

  // Expose to global for inline onclick handlers
  (window as any).store = store;
  (window as any).vision = vision;

  // Restore Original Blueprint HTML
  app.innerHTML = `
    <header class="header">
      <div class="header__logo">
        <div class="header__icon">DF</div>
        <span class="header__title">DraftForge</span>
      </div>
      <div class="header__actions">
        <input type="file" id="ocr-upload" accept="image/*" style="display:none" />
        <button class="role-btn" id="ocr-btn">📷 Scan Screen</button>
        <button class="role-btn" id="overlay-toggle">📱 Overlay</button>
        <button class="draft-toggle" id="draft-toggle">⚔️ Draft Mode</button>
        <span class="header__version">v${heroData.game_version}</span>
      </div>
    </header>

    <div class="draft-bar" id="draft-bar" style="display:none">
      <div class="draft-bar__phase-indicator" id="draft-phase-indicator">Phase: Ban 1</div>
      
      <div class="draft-settings" style="display: flex; gap: 8px;">
          <button class="role-btn" id="toggle-rank-btn">Rank: MYTHIC</button>
          <button class="role-btn" id="toggle-side-btn">Side: BLUE</button>
          <button class="role-btn" id="toggle-first-btn">First: BLUE</button>
      </div>

      <div class="draft-bar__section">
        <span class="draft-bar__label">OUR BANS</span>
        <div class="draft-bar__slots" id="ally-ban-slots"></div>
      </div>
      
      <div class="draft-bar__section">
        <span class="draft-bar__label">ENEMY BANS</span>
        <div class="draft-bar__slots" id="enemy-ban-slots"></div>
      </div>

      <div class="draft-bar__section">
        <span class="draft-bar__label">OUR PICKS</span>
        <div class="draft-bar__slots" id="ally-slots"></div>
      </div>

      <div class="tap-actions" id="tap-actions">
        <button class="tap-btn" data-action="enemy_pick">🎯 Enemy</button>
        <button class="tap-btn" data-action="ban">🚫 Ban</button>
        <button class="tap-btn" data-action="ally_pick">🤝 Ally</button>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="draft-reset-btn" id="draft-undo" style="display: none;">Undo</button>
        <button class="draft-reset-btn" id="draft-reset">Reset</button>
      </div>
    </div>

    <div class="enemy-bar">
      <span class="enemy-bar__label">Enemy<br/>Team</span>
      <div class="enemy-bar__slots" id="enemy-slots"></div>
      <button class="enemy-bar__clear" id="clear-btn" disabled>Clear</button>
    </div>

    <div class="main">
      <div class="hero-panel" id="hero-panel">
        <div class="hero-panel__toolbar">
          <div class="search-box">
            <span class="search-box__icon">🔍</span>
            <input class="search-box__input" id="search-input" type="text" placeholder="Search heroes..." />
          </div>
          <div class="role-filters" id="role-filters"></div>
        </div>
        <div class="hero-grid" id="hero-grid"></div>
      </div>

      <div class="results-panel" id="results-panel">
        <div class="results-panel__header">
          <span class="results-panel__title" id="results-title">Counter Picks</span>
          <span class="results-panel__score-badge" id="max-score-badge"></span>
        </div>
        <div class="results-tabs">
          <button class="results-tab results-tab--active" data-tab="counters">✅ Best Picks</button>
          <button class="results-tab results-tab--warn" data-tab="avoid">⚠️ Avoid</button>
          <button class="results-tab" data-tab="team">🏆 Team</button>
          <button class="results-tab" id="tab-bans" data-tab="bans" style="display:none">🚫 Bans</button>
        </div>
        <div class="results-list" id="results-list"></div>
      </div>
    </div>
  `;

  initInteractions();
}

function initInteractions(): void {
    const draftToggle = document.getElementById('draft-toggle')!;
    draftToggle.addEventListener('click', () => {
        const active = !store.get().draftActive;
        if (!active) store.resetDraft();
        store.set('draftActive', active);
    });

    document.getElementById('toggle-rank-btn')!.addEventListener('click', () => {
        const cur = store.get().rankTier;
        store.setRankTier(cur === 'MYTHIC' ? 'EPIC' : 'MYTHIC');
    });

    document.getElementById('toggle-side-btn')!.addEventListener('click', () => store.toggleDraftSide());
    document.getElementById('toggle-first-btn')!.addEventListener('click', () => store.toggleFirstPick());
    document.getElementById('draft-reset')!.addEventListener('click', () => store.resetDraft());
    document.getElementById('draft-undo')!.addEventListener('click', () => store.undoLastAction());

    document.getElementById('tap-actions')!.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.tap-btn') as HTMLElement | null;
        if (btn) store.set('tapAction', btn.dataset.action as any);
    });

    document.getElementById('clear-btn')!.addEventListener('click', () => store.clearEnemies());

    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput.addEventListener('input', () => store.set('searchQuery', searchInput.value.toLowerCase()));

    const roleContainer = document.getElementById('role-filters')!;
    const roles = ['all', 'tank', 'fighter', 'assassin', 'mage', 'marksman', 'support'];
    roleContainer.innerHTML = roles.map(r => `<button class="role-btn" data-role="${r}">${r.toUpperCase()}</button>`).join('');
    roleContainer.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.role-btn') as HTMLElement | null;
        if (btn) store.set('roleFilter', btn.dataset.role === 'all' ? null : btn.dataset.role!);
    });

    document.querySelectorAll('.results-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = (tab as HTMLElement).dataset.tab as any;
            store.set('resultsTab', target);
        });
    });

    const ocrBtn = document.getElementById('ocr-btn')!;
    const ocrInput = document.getElementById('ocr-upload') as HTMLInputElement;
    ocrBtn.addEventListener('click', () => ocrInput.click());
    ocrInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const img = new Image();
        img.onload = () => {
            const id = vision.identifyHero(img);
            if (id) store.toggleEnemy(id);
            else alert('Hero not recognized');
        };
        img.src = URL.createObjectURL(file);
    });

    store.onAny(() => render());
    render();
}

function render(): void {
  const state = store.get();
  
  // 1. Layout State
  document.getElementById('draft-bar')!.style.display = state.draftActive ? 'flex' : 'none';
  document.getElementById('tab-bans')!.style.display = state.draftActive ? 'block' : 'none';
  
  const showResults = state.enemyIds.length > 0 || state.resultsTab === 'bans' || state.resultsTab === 'team';
  document.getElementById('results-panel')!.classList.toggle('results-panel--open', showResults);

  // 2. Sync Settings
  if (state.draftActive) {
      const isOurTurn = state.tapAction === 'ally_pick' || (state.tapAction === 'ban' && state.draftPhase.startsWith('ban'));
      const phaseNames: any = { 'ban1': 'BAN PHASE 1', 'pick1': 'PICK PHASE 1', 'ban2': 'BAN PHASE 2', 'pick2': 'PICK PHASE 2', 'done': 'COMPLETE' };
      document.getElementById('draft-phase-indicator')!.textContent = `${phaseNames[state.draftPhase]} ${isOurTurn ? '• YOUR TURN' : '• ENEMY TURN'}`;
      document.getElementById('toggle-rank-btn')!.textContent = `Rank: ${state.rankTier}`;
      document.getElementById('toggle-side-btn')!.textContent = `Side: ${state.draftTeamSide.toUpperCase()}`;
      document.getElementById('toggle-first-btn')!.textContent = `First: ${state.firstPickSide.toUpperCase()}`;
      
      const renderMini = (ids: number[]) => ids.map(id => {
          const h = loader.getHero(id)!;
          return `<div class="mini-slot mini-slot--filled">${renderAvatar(h, 24)}<button class="mini-slot__x" onclick="event.stopPropagation(); store.removeBan(${id})">✕</button></div>`;
      }).join('') || '<div class="mini-slot mini-slot--empty"></div>';

      const allyBans = state.bannedIds.filter((_, i) => i % 2 === 0);
      const enemyBans = state.bannedIds.filter((_, i) => i % 2 !== 0);
      document.getElementById('ally-ban-slots')!.innerHTML = renderMini(allyBans);
      document.getElementById('enemy-ban-slots')!.innerHTML = renderMini(enemyBans);
      document.getElementById('ally-slots')!.innerHTML = state.allyPickIds.map(id => `<div class="mini-slot mini-slot--ally">${renderAvatar(loader.getHero(id)!, 24)}</div>`).join('') || '<div class="mini-slot mini-slot--empty"></div>';

      document.querySelectorAll('.tap-btn').forEach(btn => {
          (btn as HTMLElement).classList.toggle('tap-btn--active', (btn as HTMLElement).dataset.action === state.tapAction);
      });
      document.getElementById('draft-undo')!.style.display = state.history.length > 0 ? 'block' : 'none';
  }

  // 3. Enemy Bar
  const enemySlots = document.getElementById('enemy-slots')!;
  enemySlots.innerHTML = Array.from({length:5}).map((_, i) => {
      const id = state.enemyIds[i];
      if (!id) return `<div class="enemy-slot enemy-slot--empty">+</div>`;
      const h = loader.getHero(id)!;
      return `<div class="enemy-slot enemy-slot--filled">${renderAvatar(h, 48)}<button class="enemy-slot__remove" onclick="event.stopPropagation(); store.removeEnemy(${id})">✕</button></div>`;
  }).join('');
  (document.getElementById('clear-btn') as HTMLButtonElement).disabled = state.enemyIds.length === 0;

  // 4. Hero Grid
  const grid = document.getElementById('hero-grid')!;
  const prioritySet = new Set(state.priorityHeroIds);
  const unavailable = state.draftActive ? new Set([...state.enemyIds, ...state.bannedIds, ...state.allyPickIds]) : new Set(state.enemyIds);
  
  let heroes = loader.getAllHeroes().sort((a, b) => a.name.localeCompare(b.name));
  if (state.searchQuery) heroes = heroes.filter(h => h.name.toLowerCase().includes(state.searchQuery));
  if (state.roleFilter) heroes = heroes.filter(h => h.roles.includes(state.roleFilter!));

  // Sync role filters active state
  document.querySelectorAll('.role-btn[data-role]').forEach(btn => {
      const role = (btn as HTMLElement).dataset.role;
      const isActive = (role === 'all' && !state.roleFilter) || (role === state.roleFilter);
      btn.classList.toggle('role-btn--active', isActive);
  });

  grid.innerHTML = heroes.map(h => {
      const isPriority = prioritySet.has(h.id);
      const isOff = unavailable.has(h.id);
      let cls = 'hero-card';
      
      if (isOff) {
          if (state.bannedIds.includes(h.id)) cls += ' hero-card--banned';
          else if (state.allyPickIds.includes(h.id)) cls += ' hero-card--ally';
          else cls += ' hero-card--enemy';
      }
      if (isPriority) cls += ' hero-card--priority';

      return `
        <div class="${cls}" data-id="${h.id}" onclick="if(!this.classList.contains('hero-card--banned') && !this.classList.contains('hero-card--ally') && !this.classList.contains('hero-card--enemy')) { if(store.get().draftActive) store.draftTap(${h.id}); else store.toggleEnemy(${h.id}); }">
          ${renderAvatar(h, 48)}
          <span class="hero-card__name">${h.name}</span>
          <div class="priority-toggle ${isPriority ? 'priority-toggle--active' : ''}" onclick="event.stopPropagation(); store.togglePriorityHero(${h.id})">⭐</div>
          ${isPriority ? '<span class="hero-card__priority-star">⭐</span>' : ''}
        </div>`;
  }).join('');

  // 5. Sync Tabs & Results
  document.querySelectorAll('.results-tab').forEach(t => {
      t.classList.toggle('results-tab--active', (t as HTMLElement).dataset.tab === state.resultsTab);
  });
  renderDeepResults(state);
}

let lastReq = 0;
async function renderDeepResults(state: any): Promise<void> {
    const ts = Date.now();
    lastReq = ts;
    const list = document.getElementById('results-list')!;
    const title = document.getElementById('results-title')!;
    const badge = document.getElementById('max-score-badge')!;

    if (state.resultsTab === 'bans') {
        const suggestions = banAdvisor.getSuggestedBans(state.allyPickIds, state.enemyIds, state.bannedIds, state.priorityHeroIds, state.rankTier, 6);
        const isProtective = state.allyPickIds.length > 0 && suggestions.some(s => s.phase === 'protect');
        
        title.innerHTML = `
            <div class="ban-suggest-header">
                <span class="ban-suggest-phase">${isProtective ? '🛡️ Protective Bans' : '🌐 Meta Bans'}</span>
                <span class="ban-suggest-hint">${isProtective ? 'Protecting your picks' : 'Banning high-tier threats'}</span>
            </div>`;
        badge.textContent = isProtective ? 'PROTECTIVE' : 'META';

        list.innerHTML = suggestions.map((s, i) => `
            <div class="ban-card" style="animation-delay: ${i*40}ms">
                <span class="ban-card__rank">${i+1}</span>
                ${renderAvatar(s.hero, 36)}
                <div class="ban-card__info">
                    <div class="ban-card__name">${s.hero.name} <span class="result-card__tier tier--${s.hero.tier.toLowerCase()}">T${s.hero.tier}</span></div>
                    <div class="ban-card__reason">${s.reason}</div>
                    ${s.threats.length > 0 ? `
                        <div class="ban-card__threats">
                            ${s.threats.slice(0, 2).map(t => `<span class="threat-chip">⚠️ ${t.allyName} <strong>+${t.threat.toFixed(1)}</strong></span>`).join('')}
                        </div>
                    ` : ''}
                </div>
                <div class="ban-card__actions">
                    <span class="ban-card__score">🔥 ${s.score.toFixed(1)}</span>
                    <button class="ban-card__btn" onclick="event.stopPropagation(); store.addBan(${s.hero.id})">Ban</button>
                </div>
            </div>`).join('');
        return;
    }

    if (state.resultsTab === 'team') {
        title.textContent = '🏆 Optimal Team';
        const teams = state.teamMode === 'balanced' 
            ? teamBuilder.buildBalancedTeams(state.enemyIds, [...state.bannedIds, ...state.allyPickIds], 3)
            : [teamBuilder.buildMaxCounterTeam(state.enemyIds, [...state.bannedIds, ...state.allyPickIds])];

        if (teams.length === 0 || (teams[0].slots.length === 0)) { 
            list.innerHTML = '<div class="no-results-text">Select enemies to build a team</div>'; 
            badge.textContent = '';
            return; 
        }

        const team = teams[state.activeTeamSet % teams.length];
        badge.textContent = `Total: +${team.totalScore.toFixed(1)}`;
        
        list.innerHTML = `
            <div class="team-header">
                <div class="team-toggle">
                    <button class="team-toggle__btn ${state.teamMode === 'balanced' ? 'team-toggle__btn--active' : ''}" onclick="event.stopPropagation(); store.set('teamMode', 'balanced'); store.set('activeTeamSet', 0);">⚖️ Balanced</button>
                    <button class="team-toggle__btn ${state.teamMode === 'max_counter' ? 'team-toggle__btn--active' : ''}" onclick="event.stopPropagation(); store.set('teamMode', 'max_counter');">⚡ Max Counter</button>
                </div>
            </div>
            ${state.teamMode === 'balanced' ? `
                <div class="set-tabs">
                    ${teams.map((t, i) => `<button class="set-tab ${i === (state.activeTeamSet % teams.length) ? 'set-tab--active' : ''}" onclick="event.stopPropagation(); store.set('activeTeamSet', ${i})">Set ${i+1} <small>(+${t.totalScore.toFixed(0)})</small></button>`).join('')}
                </div>
            ` : ''}
            <div class="team-slots">
                ${team.slots.map(s => `
                    <div class="team-slot">
                        <div class="team-slot__pos team-slot__pos--${s.position}">${s.position.toUpperCase()}</div>
                        ${renderAvatar(s.hero, 36)}
                        <div class="team-slot__info">
                            <div class="team-slot__name">${s.hero.name}</div>
                            <div class="team-slot__roles">${s.hero.roles.join(', ')}</div>
                        </div>
                        <div class="team-slot__score">+${s.score.toFixed(1)}</div>
                    </div>`).join('')}
            </div>`;
        return;
    }

    title.textContent = state.resultsTab === 'counters' ? '✅ Counter Picks' : '⚠️ Heroes to Avoid';
    if (state.enemyIds.length === 0) { list.innerHTML = 'Select enemies first'; badge.textContent = ''; return; }

    const results = state.resultsTab === 'counters' 
        ? await engine.getCounterPicksAsync(state.enemyIds, state.draftActive ? state.allyPickIds : [], { limit: 15 })
        : engine.getWeakPicks(state.enemyIds, state.draftActive ? state.allyPickIds : [], 10);

    if (ts !== lastReq) return;

    badge.textContent = `MAX: ${results[0]?.weighted_score.toFixed(1) || '0'}`;
    const maxAbs = Math.max(...results.map(r => Math.abs(r.weighted_score)), 1);

    list.innerHTML = results.map((r, i) => {
        const isExp = state.expandedResultId === r.hero.id;
        const scoreVal = r.weighted_score;
        const barPct = Math.round((Math.abs(scoreVal) / maxAbs) * 100);
        const rank = i + 1;

        return `
            <div class="result-card ${isExp ? 'result-card--expanded' : ''}" data-rank="${rank}" onclick="const id = ${r.hero.id}; const cur = store.get().expandedResultId; store.set('expandedResultId', cur === id ? null : id)">
                <span class="result-card__rank ${rank <= 3 ? 'result-card__rank--' + (rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze') : ''}">${rank}</span>
                ${renderAvatar(r.hero, 40)}
                <div class="result-card__info">
                    <div class="result-card__name">${r.hero.name} <span class="confidence-tag confidence--${r.confidence.toLowerCase()}">${r.confidence}</span></div>
                    <div class="result-card__score-bar"><div class="result-card__score-fill ${scoreVal > 0 ? 'result-card__score-fill--positive' : 'result-card__score-fill--negative'}" style="width:${barPct}%"></div></div>
                    <div class="result-card__breakdown">
                        ${r.breakdown.length > 0 ? r.breakdown.map(b => `<span class="breakdown-chip ${b.score > 0 ? 'breakdown-chip--positive' : 'breakdown-chip--negative'}">vs ${b.enemy_name}: ${b.score > 0 ? '+' : ''}${b.score}</span>`).join('') : '<span class="breakdown-chip breakdown-chip--neutral">No direct matchup data</span>'}
                    </div>
                </div>
                <div class="result-card__score">
                    <span class="result-card__score-value ${scoreVal > 0 ? 'result-card__score-value--positive' : 'result-card__score-value--negative'}">${scoreVal > 0 ? '+' : ''}${scoreVal.toFixed(1)}</span>
                    <span class="result-card__tier tier--${r.hero.tier.toLowerCase()}">Tier ${r.hero.tier}</span>
                </div>
            </div>`;
    }).join('');
}
