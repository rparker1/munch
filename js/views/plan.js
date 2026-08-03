/* ==========================================================================
   Plan — a week at a time, three slots a day, with the shopping consequences
   of each meal shown inline.
   ========================================================================== */

import * as store from '../store.js';
import { MEALS, placeOf } from '../store.js';
import { esc, today, addDays, weekStart, niceDate, dow, dayNum, shortDate, plural } from '../util.js';
import { icon } from '../icons.js';
import { pill, toast, confirmSheet } from '../ui.js';
import { openMealEditor } from '../editors/meal.js';

const ui = { date: today(), week: weekStart(today()) };

export default {
  id: 'plan',
  label: 'Plan',
  icon: 'plan',
  title: () => 'Plan',

  sub() {
    const end = addDays(ui.week, 6);
    return `${shortDate(ui.week)} – ${shortDate(end)}`;
  },

  actions: () => `
    <button class="iconbtn" type="button" data-act="prev" aria-label="Previous week">
      <svg viewBox="0 0 24 24" aria-hidden="true" style="transform:scaleX(-1)"><path d="M9 5.5 15.5 12 9 18.5"/></svg>
    </button>
    <button class="iconbtn" type="button" data-act="next" aria-label="Next week">${icon('chevron')}</button>`,

  badge: () => null,

  render(root, ctx) {
    // Keep the selected day inside the week on screen.
    if (ui.date < ui.week || ui.date > addDays(ui.week, 6)) ui.date = ui.week;

    const days = Array.from({ length: 7 }, (_, i) => addDays(ui.week, i));
    const plan = store.dayPlan(ui.date);
    const weekBuys = countWeekBuys(days);
    const isThisWeek = ui.week === weekStart(today());

    root.innerHTML = `
      <section class="section">
        <div class="weekrow">
          ${days.map(d => dayChip(d)).join('')}
        </div>
        ${!isThisWeek ? `
          <button class="btn btn--quiet btn--sm" type="button" data-act="thisweek"
            style="margin:8px auto 0;display:flex">${icon('refresh')}Back to this week</button>` : ''}
      </section>

      <section class="section">
        <div class="section__head">
          <h2 class="section__title">${esc(niceDate(ui.date))}</h2>
          <span class="section__note">${store.plannedCount(ui.date)} of 3 planned</span>
        </div>
        <div class="slots">
          ${MEALS.map(m => planSlot(ui.date, m, plan[m.id])).join('')}
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <h2 class="section__title">Rest of the week</h2>
          ${weekBuys ? `<span class="section__note">${plural(weekBuys, 'item')} to buy</span>` : ''}
        </div>
        <div class="rows">
          ${days.filter(d => d !== ui.date).map(d => weekRow(d)).join('')}
        </div>
      </section>

      ${store.library().length ? `
        <section class="section">
          <div class="section__head">
            <h2 class="section__title">My meals</h2>
            <span class="section__note">${store.library().length} saved</span>
          </div>
          <div class="hstrip">
            ${store.library().slice(0, 14).map(l => `
              <button class="chip chip--stacked" type="button" data-lib="${esc(l.id)}">
                <b>${esc(l.name)}</b>
                <i>${esc(store.mealOf(l.mealId).label)} · ${esc(plural(l.items.length, 'item'))}</i>
              </button>`).join('')}
          </div>
          <p class="field__hint" style="text-align:center;margin-top:8px">
            Tap a saved meal to drop it onto ${esc(niceDate(ui.date).toLowerCase())}.
          </p>
        </section>` : ''}`;

    /* --- bindings --- */

    root.querySelectorAll('[data-day]').forEach(el => {
      el.addEventListener('click', () => { ui.date = el.dataset.day; ctx.refresh(); });
    });

    root.querySelectorAll('[data-slot]').forEach(el => {
      el.addEventListener('click', () => {
        openMealEditor({ date: ui.date, mealId: el.dataset.slot, after: ctx.refresh });
      });
    });

    root.querySelectorAll('[data-jump]').forEach(el => {
      el.addEventListener('click', () => { ui.date = el.dataset.jump; ctx.refresh(); });
    });

    root.querySelectorAll('[data-lib]').forEach(el => {
      el.addEventListener('click', () => dropLibrary(el.dataset.lib, ctx));
    });

    root.querySelector('[data-act=thisweek]')?.addEventListener('click', () => {
      ui.week = weekStart(today());
      ui.date = today();
      ctx.refresh();
    });
  },

  onAction(act, ctx) {
    if (act === 'prev') { ui.week = addDays(ui.week, -7); ui.date = ui.week; ctx.refresh(); }
    if (act === 'next') { ui.week = addDays(ui.week, 7);  ui.date = ui.week; ctx.refresh(); }
  },
};

