import { store } from '../state';
import { loader, renderAvatar, banAdvisor, teamBuilder, engine, getRoleColor } from '../app';
import type { ScoredHero } from '../../engine';

export function initResultsPanel(): void {
  const panel = document.getElementById('results-panel')!;
  const heroPanel = document.getElementById('hero-panel')!;
  const list = document.getElementById('results-list')!;
  const badge = document.getElementById('max-score-badge')!;
  const title = document.getElementById('results-title')!;
  const tabs = document.querySelectorAll('.results-tab');
  
  let lastRequestId = 0;

  async function render(): Promise<void> {
    const state = store.get();
    const ts = Date.now();
    lastRequestId = ts;

    const hasEnemies = state.enemyIds.length > 0;
    const showPanel = hasEnemies || state.resultsTab === 'bans' || state.resultsTab === 'team';
    
    panel.classList.toggle('results-panel--open', showPanel);
    heroPanel.classList.toggle('hero-panel--shrunk', showPanel);

    // Sync Tabs Styling with State
    tabs.forEach(tab => {
        const target = (tab as HTMLElement).dataset.tab;
        tab.classList.toggle('results-tab--active', state.resultsTab === target);
    });

    if (state.resultsTab === 'bans') {
        renderBans(state, list, title, badge);
        return;
    }

    if (state.resultsTab === 'team') {
        renderTeams(state, list, title, badge);
        return;
    }

    // Counters / Avoid
    title.textContent = state.resultsTab === 'counters' ? '✅ Counter Picks' : '⚠️ Heroes to Avoid';
    if (!hasEnemies) {
        list.innerHTML = `
            <div class="results-empty">
                <div class="results-empty__icon">⚔️</div>
                <div class="results-empty__text">Select enemy heroes to see counter-pick suggestions</div>
            </div>`;
        badge.textContent = '';
        return;
    }

    const allyIds = state.draftActive ? state.allyPickIds : [];
    const results = state.resultsTab === 'counters' 
        ? await engine.getCounterPicksAsync(state.enemyIds, allyIds, { limit: 20 })
        : engine.getWeakPicks(state.enemyIds, allyIds, 15);

    if (ts !== lastRequestId) return;

    const excludeSet = new Set([...state.bannedIds, ...state.allyPickIds]);
    const filteredResults = results.filter(r => !excludeSet.has(r.hero.id));

    if (filteredResults.length > 0) {
        badge.textContent = `MAX: ${Math.abs(filteredResults[0].weighted_score).toFixed(1)}`;
    }

    const maxAbs = filteredResults.length > 0 ? Math.max(...filteredResults.map(r => Math.abs(r.weighted_score)), 1) : 1;

    list.innerHTML = filteredResults.map((r, i) => {
        const isExpanded = state.expandedResultId === r.hero.id;
        const scoreValue = r.weighted_score;
        const scoreClass = scoreValue > 0 ? 'result-card__score-value--positive' : 'result-card__score-value--negative';
        const barClass = scoreValue > 0 ? 'result-card__score-fill--positive' : 'result-card__score-fill--negative';
        const barPct = Math.round((Math.abs(scoreValue) / maxAbs) * 100);
        const tierLower = r.hero.tier.toLowerCase();

        return `
            <div class="result-card ${isExpanded ? 'result-card--expanded' : ''}" data-result-id="${r.hero.id}" data-rank="${i+1}">
                <span class="result-card__rank">${i+1}</span>
                ${renderAvatar(r.hero, 40)}
                <div class="result-card__info">
                    <div class="result-card__name">
                        ${r.hero.name} 
                        <span class="confidence-tag confidence--${r.confidence.toLowerCase()}">${r.confidence}</span>
                        <span class="result-card__tier tier--${tierLower}" style="margin-left:auto; float:right;">T${r.hero.tier}</span>
                    </div>
                    <div class="result-card__meta">
                        ${r.hero.roles.map(role => `<span class="result-card__role-tag" style="background:${getRoleColor(role)}20;color:${getRoleColor(role)}">${role}</span>`).join('')}
                        <span>${r.hero.lanes.join(', ')}</span>
                    </div>
                    <div class="result-card__score-bar"><div class="result-card__score-fill ${barClass}" style="width:${barPct}%"></div></div>
                    
                    ${isExpanded ? `
                        <div class="result-card__breakdown">
                            ${r.breakdown.map(b => `
                                <span class="breakdown-chip ${b.score > 0 ? 'breakdown-chip--positive' : 'breakdown-chip--negative'}">
                                    vs ${b.enemy_name}: ${b.score > 0 ? '+' : ''}${b.score.toFixed(1)}
                                </span>`).join('')}
                        </div>
                        ${r.build ? `
                            <div class="result-card__build">
                                <div class="build-label">Strategic Counter Build</div>
                                <div class="build-items">
                                    ${r.build.core.map(item => `<span class="build-item">${item}</span>`).join('')}
                                    ${r.build.situational['vs_draft'] ? r.build.situational['vs_draft'].map(item => `<span class="build-item" style="background:var(--bg-glass); border:1px solid var(--accent); color:var(--accent);">${item}</span>`).join('') : ''}
                                </div>
                            </div>
                        ` : ''}
                    ` : '<div class="result-card__expand-hint">Click to see build & detailed breakdown</div>'}
                </div>
                <div class="result-card__score">
                    <span class="result-card__score-value ${scoreClass}">${scoreValue > 0 ? '+' : ''}${scoreValue.toFixed(1)}</span>
                </div>
            </div>`;
    }).join('');

    // Attach expand listeners
    list.querySelectorAll('.result-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const id = parseInt((card as HTMLElement).dataset.resultId!);
            const current = store.get().expandedResultId;
            store.set('expandedResultId', current === id ? null : id);
        });
    });
  }

  // Global result tab listener for state change
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        const target = (e.currentTarget as HTMLElement).dataset.tab as any;
        store.set('resultsTab', target);
    });
  });

  store.onAny(render);
  render();
}

