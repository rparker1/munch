/* ==========================================================================
   Shopping-list editors: add/edit a manual line, and put a bought line away
   into the inventory.
   ========================================================================== */

import * as store from '../store.js';
import { CATEGORIES, UNITS, PLACES } from '../store.js';
import { esc, num, today, addDays, niceDate, qtyLabel, plural } from '../util.js';
import { icon } from '../icons.js';
import {
  openSheet, closeSheet, toast, confirmSheet,
  field, textInput, textArea, select, segmented, chipGroup, bindPickers, readForm,
} from '../ui.js';

const unitOptions = ['', ...UNITS].map(u => ({ value: u, label: u || 'no unit' }));
const catOptions  = CATEGORIES.map(c => ({ id: c.id, label: c.label }));

/* --- add / edit a manual line ------------------------------------------- */

export function openShopEditor({ id = null, after }) {
  const line = id ? store.get().shopping.find(s => s.id === id) : null;
  const start = line || { name: '', qty: '', unit: '', category: 'produce', note: '' };

  openSheet({
    title: line ? line.name : 'Add to list',
    body: `
      <div class="form">
        ${field({ control: textInput({ name: 'name', value: start.name, placeholder: 'What do you need?', autofocus: !line }) })}

        <div class="grid-qty">
          ${field({ label: 'Amount', control: textInput({ name: 'qty', value: start.qty == null ? '' : num(start.qty), placeholder: 'optional', attrs: 'inputmode="decimal"' }) })}
          ${field({ label: 'Unit', control: select({ name: 'unit', value: start.unit, options: unitOptions }) })}
        </div>

        ${field({ label: 'Aisle', control: chipGroup({ name: 'category', value: start.category, options: catOptions }) })}
        ${field({ label: 'Notes', control: textArea({ name: 'note', value: start.note || '', placeholder: 'Brand, size, which shop…' }) })}

        <div class="sheet__foot">
          ${line ? `<button class="btn btn--danger btn--sm" type="button" data-del>${icon('trash')}</button>` : ''}
          <button class="btn" type="button" data-save>${icon('check')}${line ? 'Save' : 'Add'}</button>
        </div>
      </div>`,
    mount(root) {
      bindPickers(root);

      const commit = ({ keepOpen }) => {
        const f = readForm(root);
        if (!f.name) { root.querySelector('[name=name]').focus(); return; }
        if (line) store.updateShopItem(line.id, { ...f, qty: f.qty === '' ? null : Number(f.qty) });
        else store.addShopItem(f);
        after?.();
        if (keepOpen) {
          root.querySelector('[name=name]').value = '';
          root.querySelector('[name=qty]').value = '';
          root.querySelector('[name=name]').focus();
          toast(`${f.name} added`, { iconName: 'plus', ms: 1500 });
        } else {
          closeSheet();
          toast(line ? 'List updated' : `${f.name} added to the list`, { iconName: 'check' });
        }
      };

      root.querySelector('[data-save]').addEventListener('click', () => commit({ keepOpen: false }));
      root.querySelector('[name=name]').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit({ keepOpen: !line }); }
      });

      root.querySelector('[data-del]')?.addEventListener('click', () => {
        store.removeShopItem(line.id);
        closeSheet();
        after?.();
        toast('Removed from the list', { iconName: 'trash' });
      });
    },
  });
}

/* --- inspect one line --------------------------------------------------- */