/* --- pieces ------------------------------------------------------------- */

function dayChip(d) {
  const n = store.plannedCount(d);
  return `
    <button class="day${d === today() ? ' is-today' : ''}" type="button"
      data-day="${esc(d)}" aria-pressed="${d === ui.date}">
      <span class="day__dow">${esc(dow(d))}</span>
      <span class="day__n">${dayNum(d)}</span>
      <span class="day__dots">
        ${MEALS.map((_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}
      </span>
    </button>`;
}

function planSlot(date, meal, s) {
  if (!s) {
    return `
      <button class="slot slot--${meal.id} is-empty" type="button" data-slot="${meal.id}">
        <span class="slot__mark">${icon(meal.icon)}</span>
        <span class="slot__main">
          <span class="slot__kicker">${esc(meal.label)}</span>
          <span class="slot__name">Add ${esc(meal.label.toLowerCase())}</span>
        </span>
        <span class="slot__chev">${icon('plus')}</span>
      </button>`;
  }

  const items = s.items || [];
  const buys = items.filter(i => i.source === 'buy');
  const froms = items.filter(i => i.source === 'inv');
  const place = placeOf(s.place);

  return `
    <button class="slot slot--${meal.id}${s.done ? ' is-done' : ''}" type="button" data-slot="${meal.id}">
      <span class="slot__mark">${s.done ? icon('check') : icon(meal.icon)}</span>
      <span class="slot__main">
        <span class="slot__kicker">${esc(meal.label)}</span>
        <span class="slot__name">${esc(s.name)}</span>
        ${items.length ? `
          <span class="slot__ings">
            ${esc(items.map(i => i.name).slice(0, 4).join(', '))}${items.length > 4 ? ` +${items.length - 4}` : ''}
          </span>` : ''}
        <span class="slot__meta">
          ${place.id === 'work' ? pill(place.label, 'accent', place.icon) : ''}
          ${froms.length ? pill(`${froms.length} from stock`, 'primary') : ''}
          ${buys.length ? pill(`${buys.length} to buy`, 'warn', 'cart') : ''}
          ${s.done ? pill('Eaten', 'ok', 'check') : ''}
        </span>
      </span>
      <span class="slot__chev">${icon('chevron')}</span>
    </button>`;
}

function weekRow(d) {
  const plan = store.dayPlan(d);
  const planned = MEALS.filter(m => plan[m.id]);
  const names = planned.map(m => plan[m.id].name);

  return `
    <button class="row" type="button" data-jump="${esc(d)}">
      <span class="row__lead row__lead--date">
        <i>${esc(dow(d).toUpperCase())}</i>
        <b>${dayNum(d)}</b>
      </span>
      <span class="row__main">
        <span class="row__name">${planned.length ? esc(names.join(' · ')) : 'Nothing planned'}</span>
        <span class="row__sub">${planned.length ? esc(planned.map(m => m.label).join(', ')) : 'Tap to fill it in'}</span>
      </span>
      <span class="row__tail">
        ${planned.length ? `<span class="tnum">${planned.length}/3</span>` : ''}
        ${icon('chevron')}
      </span>
    </button>`;
}

function countWeekBuys(days) {
  let n = 0;
  for (const d of days) {
    const plan = store.dayPlan(d);
    for (const m of MEALS) {
      const s = plan[m.id];
      if (!s || s.done) continue;
      n += (s.items || []).filter(i => i.source === 'buy').length;
    }
  }
  return n;
}

function dropLibrary(libId, ctx) {
  const entry = store.library().find(l => l.id === libId);
  if (!entry) return;
  const existing = store.slot(ui.date, entry.mealId);

  const place = () => {
    store.saveSlot(ui.date, entry.mealId, {
      name: entry.name,
      place: entry.place,
      items: entry.items.map(i => {
        const hit = store.get().inventory.find(inv =>
          inv.name.toLowerCase() === i.name.toLowerCase()
          && store.locationOf(inv.locId)?.place === entry.place);
        return { ...i, source: hit ? 'inv' : 'buy', invId: hit?.id || null };
      }),
      note: '',
    });
    ctx.refresh();
    toast(`${entry.name} → ${niceDate(ui.date)}`, {
      iconName: 'check',
      action: { label: 'Open', run: () => openMealEditor({ date: ui.date, mealId: entry.mealId, after: ctx.refresh }) },
    });
  };

  if (existing) {
    confirmSheet({
      title: `Replace ${store.mealOf(entry.mealId).label.toLowerCase()}?`,
      message: `${niceDate(ui.date)} already has “${existing.name}”. Dropping “${entry.name}” in will overwrite it.`,
      confirmLabel: 'Replace',
      run: place,
    });
  } else {
    place();
  }
}