function renderBans(state: any, list: HTMLElement, title: HTMLElement, badge: HTMLElement): void {
    title.textContent = '🚫 Strategic Bans';
    const suggestions = banAdvisor.getSuggestedBans(state.allyPickIds, state.enemyIds, state.bannedIds, state.priorityHeroIds, state.rankTier, 6);
    const isProtect = suggestions[0]?.phase === 'protect';
    badge.textContent = isProtect ? 'PROTECTIVE' : 'META';
    badge.style.background = isProtect ? 'rgba(34, 197, 94, 0.15)' : 'rgba(99, 102, 241, 0.15)';

    list.innerHTML = suggestions.map((s, i) => `
        <div class="ban-card" style="animation-delay: ${i*40}ms">
            <span class="ban-card__rank">${i+1}</span>
            ${renderAvatar(s.hero, 36)}
            <div class="ban-card__info">
                <div class="ban-card__name">${s.hero.name} <span class="result-card__tier tier--${s.hero.tier.toLowerCase()}">T${s.hero.tier}</span></div>
                <div class="ban-card__reason">${s.reason}</div>
            </div>
            <div class="ban-card__actions">
                <span class="ban-card__score">${s.score.toFixed(1)}</span>
                <button class="ban-card__btn" onclick="event.stopPropagation(); store.addBan(${s.hero.id})">Ban</button>
            </div>
        </div>`).join('');
}

function renderTeams(state: any, list: HTMLElement, title: HTMLElement, badge: HTMLElement): void {
    title.textContent = '🏆 Optimized Compositions';
    const teams = teamBuilder.buildBalancedTeams(state.enemyIds, [...state.bannedIds, ...state.allyPickIds], 3);
    
    if (teams.length === 0) {
        list.innerHTML = '<div class="no-results-text">Form a draft to see team suggestions</div>';
        return;
    }

    const currentSet = state.activeTeamSet % teams.length;
    const team = teams[currentSet];
    badge.textContent = `Total: +${team.totalScore.toFixed(1)}`;

    let html = `
        <div class="set-tabs">
            ${teams.map((_, i) => `
                <button class="set-tab ${i === currentSet ? 'set-tab--active' : ''}" onclick="event.stopPropagation(); store.set('activeTeamSet', ${i})">
                    Set ${i+1} <small>(+${teams[i].totalScore.toFixed(0)})</small>
                </button>
            `).join('')}
        </div>
        <div class="team-slots">
            ${team.slots.map((s, i) => `
                <div class="team-slot" style="animation-delay: ${i*50}ms">
                    <div class="team-slot__pos team-slot__pos--${s.position}">${s.position.toUpperCase()}</div>
                    ${renderAvatar(s.hero, 36)}
                    <div class="team-slot__info">
                        <div class="team-slot__name">${s.hero.name}</div>
                        <div class="team-slot__roles">${s.hero.roles.join(' • ')}</div>
                    </div>
                    <div class="team-slot__score">+${s.score.toFixed(1)}</div>
                </div>
            `).join('')}
        </div>
    `;
    list.innerHTML = html;
}
