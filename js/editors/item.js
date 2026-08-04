/* ==========================================================================
   Inventory item editor — name, amount, aisle, where it lives, use-by.
   ========================================================================== */

import * as store from '../store.js';
import { CATEGORIES, UNITS, PLACES, PARTABLE } from '../store.js';
import { esc, num, today, addDays, niceDate, expiryInfo, qtyLabel } from '../util.js';
import { icon } from '../icons.js';
import {
  openSheet, closeSheet, toast, confirmSheet,
  field, textInput, textArea, select, segmented, chipGroup, slider, bindPickers, bindSliders, readForm,
} from '../ui.js';

const unitOptions = UNITS.map(u => ({ value: u, label: u }));
const catOptions  = CATEGORIES.map(c => ({ id: c.id, label: c.label }));

/* Suggestions only. Nothing is pre-filled: a pre-filled 20 would be Munch claiming to
   know how many slices are in your loaf, and the count has to come from the user. */
const PORTION_HINT = {
  loaf: 'slice', jar: 'spoon', tin: 'spoon', pack: 'piece',
  bottle: 'glass', bunch: 'sprig',
};

/** The part-used slider plus, for a container, what one helping of it is. */
function partBlock(start, unit) {
  if (!PARTABLE.has(unit)) return '';
  return `
    ${field({ label: 'How much is left', control: slider({ name: 'remaining', value: start.remaining }) })}
    <div class="grid-qty">
      ${field({ label: 'One helping is a', control: textInput({
        name: 'portionName', value: start.portionName || '',
        placeholder: PORTION_HINT[unit] || 'portion',
      }) })}
      ${field({ label: `How many in a ${esc(unit)}`, control: textInput({
        name: 'portionPer', value: start.portionPer === '' || start.portionPer == null ? '' : num(start.portionPer),
        placeholder: 'e.g. 20', attrs: 'inputmode="numeric"',
      }) })}
    </div>
    <span class="field__hint">
      Optional. Set it and a meal can say “2 slices” instead of a fraction of the whole thing.
    </span>`;
}

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
    remaining: prefill.remaining ?? null,
    portionName: prefill.portionName || '',
    portionPer: prefill.portionPer ?? '',
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
          placeholder: '0', selectOnFocus: true, attrs: 'inputmode="decimal"',
        }) })}
        ${field({ label: 'Unit', control: select({ name: 'unit', value: start.unit, options: unitOptions }) })}
      </div>

      <div data-remwrap>${partBlock(start, start.unit)}</div>

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

  // Assigned in mount, where `root` exists; the head-bar tick and the foot button
  // both go through it so there is only ever one save path.
  let save = () => {};

  openSheet({
    title: item ? item.name : 'Add to stock',
    body,
    confirm: { label: item ? 'Save' : 'Add to stock', run: () => save() },
    mount(root) {
      bindPickers(root);

      // Swapping home/work re-lists the stores for that place.
      root.querySelector('[data-segmented=place]').addEventListener('pick', e => {
        const opts = locOptionsFor(e.detail);
        const wrap = root.querySelector('[data-locwrap]');
        wrap.innerHTML = chipGroup({ name: 'locId', value: opts[0]?.id, options: opts });
        bindPickers(wrap);
      });

      // Removed from the DOM rather than hidden, so readForm() cannot see it — that
      // is what lets a stored fraction survive a trip through a non-partable unit
      // instead of being cleared on save.
      const unitSel = root.querySelector('[name=unit]');
      const remWrap = root.querySelector('[data-remwrap]');
      unitSel.addEventListener('change', () => {
        const shown = !!remWrap.querySelector('input[type=range]');
        if (PARTABLE.has(unitSel.value)) {
          // Rebuilt even when already shown, because "how many in a jar" and the portion
          // placeholder both name the unit. Whatever is on screen is carried across, so
          // switching jar -> tin relabels without wiping what was typed.
          const range = remWrap.querySelector('[name=remaining]');
          const live = {
            remaining: range ? Number(range.value) / 100 : start.remaining,
            portionName: remWrap.querySelector('[name=portionName]')?.value ?? start.portionName,
            portionPer: remWrap.querySelector('[name=portionPer]')?.value ?? start.portionPer,
          };
          remWrap.innerHTML = partBlock(live, unitSel.value);
          bindSliders(remWrap);
        } else if (shown) {
          remWrap.innerHTML = '';
        }
      });

      root.querySelectorAll('[data-quick]').forEach(btn => {
        btn.addEventListener('click', () => {
          const d = btn.dataset.quick;
          root.querySelector('[name=useBy]').value = d === '' ? '' : addDays(today(), Number(d));
        });
      });

      save = () => {
        const f = readForm(root);
        if (!f.name) { root.querySelector('[name=name]').focus({ preventScroll: true }); return; }
        const patch = {
          name: f.name,
          qty: f.qty,
          unit: f.unit,
          category: f.category,
          locId: f.locId || locs[0]?.id,
          useBy: f.useBy,
          note: f.note,
        };
        // Absent means the slider was not on screen, which must leave any stored
        // fraction alone rather than clearing it.
        if (f.remaining !== undefined) patch.remaining = Number(f.remaining) / 100;
        // Same rule as the slider: absent means the controls were not on screen, which
        // must leave a stored portion alone rather than clearing it.
        if (f.portionName !== undefined) patch.portionName = f.portionName || null;
        if (f.portionPer !== undefined) {
          patch.portionPer = f.portionPer === '' ? null : Number(f.portionPer);
        }
        if (item) store.updateInvItem(item.id, patch);
        else store.addInvItem(patch);
        closeSheet();
        after?.();
        toast(item ? 'Stock updated' : `${patch.name} added to ${store.locationLabel(patch.locId)}`, { iconName: 'check' });
      };

      root.querySelector('[data-save]').addEventListener('click', save);

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

          ${PARTABLE.has(cur.unit) ? `
            <div class="field">
              <span class="field__label">How much is left</span>
              ${slider({ name: 'remaining', value: cur.remaining })}
            </div>` : ''}

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
        // Writes on `change`, not `input`: every commit() reindexes, persists and
        // stamps for sync, so a drag must not fire one of those per pixel. No
        // render() either — that reopens the sheet and would tear the slider out
        // from under the thumb.
        const range = root.querySelector('[data-slider=remaining] input');
        range?.addEventListener('change', () => {
          const frac = Number(range.value) / 100;
          store.setRemaining(id, frac);
          after?.();
          if (frac !== 0) return;
          toast(`${cur.name} is empty`, {
            iconName: 'info',
            action: {
              label: 'Remove',
              run: () => {
                store.removeInvItem(id);
                after?.();
                closeSheet();
                toast('Removed from stock', {
                  iconName: 'trash',
                  action: { label: 'Undo', run: () => { store.undo(); after?.(); } },
                });
              },
            },
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
