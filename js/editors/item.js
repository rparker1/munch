/* ==========================================================================
   Inventory item editor — name, amount, aisle, where it lives, use-by.
   ========================================================================== */

import * as store from '../store.js';
import { CATEGORIES, UNITS, PLACES } from '../store.js';
import { esc, num, today, addDays, niceDate, expiryInfo, qtyLabel } from '../util.js';
import { icon } from '../icons.js';
import {
  openSheet, closeSheet, toast, confirmSheet,
  field, textInput, textArea, select, segmented, chipGroup, bindPickers, readForm,
} from '../ui.js';

const unitOptions = UNITS.map(u => ({ value: u, label: u }));
const catOptions  = CATEGORIES.map(c => ({ id: c.id, label: c.label }));

const QUICK_DATES = [
  { days: 1,  label: 'Tomorrow' },
  { days: 3,  label: '3 days' },
  { days: 7,  label: '1 week' },
  { days: 30, label: '1 month' },
  { days: 180,label: '6 months' },
];

/**
 * @param {object}  o
 * @param {string} [o.id]        existing item id; omit to create
 * @param {object} [o.prefill]   defaults for a new item
 * @param {Function} o.after
 */
export function openItemEditor({ id = null, prefill = {}, after }) {
  const item = id ? store.invItem(id) : null;
  const locs = store.locations();

  const start = item || {
    name: prefill.name || '',
    qty: prefill.qty ?? '',
    unit: prefill.unit || 'pcs',
    category: prefill.category || 'produce',
    locId: prefill.locId || locs[0]?.id,
    useBy: prefill.useBy || '',
    note: '',
  };

  const startPlace = store.locationOf(start.locId)?.place || 'home';

  const locOptionsFor = place => store.locationsFor(place).map(l => ({ id: l.id, label: l.label }));

  const body = `
    <div class="form">
      ${field({ control: textInput({
        name: 'name', value: start.name, placeholder: 'What is it?', autofocus: !item,
      }) })}

      <div class="grid-qty">
        ${field({ label: 'Amount', control: textInput({
          name: 'qty', value: start.qty == null ? '' : num(start.qty),
          placeholder: '0', attrs: 'inputmode="decimal"',
        }) })}
        ${field({ label: 'Unit', control: select({ name: 'unit', value: start.unit, options: unitOptions }) })}
      </div>

      ${field({ label: 'Aisle', control: chipGroup({ name: 'category', value: start.category, options: catOptions }) })}

      ${field({
        label: 'Where is it kept',
        hint: 'Splitting home from work keeps you from planning a lunch around something sat in the wrong fridge.',
        control: `
          ${segmented({ name: 'place', value: startPlace, options: PLACES.map(p => ({ value: p.id, label: p.label })) })}
          <div style="margin-top:8px" data-locwrap>
            ${chipGroup({ name: 'locId', value: start.locId, options: locOptionsFor(startPlace) })}
          </div>`,
      })}

      ${field({
        label: 'Use by',
        control: `
          ${textInput({ name: 'useBy', value: start.useBy, type: 'date' })}
          <div class="hstrip" style="margin:8px 0 0;padding:0">
            ${QUICK_DATES.map(q => `<button type="button" class="chip" data-quick="${q.days}">${esc(q.label)}</button>`).join('')}
            <button type="button" class="chip" data-quick="">None</button>
          </div>`,
        hint: item && start.useBy ? expiryInfo(start.useBy)?.label : '',
      })}

      ${field({ label: 'Notes', control: textArea({ name: 'note', value: start.note || '', placeholder: 'Opened, half used, whose it is…' }) })}

      <div class="sheet__foot">
        ${item ? `<button class="btn btn--danger btn--sm" type="button" data-del>${icon('trash')}</button>` : ''}
        <button class="btn" type="button" data-save>${icon('check')}${item ? 'Save' : 'Add to stock'}</button>
      </div>
    </div>`;

  openSheet({
    title: item ? item.name : 'Add to stock',
    body,
    mount(root) {
      bindPickers(root);

      // Swapping home/work re-lists the stores for that place.
      root.querySelector('[data-segmented=place]').addEventListener('pick', e => {
        const opts = locOptionsFor(e.detail);
        const wrap = root.querySelector('[data-locwrap]');
        wrap.innerHTML = chipGroup({ name: 'locId', value: opts[0]?.id, options: opts });
        bindPickers(wrap);
      });

      root.querySelectorAll('[data-quick]').forEach(btn => {
        btn.addEventListener('click', () => {
          const d = btn.dataset.quick;
          root.querySelector('[name=useBy]').value = d === '' ? '' : addDays(today(), Number(d));
        });
      });

      root.querySelector('[data-save]').addEventListener('click', () => {
        const f = readForm(root);
        if (!f.name) { root.querySelector('[name=name]').focus(); return; }
        const patch = {
          name: f.name,
          qty: f.qty,
          unit: f.unit,
          category: f.category,
          locId: f.locId || locs[0]?.id,
          useBy: f.useBy,
          note: f.note,
        };
        if (item) store.updateInvItem(item.id, patch);
        else store.addInvItem(patch);
        closeSheet();
        after?.();
        toast(item ? 'Stock updated' : `${patch.name} added to ${store.locationLabel(patch.locId)}`, { iconName: 'check' });
      });

      root.querySelector('[data-del]')?.addEventListener('click', () => {
        confirmSheet({
          title: `Remove ${item.name}?`,
          message: 'It will be taken off any meal it was assigned to. Those ingredients move over to the shopping list.',
          confirmLabel: 'Remove',
          danger: true,
          run() {
            store.removeInvItem(item.id);
            after?.();
            toast('Removed from stock', {
              iconName: 'trash',
              action: { label: 'Undo', run: () => { store.undo(); after?.(); } },
            });
          },
        });
      });
    },
  });
}

