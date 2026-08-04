/* ==========================================================================
   App shell — routing between the four views, the tab bar, settings, and
   service-worker registration.
   ========================================================================== */

import * as store from './store.js';
import * as cloud from './cloud.js';
import * as sync from './sync.js';
import * as recipe from './recipe.js';
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

        <p class="field__hint" style="text-align:center;margin-top:12px">
          Build <span class="tnum" data-build>checking…</span>
        </p>
      </div>`,
    mount(root) {
      bindPickers(root);
      bindAccount(root, render);

      runningBuild().then(build => {
        const el = root.querySelector('[data-build]');
        if (!el) return;   // the sheet was closed before the worker answered
        el.textContent = build ?? 'no service worker';
      });

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
    const pending = cloud.pendingEmail();
    return `
      <div class="field">
        <span class="field__label">Sync across devices</span>
        <span class="field__hint" style="padding:0">
          Your account starts empty; what is on this device stays on this device.
        </span>
        ${textInput({ name: 'email', value: pending, placeholder: 'you@example.com', type: 'email' })}
        <button class="btn btn--sm btn--block" type="button" data-signin style="margin-top:4px">
          ${icon('share')}${pending ? 'Send another email' : 'Email me a sign-in code'}
        </button>

        ${pending ? `
          <div class="divider" style="margin:14px 4px"></div>
          <span class="field__label">Finish signing in</span>
          <span class="field__hint" style="padding:0">
            Tapping the link in the email signs in Safari, not this app — iOS keeps
            them separate. Use the code from the email instead, or paste the link itself.
          </span>
          ${textInput({ name: 'code', value: '', placeholder: '6-digit code', attrs: 'inputmode="numeric" autocomplete="one-time-code"' })}
          <button class="btn btn--sm btn--block" type="button" data-code>${icon('check')}Sign in with code</button>
          ${textInput({ name: 'pasted', value: '', placeholder: 'or paste the link from the email' })}
          <button class="btn btn--ghost btn--sm btn--block" type="button" data-paste>
            ${icon('check')}Sign in with pasted link
          </button>` : ''}

        <div class="divider" style="margin:14px 4px"></div>
        <span class="field__label">Already signed in elsewhere</span>
        <span class="field__hint" style="padding:0">
          Quickest route, and it needs no email at all. On the device that is already
          signed in, open Settings and copy its transfer code, then paste it here.
        </span>
        ${textInput({ name: 'transfer', value: '', placeholder: 'munch1:…' })}
        <button class="btn btn--ghost btn--sm btn--block" type="button" data-transfer-in>
          ${icon('copy')}Use a transfer code
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
      <button class="btn btn--ghost btn--sm btn--block" type="button" data-transfer-out>
        ${icon('copy')}Copy transfer code for another device
      </button>
      <span class="field__hint" style="padding:0">
        Paste it into Settings on your home-screen app or laptop to sign that in without
        another email. Treat it like a password, and note it may sign this one out.
      </span>
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
      cloud.setPendingEmail(email);
      toast('Email sent — use the code in it', { iconName: 'check', ms: 5000 });
      reopen();
    } catch (err) {
      btn.disabled = false;
      const limited = /rate|limit|too many|429/i.test(err.message || '');
      toast(limited
        ? 'Email limit reached — wait an hour, or use a transfer code'
        : (err.message || 'Could not send the email'), { iconName: 'alert', ms: 6500 });
    }
  });

  /* One place for everything that ends with a session in hand. */
  const finish = async (btnSel, run) => {
    const btn = root.querySelector(btnSel);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await run();
        const user = cloud.currentUser();
        cloud.clearPendingEmail();
        store.useAccount(user.id);
        sync.start();
        closeSheet();
        navigate('today');
        ctx.refresh();
        toast(`Signed in as ${user.email || 'your account'}`, { iconName: 'check', ms: 4000 });
      } catch (err) {
        btn.disabled = false;
        toast(err.message || 'Could not sign in', { iconName: 'alert', ms: 6500 });
      }
    });
  };

  finish('[data-code]', () => cloud.signInWithCode(
    root.querySelector('[name=email]')?.value.trim() || cloud.pendingEmail(),
    root.querySelector('[name=code]').value,
  ));

  finish('[data-transfer-in]', () => cloud.signInWithTransfer(
    root.querySelector('[name=transfer]').value,
  ));

  root.querySelector('[data-transfer-out]')?.addEventListener('click', async () => {
    try {
      const code = cloud.exportTransfer();
      await navigator.clipboard.writeText(code);
      toast('Transfer code copied — paste it into the other app', { iconName: 'copy', ms: 5000 });
    } catch {
      // Clipboard access can be refused, so fall back to showing it to copy by hand.
      try {
        const code = cloud.exportTransfer();
        openSheet({
          title: 'Transfer code',
          body: `
            <div class="form">
              <span class="field__hint" style="padding:0">
                Select all of this and copy it, then paste it into Settings on the other
                app. It is as sensitive as a password.
              </span>
              <textarea class="textarea" readonly rows="4"
                style="font-family:ui-monospace,monospace;font-size:12px">${esc(code)}</textarea>
              <button class="btn btn--block" type="button" data-close>Done</button>
            </div>`,
        });
      } catch (err) {
        toast(err.message || 'Could not make a code', { iconName: 'alert' });
      }
    }
  });

  finish('[data-paste]', () => cloud.signInWithPastedLink(
    root.querySelector('[name=pasted]').value,
  ));

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

/**
 * Which build is driving this page, asked of the worker itself.
 *
 * Deliberately not read by fetching sw.js: that reports what the *server* has,
 * and those two numbers differ in exactly the case worth diagnosing — an
 * installed app still running an older worker. Resolves to null when no worker
 * is in control, which covers a plain http:// LAN server and the moment before
 * a first install takes over.
 */
function runningBuild(timeoutMs = 1500) {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve(null);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const settle = value => { clearTimeout(timer); resolve(value || null); };
    channel.port1.onmessage = e => settle(e.data);
    try {
      sw.postMessage('build', [channel.port2]);
    } catch {
      settle(null);   // an older worker with no message handler
    }
  });
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
window.munch = { store, cloud, sync, recipe, refresh: () => render(), go: navigate };
