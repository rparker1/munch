/* ==========================================================================
   Meal editor sheet.
   A meal is a name, a place (home/work) and a list of ingredients. Each
   ingredient either draws on something already in the inventory or is flagged
   to buy — which is what puts it on the shopping list.
   ========================================================================== */

import * as store from '../store.js';
import { MEALS, CATEGORIES, UNITS, PLACES, catOf, mealOf, placeOf } from '../store.js';
import { esc, num, qtyLabel, niceDate, titleCase, normName, expiryInfo, initials, plural } from '../util.js';
import { icon } from '../icons.js';
import {
  openSheet, setSheet, closeSheet, toast, confirmSheet,
  field, textInput, textArea, select, segmented, chipGroup, bindPickers, readForm, emptyState,
} from '../ui.js';

const unitOptions = ['', ...UNITS].map(u => ({ value: u, label: u || 'no unit' }));
const catOptions  = CATEGORIES.map(c => ({ id: c.id, label: c.label }));

/** Open the editor for one slot. `after` runs on any change so views refresh. */
export function openMealEditor({ date, mealId, after }) {
  const meal = mealOf(mealId);
  const existing = store.slot(date, mealId);

  const draft = existing
    ? structuredClone(existing)
    : { name: '', place: 'home', items: [], note: '', done: false };

  let opened = false;

  const show = (title, body, mount) => {
    const payload = { title, body, mount };
    if (opened) setSheet(payload);
    else { openSheet({ ...payload, dismiss: () => after?.() }); opened = true; }
  };

  /* ---------------------------------------------------------------- main -- */

  function main() {
    const lib = store.library(mealId).filter(l => normName(l.name) !== normName(draft.name));

    // Ingredients assigned from stock that physically live at the other place.
    const mismatched = [];
    for (const i of draft.items) {
      if (i.source !== 'inv' || !i.invId) continue;
      const it = store.invItem(i.invId);
      const loc = it ? store.locationOf(it.locId) : null;
      if (loc && loc.place !== draft.place) mismatched.push({ ing: i, loc });
    }
    const strandedAt = mismatched.length ? placeOf(mismatched[0].loc.place).label.toLowerCase() : '';

    const body = `
      <div class="form">
        ${field({
          label: 'What are you having?',
          control: textInput({ name: 'name', value: draft.name, placeholder: `${meal.label} — e.g. chicken traybake`, autofocus: !existing }),
        })}

        ${field({
          label: 'Where',
          hint: 'Home or work decides which stores you should be pulling from.',
          control: segmented({
            name: 'place', value: draft.place,
            options: PLACES.map(p => ({ value: p.id, label: p.label })),
          }),
        })}

        ${lib.length ? `
          <div class="field">
            <span class="field__label">Reuse a saved meal</span>
            <div class="hstrip" style="margin:0;padding:2px 0">
              ${lib.slice(0, 12).map(l => `
                <button type="button" class="chip" data-lib="${esc(l.id)}">
                  ${icon('copy')}&nbsp;${esc(l.name)}
                </button>`).join('')}
            </div>
          </div>` : ''}

        <div class="divider" style="margin:6px 4px"></div>

        <div class="field">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
            <span class="field__label" style="padding:0">Ingredients</span>
            <span class="field__hint" style="padding:0">${draft.items.length
              ? `${countInv()} from stock · ${countBuy()} to buy`
              : 'none yet'}</span>
          </div>
          ${draft.items.length ? `
            <div class="taglist" style="margin-top:4px">
              ${draft.items.map(tag).join('')}
            </div>` : `
            <p class="field__hint" style="padding:2px">
              Assign what you already have in, and flag anything missing so it lands on the shopping list.
            </p>`}
        </div>

        <div class="grid2">
          <button class="btn btn--ghost btn--sm" type="button" data-step="inv">${icon('fridge')}From stock</button>
          <button class="btn btn--ghost btn--sm" type="button" data-step="buy">${icon('cart')}To buy</button>
        </div>

        ${mismatched.length ? `
          <div class="hintbar">
            ${icon('alert')}
            <span>${plural(mismatched.length, 'ingredient')} ${mismatched.length === 1 ? 'is' : 'are'} kept at
            ${esc(strandedAt)} but this meal is set for ${esc(placeOf(draft.place).label.toLowerCase())} —
            take ${mismatched.length === 1 ? 'it' : 'them'} with you or swap ${mismatched.length === 1 ? 'it' : 'them'} out.</span>
          </div>` : ''}

        ${field({ label: 'Notes', control: textArea({ name: 'note', value: draft.note, placeholder: 'Cooking times, who it is for, anything else.' }) })}

        <div class="sheet__foot">
          ${existing ? `<button class="btn btn--danger btn--sm" type="button" data-del>${icon('trash')}</button>` : ''}
          <button class="btn" type="button" data-save>${icon('check')}${existing ? 'Save meal' : 'Add meal'}</button>
        </div>

        ${existing ? `
          <div class="stack" style="margin-top:12px">
            <div class="grid2">
              <button class="btn btn--ghost btn--sm" type="button" data-lib-save>
                ${icon('spark')}Save meal
              </button>
              <button class="btn btn--ghost btn--sm" type="button" data-copy>
                ${icon('copy')}Copy to…
              </button>
            </div>
            <button class="btn btn--ghost btn--sm btn--block" type="button" data-cook>
              ${draft.done ? `${icon('undo')}Mark as not eaten` : `${icon('flame')}Ate this — take it out of stock`}
            </button>
          </div>` : ''}
      </div>`;

    show(`${meal.label} · ${niceDate(date)}`, body, root => {
      bindPickers(root);

      root.querySelector('[name=name]').addEventListener('input', e => { draft.name = e.target.value; });
      root.querySelector('[name=note]').addEventListener('input', e => { draft.note = e.target.value; });
      root.querySelector('[data-segmented=place]').addEventListener('pick', e => {
        draft.place = e.detail;
        main();
      });

      root.querySelectorAll('[data-lib]').forEach(btn => {
        btn.addEventListener('click', () => applyLibrary(btn.dataset.lib));
      });

      root.querySelectorAll('[data-step]').forEach(btn => {
        btn.addEventListener('click', () => (btn.dataset.step === 'inv' ? fromStock() : toBuy()));
      });

      root.querySelectorAll('[data-tag-edit]').forEach(btn => {
        btn.addEventListener('click', () => editIngredient(btn.dataset.tagEdit));
      });
      root.querySelectorAll('[data-tag-x]').forEach(btn => {
        btn.addEventListener('click', () => {
          draft.items = draft.items.filter(i => i.id !== btn.dataset.tagX);
          main();
        });
      });

      root.querySelector('[data-save]').addEventListener('click', save);

      root.querySelector('[data-del]')?.addEventListener('click', () => {
        confirmSheet({
          title: 'Clear this meal?',
          message: `${meal.label} on ${niceDate(date)} will be removed from the plan. Anything it put on the shopping list goes too.`,
          confirmLabel: 'Clear meal',
          danger: true,
          run() {
            store.clearSlot(date, mealId);
            after?.();
            toast('Meal cleared', { iconName: 'trash', action: { label: 'Undo', run: () => { store.undo(); after?.(); } } });
          },
        });
      });

      root.querySelector('[data-lib-save]')?.addEventListener('click', () => {
        const form = readForm(root);
        store.saveToLibrary(mealId, { ...draft, name: form.name || draft.name });
        toast('Saved to my meals', { iconName: 'spark' });
      });

      root.querySelector('[data-copy]')?.addEventListener('click', () => {
        commitDraft();               // copy what is on screen, not what was last saved
        after?.();
        openCopySheet({ date, mealId, after });
      });

      root.querySelector('[data-cook]')?.addEventListener('click', () => {
        if (draft.done) {
          store.uncookSlot(date, mealId);
          draft.done = false;
          after?.();
          main();
          return;
        }
        commitDraft();
        const res = store.cookSlot(date, mealId);
        after?.();
        closeSheet();
        const n = res?.used.length || 0;
        toast(n ? `Logged — ${plural(n, 'item')} drawn from stock` : 'Logged as eaten', {
          iconName: 'flame',
          action: { label: 'Undo', run: () => { store.undo(); after?.(); } },
        });
      });
    });
  }

  const countInv = () => draft.items.filter(i => i.source === 'inv').length;
  const countBuy = () => draft.items.filter(i => i.source === 'buy').length;

  function tag(i) {
    const cls = i.source === 'inv' ? 'tag--inv' : 'tag--buy';
    const q = qtyLabel(i.qty, i.unit);
    return `
      <span class="tag ${cls}">
        <button type="button" data-tag-edit="${esc(i.id)}"
          style="border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer">
          ${esc(i.name)}${q ? ` <span class="tnum" style="opacity:.7">${esc(q)}</span>` : ''}
        </button>
        <button type="button" class="tag__x" data-tag-x="${esc(i.id)}" aria-label="Remove ${esc(i.name)}">
          ${icon('x')}
        </button>
      </span>`;
  }

  /** Copy the current form values onto the draft, then write it to the store. */
  function commitDraft() {
    store.saveSlot(date, mealId, draft);
  }

  function save() {
    const root = document.querySelector('#sheetBody');
    const form = readForm(root);
    draft.name = form.name || draft.name;
    draft.note = form.note || '';
    draft.place = form.place || draft.place;
    if (!draft.name.trim()) draft.name = meal.label;
    commitDraft();
    after?.();
    closeSheet();
    const buys = countBuy();
    toast(buys ? `${meal.label} planned · ${plural(buys, 'item')} added to the list` : `${meal.label} planned`, {
      iconName: 'check',
    });
  }

  function applyLibrary(libId) {
    const entry = store.library().find(l => l.id === libId);
    if (!entry) return;
    draft.name = entry.name;
    draft.place = entry.place || draft.place;
    draft.items = entry.items.map(i => {
      // Prefer stock we already hold, at the right place, over buying again.
      const hit = bestStockMatch(i.name, entry.place || draft.place);
      return {
        id: newId(),
        name: i.name,
        qty: i.qty ?? null,
        unit: i.unit || '',
        category: i.category || 'other',
        source: hit ? 'inv' : 'buy',
        invId: hit?.id || null,
      };
    });
    main();
    toast(`Loaded “${entry.name}”`, { iconName: 'copy' });
  }

  function bestStockMatch(name, place) {
    const q = normName(name);
    const hits = store.get().inventory.filter(i => normName(i.name) === q);
    if (!hits.length) return null;
    return hits.find(i => store.locationOf(i.locId)?.place === place) || hits[0];
  }

  /* ------------------------------------------------------- from stock -- */

  function fromStock() {
    const chosen = new Map(); // invId -> qty string
    let query = '';
    let placeFilter = draft.place;

    const render = () => {
      const rows = store.inventory({ query, place: placeFilter || null });
      const already = new Set(draft.items.filter(i => i.invId).map(i => i.invId));

      const body = `
        <div class="form">
          <div class="search">
            ${icon('search')}
            <input type="search" placeholder="Search what you have in" value="${esc(query)}" data-q>
          </div>

          ${segmented({
            name: 'placeFilter', value: placeFilter,
            options: [...PLACES.map(p => ({ value: p.id, label: p.label })), { value: '', label: 'All' }],
          })}

          ${rows.length ? `
            <div class="picker">
              ${rows.map(it => {
                const loc = store.locationOf(it.locId);
                const ex = expiryInfo(it.useBy);
                const on = chosen.has(it.id);
                const dup = already.has(it.id);
                return `
                  <div class="pickrow" role="button" tabindex="0" data-pick="${esc(it.id)}" aria-pressed="${on}">
                    <span class="row__lead">${esc(initials(it.name))}</span>
                    <span class="pickrow__main">
                      <span class="pickrow__name">${esc(it.name)}</span>
                      <span class="pickrow__sub">
                        ${esc(qtyLabel(it.qty, it.unit) || '—')} · ${esc(loc ? store.locationLabel(loc.id) : 'Unassigned')}
                        ${ex ? ` · <span style="color:var(--${ex.tone === 'bad' ? 'bad' : ex.tone === 'warn' ? 'warn' : 'ink-3'})">${esc(ex.label)}</span>` : ''}
                        ${dup ? ' · already on this meal' : ''}
                      </span>
                    </span>
                    ${on ? `
                      <input class="input" style="width:86px;min-height:38px;padding:6px 8px;text-align:right"
                        type="text" inputmode="decimal" value="${esc(chosen.get(it.id))}"
                        data-qty="${esc(it.id)}" aria-label="Amount of ${esc(it.name)}">
                      <span style="font-size:12px;color:var(--ink-3);width:30px">${esc(it.unit || '')}</span>
                    ` : `<span class="row__tail">${icon('plus')}</span>`}
                  </div>`;
              }).join('')}
            </div>` : emptyState({
              iconName: 'fridge',
              title: 'Nothing matches',
              body: query ? 'No stock matches that search. Add it as something to buy instead.' : 'This place has no stock recorded yet.',
            })}

          <div class="sheet__foot">
            <button class="btn btn--ghost" type="button" data-back>Back</button>
            <button class="btn" type="button" data-add ${chosen.size ? '' : 'disabled'}>
              ${icon('check')}Add ${chosen.size || ''}
            </button>
          </div>
        </div>`;

      show('Assign from stock', body, root => {
        bindPickers(root);

        const q = root.querySelector('[data-q]');
        q.addEventListener('input', () => {
          query = q.value;
          const pos = q.selectionStart;
          render();
          const nq = document.querySelector('[data-q]');
          nq.focus();
          nq.setSelectionRange(pos, pos);
        });

        root.querySelector('[data-segmented=placeFilter]').addEventListener('pick', e => {
          placeFilter = e.detail;
          render();
        });

        const togglePick = id => {
          if (chosen.has(id)) chosen.delete(id);
          else {
            const it = store.invItem(id);
            chosen.set(id, it?.qty != null ? num(it.qty) : '');
          }
          render();
        };

        root.querySelectorAll('[data-pick]').forEach(el => {
          el.addEventListener('click', e => {
            if (e.target.closest('[data-qty]')) return; // let the qty field take the tap
            togglePick(el.dataset.pick);
          });
          el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePick(el.dataset.pick); }
          });
        });

        root.querySelectorAll('[data-qty]').forEach(inp => {
          inp.addEventListener('input', () => chosen.set(inp.dataset.qty, inp.value));
          inp.addEventListener('click', e => e.stopPropagation());
        });

        root.querySelector('[data-back]').addEventListener('click', main);
        root.querySelector('[data-add]').addEventListener('click', () => {
          for (const [id, qty] of chosen) {
            const it = store.invItem(id);
            if (!it) continue;
            const existingIng = draft.items.find(i => i.invId === id);
            if (existingIng) { existingIng.qty = qty === '' ? null : Number(qty); continue; }
            draft.items.push({
              id: newId(),
              name: it.name,
              qty: qty === '' ? null : Number(qty),
              unit: it.unit || '',
              category: it.category,
              source: 'inv',
              invId: it.id,
            });
          }
          main();
        });
      });
    };

    render();
  }

  /* ----------------------------------------------------------- to buy -- */

  function toBuy() {
    const body = `
      <div class="form">
        <div class="hintbar hintbar--info">
          ${icon('info')}
          <span>Anything added here shows up on the shopping list, grouped with the rest of the aisle.</span>
        </div>

        ${field({ label: 'Item', control: textInput({ name: 'name', placeholder: 'e.g. new potatoes', autofocus: true }) })}

        <div class="grid-qty">
          ${field({ label: 'Amount', control: textInput({ name: 'qty', placeholder: 'e.g. 500', attrs: 'inputmode="decimal"' }) })}
          ${field({ label: 'Unit', control: select({ name: 'unit', value: 'g', options: unitOptions }) })}
        </div>

        ${field({ label: 'Aisle', control: chipGroup({ name: 'category', value: 'produce', options: catOptions }) })}

        <div class="sheet__foot">
          <button class="btn btn--ghost" type="button" data-back>Back</button>
          <button class="btn" type="button" data-add>${icon('plus')}Add</button>
        </div>
      </div>`;

    show('Add to buy', body, root => {
      bindPickers(root);

      const add = ({ keepOpen }) => {
        const f = readForm(root);
        if (!f.name) { root.querySelector('[name=name]').focus(); return; }
        draft.items.push({
          id: newId(),
          name: titleCase(f.name),
          qty: f.qty === '' ? null : Number(f.qty),
          unit: f.unit || '',
          category: f.category || 'other',
          source: 'buy',
          invId: null,
        });
        if (keepOpen) {
          const nameEl = root.querySelector('[name=name]');
          const qtyEl = root.querySelector('[name=qty]');
          nameEl.value = ''; qtyEl.value = '';
          nameEl.focus();
          toast(`${draft.items.length} on this meal`, { iconName: 'check', ms: 1600 });
        } else {
          main();
        }
      };

      root.querySelector('[data-add]').addEventListener('click', () => add({ keepOpen: false }));
      root.querySelector('[data-back]').addEventListener('click', main);
      root.querySelector('[name=name]').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); add({ keepOpen: true }); }
      });
    });
  }

  /* ------------------------------------------------ edit one ingredient -- */

  function editIngredient(id) {
    const ing = draft.items.find(i => i.id === id);
    if (!ing) return main();

    const stockHit = ing.invId ? store.invItem(ing.invId) : bestStockMatch(ing.name, draft.place);
    const canStock = !!stockHit;

    const body = `
      <div class="form">
        ${field({ label: 'Item', control: textInput({ name: 'name', value: ing.name }) })}

        <div class="grid-qty">
          ${field({ label: 'Amount', control: textInput({ name: 'qty', value: ing.qty == null ? '' : num(ing.qty), attrs: 'inputmode="decimal"' }) })}
          ${field({ label: 'Unit', control: select({ name: 'unit', value: ing.unit, options: unitOptions }) })}
        </div>

        ${field({
          label: 'Where it comes from',
          hint: canStock
            ? `In stock: ${qtyLabel(stockHit.qty, stockHit.unit) || 'quantity unknown'} at ${store.locationLabel(stockHit.locId)}.`
            : 'Nothing matching this name is in stock, so it stays on the shopping list.',
          control: segmented({
            name: 'source', value: canStock ? ing.source : 'buy',
            options: [
              { value: 'inv', label: 'From stock' },
              { value: 'buy', label: 'Buy it' },
            ],
          }),
        })}

        ${field({ label: 'Aisle', control: chipGroup({ name: 'category', value: ing.category, options: catOptions }) })}

        <div class="sheet__foot">
          <button class="btn btn--danger btn--sm" type="button" data-rm>${icon('trash')}</button>
          <button class="btn" type="button" data-ok>${icon('check')}Done</button>
        </div>
      </div>`;

    show('Ingredient', body, root => {
      bindPickers(root);
      if (!canStock) {
        root.querySelector('[data-segmented=source] [data-opt=inv]').disabled = true;
      }
      root.querySelector('[data-rm]').addEventListener('click', () => {
        draft.items = draft.items.filter(i => i.id !== id);
        main();
      });
      root.querySelector('[data-ok]').addEventListener('click', () => {
        const f = readForm(root);
        ing.name = titleCase(f.name || ing.name);
        ing.qty = f.qty === '' ? null : Number(f.qty);
        ing.unit = f.unit || '';
        ing.category = f.category || 'other';
        ing.source = canStock && f.source === 'inv' ? 'inv' : 'buy';
        ing.invId = ing.source === 'inv' ? stockHit.id : null;
        main();
      });
    });
  }

  main();
}

function newId() {
  return `ing_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Small helper used by the plan view's "copy to…" action. */
export function openCopySheet({ date, mealId, after }) {
  const src = store.slot(date, mealId);
  if (!src) return;
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });

  openSheet({
    title: `Copy “${src.name}”`,
    body: `
      <div class="form">
        ${field({ label: 'To which day', control: select({ name: 'date', value: days[1], options: days.map(d => ({ value: d, label: niceDate(d) })) }) })}
        ${field({ label: 'Which meal', control: segmented({ name: 'mealId', value: mealId, options: MEALS.map(m => ({ value: m.id, label: m.label })) }) })}
        <div class="sheet__foot">
          <button class="btn btn--ghost" type="button" data-close>Cancel</button>
          <button class="btn" type="button" data-go>${icon('copy')}Copy</button>
        </div>
      </div>`,
    mount(root) {
      bindPickers(root);
      root.querySelector('[data-go]').addEventListener('click', () => {
        const f = readForm(root);
        store.copySlot({ date, mealId }, { date: f.date, mealId: f.mealId });
        closeSheet();
        after?.();
        toast(`Copied to ${niceDate(f.date)}`, { iconName: 'copy' });
      });
    },
  });
}
