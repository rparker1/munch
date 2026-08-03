/* ==========================================================================
   Sync engine — local-first.

   The device's own copy stays the working copy: every read and write in the app
   goes to the local store and returns immediately, so the app opens and edits
   with no connection at all. This module carries changes up and brings other
   devices' changes down behind that, and is allowed to fail: a failed sync is a
   status line, never a lost edit.

   Conflicts resolve last-write-wins per record, which for one person's food data
   across a phone and a laptop is the right amount of machinery. Two devices
   editing the *same* item within a sync window means one edit is dropped; two
   devices editing different items both survive.
   ========================================================================== */

import * as store from './store.js';
import * as cloud from './cloud.js';
import { cloudConfigured } from './config.js';

const listeners = new Set();

let status = 'off';        // off | idle | syncing | error | offline
let detail = '';
let lastSyncedLabel = '';
let timer = null;
let running = false;
let queued = false;

export function subscribe(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}

export const snapshot = () => ({
  status,
  detail,
  lastSynced: lastSyncedLabel,
  pending: cloudConfigured() && cloud.signedIn() ? store.pendingCount() : 0,
  user: cloud.currentUser(),
  configured: cloudConfigured(),
});

function announce(next, note = '') {
  status = next;
  detail = note;
  const snap = snapshot();
  listeners.forEach(fn => fn(snap));
}

/**
 * One full cycle: push what is pending, then pull what is new.
 *
 * Push first so that a record this device just changed cannot be overwritten by
 * the copy it is about to pull back.
 */
export async function syncNow({ quiet = false } = {}) {
  if (!cloudConfigured() || !cloud.signedIn()) { announce('off'); return false; }
  if (running) { queued = true; return false; }

  running = true;
  if (!quiet) announce('syncing');

  try {
    const pending = store.pendingRecords();
    if (pending.length) {
      await cloud.push(pending);
      store.markPushed(pending.map(r => r.key));
    }

    const since = store.syncedAt();
    const rows = await cloud.pull(since);
    if (rows.length) {
      store.applyRemote(rows);
      // Advance the watermark to the newest row the server gave us, so a record
      // written between the pull and now is not skipped next time.
      const newest = rows.reduce((a, r) => (r.synced_at > a ? r.synced_at : a), since || '');
      if (newest) store.setSyncedAt(newest);
    } else if (!since) {
      store.setSyncedAt(await cloud.serverNow());
    }

    lastSyncedLabel = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    announce('idle');
    return true;
  } catch (err) {
    const offline = !navigator.onLine || /failed to fetch|networkerror|load failed/i.test(err.message || '');
    announce(offline ? 'offline' : 'error', offline ? 'Waiting for a connection' : (err.message || 'Sync failed'));
    return false;
  } finally {
    running = false;
    if (queued) { queued = false; setTimeout(() => syncNow({ quiet: true }), 300); }
  }
}

/* --- scheduling ---------------------------------------------------------- */

/** Nudge a sync shortly after a change, so bursts of edits go up together. */
export function schedule(ms = 1500) {
  if (!cloudConfigured() || !cloud.signedIn()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow({ quiet: true }), ms);
}

export function start() {
  if (!cloudConfigured()) { announce('off'); return; }
  if (!cloud.signedIn()) { announce('off'); return; }

  announce('idle');
  syncNow({ quiet: true });

  // Every local change queues a push.
  store.subscribe(() => schedule());

  // Coming back to the app, or back onto a network, is worth a look.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncNow({ quiet: true });
  });
  window.addEventListener('online', () => syncNow({ quiet: true }));
  setInterval(() => syncNow({ quiet: true }), 5 * 60_000);
}

/** Flush before the app is suspended, so the last edit is not left behind. */
export function flush() {
  if (!cloudConfigured() || !cloud.signedIn()) return;
  clearTimeout(timer);
  if (store.pendingCount()) syncNow({ quiet: true });
}
