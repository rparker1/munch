/* Functional checks against the real store module, driven in the browser. */
import { chromium } from 'playwright';

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
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
  const tomorrow = iso(new Date(Date.now() + 864e5));

  /* --- 1. a buy ingredient reaches the shopping list ------------------- */
  store.saveSlot(tomorrow, 'lunch', {
    name: 'Test soup', place: 'home',
    items: [{ name: 'Leeks', qty: 3, unit: 'pcs', category: 'produce', source: 'buy' }],
  });
  let line = store.shoppingList().all.find(l => l.name === 'Leeks');
  check('buy ingredient appears on the list', !!line, JSON.stringify(line));

  /* --- 2. the same item on two meals merges and sums ------------------- */
  store.saveSlot(tomorrow, 'dinner', {
    name: 'Test bake', place: 'home',
    items: [{ name: 'leeks', qty: 2, unit: 'pcs', category: 'produce', source: 'buy' }],
  });
  line = store.shoppingList().all.find(l => l.name === 'Leeks');
  check('duplicate names merge and sum', line?.qty === 5 && line.refs.length === 2,
        `qty=${line?.qty} refs=${line?.refs.length}`);

  /* --- 3. put away -> lands in stock AND the meals switch to stock ----- */
  const locId = store.locations()[0].id;
  store.stockUp(line, { locId, useBy: '', category: 'produce' });
  const inStock = store.get().inventory.find(i => i.name === 'Leeks');
  const stillOnList = store.shoppingList().all.some(l => l.name === 'Leeks');
  const reptd = ['lunch', 'dinner'].every(m =>
    store.slot(tomorrow, m).items.every(i => i.source === 'inv' && i.invId === inStock?.id));
  check('put away creates the stock item', !!inStock, JSON.stringify(inStock));
  check('put away removes the line', !stillOnList);
  check('put away re-points both meals to stock', reptd);

  /* --- 4. tidying the list must not resurrect it ----------------------- */
  store.clearTicked();
  check('tidying does not resurrect the line', !store.shoppingList().all.some(l => l.name === 'Leeks'));

  /* --- 5. cooking draws down the inventory ---------------------------- */
  const before = store.invItem(inStock.id).qty;   // 5 pcs
  store.cookSlot(tomorrow, 'lunch');              // lunch wants 3
  const after = store.invItem(inStock.id)?.qty;
  check('cooking deducts the amount used', after === before - 3, `${before} -> ${after}`);
  check('cooked meal is flagged done', store.slot(tomorrow, 'lunch').done === true);

  /* --- 6. undo restores the previous state ---------------------------- */
  store.undo();
  check('undo restores the amount', store.invItem(inStock.id).qty === before,
        String(store.invItem(inStock.id).qty));
  check('undo un-flags the meal', store.slot(tomorrow, 'lunch').done === false);

  /* --- 7. cooking to zero removes the item entirely -------------------- */
  store.saveSlot(today, 'breakfast', {
    name: 'Finish the leeks', place: 'home',
    items: [{ name: 'Leeks', qty: 99, unit: 'pcs', category: 'produce', source: 'inv', invId: inStock.id }],
  });
  store.cookSlot(today, 'breakfast');
  check('an emptied item leaves the inventory', !store.invItem(inStock.id));

  /* --- 8. deleting stock unlinks it from meals ------------------------- */
  const item = store.addInvItem({ name: 'Test butter', qty: 250, unit: 'g', category: 'dairy', locId });
  store.saveSlot(today, 'dinner', {
    name: 'Buttery thing', place: 'home',
    items: [{ name: 'Test butter', qty: 50, unit: 'g', category: 'dairy', source: 'inv', invId: item.id }],
  });
  store.removeInvItem(item.id);
  const ing = store.slot(today, 'dinner').items[0];
  check('deleting stock moves the ingredient to buy', ing.source === 'buy' && ing.invId === null,
        JSON.stringify(ing));
  check('the unlinked ingredient shows on the list',
        store.shoppingList().all.some(l => l.name === 'Test butter'));

  /* --- 9. the horizon keeps far-off meals off the list ----------------- */
  const far = iso(new Date(Date.now() + 20 * 864e5));
  store.saveSlot(far, 'dinner', {
    name: 'Far future', place: 'home',
    items: [{ name: 'Quince', qty: 1, unit: 'pcs', category: 'produce', source: 'buy' }],
  });
  const beyond = !store.shoppingList().all.some(l => l.name === 'Quince');
  store.setSetting('horizonDays', 30);
  const within = store.shoppingList().all.some(l => l.name === 'Quince');
  check('meals beyond the horizon stay off the list', beyond);
  check('widening the horizon pulls them in', within);

  /* --- 10. work/home separation --------------------------------------- */
  const workLoc = store.locationsFor('work')[0].id;
  store.addInvItem({ name: 'Desk oats', qty: 500, unit: 'g', category: 'cupboard', locId: workLoc });
  const atWork = store.inventory({ place: 'work' }).some(i => i.name === 'Desk oats');
  const atHome = store.inventory({ place: 'home' }).some(i => i.name === 'Desk oats');
  check('work stock is filtered to work', atWork && !atHome);

  /* --- 11. expiry banding --------------------------------------------- */
  store.addInvItem({ name: 'Old milk', qty: 1, unit: 'L', category: 'dairy', locId,
                     useBy: iso(new Date(Date.now() - 2 * 864e5)) });
  check('overdue stock is reported as expiring', store.expiring(0).some(i => i.name === 'Old milk'));

  /* --- 13. part-used fraction ----------------------------------------- */
  const tinId = store.addInvItem({
    name: 'Test tin', qty: 1, unit: 'tin', category: 'cupboard', locId,
  }).id;
  check('a new item starts with no fraction', store.invItem(tinId).remaining === null,
        `remaining=${store.invItem(tinId).remaining}`);

  store.setRemaining(tinId, 0.65);
  check('setRemaining stores the fraction', store.invItem(tinId).remaining === 0.65,
        `remaining=${store.invItem(tinId).remaining}`);

  store.setRemaining(tinId, 1.4);
  check('setRemaining clamps above 1', store.invItem(tinId).remaining === 1,
        `remaining=${store.invItem(tinId).remaining}`);

  store.setRemaining(tinId, -0.2);
  check('setRemaining clamps below 0', store.invItem(tinId).remaining === 0,
        `remaining=${store.invItem(tinId).remaining}`);

  store.setRemaining(tinId, 0.6666);
  check('setRemaining rounds to 2dp', store.invItem(tinId).remaining === 0.67,
        `remaining=${store.invItem(tinId).remaining}`);

  store.setRemaining(tinId, null);
  check('setRemaining clears back to null', store.invItem(tinId).remaining === null,
        `remaining=${store.invItem(tinId).remaining}`);

  /* 0% is a resting state, not a deletion */
  store.setRemaining(tinId, 0);
  check('an empty item stays in stock', !!store.invItem(tinId));

  /* an edit that does not mention the fraction must not wipe it */
  store.setRemaining(tinId, 0.5);
  store.updateInvItem(tinId, { note: 'opened Tuesday' });
  check('editing another field keeps the fraction', store.invItem(tinId).remaining === 0.5,
        `remaining=${store.invItem(tinId).remaining}`);

  /* switching to a non-partable unit hides it but must not destroy it */
  store.updateInvItem(tinId, { unit: 'g' });
  check('a non-partable unit keeps the stored fraction', store.invItem(tinId).remaining === 0.5,
        `remaining=${store.invItem(tinId).remaining}`);

  check('PARTABLE excludes g and pcs', !store.PARTABLE.has('g') && !store.PARTABLE.has('pcs'));
  check('PARTABLE includes every container unit',
        ['pack', 'tin', 'bottle', 'loaf', 'bunch'].every(u => store.PARTABLE.has(u)));

  /* --- 12. the shared list survives a reload -------------------------- */
  return out;
});

for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `   [${r.detail}]`}`);
}

// persistence
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
const persisted = await page.evaluate(() => {
  const s = window.munch.store.get();
  // Deliberately distinctive: the seed data ships a 'Chopped tomatoes' tin, and
  // find() would match that one — which has no fraction — instead of ours.
  const tin = s.inventory.find(i => i.name === 'Test tin');
  return s.inventory.some(i => i.name === 'Desk oats')
      && s.settings.horizonDays === 30
      && tin?.remaining === 0.5;
});
console.log(`${persisted ? 'PASS' : 'FAIL'}  state and settings survive a reload`);

const failed = results.filter(r => !r.pass).length + (persisted ? 0 : 1);
console.log(`\n${results.length + 1 - failed}/${results.length + 1} passed`);
console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
process.exit(failed ? 1 : 0);
