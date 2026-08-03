/* ==========================================================================
   Today — a pastel hero card for the next meal, three tappable figures, then
   today's slots and whatever needs eating first.
   ========================================================================== */

import * as store from '../store.js';
import { MEALS, placeOf } from '../store.js';
import { esc, today, longDate, qtyLabel, expiryInfo, initials, plural } from '../util.js';
import { icon } from '../icons.js';
import { pill } from '../ui.js';
import { openMealEditor } from '../editors/meal.js';
import { openItemPeek, openItemEditor } from '../editors/item.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'Late one';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The meal you are most likely looking for right now. */
function currentMealId() {
  const h = new Date().getHours();
  if (h < 10.5) return 'breakfast';
  if (h < 15)   return 'lunch';
  return 'dinner';
}

/** The pastel card: whatever is most worth saying, said big. */
function hero(plan, urgent, outstanding) {
  const next = MEALS.find(m => plan[m.id] && !plan[m.id].done);

  if (next) {
    const s = plan[next.id];
    const place = placeOf(s.place);
    const froms = (s.items || []).filter(i => i.source === 'inv').length;
    const buys = (s.items || []).filter(i => i.source === 'buy').length;
    return `
      <div class="hero">
        <p class="hero__eyebrow">${icon(next.icon)}Next up · ${esc(next.label)}</p>
        <p class="hero__line">
          ${esc(s.name)}
          ${s.note ? `<small>${esc(s.note)}</small>` : ''}
        </p>
        <div class="hero__foot">
          <span class="hero__tag">${icon(place.icon)}${esc(place.label)}</span>
          ${froms ? `<span class="hero__tag">${icon('fridge')}${froms} from stock</span>` : ''}
          ${buys ? `<span class="hero__tag">${icon('cart')}${buys} to buy</span>` : ''}
        </div>
      </div>`;
  }

  const planned = MEALS.filter(m => plan[m.id]).length;
  const line = !planned
    ? 'Nothing planned yet'
    : urgent
      ? `${plural(urgent, 'thing')} to use up`
      : outstanding
        ? `${plural(outstanding, 'thing')} left to buy`
        : 'All done for today';
  const sub = !planned
    ? 'Start with tonight’s dinner — the shopping list follows on its own.'
    : urgent
      ? 'All three meals logged. Worth planning these in next.'
      : outstanding
        ? 'All three meals logged. The list is waiting on the shop.'
        : 'Three meals logged and nothing outstanding.';

  return `
    <div class="hero">
      <p class="hero__eyebrow">${icon('spark')}${esc(greeting())}</p>
      <p class="hero__line">${esc(line)}<small>${esc(sub)}</small></p>
      ${!planned ? `
        <div class="hero__foot">
          <span class="hero__tag">${icon('plus')}Tap a meal below</span>
        </div>` : ''}
    </div>`;
}

