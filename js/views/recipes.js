/* ==========================================================================
   Recipes — the collection you have kept, and how much of each you could cook
   right now. Importing is what fills it; this is where it becomes browsable.
   ========================================================================== */

import * as store from '../store.js';
import * as recipe from '../recipe.js';
import { esc, plural } from '../util.js';
import { icon } from '../icons.js';
import { emptyState } from '../ui.js';
import { openMealEditor } from '../editors/meal.js';
import { openRecipe } from '../editors/recipe.js';

/* View-local UI state — deliberately not persisted, as in the other views. */
const ui = { query: '' };

export default {
  id: 'recipes',
  label: 'Recipes',
  icon: 'pot',
  title: () => 'Recipes',

  sub() {
    const n = store.library().length;
    return n ? plural(n, 'recipe') : 'Nothing saved yet';
  },

  actions: () => `
    <button class="iconbtn iconbtn--primary" type="button" data-act="import"
      aria-label="Import a recipe">${icon('plus')}</button>`,

  render(root, ctx) {
    const all = store.library();
    const stockNames = store.get().inventory.map(i => i.name);
    const hits = recipe.searchLibrary(ui.query, all, stockNames);

    root.innerHTML = `
      <section class="section">
        <div class="search">
          ${icon('search')}
          <input type="search" placeholder="Search name, ingredient, cuisine or tag"
            value="${esc(ui.query)}" data-q enterkeyhint="search" autocomplete="off">
        </div>
      </section>

      <section class="section">
        ${hits.length ? `
          <div class="rows">${hits.map(row).join('')}</div>` : `
          <div class="card">
            ${emptyState({
              iconName: 'pot',
              title: all.length ? 'Nothing matches' : 'No recipes yet',
              body: all.length
                ? 'Try a different search.'
                : 'Import one from a link, or save a meal you have planned. Anything you keep shows up here.',
              action: all.length ? null : { act: 'import', label: 'Import a recipe' },
            })}
          </div>`}
      </section>`;

    const q = root.querySelector('[data-q]');
    q.addEventListener('input', () => {
      ui.query = q.value;
      const pos = q.selectionStart;
      ctx.refresh();
      const nq = document.querySelector('[data-q]');
      if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
    });

    root.querySelectorAll('[data-open]').forEach(el => {
      el.addEventListener('click', () => openRecipe({ id: el.dataset.open, after: ctx.refresh }));
    });

    root.querySelectorAll('[data-act=import]').forEach(el => {
      el.addEventListener('click', () => this.onAction('import', ctx));
    });
  },

  onAction(act, ctx) {
    if (act !== 'import') return;
    // Import lives in the meal editor's flow, which needs a slot, so this opens today's
    // dinner straight on the import step rather than duplicating the flow. The recipe is
    // saved to the collection either way; the meal is yours to keep or clear.
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    openMealEditor({ date, mealId: 'dinner', after: ctx.refresh, startAt: 'recipe' });
  },
};

function row(h) {
  const r = h.entry;
  const bits = [
    r.totalMin ? `${r.totalMin} min` : '',
    r.serves ? `serves ${r.serves}` : '',
    r.items?.length ? `${h.inStock} of ${h.total} in` : '',
    r.cuisine || '',
  ].filter(Boolean);

  return `
    <button class="row" type="button" data-open="${esc(r.id)}">
      <span class="row__main">
        <span class="row__name">${esc(r.name)}</span>
        <span class="row__sub">${esc(bits.join(' · ')) || 'No details saved'}</span>
      </span>
      <span class="row__tail">${r.method?.length ? icon('pot') : ''}</span>
    </button>`;
}
