/* ==========================================================================
   App shell — routing between the four views, the tab bar, settings, and
   service-worker registration.
   ========================================================================== */

import * as store from './store.js';
import { PLACES, placeOf } from './store.js';
import { $, esc, plural, haptic } from './util.js';
import { icon } from './icons.js';
import {
  openSheet, closeSheet, toast, confirmSheet,
  field, textInput, segmented, bindPickers, readForm,
} from './ui.js';

import today from './views/today.js';
import inventory from './views/inventory.js';
import plan from './views/plan.js';
import shop from './views/shop.js';

const VIEWS = [today, plan, inventory, shop];
const byId = id => VIEWS.find(v => v.id === id) || VIEWS[0];

const els = {
  viewport: $('#viewport'),
  tabbar: $('#tabbar'),
  title: $('#viewTitle'),
  sub: $('#viewSub'),
  actions: $('#viewActions'),
  topbar: $('#topbar'),
};

let current = 'today';

/* --- context handed to every view -------------------------------------- */

const ctx = {
  refresh: () => render(),
  go: id => navigate(id),
  openSettings: () => openSettings(),
};

/* --- rendering ---------------------------------------------------------- */

function render() {
  const view = byId(current);

  els.title.textContent = view.title();
  const sub = view.sub?.() || '';
  els.sub.textContent = sub;
  els.sub.hidden = !sub;

  els.actions.innerHTML = view.actions?.() || '';
  els.actions.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => view.onAction?.(btn.dataset.act, ctx));
  });

  view.render(els.viewport, ctx);
  renderTabs();
}

function renderTabs() {
  els.tabbar.innerHTML = VIEWS.map(v => {
    const n = v.badge?.();
    return `
      <button class="tab" type="button" role="tab" data-view="${esc(v.id)}"
        aria-selected="${v.id === current}">
        ${icon(v.icon)}
        <span class="tab__label">${esc(v.label)}</span>
        ${n ? `<span class="tab__pip">${n > 99 ? '99+' : n}</span>` : ''}
      </button>`;
  }).join('');

  els.tabbar.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
}

