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

  /* --- 14. recipe ingredient parsing ---------------------------------- */
  const { recipe } = window.munch;
  const P = line => JSON.stringify(recipe.parseIngredient(line));

  check('grams', P('600g skinless chicken thighs') ===
        JSON.stringify({ qty: 600, unit: 'g', name: 'Skinless chicken thighs' }), P('600g skinless chicken thighs'));
  check('grams with a space', P('600 g chicken thighs') ===
        JSON.stringify({ qty: 600, unit: 'g', name: 'Chicken thighs' }), P('600 g chicken thighs'));
  check('tablespoons', P('2 tbsp olive oil') ===
        JSON.stringify({ qty: 2, unit: 'tbsp', name: 'Olive oil' }), P('2 tbsp olive oil'));
  check('spelled-out tablespoons', P('2 tablespoons olive oil') ===
        JSON.stringify({ qty: 2, unit: 'tbsp', name: 'Olive oil' }), P('2 tablespoons olive oil'));
  check('teaspoons', P('1 tsp ground cumin') ===
        JSON.stringify({ qty: 1, unit: 'tsp', name: 'Ground cumin' }), P('1 tsp ground cumin'));
  check('cloves', P('3 cloves garlic, crushed') ===
        JSON.stringify({ qty: 3, unit: 'clove', name: 'Garlic' }), P('3 cloves garlic, crushed'));
  check('a tin with a pack size', P('1 x 400g tin chopped tomatoes') ===
        JSON.stringify({ qty: 1, unit: 'tin', name: 'Chopped tomatoes' }), P('1 x 400g tin chopped tomatoes'));
  check('cans read as tins', P('2 cans chickpeas, drained') ===
        JSON.stringify({ qty: 2, unit: 'tin', name: 'Chickpeas' }), P('2 cans chickpeas, drained'));
  check('litres normalise to L', P('1 litre chicken stock') ===
        JSON.stringify({ qty: 1, unit: 'L', name: 'Chicken stock' }), P('1 litre chicken stock'));
  check('kilos', P('1.5kg potatoes') ===
        JSON.stringify({ qty: 1.5, unit: 'kg', name: 'Potatoes' }), P('1.5kg potatoes'));
  check('a bare count is pcs', P('2 lemons, halved') ===
        JSON.stringify({ qty: 2, unit: 'pcs', name: 'Lemons' }), P('2 lemons, halved'));

  /* Unreadable amounts keep the line intact, commas and all. */
  check('a handful keeps its wording', P('A good handful of parsley') ===
        JSON.stringify({ qty: null, unit: '', name: 'A good handful of parsley' }),
        P('A good handful of parsley'));
  check('to taste keeps its comma', P('Salt and pepper, to taste') ===
        JSON.stringify({ qty: null, unit: '', name: 'Salt and pepper, to taste' }),
        P('Salt and pepper, to taste'));

  /* Never invent a conversion. */
  check('no unit is ever converted',
        recipe.parseIngredient('2 tbsp olive oil').unit === 'tbsp' &&
        recipe.parseIngredient('1 tsp cumin').unit === 'tsp');

  /* Aisles */
  check('guesses protein', recipe.guessCategory('Chicken thighs') === 'protein');
  check('guesses produce', recipe.guessCategory('Lemons') === 'produce');
  check('guesses dairy', recipe.guessCategory('Greek yoghurt') === 'dairy');
  check('unknown names fall back to other', recipe.guessCategory('Ras el hanout') === 'other');

  /* The list wrapper attaches the aisle */
  const parsed = recipe.parseIngredients(['600g chicken thighs', 'Salt, to taste']);
  // The aisle is still guessed for a line whose amount could not be read.
  check('parseIngredients attaches a category',
        parsed[0].category === 'protein' && parsed[1].category === 'cupboard',
        JSON.stringify(parsed));
  check('parseIngredients preserves order and length', parsed.length === 2);

  /* --- 14b. regressions found against a real recipe page --------------- */
  /* Substring matching had 'ice' claiming rice, sliced and juice for the freezer. */
  check('rice is a cupboard item, not frozen', recipe.guessCategory('Long grain rice') === 'cupboard',
        recipe.guessCategory('Long grain rice'));
  check('sliced does not mean frozen', recipe.guessCategory('Chorizo') === 'protein',
        recipe.guessCategory('Chorizo'));
  check('juice does not mean frozen', recipe.guessCategory('Orange juice') === 'drinks',
        recipe.guessCategory('Orange juice'));

  /* The head noun decides: chicken stock is stock, not chicken. */
  check('the head noun wins', recipe.guessCategory('Chicken stock') === 'cupboard',
        recipe.guessCategory('Chicken stock'));
  check('but a head noun miss still scans the name',
        recipe.guessCategory('Chicken thighs') === 'protein', recipe.guessCategory('Chicken thighs'));

  /* Plenty of sites omit the comma before the preparation. */
  check('trailing preparation is stripped without a comma',
        P('2 chicken breasts chopped') === JSON.stringify({ qty: 2, unit: 'pcs', name: 'Chicken breasts' }),
        P('2 chicken breasts chopped'));
  check('two trailing preparation words are both stripped',
        P('1 red pepper thinly sliced') === JSON.stringify({ qty: 1, unit: 'pcs', name: 'Red pepper' }),
        P('1 red pepper thinly sliced'));

  /* The unit sometimes trails the name. */
  check('a trailing unit word is adopted',
        P('2 garlic cloves crushed') === JSON.stringify({ qty: 2, unit: 'clove', name: 'Garlic' }),
        P('2 garlic cloves crushed'));
  check('a real unit is never overridden by a trailing word',
        P('600g garlic cloves') === JSON.stringify({ qty: 600, unit: 'g', name: 'Garlic cloves' }),
        P('600g garlic cloves'));

  /* A container after a mass is noise; the mass is the useful amount. */
  check('a container after a mass is dropped',
        P('400g can plum tomato') === JSON.stringify({ qty: 400, unit: 'g', name: 'Plum tomato' }),
        P('400g can plum tomato'));

  /* Stripping must never empty the name. */
  check('a name made only of preparation survives',
        recipe.parseIngredient('2 chopped').name === 'Chopped',
        JSON.stringify(recipe.parseIngredient('2 chopped')));

  /* --- 15. ranking saved meals ---------------------------------------- */
  const LIB = [
    { id: 'a', name: 'Chicken traybake', items: [{ name: 'Chicken thighs' }, { name: 'Lemons' }, { name: 'Potatoes' }] },
    { id: 'b', name: 'Lemon pilaf',      items: [{ name: 'Rice' }, { name: 'Lemons' }] },
    { id: 'c', name: 'Bean chilli',      items: [{ name: 'Beans' }, { name: 'Tomatoes' }] },
  ];
  const STOCK = ['Chicken thighs', 'Lemons', 'Rice'];

  let r = recipe.searchLibrary('chicken', LIB, STOCK);
  check('a name match ranks first', r[0]?.entry.id === 'a', JSON.stringify(r.map(x => x.entry.id)));
  check('non-matching meals are excluded', !r.some(x => x.entry.id === 'c'),
        JSON.stringify(r.map(x => x.entry.id)));

  r = recipe.searchLibrary('lemons', LIB, STOCK);
  check('an ingredient match counts', r.some(x => x.entry.id === 'a') && r.some(x => x.entry.id === 'b'),
        JSON.stringify(r.map(x => x.entry.id)));
  check('the fuller larder wins the tie-break', r[0]?.entry.id === 'b',
        JSON.stringify(r.map(x => `${x.entry.id}:${x.inStock}/${x.total}`)));

  r = recipe.searchLibrary('', LIB, STOCK);
  check('an empty query returns everything', r.length === 3, String(r.length));

  const tray = recipe.searchLibrary('chicken', LIB, STOCK)[0];
  check('in-stock counts are reported', tray.inStock === 2 && tray.total === 3,
        `${tray.inStock}/${tray.total}`);

  /* --- 16. durations --------------------------------------------------- */
  check('minutes', recipe.parseDuration('PT55M') === 55, String(recipe.parseDuration('PT55M')));
  check('hours and minutes', recipe.parseDuration('PT1H30M') === 90, String(recipe.parseDuration('PT1H30M')));
  check('whole hours', recipe.parseDuration('PT2H') === 120, String(recipe.parseDuration('PT2H')));
  check('days', recipe.parseDuration('P1D') === 1440, String(recipe.parseDuration('P1D')));
  /* Zero is bad data, not a fast recipe. */
  check('a parsed zero is null', recipe.parseDuration('PT0S') === null, String(recipe.parseDuration('PT0S')));
  check('PT0M is null', recipe.parseDuration('PT0M') === null, String(recipe.parseDuration('PT0M')));
  check('empty is null', recipe.parseDuration('') === null, String(recipe.parseDuration('')));
  check('undefined is null', recipe.parseDuration(undefined) === null, String(recipe.parseDuration(undefined)));
  check('nonsense is null', recipe.parseDuration('about an hour') === null,
        String(recipe.parseDuration('about an hour')));

  /* --- 17. method normalisation, all four shapes ----------------------- */
  const M = x => JSON.stringify(recipe.normaliseMethod(x));
  check('HowToStep objects', M([{ '@type': 'HowToStep', text: 'Heat the oil.' },
                                { '@type': 'HowToStep', text: 'Add the onion.' }])
        === JSON.stringify(['Heat the oil.', 'Add the onion.']), M([{ text: 'Heat the oil.' }]));
  check('plain strings', M(['Heat the oil.', 'Add the onion.'])
        === JSON.stringify(['Heat the oil.', 'Add the onion.']), '');
  check('one string with newlines', M('Heat the oil.\nAdd the onion.')
        === JSON.stringify(['Heat the oil.', 'Add the onion.']), M('Heat the oil.\nAdd the onion.'));
  check('HowToSection wrapping steps', M([{ '@type': 'HowToSection',
        itemListElement: [{ '@type': 'HowToStep', text: 'Heat the oil.' }] }])
        === JSON.stringify(['Heat the oil.']), '');
  check('embedded HTML is stripped', M(['<p>Heat the <b>oil</b>.</p>'])
        === JSON.stringify(['Heat the oil.']), M(['<p>Heat the <b>oil</b>.</p>']));
  check('empty steps are dropped', M(['Heat the oil.', '', '   ', null])
        === JSON.stringify(['Heat the oil.']), M(['Heat the oil.', '', '   ', null]));
  check('nothing gives an empty list', M(undefined) === JSON.stringify([]), M(undefined));

  /* --- 18. equipment, inferred and stated ------------------------------ */
  const jam = ['Heat 1 tbsp olive oil in a large frying pan with a lid over a medium-high heat.',
               'Tip in the diced onion and cook for 3-4 mins until soft.'];
  const eq = recipe.guessEquipment(jam);
  check('finds the frying pan', eq.includes('frying pan'), JSON.stringify(eq));
  check('does not also list the generic pan', !eq.includes('pan'), JSON.stringify(eq));
  check('invents nothing when no equipment is mentioned',
        recipe.guessEquipment(['Stir everything together and serve.']).length === 0,
        JSON.stringify(recipe.guessEquipment(['Stir everything together and serve.'])));
  check('does not match pan inside pancetta',
        recipe.guessEquipment(['Fry the pancetta until crisp.']).length === 0,
        JSON.stringify(recipe.guessEquipment(['Fry the pancetta until crisp.'])));
  check('a stated tool wins over inference',
        JSON.stringify(recipe.guessEquipment(jam, ['Slow cooker'])) === JSON.stringify(['Slow cooker']),
        JSON.stringify(recipe.guessEquipment(jam, ['Slow cooker'])));
  check('a tool object is read too',
        JSON.stringify(recipe.guessEquipment(jam, [{ name: 'Wok' }])) === JSON.stringify(['Wok']),
        JSON.stringify(recipe.guessEquipment(jam, [{ name: 'Wok' }])));

  /* --- 19. search over tags and cuisine -------------------------------- */
  const LIB2 = [
    { id: 'x', name: 'Jambalaya', cuisine: 'Cajun & Creole', tags: ['rice', 'one pot'], items: [{ name: 'Rice' }] },
    { id: 'y', name: 'Omelette', cuisine: 'French', tags: ['quick'], items: [{ name: 'Eggs' }] },
  ];
  check('a cuisine match is found', recipe.searchLibrary('cajun', LIB2, []).some(r2 => r2.entry.id === 'x'),
        JSON.stringify(recipe.searchLibrary('cajun', LIB2, []).map(r2 => r2.entry.id)));
  check('a tag match is found', recipe.searchLibrary('one pot', LIB2, []).some(r2 => r2.entry.id === 'x'),
        JSON.stringify(recipe.searchLibrary('one pot', LIB2, []).map(r2 => r2.entry.id)));
  check('a non-match is still excluded', !recipe.searchLibrary('cajun', LIB2, []).some(r2 => r2.entry.id === 'y'));

  /* --- 19b. HTML entities, found in real JSON-LD ------------------------ */
  /* BBC Good Food publishes its cuisine as "Cajun &amp; Creole". The app escapes on
     render, so an undecoded entity reaches the screen as "&amp;". */
  check('named entities decode', recipe.decodeEntities('Cajun &amp; Creole') === 'Cajun & Creole',
        recipe.decodeEntities('Cajun &amp; Creole'));
  check('numeric entities decode', recipe.decodeEntities('30&#176;C') === '30°C',
        recipe.decodeEntities('30&#176;C'));
  check('hex entities decode', recipe.decodeEntities('caf&#xe9;') === 'café',
        recipe.decodeEntities('caf&#xe9;'));
  check('fractions decode', recipe.decodeEntities('&frac12; tsp') === '½ tsp',
        recipe.decodeEntities('&frac12; tsp'));
  check('an unknown entity is left alone', recipe.decodeEntities('a &notreal; b') === 'a &notreal; b',
        recipe.decodeEntities('a &notreal; b'));
  check('method steps get decoded too',
        recipe.normaliseMethod(['Heat &amp; stir'])[0] === 'Heat & stir',
        JSON.stringify(recipe.normaliseMethod(['Heat &amp; stir'])));
  /* Decoded last, so an escaped tag in the text is never mistaken for a real one. */
  check('an escaped tag is not treated as markup',
        recipe.normaliseMethod(['Use &lt;b&gt; tags'])[0] === 'Use <b> tags',
        JSON.stringify(recipe.normaliseMethod(['Use &lt;b&gt; tags'])));

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
