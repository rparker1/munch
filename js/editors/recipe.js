/* ==========================================================================
   Recipe reader — what it is, what you will need, and how to make it.

   Sits beside the other editors rather than inside the view, the same split as
   views/inventory.js and editors/item.js.
   ========================================================================== */

import * as store from '../store.js';
import * as recipe from '../recipe.js';
import { MEALS, PLACES } from '../store.js';
import { esc, plural, qtyLabel, niceDate } from '../util.js';
import { icon } from '../icons.js';
import {
  openSheet, setSheet, closeSheet, toast, confirmSheet,
  field, select, segmented, bindPickers, readForm,
} from '../ui.js';

/**
 * The best in-stock match for a name at a place, or null.
 *
 * meal.js has a bestStockMatch, but it is private to that module. Rather than export
 * it and couple the two editors, this reads the already-exported matchInInventory and
 * filters by place — the place matters, or a work lunch gets matched to the fridge at
 * home.
 */
function stockAt(name, place) {
  return store.matchInInventory(name).find(it => {
    const loc = store.locationOf(it.locId);
    return loc && loc.place === place;
  }) || null;
}

export function openRecipe({ id, after }) {
  const r = store.library().find(l => l.id === id);
  if (!r) return;

  let opened = false;
  const show = (title, body, mount) => {
    const payload = { title, body, mount };
    if (opened) setSheet(payload);
    else { openSheet({ ...payload, dismiss: () => after?.() }); opened = true; }
  };

  function main() {
    // Computed now, against current stock. A recipe kept three weeks ago should not
    // claim you still have the chicken.
    const rows = (r.items || []).map(i => ({ ...i, hit: stockAt(i.name, r.place || 'home') }));
    const inStock = rows.filter(x => x.hit).length;
    const method = r.method || [];
    const kit = recipe.guessEquipment(method);

    const timing = [
      r.totalMin ? `${r.totalMin} min` : '',
      r.prepMin || r.cookMin ? `${r.prepMin || 0} prep / ${r.cookMin || 0} cook` : '',
      r.serves ? `serves ${r.serves}` : '',
      r.cuisine || '',
    ].filter(Boolean).join(' · ');

    const body = `
      <div class="form">
        ${timing ? `<p class="field__hint" style="padding:2px">${esc(timing)}</p>` : ''}

        ${r.sourceName ? `
          <p class="field__hint" style="padding:2px">
            From ${r.sourceUrl
              ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.sourceName)}</a>`
              : esc(r.sourceName)}
          </p>` : ''}

        ${kit.length ? `
          <div class="field">
            <span class="field__label">From the method</span>
            <div class="taglist">${kit.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</div>
            <span class="field__hint">Picked out of the steps below, not stated by the author.</span>
          </div>` : ''}

        <div class="field">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
            <span class="field__label" style="padding:0">Ingredients</span>
            <span class="field__hint" style="padding:0">${inStock} of ${rows.length} in</span>
          </div>
          <div class="rows">
            ${rows.map(x => `
              <div class="row" style="cursor:default">
                <span class="row__main">
                  <span class="row__name">${esc(x.name)}</span>
                  <span class="row__sub">
                    ${esc(qtyLabel(x.qty, x.unit) || 'no amount')} · ${x.hit ? 'in stock' : 'to buy'}
                  </span>
                </span>
              </div>`).join('')}
          </div>
        </div>

        ${method.length ? `
          <div class="field">
            <span class="field__label">Method</span>
            <div class="stack">
              ${method.map((s, i) => `
                <div class="card" style="padding:14px 16px">
                  <span class="field__label" style="padding:0">Step ${i + 1}</span>
                  <p style="font-size:15px;line-height:1.55;margin:6px 0 0">${esc(s)}</p>
                </div>`).join('')}
            </div>
          </div>` : `
          <p class="field__hint" style="padding:2px">
            No method saved — this one was kept before Munch read the whole page.
          </p>`}

        <div class="sheet__foot">
          <button class="btn btn--danger btn--sm" type="button" data-del>${icon('trash')}</button>
          <button class="btn" type="button" data-use>${icon('plan')}Use in a meal</button>
        </div>
      </div>`;

    show(r.name, body, root => {
      root.querySelector('[data-use]').addEventListener('click', usePicker);

      root.querySelector('[data-del]').addEventListener('click', () => {
        confirmSheet({
          title: `Delete ${r.name}?`,
          message: 'It comes out of your recipes. Any meal already planned from it stays as it is.',
          confirmLabel: 'Delete',
          danger: true,
          run() {
            store.removeFromLibrary(r.id);
            after?.();
            toast('Recipe deleted', {
              iconName: 'trash',
              action: { label: 'Undo', run: () => { store.undo(); after?.(); } },
            });
          },
        });
      });
    });
  }

  /* Which day, which meal, and where. The place is not decoration: saveSlot needs one,
     a recipe reached from the collection has no slot to inherit it from, and it decides
     which stores an ingredient can be matched against. */
  function usePicker() {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    });

    const body = `
      <div class="form">
        ${field({ label: 'Which day', control: select({
          name: 'date', value: days[0], options: days.map(d => ({ value: d, label: niceDate(d) })),
        }) })}
        ${field({ label: 'Which meal', control: segmented({
          name: 'mealId', value: r.mealId || 'dinner',
          options: MEALS.map(m => ({ value: m.id, label: m.label })),
        }) })}
        ${field({
          label: 'Home or work',
          hint: 'Decides which stores its ingredients can be matched against.',
          control: segmented({
            name: 'place', value: r.place || 'home',
            options: PLACES.map(p => ({ value: p.id, label: p.label })),
          }),
        })}
        <div class="sheet__foot">
          <button class="btn btn--ghost" type="button" data-back>Back</button>
          <button class="btn" type="button" data-go>${icon('check')}Add to the plan</button>
        </div>
      </div>`;

    show(`Use ${r.name}`, body, root => {
      bindPickers(root);
      root.querySelector('[data-back]').addEventListener('click', main);

      root.querySelector('[data-go]').addEventListener('click', () => {
        const f = readForm(root);
        // Re-matched against stock now, at the place just chosen, rather than carried
        // over from whenever the recipe was saved.
        const items = (r.items || []).map(i => {
          const hit = stockAt(i.name, f.place);
          return {
            id: `ing_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
            name: i.name, qty: i.qty, unit: i.unit, category: i.category,
            source: hit ? 'inv' : 'buy',
            invId: hit ? hit.id : null,
          };
        });

        store.saveSlot(f.date, f.mealId, {
          name: r.name,
          place: f.place,
          items,
          note: r.serves ? `Serves ${r.serves}` : '',
          done: false,
        });

        closeSheet();
        after?.();
        toast(`${r.name} added to ${niceDate(f.date)}`, { iconName: 'check' });
      });
    });
  }

  main();
}
