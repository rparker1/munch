# The Recipes section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a recipe's method, timings and cuisine on import, and add a Recipes tab where the collection can be browsed, read and cooked from.

**Architecture:** Three more pure functions in `js/recipe.js` (durations, method normalisation, equipment inference) keep all parsing unit-testable with no network. The Edge Function gains passthrough fields only — it still parses nothing. `library` records gain optional fields and a nullable `mealId`, so a saved recipe belongs to any slot. A new `js/views/recipes.js` implements the existing view contract as a fifth tab.

**Tech Stack:** Plain ES modules, no build step, no client dependencies. Deno/TypeScript for the Edge Function. Playwright for browser tests.

## Global Constraints

- No client dependencies and no build step.
- `store.js` is the only module that touches persisted state. `recipe.js` returns plain objects and never writes.
- Every mutation funnels through `commit()`. Never hand-stamp a sync clock.
- Dark only. UK English in all user-facing copy.
- **Nothing is ever converted between units.**
- Inferred equipment renders under **"From the method"**, never "Equipment".
- `parseDuration` returns `null` for unparseable input *and* for a parsed zero.
- No Supabase migration: `kind` stays `'library'`.
- Every new `library` field is optional; existing entries must stay valid untouched.
- New modules MUST be added to `sw.js`'s `SHELL` list — `tests/syntax.mjs` enforces it.
- Serve for tests with `python3 -m http.server 8765`; use `/opt/homebrew/opt/node@24/bin/node`; pass `CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
- Supabase project ref `aaticbarhuvbjmfjtfey`, function name `recipe`, `verify_jwt` stays **false**.

---

### Task 1: `recipe.js` — durations, method, equipment, richer search

**Files:**
- Modify: `js/recipe.js`
- Test: `tests/logic.mjs` (append inside the `page.evaluate` block, before `return out;`)

**Interfaces:**
- Produces:
  - `export function parseDuration(iso: string): number|null` — whole minutes; `null` for unparseable or zero
  - `export function normaliseMethod(instructions: unknown): string[]`
  - `export function guessEquipment(method: string[], tool?: unknown): string[]`
  - `export const EQUIPMENT_WORDS: string[]`
  - `searchLibrary` additionally matches `entry.tags` and `entry.cuisine`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

```sh
python3 -m http.server 8765 &
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: a `pageerror` — `recipe.parseDuration is not a function`.

- [ ] **Step 3: Implement**

Append to `js/recipe.js`:

```js
/* --- what the page says, beyond the ingredients -------------------------- */

const stripTags = s => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * An ISO 8601 duration in whole minutes. PT55M -> 55, PT1H30M -> 90, P1D -> 1440.
 *
 * Returns null for anything unreadable *and* for a parsed zero. "No timing given"
 * and "takes no time" are different claims, and rendering "0 min" would state
 * something the page never did.
 */
export function parseDuration(iso) {
  const m = String(iso ?? '').trim()
    .match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m) return null;
  const mins = Number(m[1] || 0) * 1440
    + Number(m[2] || 0) * 60
    + Number(m[3] || 0)
    + Math.round(Number(m[4] || 0) / 60);
  return mins > 0 ? mins : null;
}

/**
 * recipeInstructions -> an ordered list of step strings.
 *
 * Four shapes turn up in the wild and all four have to work: HowToStep objects with
 * .text, plain strings, one string using newlines as separators, and HowToSection
 * wrapping itemListElement. Some sites also embed markup inside .text.
 */
export function normaliseMethod(instructions) {
  const out = [];
  const push = v => { const t = stripTags(v); if (t) out.push(t); };

  const walk = node => {
    if (node == null) return;
    if (typeof node === 'string') { node.split(/\r?\n+/).forEach(push); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') {
      if (Array.isArray(node.itemListElement)) return walk(node.itemListElement);
      if (node.text) return push(node.text);
      if (node.name) return push(node.name);
    }
  };

  walk(instructions);
  return out;
}

/* Longest first, so "frying pan" is found before the generic "pan" and the generic
   is then suppressed. Whole-word matched: a substring scan for "pan" hits
   "pancetta", which is the same trap as 'ice' matching "rice" above. */
export const EQUIPMENT_WORDS = [
  'food processor', 'roasting tin', 'baking tray', 'baking sheet', 'slow cooker',
  'frying pan', 'air fryer', 'saucepan', 'casserole', 'colander', 'griddle',
  'ramekin', 'steamer', 'skewers', 'blender', 'whisk', 'sieve', 'oven', 'grill',
  'wok', 'hob', 'pan',
];

/**
 * What you will need. The author's `tool` field when there is one — which is rare —
 * otherwise whatever the method itself mentions.
 *
 * This is the only inference in the app. It earns the exception because equipment is
 * not a quantity: an incomplete list costs nothing, and the caller labels it "From
 * the method" so it is never passed off as the author's own.
 */
export function guessEquipment(method, tool) {
  const stated = (Array.isArray(tool) ? tool : tool ? [tool] : [])
    .map(t => stripTags(typeof t === 'string' ? t : t?.name))
    .filter(Boolean);
  if (stated.length) return [...new Set(stated)];

  const text = (method || []).join(' ').toLowerCase();
  const found = [];
  for (const item of EQUIPMENT_WORDS) {
    const re = new RegExp(`\\b${item.replace(/ /g, '\\s+')}\\b`);
    if (re.test(text) && !found.some(f => f.includes(item))) found.push(item);
  }
  return found;
}
```