/** Quick-look sheet: amount nudgers, where it is, and what it is booked into. */
export function openItemPeek({ id, after }) {
  const it = store.invItem(id);
  if (!it) return;

  const ex = expiryInfo(it.useBy);
  const bookings = bookedInto(id);

  const render = () => {
    const cur = store.invItem(id);
    if (!cur) { closeSheet(); return; }

    openSheet({
      title: cur.name,
      body: `
        <div class="form">
          <div class="card" style="padding:16px;display:flex;align-items:center;gap:14px">
            <button class="iconbtn" type="button" data-bump="-1" aria-label="Less">${icon('minus')}</button>
            <div style="flex:1;text-align:center">
              <div style="font-size:30px;font-weight:740;letter-spacing:-.03em" class="tnum">
                ${esc(num(cur.qty) || '0')}
              </div>
              <div style="font-size:12.5px;color:var(--ink-3);font-weight:600">${esc(cur.unit || 'units')}</div>
            </div>
            <button class="iconbtn" type="button" data-bump="1" aria-label="More">${icon('plus')}</button>
          </div>

          <div class="rows">
            <div class="row" style="cursor:default">
              <span class="row__lead">${icon('pin')}</span>
              <span class="row__main">
                <span class="row__name">${esc(store.locationLabel(cur.locId))}</span>
                <span class="row__sub">${esc(store.catOf(cur.category).label)}</span>
              </span>
            </div>
            <div class="row" style="cursor:default">
              <span class="row__lead">${icon('clock')}</span>
              <span class="row__main">
                <span class="row__name">${esc(cur.useBy ? niceDate(cur.useBy) : 'No use-by set')}</span>
                <span class="row__sub">${esc(ex ? ex.label : 'Add one to get expiry warnings')}</span>
              </span>
            </div>
            ${cur.note ? `
              <div class="row" style="cursor:default">
                <span class="row__lead">${icon('info')}</span>
                <span class="row__main"><span class="row__sub" style="margin:0">${esc(cur.note)}</span></span>
              </div>` : ''}
          </div>

          ${bookings.length ? `
            <div class="field">
              <span class="field__label">Booked into</span>
              <div class="taglist">
                ${bookings.map(b => `<span class="tag tag--inv">${esc(b)}</span>`).join('')}
              </div>
            </div>` : ''}

          <div class="sheet__foot">
            <button class="btn btn--ghost" type="button" data-edit>${icon('pencil')}Edit</button>
            <button class="btn" type="button" data-close>${icon('check')}Done</button>
          </div>
        </div>`,
      mount(root) {
        root.querySelectorAll('[data-bump]').forEach(btn => {
          btn.addEventListener('click', () => {
            store.bumpQty(id, Number(btn.dataset.bump));
            after?.();
            render();
          });
        });
        root.querySelector('[data-edit]').addEventListener('click', () => {
          closeSheet();
          setTimeout(() => openItemEditor({ id, after }), 200);
        });
      },
      dismiss: () => after?.(),
    });
  };

  render();
}

/** Human-readable list of the meals an inventory item is assigned to. */
function bookedInto(invId) {
  const out = [];
  const plan = store.get().plan;
  for (const [date, day] of Object.entries(plan)) {
    for (const meal of store.MEALS) {
      const s = day[meal.id];
      if (!s || s.done) continue;
      const hit = (s.items || []).find(i => i.invId === invId);
      if (hit) out.push(`${niceDate(date)} · ${meal.label}${hit.qty ? ` (${qtyLabel(hit.qty, hit.unit)})` : ''}`);
    }
  }
  return out.slice(0, 6);
}