export default {
  id: 'today',
  label: 'Today',
  icon: 'sun',
  title: () => 'Today',
  sub: () => longDate(today()),

  actions: () => `
    <button class="iconbtn" type="button" data-act="settings" aria-label="Settings">${icon('cog')}</button>`,

  badge: () => null,

  render(root, ctx) {
    const date = today();
    const plan = store.dayPlan(date);
    const urgent = store.expiring(2);
    const soon = store.expiring(5);
    const list = store.shoppingList();
    const plannedN = MEALS.filter(m => plan[m.id]).length;

    root.innerHTML = `
      <section class="section">
        ${hero(plan, urgent.length, list.outstanding)}
      </section>

      <section class="section">
        <div class="stattrio">
          <button class="stattile" type="button" data-act="open-plan">
            <b>${plannedN}<small>/3</small></b><span>Meals planned</span>
          </button>
          <button class="stattile ${urgent.length ? 'stattile--pink' : ''}" type="button" data-act="open-inventory">
            <b>${urgent.length}</b><span>Use up now</span>
          </button>
          <button class="stattile ${list.outstanding ? 'stattile--amber' : ''}" type="button" data-act="open-shop">
            <b>${list.outstanding}</b><span>To buy</span>
          </button>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <h2 class="section__title">Today’s meals</h2>
          <button class="btn btn--quiet btn--sm" type="button" data-act="open-plan">Whole week</button>
        </div>
        <div class="slots">
          ${MEALS.map(m => slotCard(m, plan[m.id])).join('')}
        </div>
      </section>

      ${soon.length ? `
        <section class="section">
          <div class="section__head">
            <h2 class="section__title">Use these up</h2>
            <span class="section__note">${plural(soon.length, 'item')}</span>
          </div>
          <div class="rows">
            ${soon.slice(0, 5).map(expiryRow).join('')}
          </div>
          ${soon.length > 5 ? `
            <button class="btn btn--quiet btn--sm" type="button" data-act="open-inventory"
              style="margin:10px auto 0;display:flex">See all ${soon.length}</button>` : ''}
        </section>` : ''}

      <section class="section">
        <div class="stack">
          <button class="btn btn--ghost btn--block" type="button" data-act="add-item">
            ${icon('fridge')}Add to stock
          </button>
        </div>
        <p class="field__hint" style="text-align:center;margin-top:20px;opacity:.7">
          Everything stays on this device.
        </p>
      </section>`;

    /* --- bindings --- */

    root.querySelectorAll('[data-slot]').forEach(el => {
      el.addEventListener('click', () => {
        openMealEditor({ date, mealId: el.dataset.slot, after: ctx.refresh });
      });
    });

    root.querySelectorAll('[data-peek]').forEach(el => {
      el.addEventListener('click', () => openItemPeek({ id: el.dataset.peek, after: ctx.refresh }));
    });

    root.querySelectorAll('[data-act]').forEach(el => {
      el.addEventListener('click', () => this.onAction(el.dataset.act, ctx));
    });

    const focusMeal = root.querySelector(`[data-slot="${currentMealId()}"]`);
    if (focusMeal && !plan[currentMealId()]) focusMeal.classList.add('fade-in');
  },

  onAction(act, ctx) {
    if (act === 'open-plan') ctx.go('plan');
    else if (act === 'open-shop') ctx.go('shop');
    else if (act === 'open-inventory') ctx.go('inventory');
    else if (act === 'add-item') openItemEditor({ after: ctx.refresh });
    else if (act === 'settings') ctx.openSettings();
  },
};

function slotCard(meal, s) {
  if (!s) {
    return `
      <button class="slot slot--${meal.id} is-empty" type="button" data-slot="${meal.id}">
        <span class="slot__mark">${icon(meal.icon)}</span>
        <span class="slot__main">
          <span class="slot__kicker">${esc(meal.label)}</span>
          <span class="slot__name">Nothing planned</span>
        </span>
        <span class="slot__chev">${icon('plus')}</span>
      </button>`;
  }

  const buys = (s.items || []).filter(i => i.source === 'buy').length;
  const froms = (s.items || []).filter(i => i.source === 'inv').length;
  const place = placeOf(s.place);

  return `
    <button class="slot slot--${meal.id}${s.done ? ' is-done' : ''}" type="button" data-slot="${meal.id}">
      <span class="slot__mark">${s.done ? icon('check') : icon(meal.icon)}</span>
      <span class="slot__main">
        <span class="slot__kicker">${esc(meal.label)}</span>
        <span class="slot__name">${esc(s.name)}</span>
        <span class="slot__meta">
          ${place.id === 'work' ? pill(place.label, 'accent', place.icon) : ''}
          ${buys ? pill(`${buys} to buy`, 'warn', 'cart') : ''}
          ${!buys && froms ? pill('All in stock', 'primary', 'check') : ''}
          ${s.done ? pill('Eaten', 'ok', 'check') : ''}
        </span>
      </span>
      <span class="slot__chev">${icon('chevron')}</span>
    </button>`;
}

function expiryRow(it) {
  const ex = expiryInfo(it.useBy);
  const cat = store.catOf(it.category);
  const loc = store.locationOf(it.locId);
  return `
    <button class="row" type="button" data-peek="${esc(it.id)}">
      <span class="row__lead" style="background:${esc(cat.colour)}26;color:${esc(cat.colour)}">
        ${esc(initials(it.name))}
      </span>
      <span class="row__main">
        <span class="row__name">${esc(it.name)}</span>
        <span class="row__sub">
          ${esc(qtyLabel(it.qty, it.unit) || '—')}
          <i class="dot"></i>${esc(loc ? store.locationLabel(loc.id) : 'Unassigned')}
        </span>
      </span>
      <span class="row__tail">${pill(ex.label, ex.tone, ex.n <= 0 ? 'alert' : 'clock')}</span>
    </button>`;
}
