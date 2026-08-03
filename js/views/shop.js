/* ==========================================================================
   Shop — the list. Plan-derived lines and hand-added lines side by side,
   grouped by aisle so one pass round the shop covers it.
   ========================================================================== */

import * as store from '../store.js';
import { esc, qtyLabel, niceDate, plural } from '../util.js';
import { icon } from '../icons.js';
import { pill, emptyState, toast, confirmSheet } from '../ui.js';
import { openShopEditor, openLinePeek, openPutAwayAll } from '../editors/shop.js';

const ui = { hideDone: false };

export default {
  id: 'shop',
  label: 'Shop',
  icon: 'cart',
  title: () => 'Shopping',

  sub() {
    const { outstanding, total } = store.shoppingList();
    if (!total) return 'Nothing on the list';
    return `${outstanding} of ${total} left`;
  },

  actions: () => `
    <button class="iconbtn iconbtn--primary" type="button" data-act="add" aria-label="Add to list">${icon('plus')}</button>`,

  badge() {
    const { outstanding } = store.shoppingList();
    return outstanding || null;
  },

  render(root, ctx) {
    const list = store.shoppingList();
    const doneN = list.total - list.outstanding;
    const fromPlan = list.all.filter(l => l.kind === 'plan').length;
    const clearable = store.clearableCount();

    const groups = ui.hideDone
      ? list.groups.map(g => ({ ...g, lines: g.lines.filter(l => !l.done) })).filter(g => g.lines.length)
      : list.groups;

    root.innerHTML = `
      ${list.total ? `
        <section class="section">
          <div class="card summary">
            <div style="flex:1">
              <div class="summary__n">${list.outstanding}</div>
              <div class="summary__t">
                still to get${fromPlan ? ` · ${fromPlan} from the plan` : ''}
              </div>
            </div>
            ${doneN ? `
              <button class="btn btn--ghost btn--sm" type="button" data-act="putaway">
                ${icon('fridge')}Put away ${doneN}
              </button>` : ''}
          </div>
        </section>` : ''}

      <section class="section">
        ${groups.length ? `
          <div class="rows">
            ${groups.map(renderGroup).join('')}
          </div>` : `
          <div class="card">
            ${emptyState({
              iconName: 'cart',
              title: list.total ? 'All ticked off' : 'The list is empty',
              body: list.total
                ? 'Everything on the list is done. Put it away to move it into your stock.'
                : 'Plan a meal and anything you are missing lands here automatically. You can also add things by hand.',
              action: list.total ? null : { act: 'add', label: 'Add an item' },
            })}
          </div>`}
      </section>

      ${list.total ? `
        <section class="section">
          <div class="stack">
            <div class="grid2">
              <button class="btn btn--ghost btn--sm" type="button" data-act="hide">
                ${ui.hideDone ? `${icon('undo')}Show ticked` : `${icon('check')}Hide ticked`}
              </button>
              <button class="btn btn--ghost btn--sm" type="button" data-act="share">${icon('share')}Share</button>
            </div>
            ${clearable ? `
              <button class="btn btn--ghost btn--sm btn--block" type="button" data-act="clear">
                ${icon('trash')}Clear ${plural(clearable, 'ticked item')}
              </button>` : ''}
          </div>
          <p class="field__hint" style="text-align:center;margin-top:16px">
            Lines from the plan disappear once the meal is logged as eaten.
          </p>
        </section>` : ''}`;

    /* --- bindings --- */

    const lineByKey = key => list.all.find(l => l.key === key);

    root.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const line = lineByKey(el.dataset.toggle);
        if (!line) return;
        store.toggleLine(line);
        ctx.refresh();
      });
    });

    root.querySelectorAll('[data-info]').forEach(el => {
      el.addEventListener('click', () => {
        const line = lineByKey(el.dataset.info);
        if (line) openLinePeek({ line, after: ctx.refresh });
      });
    });

    root.querySelectorAll('[data-act]').forEach(el => {
      el.addEventListener('click', () => this.onAction(el.dataset.act, ctx));
    });
  },

  onAction(act, ctx) {
    if (act === 'add') { openShopEditor({ after: ctx.refresh }); return; }

    if (act === 'hide') { ui.hideDone = !ui.hideDone; ctx.refresh(); return; }

    if (act === 'putaway') { openPutAwayAll({ after: ctx.refresh }); return; }

    if (act === 'clear') {
      confirmSheet({
        title: 'Clear ticked items?',
        message: 'Hand-added lines come off the list without going into your stock. '
          + 'Lines that came from a meal stay put — use “Put away” for those, or log the meal as eaten.',
        confirmLabel: 'Clear them',
        danger: true,
        run() {
          const n = store.clearTicked();
          ctx.refresh();
          toast(n ? `${plural(n, 'item')} removed` : 'Nothing to remove', {
            iconName: 'check',
            action: { label: 'Undo', run: () => { store.undo(); ctx.refresh(); } },
          });
        },
      });
      return;
    }

    if (act === 'share') shareList();
  },
};

/* --- pieces ------------------------------------------------------------- */

function renderGroup(g) {
  const open = g.lines.filter(l => !l.done).length;
  return `
    <div class="group">
      <div class="group__label">
        <span class="swatch" style="background:${esc(g.cat.colour)}"></span>
        <span>${esc(g.cat.label)}</span>
        <b>${open ? `${open} left` : 'done'}</b>
      </div>
      ${g.lines.map(lineRow).join('')}
    </div>`;
}

function lineRow(l) {
  const q = qtyLabel(l.qty, l.unit);
  const why = l.refs.length
    ? l.refs.length === 1
      ? `${niceDate(l.refs[0].date)} · ${l.refs[0].mealLabel}`
      : `${plural(l.refs.length, 'meal')} this week`
    : (l.note || 'Added by hand');

  return `
    <div class="row row--split${l.done ? ' is-done' : ''}">
      <button class="row__hit" type="button" data-toggle="${esc(l.key)}"
        aria-label="${l.done ? 'Untick' : 'Tick off'} ${esc(l.name)}">
        <span class="tick" aria-pressed="${l.done}">${icon('check')}</span>
        <span class="row__main">
          <span class="row__name">${esc(l.name)}</span>
          <span class="row__sub">${esc(why)}</span>
        </span>
        ${q ? `<span class="row__tail tnum">${esc(q)}</span>` : ''}
      </button>
      <button class="iconbtn iconbtn--plain" type="button" data-info="${esc(l.key)}"
        aria-label="Details for ${esc(l.name)}">${icon('chevron')}</button>
    </div>`;
}

async function shareList() {
  const text = store.exportText();
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Shopping list', text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('List copied to the clipboard', { iconName: 'copy' });
  } catch (err) {
    if (err?.name === 'AbortError') return; // user cancelled the share sheet
    toast('Could not share — copy it from the list instead');
  }
}
