import { store } from '../state';
import { loader, renderAvatar } from '../app';

export function initDraftBar(): void {
  const bar = document.getElementById('draft-bar')!;
  const allyBanSlots = document.getElementById('ally-ban-slots')!;
  const enemyBanSlots = document.getElementById('enemy-ban-slots')!;
  const allySlots = document.getElementById('ally-slots')!;
  const phaseIndicator = document.getElementById('draft-phase-indicator')!;
  const sideBtn = document.getElementById('toggle-side-btn')!;
  const firstBtn = document.getElementById('toggle-first-btn')!;

  function render(): void {
    const state = store.get();
    if (!state.draftActive) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'flex';

    // 1. Settings & Rank
    sideBtn.textContent = `Side: ${state.draftTeamSide.toUpperCase()}`;
    firstBtn.textContent = `First: ${state.firstPickSide.toUpperCase()}`;
    
    const rankBtn = document.getElementById('toggle-rank-btn')!;
    rankBtn.textContent = `Rank: ${state.rankTier}`;
    rankBtn.className = `role-btn ${state.rankTier === 'MYTHIC' ? 'role-btn--active' : ''}`;
    
    // 2. Phase & Turn
    const phaseNames: Record<string, string> = {
        'ban1': state.rankTier === 'EPIC' ? 'BAN PHASE' : 'BAN PHASE 1', 
        'pick1': state.rankTier === 'EPIC' ? 'PICK PHASE' : 'PICK PHASE 1',
        'ban2': 'BAN PHASE 2', 
        'pick2': 'PICK PHASE 2', 
        'done': 'DRAFT COMPLETE'
    };
    
    // Determine Turn Label
    const isOurTurn = state.tapAction === 'ally_pick' || (state.tapAction === 'ban' && state.draftPhase.startsWith('ban'));
    const turnLabel = state.draftPhase === 'done' ? '' : (isOurTurn ? '• YOUR TURN' : '• ENEMY TURN');
    
    phaseIndicator.textContent = `${phaseNames[state.draftPhase] || 'DRAFT'} ${turnLabel}`;
    phaseIndicator.className = `draft-bar__phase-indicator ${isOurTurn ? 'phase--active' : 'phase--waiting'}`;

    // 3. Slots
    const isEpic = state.rankTier === 'EPIC';
    const renderMini = (ids: number[], type: 'ban' | 'ally') => {
        let html = '';
        const maxSlots = (type === 'ban') ? (isEpic ? 3 : 5) : 5;
        for (let i = 0; i < maxSlots; i++) {
            if (i < ids.length) {
                const h = loader.getHero(ids[i])!;
                html += `<div class="mini-slot mini-slot--${type}">${renderAvatar(h, 24)}</div>`;
            } else {
                html += `<div class="mini-slot mini-slot--empty"></div>`;
            }
        }
        return html;
    };

    const allyBans = state.bannedIds.filter((_, i) => i % 2 === 0);
    const enemyBans = state.bannedIds.filter((_, i) => i % 2 !== 0);
    
    allyBanSlots.innerHTML = renderMini(allyBans, 'ban');
    enemyBanSlots.innerHTML = renderMini(enemyBans, 'ban');
    allySlots.innerHTML = renderMini(state.allyPickIds, 'ally');

    // 4. Tap Actions Sync
    document.querySelectorAll('.tap-btn').forEach(btn => {
        (btn as HTMLElement).classList.toggle('tap-btn--active', (btn as HTMLElement).dataset.action === state.tapAction);
    });

    document.getElementById('draft-undo')!.style.display = state.history.length > 0 ? 'block' : 'none';
  }

  // Bind non-render interactions once
  document.getElementById('toggle-rank-btn')!.addEventListener('click', () => {
      const current = store.get().rankTier;
      store.setRankTier(current === 'MYTHIC' ? 'EPIC' : 'MYTHIC');
  });
  document.getElementById('toggle-side-btn')!.addEventListener('click', () => store.toggleDraftSide());
  document.getElementById('toggle-first-btn')!.addEventListener('click', () => store.toggleFirstPick());
  document.getElementById('draft-reset')!.addEventListener('click', () => store.resetDraft());
  document.getElementById('draft-undo')!.addEventListener('click', () => store.undoLastAction());
  
  document.getElementById('tap-actions')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.tap-btn') as HTMLElement | null;
    if (btn) store.set('tapAction', btn.dataset.action as any);
  });

  store.onAny(render);
  render();
}