export function openLinePeek({ line, after }) {
  const already = store.matchInInventory(line.name);

  openSheet({
    title: line.name,
    body: `
      <div class="form">
        <div class="rows">
          <div class="row" style="cursor:default">
            <span class="row__lead">${icon('box')}</span>
            <span class="row__main">
              <span class="row__name">${esc(qtyLabel(line.qty, line.unit) || 'No amount set')}</span>
              <span class="row__sub">${esc(store.catOf(line.category).label)}</span>
            </span>
          </div>
          ${line.refs.length ? line.refs.map(r => `
            <div class="row" style="cursor:default">
              <span class="row__lead">${icon('plan')}</span>
              <span class="row__main">
                <span class="row__name">${esc(r.slotName || r.mealLabel)}</span>
                <span class="row__sub">${esc(niceDate(r.date))} · ${esc(r.mealLabel)}</span>
              </span>
            </div>`).join('') : `
            <div class="row" style="cursor:default">
              <span class="row__lead">${icon('plus')}</span>
              <span class="row__main">
                <span class="row__name">Added by hand</span>
                <span class="row__sub">Not tied to a planned meal</span>
              </span>
            </div>`}
        </div>

        ${line.note ? `<p class="field__hint">${esc(line.note)}</p>` : ''}

        ${already.length ? `
          <div class="hintbar">
            ${icon('alert')}
            <span>You may already have this — ${esc(already.map(i => `${qtyLabel(i.qty, i.unit) || 'some'} at ${store.locationLabel(i.locId)}`).join(', '))}.</span>
          </div>` : ''}

        <div class="stack">
          <button class="btn btn--block" type="button" data-stock>${icon('fridge')}Bought it — put it away</button>
          ${line.kind === 'manual'
            ? `<button class="btn btn--ghost btn--block" type="button" data-edit>${icon('pencil')}Edit this line</button>`
            : `<p class="field__hint" style="text-align:center">This line comes from your meal plan. Edit the meal to change it.</p>`}
          <button class="btn btn--ghost btn--block" type="button" data-toggle>
            ${line.done ? `${icon('undo')}Put back on the list` : `${icon('check')}Tick off`}
          </button>
        </div>
      </div>`,
    mount(root) {
      root.querySelector('[data-stock]').addEventListener('click', () => {
        closeSheet();
        setTimeout(() => openStockUp({ line, after }), 200);
      });
      root.querySelector('[data-edit]')?.addEventListener('click', () => {
        closeSheet();
        setTimeout(() => openShopEditor({ id: line.id, after }), 200);
      });
      root.querySelector('[data-toggle]').addEventListener('click', () => {
        store.toggleLine(line);
        closeSheet();
        after?.();
      });
    },
  });
}

/* --- bought it, put it away -------------------------------------------- */

