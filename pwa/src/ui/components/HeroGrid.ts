import { store } from '../state';
import { loader, renderAvatar } from '../app';

export function initHeroGrid(): void {
  const grid = document.getElementById('hero-grid')!;

  function render(): void {
    const state = store.get();
    const prioritySet = new Set(state.priorityHeroIds);
    
    // Fix: Only lock draft heroes if Draft Mode is actually active
    const unavailable = state.draftActive 
        ? new Set([...state.enemyIds, ...state.bannedIds, ...state.allyPickIds])
        : new Set(state.enemyIds);
    
    let heroes = loader.getAllHeroes().sort((a, b) => a.name.localeCompare(b.name));
    if (state.searchQuery) heroes = heroes.filter(h => h.name.toLowerCase().includes(state.searchQuery));
    if (state.roleFilter) heroes = heroes.filter(h => h.roles.includes(state.roleFilter!));

    grid.innerHTML = heroes.map(h => {
      const isPriority = prioritySet.has(h.id);
      const isOff = unavailable.has(h.id);
      const isBanned = state.bannedIds.includes(h.id);
      
      let cls = 'hero-card';
      if (isOff) cls += isBanned ? ' hero-card--banned' : ' hero-card--disabled';
      if (isPriority) cls += ' hero-card--priority';

      return `
        <div class="${cls}" data-hero-id="${h.id}">
          <span class="hero-card__tier tier--${h.tier.toLowerCase()}">${h.tier}</span>
          ${renderAvatar(h, 48)}
          <span class="hero-card__name">${h.name}</span>
          ${isPriority ? '<span class="hero-card__priority-star">⭐</span>' : ''}
          <div class="priority-toggle" data-priority-id="${h.id}" title="Star as priority pick">⭐</div>
        </div>`;
    }).join('');

    // Re-bind listeners after each render to keep it atomic
    grid.querySelectorAll('.hero-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const pBtn = target.closest('.priority-toggle');
            const id = parseInt((card as HTMLElement).dataset.heroId!);

            if (pBtn) {
                e.stopPropagation();
                store.togglePriorityHero(id);
            } else if (!card.classList.contains('hero-card--disabled') && !card.classList.contains('hero-card--banned')) {
                if (store.get().draftActive) store.draftTap(id);
                else store.toggleEnemy(id);
            }
        });
    });
  }

  store.onAny(render);
  render();
}