function navigate(id) {
  if (id === current) {
    els.viewport.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  current = id;
  history.replaceState(null, '', `#${id}`);
  haptic(6);
  render();
  window.scrollTo({ top: 0 });
  els.viewport.classList.remove('fade-in');
  void els.viewport.offsetWidth; // restart the animation
  els.viewport.classList.add('fade-in');
}

/* --- settings ----------------------------------------------------------- */

function openSettings() {
  const s = store.get();

  const render = () => openSheet({
    title: 'Settings',
    body: `
      <div class="form">
        <div class="field">
          <span class="field__label">Where you keep things</span>
          <div class="rows">
            ${store.locations().map(l => `
              <div class="row row--split">
                <span class="row__hit" style="cursor:default">
                  <span class="row__lead">${icon(placeOf(l.place).icon)}</span>
                  <span class="row__main">
                    <span class="row__name">${esc(l.label)}</span>
                    <span class="row__sub">${esc(placeOf(l.place).label)} · ${store.inventory({ locId: l.id }).length} items</span>
                  </span>
                </span>
                <button class="iconbtn iconbtn--plain" type="button" data-rmloc="${esc(l.id)}"
                  aria-label="Remove ${esc(l.label)}">${icon('trash')}</button>
              </div>`).join('')}
          </div>
        </div>

        <div class="grid-qty">
          ${field({ label: 'Add a place', control: textInput({ name: 'label', placeholder: 'e.g. Garage freezer' }) })}
          ${field({ label: 'Home or work', control: segmented({ name: 'place', value: 'home', options: PLACES.map(p => ({ value: p.id, label: p.label })) }) })}
        </div>
        <button class="btn btn--ghost btn--sm btn--block" type="button" data-addloc>${icon('plus')}Add place</button>

        <div class="divider"></div>

        <div class="field">
          <span class="field__label">How far ahead the list looks</span>
          ${segmented({
            name: 'horizonDays', value: String(s.settings.horizonDays ?? 14),
            options: [{ value: '7', label: '1 week' }, { value: '14', label: '2 weeks' }, { value: '30', label: '1 month' }],
          })}
          <span class="field__hint">Meals beyond this window stay off the shopping list until they come closer.</span>
        </div>

        <div class="divider"></div>

        <div class="stack">
          <div class="card summary">
            <div style="flex:1">
              <div class="summary__t">
                ${plural(s.inventory.length, 'item')} in stock ·
                ${plural(Object.keys(s.plan).length, 'day')} planned ·
                ${plural(s.library.length, 'saved meal')}
              </div>
            </div>
          </div>
          <button class="btn btn--ghost btn--sm btn--block" type="button" data-export>${icon('share')}Export everything</button>
          <button class="btn btn--danger btn--sm btn--block" type="button" data-reset>${icon('refresh')}Start again from scratch</button>
        </div>

        <p class="field__hint" style="text-align:center;margin-top:18px">
          Munch stores everything in this browser. Nothing leaves the device, and clearing your
          browser data clears the app.
        </p>
      </div>`,
    mount(root) {
      bindPickers(root);

      root.querySelector('[data-segmented=horizonDays]').addEventListener('pick', e => {
        store.setSetting('horizonDays', Number(e.detail));
        ctx.refresh();
      });

      root.querySelector('[data-addloc]').addEventListener('click', () => {
        const f = readForm(root);
        if (!f.label) { root.querySelector('[name=label]').focus(); return; }
        store.addLocation(f.label, f.place);
        ctx.refresh();
        render();
      });

      root.querySelectorAll('[data-rmloc]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.rmloc;
          const n = store.inventory({ locId: id }).length;
          confirmSheet({
            title: 'Remove this place?',
            message: n
              ? `${plural(n, 'item')} stored here will move to ${store.locations().find(l => l.id !== id)?.label}.`
              : 'Nothing is stored here, so nothing else changes.',
            confirmLabel: 'Remove',
            danger: true,
            run() {
              if (!store.removeLocation(id)) { toast('Keep at least one place'); return; }
              ctx.refresh();
              render();
            },
          });
        });
      });

      root.querySelector('[data-export]').addEventListener('click', async () => {
        const text = JSON.stringify(store.get(), null, 2);
        try {
          await navigator.clipboard.writeText(text);
          toast('Copied as JSON', { iconName: 'copy' });
        } catch {
          toast('Could not copy — clipboard blocked');
        }
      });

      root.querySelector('[data-reset]').addEventListener('click', () => {
        confirmSheet({
          title: 'Start again?',
          message: 'Your stock, plan and list are wiped and replaced with the sample data the app ships with.',
          confirmLabel: 'Wipe and reset',
          danger: true,
          run() {
            store.resetAll({ seed: true });
            closeSheet();
            navigate('today');
            ctx.refresh();
            toast('Reset', { iconName: 'refresh', action: { label: 'Undo', run: () => { store.undo(); ctx.refresh(); } } });
          },
        });
      });
    },
  });

  render();
}

/* --- chrome ------------------------------------------------------------- */

/* Hairline under the header only once the content has scrolled beneath it. */
function watchScroll() {
  const onScroll = () => {
    els.topbar.classList.toggle('is-stuck', window.scrollY > 4);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* Keep the day-sensitive views honest across midnight and app resume, and never
   leave a debounced save behind when iOS suspends us. */
function watchLifecycle() {
  let seen = new Date().getDate();
  const checkDay = () => {
    const now = new Date().getDate();
    if (now !== seen) { seen = now; render(); }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) store.flush();
    else checkDay();
  });
  window.addEventListener('pagehide', () => store.flush());
  setInterval(checkDay, 60_000);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  // Whether a worker was already driving this page decides what a later
  // controller change means: a first install (nothing to do) or an update
  // that has just swapped the assets under us (reload once onto the new set).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    // updateViaCache: 'none' keeps sw.js itself out of the HTTP cache. GitHub
    // Pages serves it with a ten-minute max-age, which is long enough for an
    // installed app to keep booting the previous version after a deploy.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => reg.update().catch(() => {}))
      .catch(err => console.warn('Munch: service worker not registered', err));
  });
}

/* --- boot --------------------------------------------------------------- */

store.init();
store.subscribe(() => {
  // Persisted; views re-render explicitly via ctx.refresh so we do not fight
  // half-finished sheet interactions.
});

const hash = location.hash.replace('#', '');
if (VIEWS.some(v => v.id === hash)) current = hash;

render();
watchScroll();
watchLifecycle();
registerServiceWorker();

window.addEventListener('hashchange', () => {
  const id = location.hash.replace('#', '');
  if (VIEWS.some(v => v.id === id) && id !== current) { current = id; render(); }
});

// A tiny hook for debugging from Safari's console.
window.munch = { store, refresh: () => render(), go: navigate };