Then extend `searchLibrary`'s scoring. Replace its `.map(entry => {…})` body with:

```js
    .map(entry => {
      const items = entry.items || [];
      const nameHit = !!q && norm(entry.name).includes(q);
      const ingHits = q ? items.filter(i => norm(i.name).includes(q)).length : 0;
      const metaHit = !!q && (
        norm(entry.cuisine).includes(q)
        || (entry.tags || []).some(t => norm(t).includes(q))
      );
      const inStock = items.filter(i => held(i.name)).length;
      // A name match outweighs everything; a tag or cuisine match sits between a name
      // and a single ingredient, because it describes the whole dish.
      const score = (nameHit ? 100 : 0) + (metaHit ? 25 : 0) + ingHits * 10;
      return { entry, score, inStock, total: items.length };
    })
```

- [ ] **Step 4: Run it to verify it passes**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
/opt/homebrew/opt/node@24/bin/node tests/syntax.mjs
```

Expected: all checks PASS, `ERRORS: none`, all files parse and all modules precached.

- [ ] **Step 5: Commit**

```sh
git add js/recipe.js tests/logic.mjs
git commit -m "Read the method, the timings and the equipment a recipe mentions"
```

---

### Task 2: Edge Function — pass the rest of the page through

**Files:**
- Modify: `supabase/functions/recipe/index.ts`
- Modify: `tests/recipe-fn.mjs`

**Interfaces:**
- Produces, on both `?url=` and `?id=`, a `recipe` object with these additional fields, all **raw and unparsed** so the client owns parsing:
  - `instructions: unknown` — the JSON-LD `recipeInstructions` value as found, or TheMealDB's `strInstructions` string
  - `totalTime, prepTime, cookTime: string|null` — raw ISO 8601, `null` from TheMealDB which publishes none
  - `cuisine, category: string` — `recipeCuisine`/`recipeCategory`, or TheMealDB's `strArea`/`strCategory`
  - `keywords: unknown` — raw string or array, or TheMealDB's `strTags`
  - `tool: unknown` — raw `tool` value, `null` from TheMealDB

- [ ] **Step 1: Extend the JSON-LD response**

In `supabase/functions/recipe/index.ts`, replace the `?url=` success response's `recipe` object with:

```ts
      recipe: {
        name: firstString(found.name) || 'Imported recipe',
        serves: asServes(found.recipeYield),
        sourceUrl: safe.toString(),
        sourceName: siteName || safe.hostname.replace(/^www\./, ''),
        image: firstString(found.image),
        ingredients,
        // Raw and unparsed on purpose: js/recipe.js owns every parser, so a fix
        // there needs no redeploy.
        instructions: found.recipeInstructions ?? null,
        totalTime: firstString(found.totalTime) || null,
        prepTime: firstString(found.prepTime) || null,
        cookTime: firstString(found.cookTime) || null,
        cuisine: firstString(found.recipeCuisine),
        category: firstString(found.recipeCategory),
        keywords: found.keywords ?? null,
        tool: found.tool ?? null,
      },
```

- [ ] **Step 2: Extend the TheMealDB response**

Replace the `?id=` success response's `recipe` object with:

```ts
        recipe: {
          name: String(meal.strMeal),
          serves: null,
          sourceUrl: String(meal.strSource || ''),
          sourceName: 'TheMealDB',
          image: String(meal.strMealThumb || ''),
          ingredients,
          // strInstructions is one string with newlines, which normaliseMethod
          // already handles as one of its four shapes.
          instructions: String(meal.strInstructions || '') || null,
          totalTime: null,
          prepTime: null,
          cookTime: null,
          cuisine: String(meal.strArea || ''),
          category: String(meal.strCategory || ''),
          keywords: String(meal.strTags || '') || null,
          tool: null,
        },
