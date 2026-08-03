/* Sync bookkeeping, exercised against the real store in a browser.
 *
 * No Supabase project needed: this drives store.js directly, standing in for the
 * server by hand. It covers what the network cannot be trusted to reveal on a
 * good day — that a change is queued exactly once, that last-write-wins picks the
 * right side, that a deletion propagates as a tombstone rather than reappearing,
 * and that signing in and out never mixes two workspaces together.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  // A blocked or absent Supabase host is the condition the last block tests, and
  // is also how this sandbox behaves — the app is required to survive it, not to
  // avoid logging it.
  if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) return;
  errors.push('console: ' + m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

const results = await page.evaluate(() => {
  const { store } = window.munch;
  const out = [];
  const check = (name, pass, detail = '') => out.push({ name, pass, detail });
  const iso = d => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const today = iso(new Date());
  const find = (recs, kind, id) => recs.find(r => r.kind === kind && r.id === id);

  /* --- 1. a plain load queues nothing ---------------------------------- */
  store.markPushed(store.pendingRecords().map(r => r.key));
  check('nothing is pending once caught up', store.pendingCount() === 0, String(store.pendingCount()));

  /* --- 2. one edit, one queued record ---------------------------------- */
  const item = store.addInvItem({ name: 'Sync sprouts', qty: 400, unit: 'g', category: 'produce',
                                  locId: store.locations()[0].id });
  let pending = store.pendingRecords();
  const rec = find(pending, 'inventory', item.id);
  check('an added item is queued', !!rec && rec.payload.name === 'Sync sprouts', JSON.stringify(rec));
  check('only the changed record is queued', pending.length === 1, `${pending.length} queued`);

  /* --- 3. editing again does not queue it twice ------------------------ */
  store.updateInvItem(item.id, { qty: 500 });
  pending = store.pendingRecords();
  check('re-editing does not duplicate the record',
        pending.filter(r => r.kind === 'inventory' && r.id === item.id).length === 1,
        `${pending.length} queued`);

  /* --- 4. a delete queues a tombstone, not a disappearance ------------- */
  store.markPushed(store.pendingRecords().map(r => r.key));
  store.removeInvItem(item.id);
  pending = store.pendingRecords();
  const tomb = find(pending, 'inventory', item.id);
  check('a deletion is queued as a tombstone', !!tomb && tomb.deleted === true, JSON.stringify(tomb));

  /* --- 5. a newer remote copy wins ------------------------------------- */
  store.markPushed(store.pendingRecords().map(r => r.key));
  const other = store.addInvItem({ name: 'Remote rice', qty: 1, unit: 'kg', category: 'cupboard',
                                   locId: store.locations()[0].id });
  store.markPushed(store.pendingRecords().map(r => r.key));
  store.applyRemote([{
    kind: 'inventory', id: other.id,
    payload: { ...store.invItem(other.id), name: 'Remote rice', qty: 9 },
    updated_at: new Date(Date.now() + 60_000).toISOString(),
    synced_at: new Date().toISOString(), deleted_at: null,
  }]);
  check('a newer remote edit is applied', store.invItem(other.id)?.qty === 9,
        String(store.invItem(other.id)?.qty));

  /* --- 6. an older remote copy loses ----------------------------------- */
  store.updateInvItem(other.id, { qty: 4 });
  store.applyRemote([{
    kind: 'inventory', id: other.id,
    payload: { ...store.invItem(other.id), qty: 99 },
    updated_at: new Date(Date.now() - 60_000).toISOString(),
    synced_at: new Date().toISOString(), deleted_at: null,
  }]);
  check('an older remote edit is ignored', store.invItem(other.id)?.qty === 4,
        String(store.invItem(other.id)?.qty));

  /* --- 7. a remote tombstone removes the item ------------------------- */
  store.applyRemote([{
    kind: 'inventory', id: other.id, payload: null,
    updated_at: new Date(Date.now() + 120_000).toISOString(),
    synced_at: new Date().toISOString(),
    deleted_at: new Date(Date.now() + 120_000).toISOString(),
  }]);
  check('a remote tombstone removes the item locally', !store.invItem(other.id));

  /* --- 8. meals round-trip through the record shape ------------------- */
  store.saveSlot(today, 'dinner', {
    name: 'Sync stew', place: 'home',
    items: [{ name: 'Barley', qty: 200, unit: 'g', category: 'cupboard', source: 'buy' }],
  });
  pending = store.pendingRecords();
  const slotRec = find(pending, 'slot', `${today}|dinner`);
  check('a meal is queued as one slot record', !!slotRec && slotRec.payload.name === 'Sync stew',
        JSON.stringify(slotRec && slotRec.id));

  store.markPushed(pending.map(r => r.key));
  store.clearSlot(today, 'dinner');
  const slotTomb = find(store.pendingRecords(), 'slot', `${today}|dinner`);
  check('clearing a meal queues a slot tombstone', !!slotTomb && slotTomb.deleted === true);

  // ...and a remote slot lands back in the plan.
  store.applyRemote([{
    kind: 'slot', id: `${today}|lunch`,
    payload: { name: 'Remote soup', place: 'work', items: [], note: '', done: false },
    updated_at: new Date(Date.now() + 60_000).toISOString(),
    synced_at: new Date().toISOString(), deleted_at: null,
  }]);
  check('a remote meal appears in the plan', store.slot(today, 'lunch')?.name === 'Remote soup',
        String(store.slot(today, 'lunch')?.name));

  /* --- 9. settings and ticks are syncable too ------------------------- */
  store.setSetting('horizonDays', 7);
  check('a settings change is queued', !!find(store.pendingRecords(), 'setting', 'app'));

  /* --- 10. signing in opens an empty, separate workspace -------------- */
  const beforeCount = store.get().inventory.length;
  store.useAccount('test-user-1');
  const accountEmpty = store.get().inventory.length === 0;
  const accountHasPlaces = store.locations().length > 0;
  check('an account starts with no stock', accountEmpty, `${store.get().inventory.length} items`);
  check('an account still has somewhere to put things', accountHasPlaces);
  check('an empty account queues nothing to push', store.pendingCount() === 0,
        `${store.pendingCount()} queued`);

  store.addInvItem({ name: 'Account apples', qty: 3, unit: 'pcs', category: 'produce',
                     locId: store.locations()[0].id });

  /* --- 11. signing out hands the device copy straight back ------------ */
  store.useAccount(null);
  const backToLocal = store.get().inventory.length === beforeCount;
  const noLeak = !store.get().inventory.some(i => i.name === 'Account apples');
  check('signing out restores the device copy', backToLocal,
        `${store.get().inventory.length} vs ${beforeCount}`);
  check('account data does not leak into the device copy', noLeak);

  /* --- 12. and the account keeps its own on return -------------------- */
  store.useAccount('test-user-1');
  check('the account keeps its own data',
        store.get().inventory.some(i => i.name === 'Account apples'));
  store.useAccount(null);

  return out;
});