export function openStockUp({ line, after }) {
  const locs = store.locations();
  const startPlace = 'home';
  const locOptionsFor = place => store.locationsFor(place).map(l => ({ id: l.id, label: l.label }));

  openSheet({
    title: `Put away ${line.name}`,
    body: `
      <div class="form">
        <div class="grid-qty">
          ${field({ label: 'Amount', control: textInput({ name: 'qty', value: line.qty == null ? '' : num(line.qty), attrs: 'inputmode="decimal"' }) })}
          ${field({ label: 'Unit', control: select({ name: 'unit', value: line.unit || 'pcs', options: unitOptions.slice(1) }) })}
        </div>

        ${field({
          label: 'Where does it go',
          control: `
            ${segmented({ name: 'place', value: startPlace, options: PLACES.map(p => ({ value: p.id, label: p.label })) })}
            <div style="margin-top:8px" data-locwrap>
              ${chipGroup({ name: 'locId', value: locOptionsFor(startPlace)[0]?.id, options: locOptionsFor(startPlace) })}
            </div>`,
        })}

        ${field({
          label: 'Use by',
          control: `
            ${textInput({ name: 'useBy', value: '', type: 'date' })}
            <div class="hstrip" style="margin:8px 0 0;padding:0">
              ${[['3 days', 3], ['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['6 months', 180]]
                .map(([l, d]) => `<button type="button" class="chip" data-quick="${d}">${esc(l)}</button>`).join('')}
            </div>`,
          hint: 'Leave blank for cupboard staples.',
        })}

        ${field({ label: 'Aisle', control: chipGroup({ name: 'category', value: line.category, options: catOptions }) })}

        <div class="sheet__foot">
          <button class="btn btn--ghost" type="button" data-close>Cancel</button>
          <button class="btn" type="button" data-go>${icon('check')}Put away</button>
        </div>
      </div>`,
    mount(root) {
      bindPickers(root);

      root.querySelector('[data-segmented=place]').addEventListener('pick', e => {
        const opts = locOptionsFor(e.detail);
        const wrap = root.querySelector('[data-locwrap]');
        wrap.innerHTML = chipGroup({ name: 'locId', value: opts[0]?.id, options: opts });
        bindPickers(wrap);
      });

      root.querySelectorAll('[data-quick]').forEach(btn => {
        btn.addEventListener('click', () => {
          root.querySelector('[name=useBy]').value = addDays(today(), Number(btn.dataset.quick));
        });
      });

      root.querySelector('[data-go]').addEventListener('click', () => {
        const f = readForm(root);
        store.stockUp(
          { ...line, qty: f.qty === '' ? null : Number(f.qty), unit: f.unit },
          { locId: f.locId || locs[0]?.id, useBy: f.useBy, category: f.category },
        );
        closeSheet();
        after?.();
        toast(`${line.name} → ${store.locationLabel(f.locId)}`, { iconName: 'fridge' });
      });
    },
  });
}

/* --- bulk: put every ticked line away ---------------------------------- */

export function openPutAwayAll({ after }) {
  const ticked = store.shoppingList().all.filter(l => l.done);
  if (!ticked.length) {
    toast('Nothing is ticked off yet');
    return;
  }

  const locOptionsFor = place => store.locationsFor(place).map(l => ({ id: l.id, label: l.label }));

  openSheet({
    title: `Put away ${plural(ticked.length, 'item')}`,
    body: `
      <div class="form">
        <p class="field__hint" style="padding:0">
          Everything ticked goes into one place with the same use-by. Fine for a single shop —
          adjust individual items afterwards if you need to.
        </p>

        ${field({
          label: 'Where',
          control: `
            ${segmented({ name: 'place', value: 'home', options: PLACES.map(p => ({ value: p.id, label: p.label })) })}
            <div style="margin-top:8px" data-locwrap>
              ${chipGroup({ name: 'locId', value: locOptionsFor('home')[0]?.id, options: locOptionsFor('home') })}
            </div>`,
        })}

        ${field({
          label: 'Use by',
          control: `
            ${textInput({ name: 'useBy', value: '', type: 'date' })}
            <div class="hstrip" style="margin:8px 0 0;padding:0">
              ${[['3 days', 3], ['1 week', 7], ['1 month', 30]]
                .map(([l, d]) => `<button type="button" class="chip" data-quick="${d}">${esc(l)}</button>`).join('')}
            </div>`,
          hint: 'Blank is fine — you can add dates per item later.',
        })}

        <div class="taglist">
          ${ticked.map(l => `<span class="tag">${esc(l.name)}</span>`).join('')}
        </div>

        <div class="sheet__foot">
          <button class="btn btn--ghost" type="button" data-close>Cancel</button>
          <button class="btn" type="button" data-go>${icon('fridge')}Put away</button>
        </div>
      </div>`,
    mount(root) {
      bindPickers(root);

      root.querySelector('[data-segmented=place]').addEventListener('pick', e => {
        const opts = locOptionsFor(e.detail);
        const wrap = root.querySelector('[data-locwrap]');
        wrap.innerHTML = chipGroup({ name: 'locId', value: opts[0]?.id, options: opts });
        bindPickers(wrap);
      });

      root.querySelectorAll('[data-quick]').forEach(btn => {
        btn.addEventListener('click', () => {
          root.querySelector('[name=useBy]').value = addDays(today(), Number(btn.dataset.quick));
        });
      });

      root.querySelector('[data-go]').addEventListener('click', () => {
        const f = readForm(root);
        store.snapshot('Shopping put away');
        for (const l of ticked) {
          store.stockUp(l, { locId: f.locId, useBy: f.useBy, category: l.category });
        }
        closeSheet();
        after?.();
        toast(`${plural(ticked.length, 'item')} put away`, {
          iconName: 'fridge',
          action: { label: 'Undo', run: () => { store.undo(); after?.(); } },
        });
      });
    },
  });
}
