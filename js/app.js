/* ==========================================================================
   App shell — routing between the four views, the tab bar, settings, and
   service-worker registration.
   ========================================================================== */

import * as store from './store.js';
import * as cloud from './cloud.js';
import * as sync from './sync.js';
import { cloudConfigured } from './config.js';
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
        ${accountBlock()}

        <div class="divider"></div>

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
          <button class="btn btn--ghost btn--sm btn--block" type="button" data-seed>${icon('spark')}Load the sample data</button>
          <button class="btn btn--danger btn--sm btn--block" type="button" data-reset>${icon('trash')}Clear everything</button>
        </div>

        <p class="field__hint" style="text-align:center;margin-top:18px">
          Munch stores everything in this browser. Nothing leaves the device, and clearing your
          browser data clears the app.
        </p>
      </div>`,
    mount(root) {
      bindPickers(root);
      bindAccount(root, render);

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

      root.querySelector('[data-seed]').addEventListener('click', () => {
        confirmSheet({
          title: 'Load the sample data?',
          message: 'This replaces whatever is here now with the example stock, meals and list — '
            + 'handy for a look round, not for real use.',
          confirmLabel: 'Load samples',
          run() {
            store.resetAll({ seed: true });
            closeSheet();
            ctx.refresh();
            toast('Sample data loaded', {
              iconName: 'spark',
              action: { label: 'Undo', run: () => { store.undo(); ctx.refresh(); } },
            });
          },
        });
      });

      root.querySelector('[data-reset]').addEventListener('click', () => {
        const signedIn = sync.snapshot().user;
        confirmSheet({
          title: 'Clear everything?',
          message: 'Your stock, meals, shopping list and saved meals are all removed, leaving the app '
            + 'empty. Where you keep things is kept.'
            + (signedIn ? ' This clears your account too, on every device.' : ''),
          confirmLabel: 'Clear everything',
          danger: true,
          run() {
            store.resetAll({ seed: false });
            closeSheet();
            navigate('today');
            ctx.refresh();
            toast('Cleared', {
              iconName: 'trash',
              action: { label: 'Undo', run: () => { store.undo(); ctx.refresh(); } },
            });
          },
        });
      });
    },
  });

  render();
}

/* --- account & sync ----------------------------------------------------- */

const SYNC_WORDS = {
  off:     ['', ''],
  idle:    ['ok',   'Up to date'],
  syncing: ['primary', 'Syncing…'],
  offline: ['warn', 'Offline — will sync later'],
  error:   ['bad',  'Sync problem'],
};

function accountBlock() {
  if (!cloudConfigured()) {
    return `
      <div class="field">
        <span class="field__label">Sync</span>
        <div class="hintbar hintbar--info">
          ${icon('info')}
          <span>Not set up yet. Add your Supabase project URL and anon key to
          <b>js/config.js</b>, and run <b>supabase/schema.sql</b> in the SQL editor.
          Until then everything stays on this device.</span>
        </div>
      </div>`;
  }

  const s = sync.snapshot();
  const user = s.user;

  if (!user) {
    return `
      <div class="field">
        <span class="field__label">Sync across devices</span>
        <span class="field__hint" style="padding:0">
          Enter your email and we will send a sign-in link — no password. Your
          account starts empty; what is on this device stays on this device.
        </span>
        ${textInput({ name: 'email', value: '', placeholder: 'you@example.com', type: 'email' })}
        <button class="btn btn--sm btn--block" type="button" data-signin style="margin-top:4px">
          ${icon('share')}Email me a sign-in link
        </button>
        <div class="divider" style="margin:14px 4px"></div>
        <span class="field__hint" style="padding:0">
          Tapping the link opens Safari, which on iOS can be a different place from
          your home-screen app — so if it signed in the browser but not here, paste
          the link itself in below instead.
        </span>
        ${textInput({ name: 'pasted', value: '', placeholder: 'Paste the link from the email' })}
        <button class="btn btn--ghost btn--sm btn--block" type="button" data-paste>
          ${icon('check')}Sign in with a pasted link
        </button>
      </div>`;
  }

  const [tone, words] = SYNC_WORDS[s.status] || SYNC_WORDS.idle;
  return `
    <div class="field">
      <span class="field__label">Signed in</span>
      <div class="rows">
        <div class="row" style="cursor:default">
          <span class="row__lead">${icon('spark')}</span>
          <span class="row__main">
            <span class="row__name">${esc(user.email || 'Your account')}</span>
            <span class="row__sub">
              ${esc(words)}${s.lastSynced && s.status === 'idle' ? ` · ${esc(s.lastSynced)}` : ''}
              ${s.pending ? ` · ${s.pending} waiting` : ''}
            </span>
          </span>
          <span class="row__tail">${tone ? `<span class="pill pill--${tone}">${esc(words)}</span>` : ''}</span>
        </div>
      </div>
      ${s.status === 'error' && s.detail ? `
        <div class="hintbar">${icon('alert')}<span>${esc(s.detail)}</span></div>` : ''}
      <div class="grid2" style="margin-top:4px">
        <button class="btn btn--ghost btn--sm" type="button" data-syncnow>${icon('refresh')}Sync now</button>
        <button class="btn btn--ghost btn--sm" type="button" data-signout>${icon('undo')}Sign out</button>
      </div>
    </div>`;
}

function bindAccount(root, reopen) {
  root.querySelector('[data-signin]')?.addEventListener('click', async () => {
    const email = root.querySelector('[name=email]').value.trim();
    if (!email || !email.includes('@')) { root.querySelector('[name=email]').focus(); return; }
    const btn = root.querySelector('[data-signin]');
    btn.disabled = true;
    try {
      await cloud.sendMagicLink(email);
      toast('Check your email for the link', { iconName: 'check', ms: 5000 });
      closeSheet();
    } catch (err) {
      btn.disabled = false;
      toast(err.message || 'Could not send the link', { iconName: 'alert', ms: 5000 });
    }
  });

  root.querySelector('[data-paste]')?.addEventListener('click', async () => {
    const btn = root.querySelector('[data-paste]');
    const text = root.querySelector('[name=pasted]').value;
    btn.disabled = true;
    try {
      await cloud.signInWithPastedLink(text);
      const user = cloud.currentUser();
      store.useAccount(user.id);
      sync.start();
      closeSheet();
      navigate('today');
      ctx.refresh();
      toast(`Signed in as ${user.email || 'your account'}`, { iconName: 'check', ms: 4000 });
    } catch (err) {
      btn.disabled = false;
      toast(err.message || 'Could not sign in', { iconName: 'alert', ms: 6000 });
    }
  });

  root.querySelector('[data-syncnow]')?.addEventListener('click', async () => {
    const ok = await sync.syncNow();
    ctx.refresh();
    reopen();
    if (ok) toast('Synced', { iconName: 'check' });
    else toast(sync.snapshot().detail || 'Could not sync', { iconName: 'alert', ms: 4500 });
  });

  root.querySelector('[data-signout]')?.addEventListener('click', () => {
    confirmSheet({
      title: 'Sign out?',
      message: 'This device goes back to the copy it had before you signed in. '
        + 'Anything synced stays in your account and comes back when you sign in again.',
      confirmLabel: 'Sign out',
      run: async () => {
        await cloud.signOut();
        store.useAccount(null);
        navigate('today');
        ctx.refresh();
        toast('Signed out', { iconName: 'check' });
      },
    });
  });
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
    if (document.hidden) { store.flush(); sync.flush(); }
    else checkDay();
  });
  window.addEventListener('pagehide', () => { store.flush(); sync.flush(); });
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

// A magic-link return arrives with tokens in the fragment, which is also where
// the router keeps the current view — so claim it and clean it up first.
const authReturn = cloud.consumeAuthRedirect();

store.init(cloud.currentUser()?.id || null);
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

sync.start();
sync.subscribe(() => renderTabs());

if (authReturn?.status === 'signed-in') {
  toast(`Signed in as ${authReturn.user.email || 'your account'}`, { iconName: 'check', ms: 4000 });
  render();
} else if (authReturn?.status === 'error') {
  toast(authReturn.message, { iconName: 'alert', ms: 6000 });
}

window.addEventListener('hashchange', () => {
  const id = location.hash.replace('#', '');
  if (VIEWS.some(v => v.id === id) && id !== current) { current = id; render(); }
});

// A tiny hook for debugging from Safari's console.
window.munch = { store, cloud, sync, refresh: () => render(), go: navigate };