```

- [ ] **Step 3: Redeploy**

Deploy via the Supabase MCP `deploy_edge_function`: project `aaticbarhuvbjmfjtfey`, name `recipe`, entrypoint `index.ts`, `verify_jwt: false`, passing the whole file content.

- [ ] **Step 4: Extend the function tests**

In `tests/recipe-fn.mjs`, inside the `if (good.body.ok) {` block, after the existing checks:

```js
  check('returns raw instructions', r.instructions != null, typeof r.instructions);
  check('returns a raw ISO total time', /^PT/i.test(r.totalTime || ''), String(r.totalTime));
  check('returns a cuisine', typeof r.cuisine === 'string' && r.cuisine.length > 0, r.cuisine);
  check('parses none of it server-side',
        typeof r.totalTime === 'string' && !Number.isFinite(r.totalTime), String(r.totalTime));
```

And after the TheMealDB lookup checks:

```js
  check('lookup returns instructions as one string',
        typeof looked.body.recipe?.instructions === 'string'
        && looked.body.recipe.instructions.length > 0,
        `${String(looked.body.recipe?.instructions).length} chars`);
  check('lookup reports no timings, rather than zero',
        looked.body.recipe?.totalTime === null, String(looked.body.recipe?.totalTime));
  check('lookup reports an area as the cuisine',
        typeof looked.body.recipe?.cuisine === 'string', String(looked.body.recipe?.cuisine));
```

- [ ] **Step 5: Run them**

```sh
/opt/homebrew/opt/node@24/bin/node tests/recipe-fn.mjs
```

Expected: every existing guard still refuses, and the seven new checks pass.

- [ ] **Step 6: Commit**

```sh
git add supabase/functions/recipe/index.ts tests/recipe-fn.mjs
git commit -m "Pass the method, timings and cuisine through, still parsing nothing"
```

---

### Task 3: `store.js` — a saved recipe belongs to any slot

**Files:**
- Modify: `js/store.js` (`saveToLibrary` and `library`)
- Test: `tests/logic.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `saveToLibrary(mealId: string|null, data): entry` — `mealId` may be `null`; carries `method`, `prepMin`, `cookMin`, `totalMin`, `serves`, `cuisine`, `tags`, `sourceName`, `sourceUrl`, `image` when supplied
  - `library(mealId?: string): entry[]` — with a `mealId`, returns entries matching it **or** having `mealId: null`; with none, returns everything

- [ ] **Step 1: Write the failing test**

```js
  /* --- 20. recipes belong to any slot ---------------------------------- */
  const rec = store.saveToLibrary(null, {
    name: 'Test jambalaya', place: 'home',
    items: [{ name: 'Rice', qty: 250, unit: 'g', category: 'cupboard' }],
    method: ['Heat the oil.', 'Add the rice.'],
    prepMin: 10, cookMin: 45, totalMin: 55,
    serves: 4, cuisine: 'Cajun & Creole', tags: ['one pot'],
    sourceName: 'Good Food', sourceUrl: 'https://example.com/j', image: 'https://example.com/j.jpg',
  });
  check('a recipe saves with no meal type', rec.mealId === null, JSON.stringify(rec.mealId));
  check('the method is kept', rec.method?.length === 2, JSON.stringify(rec.method));
  check('the timings are kept', rec.totalMin === 55 && rec.prepMin === 10 && rec.cookMin === 45,
        `${rec.prepMin}/${rec.cookMin}/${rec.totalMin}`);
  check('the cuisine and tags are kept', rec.cuisine === 'Cajun & Creole' && rec.tags[0] === 'one pot',
        JSON.stringify([rec.cuisine, rec.tags]));
  check('the source is kept', rec.sourceName === 'Good Food', String(rec.sourceName));

  check('a null-meal recipe is offered for dinner', store.library('dinner').some(l => l.id === rec.id));
  check('and for breakfast too', store.library('breakfast').some(l => l.id === rec.id));
  check('and appears in the whole collection', store.library().some(l => l.id === rec.id));

  const tied = store.saveToLibrary('dinner', { name: 'Test tied meal', place: 'home', items: [] });
  check('a meal-typed entry still filters', store.library('dinner').some(l => l.id === tied.id)
        && !store.library('breakfast').some(l => l.id === tied.id));

  /* Old entries with no new fields must stay valid. */
  check('an entry without a method is still returned',
        store.library('dinner').some(l => l.id === tied.id && l.method === undefined),
        JSON.stringify(store.library('dinner').find(l => l.id === tied.id)?.method));
```

- [ ] **Step 2: Run it to verify it fails**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: FAIL on `a recipe saves with no meal type` — the current code coerces `mealId` and drops the extra fields.

- [ ] **Step 3: Implement**

Replace `saveToLibrary` and `library` in `js/store.js` with:

```js
/**
 * Keep a meal or a recipe.
 *
 * `mealId` null means a recipe rather than a meal template: it is not tied to
 * breakfast, lunch or dinner, so library() offers it for any of them. Every field
 * beyond name/place/items is optional and only stored when supplied, which is what
 * keeps entries saved before this change valid and untouched.
 */
export function saveToLibrary(mealId, data) {
  const entry = {
    id: uid('lib'),
    name: titleCase(data.name || 'Meal'),
    mealId: mealId || null,
    place: data.place || 'home',
    items: (data.items || []).map(i => ({
      name: titleCase(i.name),
      qty: i.qty ?? null,
      unit: i.unit || '',
      category: i.category || 'other',
    })),
  };

  // Only set what we were given, so an old entry never gains empty fields and a
  // record round-tripped through an older build is not filled with nulls.
  for (const key of ['method', 'prepMin', 'cookMin', 'totalMin', 'serves',
                     'cuisine', 'tags', 'sourceName', 'sourceUrl', 'image']) {
    if (data[key] != null) entry[key] = data[key];
  }

  // Replace a same-named entry of the same kind rather than piling up.
  state.library = state.library.filter(
    l => !(l.mealId === entry.mealId && normName(l.name) === normName(entry.name)),
  );
  state.library.unshift(entry);
  state.library = state.library.slice(0, 200);
  commit();
  return entry;
}

/** Everything, or everything a given meal slot can use. */
export const library = mealId => state.library.filter(
  l => !mealId || l.mealId === mealId || l.mealId == null,
);
```

The cap rises from 60 to 200: the library is now a recipe collection rather than a
handful of slot templates.

- [ ] **Step 4: Run it to verify it passes**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/sync.mjs
```

Expected: all `logic.mjs` checks PASS and `sync.mjs` still 23/23 — the record shape changed, so the sync suite matters here.

- [ ] **Step 5: Commit**

```sh
git add js/store.js tests/logic.mjs
git commit -m "A saved recipe belongs to any slot, and keeps its method"
```

---

### Task 4: Keep the recipe, not just its ingredients

**Files:**
- Modify: `js/editors/meal.js` (`reviewRecipe`)
- Test: an automated live-import assertion, below

**Interfaces:**
- Consumes: `parseDuration`, `normaliseMethod` (Task 1); `saveToLibrary` (Task 3); the new passthrough fields (Task 2).
- Produces: every import writes a `library` entry with `mealId: null`, which is what populates the directory.

Importing currently fills the slot and saves nothing, so the directory would start
empty and stay empty. This is the missing link.

- [ ] **Step 1: Parse the extra fields when the review sheet opens**

In `reviewRecipe(r)` in `js/editors/meal.js`, immediately after the `rows` assignment:

```js
    const method = recipe.normaliseMethod(r.instructions);
    const totalMin = recipe.parseDuration(r.totalTime);
    const prepMin = recipe.parseDuration(r.prepTime);
    const cookMin = recipe.parseDuration(r.cookTime);
```

- [ ] **Step 2: Show the timings in the summary line**

Replace the summary `<p class="field__hint">` in `reviewRecipe` with:

```js
        <p class="field__hint" style="padding:2px">
          ${plural(rows.length, 'ingredient')} · ${inStock} already in stock${r.serves ? ` · serves ${r.serves}` : ''}${totalMin ? ` · ${totalMin} min` : ''}${method.length ? ` · ${plural(method.length, 'step')}` : ''}${r.sourceName ? ` · from ${esc(r.sourceName)}` : ''}
        </p>
```

- [ ] **Step 3: Save the recipe on confirm**

In `reviewRecipe`'s `[data-ok]` handler, after the `for (const row of rows)` loop that
pushes into `draft.items` and before `main()`:

```js
        // Keep the recipe itself, not only its ingredients. mealId null so it can be
        // used from any slot, and so it shows up in the Recipes tab.
        const tags = Array.isArray(r.keywords)
          ? r.keywords.map(String)
          : String(r.keywords || '').split(',').map(t => t.trim()).filter(Boolean);

        store.saveToLibrary(null, {
          name: draft.name || r.name,
          place: draft.place,
          items: rows.map(row => ({
            name: row.name, qty: row.qty, unit: row.unit, category: row.category,
          })),
          method,
          prepMin,
          cookMin,
          totalMin,
          serves: r.serves,
          cuisine: r.cuisine,
          tags: tags.length ? tags : null,
          sourceName: r.sourceName,
          sourceUrl: r.sourceUrl,
          image: r.image,
        });
```

- [ ] **Step 4: Verify with a live import, automatically**

Write `/tmp/verify-capture.mjs` and run it from the repo root. This is the spec's
"real-page import check", automated rather than done by eye — the point is that the
whole chain from page to stored record works, and only a live page proves that.

```js
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM });
const c = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const p = await c.newPage();
const fails = [];
const check = (n, ok, d = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`); if (!ok) fails.push(n); };

await p.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
await p.click('[data-view=plan]');
await p.waitForTimeout(400);
await p.locator('[data-slot]').first().click();
await p.waitForTimeout(450);
await p.locator('#sheetBody [data-step=recipe]').click();
await p.waitForTimeout(400);
await p.fill('[name=url]', 'https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya');
await p.locator('#sheetBody [data-go]').click();
await p.waitForTimeout(9000);

const summary = (await p.locator('#sheetBody .field__hint').first().textContent()).replace(/\s+/g, ' ');
check('the summary shows time and steps', /55 min/.test(summary) && /4 steps/.test(summary), summary);

await p.locator('#sheetBody [data-ok]').click();
await p.waitForTimeout(700);

const kept = await p.evaluate(() =>
  window.munch.store.get().library.find(l => /jambalaya/i.test(l.name)) || null);
check('the recipe itself was kept', !!kept);
check('it is not tied to a meal type', kept?.mealId === null, JSON.stringify(kept?.mealId));
check('at least three method steps', (kept?.method?.length || 0) >= 3, `${kept?.method?.length} steps`);
check('a non-null total time', kept?.totalMin === 55, String(kept?.totalMin));
check('the cuisine came through', /Cajun/.test(kept?.cuisine || ''), String(kept?.cuisine));

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
```

Also run the smoke walk:

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  SHOT_DIR=./shots /opt/homebrew/opt/node@24/bin/node tests/smoke.mjs
```

Expected: all six capture checks pass, and `ERRORS: none` from smoke.

- [ ] **Step 5: Commit**

```sh
git add js/editors/meal.js
git commit -m "Keep the imported recipe, not only its ingredients"
```

---

### Task 5: The Recipes tab

**Files:**
- Create: `js/views/recipes.js`
- Modify: `js/app.js` (the `VIEWS` array on line 24)
- Modify: `sw.js` (the `SHELL` list)
- Test: `tests/smoke.mjs`

**Interfaces:**
- Consumes: `recipe.searchLibrary` (Task 1), `store.library()` (Task 3).
- Produces: a default-exported view object satisfying the app's contract —
  `{ id: 'recipes', label: 'Recipes', icon: 'pot', title(), sub(), actions(), render(root, ctx), onAction(act, ctx) }`
  and `export function openRecipe({ id, after })`, implemented in Task 6.

- [ ] **Step 1: Create the view**

```js
/* ==========================================================================
   Recipes — the collection you have kept, and what you can cook from it.
   ========================================================================== */

import * as store from '../store.js';
import * as recipe from '../recipe.js';
import { esc, plural } from '../util.js';
import { icon } from '../icons.js';
import { emptyState } from '../ui.js';
import { openMealEditor } from '../editors/meal.js';

/* View-local, deliberately not persisted. */
const ui = { query: '' };

export default {
  id: 'recipes',
  label: 'Recipes',
  icon: 'pot',
  title: () => 'Recipes',

  sub() {
    const n = store.library().length;
    return n ? plural(n, 'recipe') : 'Nothing saved yet';
  },

  actions: () => `
    <button class="iconbtn iconbtn--primary" type="button" data-act="import"
      aria-label="Import a recipe">${icon('plus')}</button>`,

  render(root, ctx) {
    const all = store.library();
    const stockNames = store.get().inventory.map(i => i.name);
    const hits = recipe.searchLibrary(ui.query, all, stockNames);

    root.innerHTML = `
      <section class="section">
        <div class="search">
          ${icon('search')}
          <input type="search" placeholder="Search your recipes" value="${esc(ui.query)}"
            data-q enterkeyhint="search" autocomplete="off">
        </div>
      </section>

      <section class="section">
        ${hits.length ? `
          <div class="rows">
            ${hits.map(h => row(h)).join('')}
          </div>` : `
          <div class="card">
            ${emptyState({
              iconName: 'pot',
              title: all.length ? 'Nothing matches' : 'No recipes yet',
              body: all.length
                ? 'Try a different search.'
                : 'Import one from a link, or save a meal you have planned. Anything you keep shows up here.',
              action: all.length ? null : { act: 'import', label: 'Import a recipe' },
            })}
          </div>`}
      </section>`;

    const q = root.querySelector('[data-q]');
    q.addEventListener('input', () => {
      ui.query = q.value;
      const pos = q.selectionStart;
      ctx.refresh();
      const nq = document.querySelector('[data-q]');
      if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
    });

    // The rows carry data-open but are inert until Task 6 adds the reader. That is
    // deliberate ordering, not an oversight: this task must not import a module that
    // does not exist yet, or nothing loads at all.

    root.querySelectorAll('[data-act=import]').forEach(el => {
      el.addEventListener('click', () => this.onAction('import', ctx));
    });
  },

  onAction(act, ctx) {
    if (act !== 'import') return;
    // Import lives in the meal editor's flow, which needs a slot. Send them to today's
    // dinner: the recipe is saved to the collection either way, and the meal is theirs
    // to keep or clear.
    const today = new Date();
    const p = n => String(n).padStart(2, '0');
    const date = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
    openMealEditor({ date, mealId: 'dinner', after: ctx.refresh, startAt: 'recipe' });
  },
};

function row(h) {
  const r = h.entry;
  const bits = [
    r.totalMin ? `${r.totalMin} min` : '',
    r.serves ? `serves ${r.serves}` : '',
    r.items?.length ? `${h.inStock} of ${h.total} in` : '',
    r.cuisine || '',
  ].filter(Boolean);

  return `
    <button class="row" type="button" data-open="${esc(r.id)}">
      <span class="row__main">
        <span class="row__name">${esc(r.name)}</span>
        <span class="row__sub">${esc(bits.join(' · ')) || 'No details saved'}</span>
      </span>
      <span class="row__tail">${r.method?.length ? icon('pot') : ''}</span>
    </button>`;
}
```

- [ ] **Step 2: Let the meal editor open straight onto the import step**

`onAction` above passes `startAt: 'recipe'`. In `js/editors/meal.js`, change the
signature and the final call:

```js
export function openMealEditor({ date, mealId, after, startAt = null }) {
```

and replace the `main();` on the last line of `openMealEditor` with:

```js
  if (startAt === 'recipe') findRecipe();
  else main();
```

- [ ] **Step 3: Register the tab and precache the module**

In `js/app.js` line 24:

```js
const VIEWS = [today, plan, recipes, inventory, shop];
```

with the import beside the other views:

```js
import recipes from './views/recipes.js';
```

In `sw.js`, add the view to `SHELL` after `'./js/views/inventory.js'`. Task 6 adds
the editor alongside it:

```js
  './js/views/recipes.js',
```

- [ ] **Step 4: Extend the smoke walk**

`tests/smoke.mjs` has **two** view-id arrays and both need `recipes`. Line 191, the
layout check:

```js
for (const v of ['today', 'plan', 'recipes', 'inventory', 'shop']) {
```

and line 216, the tab-tappable check:

```js
for (const v of ['plan', 'recipes', 'inventory', 'shop', 'today']) {
```

Then after the settings shot near the end, add:

```js
await page.click('[data-view=recipes]');
await page.waitForTimeout(300);
await shot('24-recipes');
```

- [ ] **Step 5: Verify**

```sh
/opt/homebrew/opt/node@24/bin/node tests/syntax.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  SHOT_DIR=./shots /opt/homebrew/opt/node@24/bin/node tests/smoke.mjs
```

Expected: all files parse **and all modules precached** (the guard catches a missing
`SHELL` entry), five tabs laid out with `ERRORS: none`, and `shots/24-recipes.png`
showing the collection.

- [ ] **Step 6: Commit**

```sh
git add js/views/recipes.js js/app.js sw.js tests/smoke.mjs
git commit -m "A Recipes tab: the collection, searchable"
```

---

### Task 6: The reader, and cooking from it

**Files:**
- Create: `js/editors/recipe.js`
- Modify: `js/views/recipes.js` (add the import and wire the inert rows from Task 5)
- Modify: `sw.js` (add `'./js/editors/recipe.js'` to `SHELL`)
- Test: `tests/smoke.mjs` plus the manual walk below

**Interfaces:**
- Consumes: `recipe.guessEquipment` (Task 1); `store.library()`, `store.removeFromLibrary()`, `store.saveSlot()`; `bestStockMatch` is **not** available here (it is private to `meal.js`), so this module uses `store.matchInInventory` filtered by place — see step 2.
- Produces: `export function openRecipe({ id, after })`.

- [ ] **Step 1: Create the reader**

```js
/* ==========================================================================
   Recipe reader — what it is, what you need, and how to make it.
   ========================================================================== */

import * as store from '../store.js';
import * as recipe from '../recipe.js';
import { MEALS, PLACES } from '../store.js';
import { esc, plural, qtyLabel, niceDate } from '../util.js';
import { icon } from '../icons.js';
import {
  openSheet, setSheet, closeSheet, toast, confirmSheet,
  field, select, segmented, bindPickers, readForm,
} from '../ui.js';

/** The best in-stock match for a name at a place, or null. */
function stockAt(name, place) {
  return store.matchInInventory(name).find(it => {
    const loc = store.locationOf(it.locId);
    return loc && loc.place === place;
  }) || null;
}

export function openRecipe({ id, after }) {
  const r = store.library().find(l => l.id === id);
  if (!r) return;

  let opened = false;
  const show = (title, body, mount) => {
    const payload = { title, body, mount };
    if (opened) setSheet(payload);
    else { openSheet({ ...payload, dismiss: () => after?.() }); opened = true; }
  };

  function main() {
    // Computed now, against current stock: a recipe kept three weeks ago should not
    // claim you still have the chicken.
    const rows = (r.items || []).map(i => ({ ...i, hit: stockAt(i.name, r.place || 'home') }));
    const inStock = rows.filter(x => x.hit).length;
    const method = r.method || [];
    const kit = recipe.guessEquipment(method);

    const timing = [
      r.totalMin ? `${r.totalMin} min` : '',
      r.prepMin || r.cookMin ? `${r.prepMin || 0} prep / ${r.cookMin || 0} cook` : '',
      r.serves ? `serves ${r.serves}` : '',
      r.cuisine || '',
    ].filter(Boolean).join(' · ');

    const body = `
      <div class="form">
        ${timing ? `<p class="field__hint" style="padding:2px">${esc(timing)}</p>` : ''}

        ${r.sourceName ? `
          <p class="field__hint" style="padding:2px">
            From ${r.sourceUrl
              ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.sourceName)}</a>`
              : esc(r.sourceName)}
          </p>` : ''}

        ${kit.length ? `
          <div class="field">
            <span class="field__label">From the method</span>
            <div class="taglist">${kit.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</div>
            <span class="field__hint">Picked out of the steps below, not stated by the author.</span>
          </div>` : ''}

        <div class="field">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
            <span class="field__label" style="padding:0">Ingredients</span>
            <span class="field__hint" style="padding:0">${inStock} of ${rows.length} in</span>
          </div>
          <div class="rows">
            ${rows.map(x => `
              <div class="row" style="cursor:default">
                <span class="row__main">
                  <span class="row__name">${esc(x.name)}</span>
                  <span class="row__sub">
                    ${esc(qtyLabel(x.qty, x.unit) || 'no amount')} · ${x.hit ? 'in stock' : 'to buy'}
                  </span>
                </span>
              </div>`).join('')}
          </div>
        </div>

        ${method.length ? `
          <div class="field">
            <span class="field__label">Method</span>
            <div class="stack">
              ${method.map((s, i) => `
                <div class="card" style="padding:14px 16px">
                  <span class="field__label" style="padding:0">Step ${i + 1}</span>
                  <p style="font-size:15px;line-height:1.55;margin:6px 0 0">${esc(s)}</p>
                </div>`).join('')}
            </div>
          </div>` : `
          <p class="field__hint" style="padding:2px">
            No method saved — this one was kept before Munch read the whole page.
          </p>`}

        <div class="sheet__foot">
          <button class="btn btn--danger btn--sm" type="button" data-del>${icon('trash')}</button>
          <button class="btn" type="button" data-use>${icon('plan')}Use in a meal</button>
        </div>
      </div>`;

    show(r.name, body, root => {
      root.querySelector('[data-use]').addEventListener('click', usePicker);

      root.querySelector('[data-del]').addEventListener('click', () => {
        confirmSheet({
          title: `Delete ${r.name}?`,
          message: 'It comes out of your recipes. Any meal already planned from it stays as it is.',
          confirmLabel: 'Delete',
          danger: true,
          run() {
            store.removeFromLibrary(r.id);
            after?.();
            toast('Recipe deleted', {
              iconName: 'trash',
              action: { label: 'Undo', run: () => { store.undo(); after?.(); } },
            });
          },
        });
      });
    });
  }

  /* Which day, which meal, and where — the place is not decoration: saveSlot needs
     one, a recipe has no slot to inherit it from, and it decides which stores an
     ingredient can be matched against. */
  function usePicker() {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    });

    const body = `
      <div class="form">
        ${field({ label: 'Which day', control: select({
          name: 'date', value: days[0], options: days.map(d => ({ value: d, label: niceDate(d) })),
        }) })}
        ${field({ label: 'Which meal', control: segmented({
          name: 'mealId', value: r.mealId || 'dinner',
          options: MEALS.map(m => ({ value: m.id, label: m.label })),
        }) })}
        ${field({
          label: 'Home or work',
          hint: 'Decides which stores its ingredients can be matched against.',
          control: segmented({
            name: 'place', value: r.place || 'home',
            options: PLACES.map(p => ({ value: p.id, label: p.label })),
          }),
        })}
        <div class="sheet__foot">
          <button class="btn btn--ghost" type="button" data-back>Back</button>
          <button class="btn" type="button" data-go>${icon('check')}Add to the plan</button>
        </div>
      </div>`;

    show(`Use ${r.name}`, body, root => {
      bindPickers(root);
      root.querySelector('[data-back]').addEventListener('click', main);

      root.querySelector('[data-go]').addEventListener('click', () => {
        const f = readForm(root);
        // Re-matched against stock now, at the place just chosen.
        const items = (r.items || []).map(i => {
          const hit = stockAt(i.name, f.place);
          return {
            id: `ing_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
            name: i.name, qty: i.qty, unit: i.unit, category: i.category,
            source: hit ? 'inv' : 'buy',
            invId: hit ? hit.id : null,
          };
        });

        store.saveSlot(f.date, f.mealId, {
          name: r.name,
          place: f.place,
          items,
          note: r.serves ? `Serves ${r.serves}` : '',
          done: false,
        });

        closeSheet();
        after?.();
        toast(`Added to ${niceDate(f.date)}`, { iconName: 'check' });
      });
    });
  }

  main();
}
```

- [ ] **Step 2: Wire the directory's rows to it**

In `js/views/recipes.js`, add the import:

```js
import { openRecipe } from '../editors/recipe.js';
```

and restore the listener in `render`, where Task 5 left the comment:

```js
    root.querySelectorAll('[data-open]').forEach(el => {
      el.addEventListener('click', () => openRecipe({ id: el.dataset.open, after: ctx.refresh }));
    });