/* --- signed in, but the server cannot be reached ------------------------- */
/* The whole point of local-first is that this is a status line, not an outage.
 * Forge a session, reload, and require a working app anyway. */

await page.evaluate(() => {
  localStorage.setItem('munch.session', JSON.stringify({
    accessToken: 'forged.for.test',
    refreshToken: 'forged',
    expiresAt: Date.now() + 3600_000,
    userId: 'offline-test-user',
    email: 'offline@example.invalid',
  }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const offline = await page.evaluate(async () => {
  const { store, sync, cloud } = window.munch;
  return {
    booted: document.querySelectorAll('.tab').length === 4,
    signedIn: cloud.signedIn(),
    // The account workspace, not the device one.
    accountWorkspace: store.get().inventory.length === 0,
    syncStatus: sync.snapshot().status,
    // And the app must still take an edit while the server is unreachable.
    acceptsEdits: (() => {
      const before = store.get().inventory.length;
      store.addInvItem({ name: 'Written while offline', qty: 1, unit: 'pcs',
                         category: 'other', locId: store.locations()[0].id });
      return store.get().inventory.length === before + 1;
    })(),
    queued: store.pendingCount() > 0,
  };
});

const softFail = ['offline', 'error'].includes(offline.syncStatus);
results.push(
  { name: 'a signed-in device boots with the server unreachable', pass: offline.booted, detail: '' },
  { name: 'it opens the account workspace, not the device one', pass: offline.accountWorkspace, detail: '' },
  { name: 'an unreachable server is a status, not a crash', pass: softFail, detail: offline.syncStatus },
  { name: 'edits still work with no server', pass: offline.acceptsEdits, detail: '' },
  { name: 'those edits are queued for later', pass: offline.queued, detail: '' },
);

// Leave no forged session behind.
await page.evaluate(() => localStorage.removeItem('munch.session'));

for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `   [${r.detail}]`}`);
}

const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
