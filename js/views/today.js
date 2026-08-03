/* ==========================================================================
   Today — the landing view. What you are eating, what needs using up, and
   how much is still outstanding on the list.
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

function headline(plan, expiringSoon, outstanding) {
  const planned = MEALS.filter(m => plan[m.id]);
  const next = MEALS.find(m => plan[m.id] && !plan[m.id].done);

  if (!planned.length) {
    return 'Nothing planned yet — start with tonight’s dinner and the list will follow.';
  }
  if (next) {
    const s = plan[next.id];
    const where = s.place === 'work' ? ' at work' : '';
    return `Next up: <strong>${esc(s.name)}</strong>${where}.`;
  }
  if (expiringSoon) return `All three meals logged. ${plural(expiringSoon, 'item')} still needs using up.`;
  if (outstanding) return `All three meals logged. ${plural(outstanding, 'thing')} left to buy.`;
  return 'All three meals logged. Nothing outstanding — good day.';
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
        <div class="hero">
          <p class="hero__eyebrow">${esc(greeting())}</p>
          <p class="hero__line">${headline(plan, urgent.length, list.outstanding)}</p>
          <div class="hero__stats">
            <div class="hero__stat"><b>${plannedN}<small>/3</small></b><span>Planned</span></div>
            <div class="hero__stat"><b>${urgent.length}</b><span>Use up</span></div>
            <div class="hero__stat"><b>${list.outstanding}</b><span>To buy</span></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <h2 class="section__title">Today’s meals</h2>
          <button class="btn btn--quiet btn--sm" type="button" data-act="open-plan">Whole week</button>
        </div>
        <div class="slots">
          ${MEALS.map(m => slotCard(date, m, plan[m.id])).join('')}
        </div>
      </section>

      ${soon.length ? `
        <section class="section">
          <div class="section__head">
            <h2 class="section__title">Use these up</h2>
            <span class="section__note">${plural(soon.length, 'item')}</span>
          </div>
          <div class="rows">
            ${soon.slice(0, 6).map(expiryRow).join('')}
          </div>
          ${soon.length > 6 ? `
            <button class="btn btn--quiet btn--sm" type="button" data-act="open-inventory"
              style="margin:8px auto 0;display:flex">See all ${soon.length}</button>` : ''}
        </section>` : ''}

      <section class="section">
        <div class="section__head"><h2 class="section__title">Quick add</h2></div>
        <div class="stack">
          <button class="btn btn--ghost btn--block" type="button" data-act="add-item">
            ${icon('fridge')}Something new in stock
          </button>
          <button class="btn btn--ghost btn--block" type="button" data-act="open-shop">
            ${icon('cart')}${list.outstanding ? `Shopping list · ${plural(list.outstanding, 'item')}` : 'Shopping list'}
          </button>
        </div>
      </section>

      <p class="field__hint" style="text-align:center;margin-top:26px;opacity:.7">
        Munch keeps everything on this device only.
      </p>`;

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
      el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'open-plan') ctx.go('plan');
        else if (act === 'open-shop') ctx.go('shop');
        else if (act === 'open-inventory') ctx.go('inventory');
        else if (act === 'add-item') openItemEditor({ after: ctx.refresh });
        else if (act === 'settings') ctx.openSettings();
      });
    });

    // Nudge the meal that fits the time of day.
    const focusMeal = root.querySelector(`[data-slot="${currentMealId()}"]`);
    if (focusMeal && !plan[currentMealId()]) focusMeal.classList.add('fade-in');
  },

  onAction(act, ctx) {
    if (act === 'settings') ctx.openSettings();
  },
};

function slotCard(date, meal, s) {
  if (!s) {
    return `
      <button class="slot slot--${meal.id} is-empty" type="button" data-slot="${meal.id}">
        <span class="slot__mark">${icon(meal.icon)}</span>
        <span class="slot__main">
          <span class="slot__kicker">${esc(meal.label)}</span>
          <span class="slot__name">Nothing planned — tap to add</span>
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
          ${froms ? pill(`${froms} from stock`, 'primary') : ''}
          ${buys ? pill(`${buys} to buy`, 'warn', 'cart') : ''}
          ${s.done ? pill('Eaten', 'ok', 'check') : ''}
        </span>
      </span>
      <span class="slot__chev">${icon('chevron')}</span>
    </button>`;
}

function expiryRow(it) {
  const ex = expiryInfo(it.useBy);
  const loc = store.locationOf(it.locId);
  return `
    <button class="row" type="button" data-peek="${esc(it.id)}">
      <span class="row__lead" style="background:${esc(store.catOf(it.category).colour)}1F;color:${esc(store.catOf(it.category).colour)}">
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