```

Add to `sw.js`'s `SHELL`, beside the view:

```js
  './js/editors/recipe.js',
```

- [ ] **Step 3: Note on stock matching**

`meal.js`'s `bestStockMatch` is private to that module, so this file defines
`stockAt(name, place)` over the exported `store.matchInInventory` and filters by the
chosen place. Same behaviour, no export added to `meal.js` and no duplication of its
internals.

- [ ] **Step 4: Verify**

```sh
/opt/homebrew/opt/node@24/bin/node tests/syntax.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  SHOT_DIR=./shots /opt/homebrew/opt/node@24/bin/node tests/smoke.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: parse and precache clean, `ERRORS: none`, all logic checks pass.

Then by hand: import the jambalaya, go to **Recipes**, open it. Confirm the timing
line reads `55 min · 10 prep / 45 cook · serves 4 · Cajun & Creole`; that **From the
method** lists `frying pan` with the caveat beneath; that the four steps are numbered;
that ingredients show in-stock or to-buy; that **Use in a meal** with a day, meal and
place adds it to the plan with ingredients re-matched; and that **Delete** is
undoable.

- [ ] **Step 5: Commit**

```sh
git add js/editors/recipe.js js/views/recipes.js sw.js
git commit -m "Read a recipe, and cook it on a chosen day"
```

---

## Deviations from the spec

1. **The reader lives in `js/editors/recipe.js`, not in the view.** The spec described
   the directory and the reader together. Splitting them follows the existing shape —
   `views/inventory.js` renders the list and `editors/item.js` owns the sheets — and
   keeps each file focused.
2. **`stockAt` rather than `bestStockMatch`.** The spec named the editor's place-aware
   matcher, which is private to `meal.js`. Rather than export it and couple the two
   editors, the reader defines the same behaviour over the already-exported
   `store.matchInInventory`.
3. **Import from the Recipes tab routes via the meal editor**, opening it straight onto
   the import step through a new `startAt` option, rather than duplicating the import
   flow. The recipe is saved to the collection either way, so the temporary dinner slot
   is a side effect the user can keep or clear.

## Notes carried over from the spec

- No Supabase migration; `kind` stays `'library'`.
- Every new `library` field is optional, so entries saved earlier stay valid and read
  as recipes with no method.
- Equipment renders under **"From the method"** and never as the author's own.
- `parseDuration` returns null for a parsed zero.
- Filters and facets are the next spec, not this one.
