/* ==========================================================================
   Inventory — what you have in, where it is, and how long it has left.
   ========================================================================== */

import * as store from '../store.js';
import { PLACES, placeOf } from '../store.js';
import { esc, qtyLabel, expiryInfo, initials, plural, debounce, daysFromToday } from '../util.js';
import { icon } from '../icons.js';
import { pill, emptyState } from '../ui.js';
import { openItemEditor, openItemPeek } from '../editors/item.js';

/* View-local UI state — deliberately not persisted. */
const ui = { query: '', place: '', locId: '', urgentOnly: false };

export default {
  id: 'inventory',
  label: 'Stock',
  icon: 'fridge',
  title: () => 'Stock',

  sub() {
    const n = store.get().inventory.length;
    const soon = store.expiring(3).length;
    return soon ? `${plural(n, 'item')} · ${soon} need using` : plural(n, 'item');
  },

  actions: () => `
    <button class="iconbtn iconbtn--primary" type="button" data-act="add" aria-label="Add to stock">${icon('plus')}</button>`,

  badge() {
    const n = store.expiring(1).length;
    return n || null;
  },

  render(root, ctx) {
    const all = store.get().inventory;
    let rows = store.inventory({
      query: ui.query,
      place: ui.place || null,
      locId: ui.locId || null,
    });
    if (ui.urgentOnly) rows = rows.filter(i => i.useBy && daysFromToday(i.useBy) <= 3);

    const urgentN = store.expiring(3).length;
    const locChips = ui.place ? store.locationsFor(ui.place) : [];

    root.innerHTML = `
      <section class="section">
        <div class="search">
          ${icon('search')}
          <input type="search" placeholder="Search your stock" value="${esc(ui.query)}"
            data-q enterkeyhint="search" autocomplete="off">
        </div>

        <div class="hstrip" style="margin-top:10px">
          <button class="chip" type="button" data-place="" aria-pressed="${ui.place === ''}">
            Everywhere<span class="chip__n">${all.length}</span>
          </button>
          ${PLACES.map(p => {
            const n = store.inventory({ place: p.id }).length;
            return `
              <button class="chip" type="button" data-place="${esc(p.id)}" aria-pressed="${ui.place === p.id}">
                ${esc(p.label)}<span class="chip__n">${n}</span>
              </button>`;
          }).join('')}
          ${urgentN ? `
            <button class="chip" type="button" data-urgent aria-pressed="${ui.urgentOnly}"
              style="${ui.urgentOnly ? '' : 'color:var(--bad)'}">
              Use up soon<span class="chip__n">${urgentN}</span>
            </button>` : ''}
        </div>

        ${locChips.length ? `
          <div class="hstrip" style="margin-top:7px">
            <button class="chip" type="button" data-loc="" aria-pressed="${ui.locId === ''}">
              All ${esc(placeOf(ui.place).label.toLowerCase())}
            </button>
            ${locChips.map(l => {
              const n = store.inventory({ locId: l.id }).length;
              return `
                <button class="chip" type="button" data-loc="${esc(l.id)}" aria-pressed="${ui.locId === l.id}">
                  ${esc(l.label)}<span class="chip__n">${n}</span>
                </button>`;
            }).join('')}
          </div>` : ''}
      </section>

      <section class="section">
        ${rows.length ? renderGroups(rows) : `
          <div class="card">
            ${emptyState({
              iconName: 'fridge',
              title: all.length ? 'Nothing matches' : 'Your stock is empty',
              body: all.length
                ? 'Try a different search, or clear the filters above.'
                : 'Add what you have in at home and at work. Meals can then draw straight from it.',
              action: all.length ? null : { act: 'add', label: 'Add your first item' },
            })}
          </div>`}
      </section>

      ${rows.length ? `
        <p class="field__hint" style="text-align:center;margin-top:18px;opacity:.75">
          Tap an item to adjust the amount. ${store.get().inventory.filter(i => !i.useBy).length} without a use-by date.
        </p>` : ''}`;

    /* --- bindings --- */

    const q = root.querySelector('[data-q]');
    const runSearch = debounce(() => {
      ui.query = q.value;
      const pos = q.selectionStart;
      ctx.refresh();
      const nq = document.querySelector('[data-q]');
      if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
    }, 160);
    q.addEventListener('input', runSearch);

    root.querySelectorAll('[data-place]').forEach(el => {
      el.addEventListener('click', () => {
        ui.place = el.dataset.place;
        ui.locId = '';
        ui.urgentOnly = false;
        ctx.refresh();
      });
    });

    root.querySelectorAll('[data-loc]').forEach(el => {
      el.addEventListener('click', () => { ui.locId = el.dataset.loc; ctx.refresh(); });
    });

    root.querySelector('[data-urgent]')?.addEventListener('click', () => {
      ui.urgentOnly = !ui.urgentOnly;
      ctx.refresh();
    });

    root.querySelectorAll('[data-peek]').forEach(el => {
      el.addEventListener('click', () => openItemPeek({ id: el.dataset.peek, after: ctx.refresh }));
    });

    root.querySelectorAll('[data-act=add]').forEach(el => {
      el.addEventListener('click', () => openItemEditor({
        prefill: { locId: ui.locId || store.locationsFor(ui.place || 'home')[0]?.id },
        after: ctx.refresh,
      }));
    });
  },

  onAction(act, ctx) {
    if (act === 'add') {
      openItemEditor({
        prefill: { locId: ui.locId || store.locationsFor(ui.place || 'home')[0]?.id },
        after: ctx.refresh,
      });
    }
  },
};

/** Group by store, but only when the user has not already narrowed to one. */
function renderGroups(rows) {
  const byLoc = new Map();
  for (const it of rows) {
    const key = it.locId || 'none';
    if (!byLoc.has(key)) byLoc.set(key, []);
    byLoc.get(key).push(it);
  }

  if (byLoc.size === 1) {
    return `<div class="rows">${rows.map(itemRow).join('')}</div>`;
  }

  const ordered = store.locations()
    .map(l => [l.id, byLoc.get(l.id)])
    .filter(([, v]) => v?.length);
  if (byLoc.has('none')) ordered.push(['none', byLoc.get('none')]);

  return `
    <div class="rows">
      ${ordered.map(([locId, items]) => `
        <div class="group">
          <div class="group__label">
            ${icon(locId === 'none' ? 'box' : (placeOf(store.locationOf(locId)?.place).icon))}
            <span>${esc(locId === 'none' ? 'Unassigned' : store.locationLabel(locId))}</span>
            <b>${items.length}</b>
          </div>
          ${items.map(itemRow).join('')}
        </div>`).join('')}
    </div>`;
}

function itemRow(it) {
  const ex = expiryInfo(it.useBy);
  const cat = store.catOf(it.category);
  return `
    <button class="row" type="button" data-peek="${esc(it.id)}">
      <span class="row__lead" style="background:${esc(cat.colour)}1F;color:${esc(cat.colour)}">
        ${esc(initials(it.name))}
      </span>
      <span class="row__main">
        <span class="row__name">${esc(it.name)}</span>
        <span class="row__sub">
          ${esc(cat.label)}
          ${it.note ? `<i class="dot"></i>${esc(it.note.slice(0, 28))}` : ''}
        </span>
      </span>
      <span class="row__tail">
        ${ex ? pill(ex.label, ex.tone, ex.n <= 0 ? 'alert' : null) : ''}
        <span class="tnum">${esc(qtyLabel(it.qty, it.unit) || '—')}</span>
      </span>
    </button>`;
}
