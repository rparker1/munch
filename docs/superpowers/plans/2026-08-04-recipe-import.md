# Recipe search and import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a recipe from a link (or pasted text) into a planned meal, and search saved meals by ingredient and by what is in stock.

**Architecture:** A new pure module `js/recipe.js` does all parsing and ranking with no network and no DOM, so it is unit-testable in `logic.mjs`. A single Supabase Edge Function does everything needing a server — fetching third-party pages and proxying TheMealDB — and returns raw ingredient *strings*, so parsing stays client-side and a parser fix never needs a redeploy. The meal editor gains one more step in its existing `show()`/`setSheet()` flow; imported ingredients land in the in-memory `draft` and are only persisted when the user saves the meal.

**Tech Stack:** Plain ES modules, no build step, no client dependencies. Deno/TypeScript for the Edge Function. Playwright for browser tests, plain `fetch` for the function tests.

## Global Constraints

- No client dependencies and no build step. Nothing may be added to the app's runtime.
- `store.js` is the only module that touches persisted state. `recipe.js` returns plain objects and never writes.
- Every mutation funnels through `commit()`. Never hand-stamp a sync clock.
- Dark only. No light theme, no `prefers-color-scheme` branch.
- UK English in all user-facing copy.
- **Nothing is ever converted between units.** No tbsp→ml, no cup→g.
- `UNITS` gains exactly `tbsp`, `tsp`, `clove` — appended, not reordered.
- An amount that cannot be read means `qty: null` and the line's **full original wording** kept as the name.
- TheMealDB must be credited as the source wherever its data is shown.
- `PARTABLE` is not extended — none of the three new units is a part-usable container.
- Serve the app for tests with `python3 -m http.server 8765` from the repo root.
- Tests need Node 22+. On this machine use `/opt/homebrew/opt/node@24/bin/node`.
- Pass the browser binary via `CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
- Supabase project ref is `aaticbarhuvbjmfjtfey` (project name `Munch`).

---

## Phase 1 — local search and URL import

### Task 1: `recipe.js` — parse an ingredient line

**Files:**
- Create: `js/recipe.js`
- Modify: `js/store.js` (the `UNITS` export)
- Test: `tests/logic.mjs` (append inside the `page.evaluate` block, before `return out;`)
- Modify: `js/app.js` (expose `recipe` on `window.munch` so the test can reach it)

**Interfaces:**
- Consumes: `titleCase` from `js/util.js`.
- Produces:
  - `export function parseIngredient(line: string): { qty: number|null, unit: string, name: string }`
  - `export function guessCategory(name: string): string` — a `CATEGORIES` id, `'other'` when nothing matches
  - `export const CATEGORY_KEYWORDS: Record<string, string[]>`
  - `export function parseIngredients(lines: string[]): Array<{ qty, unit, name, category }>` — maps `parseIngredient` and attaches `guessCategory(name)`

- [ ] **Step 1: Write the failing test**

Append inside the `page.evaluate` callback in `tests/logic.mjs`, directly before `return out;`:

```js
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
  check('parseIngredients attaches a category',
        parsed[0].category === 'protein' && parsed[1].category === 'other',
        JSON.stringify(parsed));
  check('parseIngredients preserves order and length', parsed.length === 2);
```

- [ ] **Step 2: Run the test to verify it fails**

```sh
python3 -m http.server 8765 &
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: a `pageerror` — `Cannot destructure property 'recipe' of 'window.munch'` or `recipe.parseIngredient is not a function`.

- [ ] **Step 3: Add the three units**

In `js/store.js`, replace the `UNITS` line with:

```js
export const UNITS = ['pcs', 'g', 'kg', 'ml', 'L', 'pack', 'tin', 'bunch', 'loaf', 'bottle',
                      'tbsp', 'tsp', 'clove'];
```

Appended rather than inserted, so existing `select()` option order is unchanged for everything above. `PARTABLE` is deliberately untouched — a tablespoon is not a part-usable container.

- [ ] **Step 4: Write `js/recipe.js`**

```js
/* ==========================================================================
   Recipe parsing. Pure functions only — no network, no DOM, no store access —
   so this is unit-testable without a server and a fix never needs a redeploy.

   Nothing here converts between units. Recipes say "2 tbsp" and "3 cloves", and
   turning those into millilitres would mean inventing a physical quantity, which
   the app does nowhere else. Anything unreadable keeps its wording and loses its
   amount, which is a shape the app already handles everywhere.
   ========================================================================== */

import { titleCase } from './util.js';

/* Written form -> the unit stored. Longest forms first so 'tablespoons' is not
   matched by 'tbsp'-style prefixes, and 'cloves' before 'clove'. */
const UNIT_WORDS = [
  ['tablespoons', 'tbsp'], ['tablespoon', 'tbsp'], ['tbsps', 'tbsp'], ['tbsp', 'tbsp'],
  ['teaspoons', 'tsp'], ['teaspoon', 'tsp'], ['tsps', 'tsp'], ['tsp', 'tsp'],
  ['cloves', 'clove'], ['clove', 'clove'],
  ['kilograms', 'kg'], ['kilogram', 'kg'], ['kilos', 'kg'], ['kilo', 'kg'], ['kg', 'kg'],
  ['grams', 'g'], ['gram', 'g'], ['g', 'g'],
  ['millilitres', 'ml'], ['millilitre', 'ml'], ['ml', 'ml'],
  ['litres', 'L'], ['litre', 'L'], ['liters', 'L'], ['liter', 'L'], ['l', 'L'],
  ['packets', 'pack'], ['packet', 'pack'], ['packs', 'pack'], ['pack', 'pack'],
  ['tins', 'tin'], ['tin', 'tin'], ['cans', 'tin'], ['can', 'tin'],
  ['bottles', 'bottle'], ['bottle', 'bottle'],
  ['loaves', 'loaf'], ['loaf', 'loaf'],
  ['bunches', 'bunch'], ['bunch', 'bunch'],
];

export const CATEGORY_KEYWORDS = {
  protein: ['chicken', 'beef', 'pork', 'lamb', 'mince', 'bacon', 'sausage', 'salmon',
            'tuna', 'cod', 'prawn', 'fish', 'thigh', 'breast', 'steak', 'tofu'],
  produce: ['lemon', 'lime', 'orange', 'apple', 'banana', 'berry', 'berries', 'onion',
            'garlic', 'potato', 'tomato', 'carrot', 'spinach', 'pepper', 'courgette',
            'aubergine', 'broccoli', 'salad', 'lettuce', 'cucumber', 'herb', 'parsley',
            'coriander', 'basil', 'mint', 'ginger', 'mushroom', 'leek', 'celery'],
  dairy: ['milk', 'butter', 'cheese', 'cheddar', 'parmesan', 'feta', 'halloumi',
          'yoghurt', 'yogurt', 'cream', 'egg', 'mozzarella'],
  bakery: ['bread', 'loaf', 'flour', 'roll', 'bun', 'pitta', 'tortilla', 'wrap',
           'baguette', 'sourdough'],
  frozen: ['frozen', 'peas', 'ice'],
  drinks: ['wine', 'beer', 'juice', 'coffee', 'tea', 'squash', 'cordial'],
  snacks: ['crisps', 'chocolate', 'biscuit', 'nuts', 'crackers'],
  household: ['foil', 'clingfilm', 'washing-up', 'bin bag', 'kitchen roll'],
  cupboard: ['rice', 'pasta', 'noodle', 'oil', 'vinegar', 'stock', 'tin', 'tinned',
             'chickpea', 'bean', 'lentil', 'spice', 'cumin', 'paprika', 'curry',
             'sugar', 'honey', 'soy', 'mustard', 'ketchup', 'salt', 'sauce', 'passata'],
};

/** A CATEGORIES id. 'other' whenever nothing matches — always a real aisle. */
export function guessCategory(name) {
  const n = String(name || '').toLowerCase();
  // Deterministic order: the first listed category that matches wins, so a name
  // hitting two lists always lands the same way.
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some(w => n.includes(w))) return cat;
  }
  return 'other';
}

/**
 * One ingredient line -> { qty, unit, name }.
 *
 * Returns qty null and the line untouched when no amount can be read. In that
 * case the wording is preserved exactly — trailing clauses included — because
 * trimming a phrase we already failed to parse only loses information:
 * "Salt and pepper, to taste" reads correctly, "Salt and pepper" with no amount
 * does not.
 */
export function parseIngredient(line) {
  const raw = String(line || '').trim();
  if (!raw) return { qty: null, unit: '', name: '' };

  // A leading amount: 600, 1.5, or 1/2. Anything else and we give up early.
  const m = raw.match(/^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(.*)$/);
  if (!m) return { qty: null, unit: '', name: raw };

  const qty = m[1].includes('/')
    ? (() => { const [a, b] = m[1].split('/').map(Number); return b ? a / b : null; })()
    : Number(m[1]);
  if (qty == null || !isFinite(qty)) return { qty: null, unit: '', name: raw };

  let rest = m[2];

  // "1 x 400g tin chopped tomatoes" — drop a multiplier and any pack size, so the
  // unit found is the container, not the weight inside it.
  rest = rest.replace(/^x\s*/i, '').replace(/^\d+(?:\.\d+)?\s*(?:g|kg|ml|l)\b\s*/i, '');

  let unit = '';
  for (const [word, stored] of UNIT_WORDS) {
    const re = new RegExp(`^${word}\\b\\.?\\s*`, 'i');
    if (re.test(rest)) { unit = stored; rest = rest.replace(re, ''); break; }
  }
  if (!unit) unit = 'pcs';   // a bare count

  // Preparation after the first comma is noise once we have an amount.
  let name = rest.split(',')[0].replace(/^of\s+/i, '').trim();
  if (!name) return { qty: null, unit: '', name: raw };

  return { qty, unit, name: titleCase(name) };
}

/** Parse a list and attach a guessed aisle to each. Order is preserved. */
export function parseIngredients(lines) {
  return (lines || []).map(l => {
    const p = parseIngredient(l);
    return { ...p, category: guessCategory(p.name) };
  });
}
```

- [ ] **Step 5: Expose it for the tests**

In `js/app.js`, add the import beside the others at the top:

```js
import * as recipe from './recipe.js';
```

and extend the last line of the file:

```js
window.munch = { store, cloud, sync, recipe, refresh: () => render(), go: navigate };
```

- [ ] **Step 6: Run the test to verify it passes**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
/opt/homebrew/opt/node@24/bin/node tests/syntax.mjs
```

Expected: every check PASSes, `ERRORS: none`, and 25/25 files parse.

- [ ] **Step 7: Commit**

```sh
git add js/recipe.js js/store.js js/app.js tests/logic.mjs
git commit -m "Parse a recipe ingredient line without inventing conversions"
```

---

### Task 2: `recipe.js` — rank saved meals

**Files:**
- Modify: `js/recipe.js`
- Test: `tests/logic.mjs` (append after the Task 1 block)

**Interfaces:**
- Consumes: `parseIngredient` from Task 1 (not used here, but same module).
- Produces:
  - `export function searchLibrary(query: string, entries: Array<{id,name,items}>, inventoryNames: string[]): Array<{ entry, score, inStock, total }>` — sorted best-first, entries with no text match excluded when `query` is non-empty

Taking `entries` and `inventoryNames` as arguments rather than reading the store keeps the function pure and testable.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: `recipe.searchLibrary is not a function`.

- [ ] **Step 3: Implement**

Append to `js/recipe.js`:

```js
const norm = s => String(s || '').toLowerCase().trim();

/**
 * Rank saved meals for a query, annotated with how much of each is already in.
 *
 * Pure: the caller passes the library and the stock names, so this needs no store
 * access and can be tested with fixtures. Ties on text relevance are broken by the
 * fuller larder — the whole point being to cook what you already have.
 */
export function searchLibrary(query, entries, inventoryNames) {
  const q = norm(query);
  const stock = (inventoryNames || []).map(norm);
  const held = name => {
    const n = norm(name);
    return stock.some(s => s === n || s.includes(n) || n.includes(s));
  };

  return (entries || [])
    .map(entry => {
      const items = entry.items || [];
      const nameHit = q && norm(entry.name).includes(q);
      const ingHits = q ? items.filter(i => norm(i.name).includes(q)).length : 0;
      const inStock = items.filter(i => held(i.name)).length;
      // A name match outweighs any number of ingredient matches.
      const score = (nameHit ? 100 : 0) + ingHits * 10;
      return { entry, score, inStock, total: items.length };
    })
    .filter(r => !q || r.score > 0)
    .sort((a, b) => (b.score - a.score) || (b.inStock - a.inStock) || a.entry.name.localeCompare(b.entry.name));
}
```

- [ ] **Step 4: Run it to verify it passes**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: all checks PASS, `ERRORS: none`.

- [ ] **Step 5: Commit**

```sh
git add js/recipe.js tests/logic.mjs
git commit -m "Rank saved meals by relevance, then by what is already in"
```

---

### Task 3: Edge Function — fetch a page and read its Recipe JSON-LD

**Files:**
- Create: `supabase/functions/recipe/index.ts`
- Create: `tests/recipe-fn.mjs`
- Modify: `README.md` (Tests section)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces an HTTPS endpoint at `https://aaticbarhuvbjmfjtfey.supabase.co/functions/v1/recipe`:
  - `GET ?url=<https page>` → `{ ok: true, recipe: { name, serves, sourceUrl, sourceName, image, ingredients: string[] } }`
  - On failure → `{ ok: false, reason }` with `reason` ∈ `bad-request`, `blocked`, `too-large`, `timeout`, `fetch-failed`, `no-recipe`
  - CORS: `access-control-allow-origin: *`, and `OPTIONS` answered

- [ ] **Step 1: Write the function**

```ts
/* Recipe helper.
 *
 * Exists because a page on rparker1.github.io cannot fetch a recipe site — CORS
 * forbids it and no client-side arrangement changes that.
 *
 * It returns ingredient lines as raw strings and parses none of them. Parsing
 * lives in js/recipe.js so it is unit-testable with no network and so a parser fix
 * never needs a redeploy.
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'content-type': 'application/json',
};

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000;

const fail = (reason: string, status = 400) =>
  new Response(JSON.stringify({ ok: false, reason }), { status, headers: CORS });

/* Literal hosts we refuse. A hostname that *resolves* to a private address is not
   detectable here — the runtime exposes no DNS — which is why nothing but parsed
   JSON is ever returned, and why the size and time caps are hard. */
function hostBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd')) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;   // cloud metadata
  }
  return false;
}

function checkUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (hostBlocked(u.hostname)) return null;
  return u;
}

/** Follow redirects by hand so every hop is re-checked, not just the input. */
async function safeFetch(start: URL, signal: AbortSignal): Promise<Response> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url.toString(), {
      redirect: 'manual',
      signal,
      headers: { 'user-agent': 'Munch/1.0 (personal recipe importer)', accept: 'text/html' },
    });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get('location');
    if (!loc) return res;
    const next = checkUrl(new URL(loc, url).toString());
    if (!next) throw new Error('blocked');
    url = next;
  }
  throw new Error('too-many-redirects');
}

/** Read at most MAX_BYTES, refusing while streaming rather than after. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('too-large'); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

/* Walk JSON-LD for the first Recipe, including inside @graph and arrays. */
function findRecipe(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const n of node) { const hit = findRecipe(n); if (hit) return hit; }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const isRecipe = type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
  if (isRecipe) return obj;
  return findRecipe(obj['@graph'] ?? null);
}

const firstString = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return firstString(v[0]);
  if (v && typeof v === 'object') return firstString((v as Record<string, unknown>).url);
  return '';
};

const asServes = (v: unknown): number | null => {
  const s = firstString(v) || (typeof v === 'number' ? String(v) : '');
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : null;
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const params = new URL(req.url).searchParams;
  const target = params.get('url');
  if (!target) return fail('bad-request');

  const safe = checkUrl(target);
  if (!safe) return fail('blocked', 403);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await safeFetch(safe, ctrl.signal);
    if (!res.ok) return fail('fetch-failed', 502);
    const html = await readCapped(res);

    let found: Record<string, unknown> | null = null;
    const blocks = html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    );
    for (const b of blocks) {
      try { found = findRecipe(JSON.parse(b[1].trim())); } catch { /* skip bad JSON-LD */ }
      if (found) break;
    }
    if (!found) return fail('no-recipe', 422);

    const ingredients = (Array.isArray(found.recipeIngredient) ? found.recipeIngredient : [])
      .map(String).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!ingredients.length) return fail('no-recipe', 422);

    const siteName = html.match(
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    )?.[1];

    return new Response(JSON.stringify({
      ok: true,
      recipe: {
        name: firstString(found.name) || 'Imported recipe',
        serves: asServes(found.recipeYield),
        sourceUrl: safe.toString(),
        sourceName: siteName || safe.hostname.replace(/^www\./, ''),
        image: firstString(found.image),
        ingredients,
      },
    }), { headers: CORS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'blocked') return fail('blocked', 403);
    if (msg === 'too-large') return fail('too-large', 413);
    if (msg === 'too-many-redirects') return fail('fetch-failed', 502);
    if (ctrl.signal.aborted) return fail('timeout', 504);
    return fail('fetch-failed', 502);
  } finally {
    clearTimeout(timer);
  }
});
```

- [ ] **Step 2: Deploy it with `verify_jwt` disabled**

Deploy via the Supabase MCP `deploy_edge_function` to project `aaticbarhuvbjmfjtfey`, function name `recipe`, with JWT verification **off** so import works signed out.

Then confirm it is listed:

```
mcp: list_edge_functions project_id=aaticbarhuvbjmfjtfey
```

Expected: one function named `recipe`, status `ACTIVE`.

- [ ] **Step 3: Write the function tests**

Create `tests/recipe-fn.mjs`:

```js
/* Edge Function checks. Plain fetch, no Playwright — runs with nothing installed.
   FN overrides the endpoint. */
const FN = process.env.FN
  || 'https://aaticbarhuvbjmfjtfey.supabase.co/functions/v1/recipe';

const fails = [];
const check = (name, pass, detail = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!pass) fails.push(name);
};
const call = async qs => {
  const res = await fetch(`${FN}?${qs}`);
  let body = {};
  try { body = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body };
};

/* --- guards: every one of these must be refused ------------------------- */
for (const [label, url] of [
  ['plain http', 'http://example.com/recipe'],
  ['loopback', 'https://127.0.0.1/'],
  ['localhost by name', 'https://localhost/'],
  ['cloud metadata', 'https://169.254.169.254/latest/meta-data/'],
  ['private 10/8', 'https://10.0.0.1/'],
  ['private 192.168/16', 'https://192.168.1.1/'],
  ['private 172.16/12', 'https://172.16.0.1/'],
]) {
  const r = await call(`url=${encodeURIComponent(url)}`);
  check(`refuses ${label}`, r.body.reason === 'blocked', `${r.status} ${JSON.stringify(r.body)}`);
}

const missing = await call('');
check('rejects a missing url', missing.body.reason === 'bad-request', JSON.stringify(missing.body));

/* --- a page with no Recipe JSON-LD ------------------------------------- */
const bare = await call(`url=${encodeURIComponent('https://example.com/')}`);
check('reports no-recipe on a page without one', bare.body.reason === 'no-recipe',
      JSON.stringify(bare.body));

/* --- a real recipe page ------------------------------------------------ */
const REAL = process.env.RECIPE_URL
  || 'https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya';
const good = await call(`url=${encodeURIComponent(REAL)}`);
if (good.body.ok) {
  const r = good.body.recipe;
  check('returns a name', typeof r.name === 'string' && r.name.length > 0, r.name);
  check('returns ingredient lines', Array.isArray(r.ingredients) && r.ingredients.length > 2,
        `${r.ingredients?.length} lines`);
  check('every line is a non-empty string',
        r.ingredients.every(l => typeof l === 'string' && l.trim().length > 0));
  check('reports the source', !!r.sourceName && r.sourceUrl === REAL, `${r.sourceName}`);
  check('returns no raw HTML', !JSON.stringify(good.body).includes('<script'));
} else {
  // A live third-party page may bot-block; that is not our bug, so say so loudly
  // rather than failing the suite on someone else's WAF.
  console.log(`SKIP  live recipe page — ${JSON.stringify(good.body)} (set RECIPE_URL to retry)`);
}

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 4: Run the function tests**

```sh
/opt/homebrew/opt/node@24/bin/node tests/recipe-fn.mjs
```

Expected: every guard refused with `blocked`, `bad-request` for a missing url, `no-recipe` for `example.com`, and either the live-page checks passing or a single `SKIP` line.

- [ ] **Step 5: Document it**

In `README.md`, in the Tests section, after the `deployed.mjs` paragraph:

```
`recipe-fn.mjs` checks the recipe Edge Function: that a real page yields ingredient
lines, and that the SSRF guards refuse plain http, loopback, `localhost`, cloud
metadata and every private range — re-checked after each redirect, not only on the
input. Plain `fetch`, nothing to install. `FN` overrides the endpoint and
`RECIPE_URL` the page it tries.
```

and add to the command block:

```sh
node tests/recipe-fn.mjs
```

- [ ] **Step 6: Commit**

```sh
git add supabase/functions/recipe/index.ts tests/recipe-fn.mjs README.md
git commit -m "Edge Function to read a recipe page's JSON-LD, with SSRF guards"
```

---

### Task 4: `Find a recipe` in the meal editor

**Files:**
- Modify: `js/editors/meal.js` (imports; the `grid2` step buttons around line 97; the `[data-step]` listener around line 147; new `findRecipe()` and `reviewRecipe()` steps beside `toBuy()` at line 410)
- Create: nothing
- Test: manual, plus `tests/smoke.mjs` staying clean

**Interfaces:**
- Consumes: `recipe.parseIngredients`, `recipe.searchLibrary` from Tasks 1–2; the Edge Function from Task 3; the editor's existing `show()`, `main()`, `draft`, `applyLibrary()`, `bestStockMatch()`, `newId()`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the imports and the endpoint constant**

At the top of `js/editors/meal.js`, beside the existing imports:

```js
import * as recipe from '../recipe.js';
import { SUPABASE } from '../config.js';

const RECIPE_FN = `${SUPABASE.url}/functions/v1/recipe`;
```

- [ ] **Step 2: Add the third step button**

Replace the `grid2` block at line 97 with:

```js
        <div class="grid2">
          <button class="btn btn--ghost btn--sm" type="button" data-step="inv">${icon('fridge')}From stock</button>
          <button class="btn btn--ghost btn--sm" type="button" data-step="buy">${icon('cart')}To buy</button>
        </div>
        <button class="btn btn--ghost btn--sm btn--block" type="button" data-step="recipe">
          ${icon('search')}Find a recipe
        </button>
```

and extend the `[data-step]` listener:

```js
      root.querySelectorAll('[data-step]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.step === 'inv') fromStock();
          else if (btn.dataset.step === 'buy') toBuy();
          else findRecipe();
        });
      });
```

- [ ] **Step 3: Add the search step**

Beside `toBuy()`, add:

```js
  /* --------------------------------------------------------- find a recipe -- */

  function findRecipe(query = '') {
    const stockNames = store.get().inventory.map(i => i.name);
    const hits = recipe.searchLibrary(query, store.library(mealId), stockNames);

    const body = `
      <div class="form">
        ${field({ label: 'Search your meals', control: textInput({
          name: 'q', value: query, placeholder: 'e.g. chicken, lemon', autofocus: true,
          selectOnFocus: true,
        }) })}

        ${hits.length ? `
          <div class="rows">
            ${hits.slice(0, 12).map(h => `
              <button class="row" type="button" data-pick="${esc(h.entry.id)}">
                <span class="row__main">
                  <span class="row__name">${esc(h.entry.name)}</span>
                  <span class="row__sub">${h.inStock} of ${h.total} already in</span>
                </span>
              </button>`).join('')}
          </div>` : `
          <p class="field__hint" style="padding:2px">
            ${query ? 'None of your saved meals match that.' : 'No saved meals yet — import one below.'}
          </p>`}

        <div class="divider" style="margin:6px 4px"></div>

        ${field({
          label: 'Import from a link',
          hint: 'Most recipe sites work. Paste the address of the recipe page.',
          control: textInput({ name: 'url', placeholder: 'https://…', attrs: 'inputmode="url"' }),
        })}

        <div class="sheet__foot">
          <button class="btn btn--ghost" type="button" data-back>Back</button>
          <button class="btn" type="button" data-go>${icon('search')}Import</button>
        </div>
      </div>`;

    show('Find a recipe', body, root => {
      root.querySelector('[data-back]').addEventListener('click', main);

      root.querySelectorAll('[data-pick]').forEach(btn => {
        btn.addEventListener('click', () => applyLibrary(btn.dataset.pick));
      });

      const q = root.querySelector('[name=q]');
      q.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); findRecipe(q.value); }
      });

      root.querySelector('[data-go]').addEventListener('click', async () => {
        const url = root.querySelector('[name=url]').value.trim();
        if (!url) { root.querySelector('[name=url]').focus(); return; }
        const btn = root.querySelector('[data-go]');
        btn.disabled = true;
        btn.textContent = 'Reading…';
        try {
          const res = await fetch(`${RECIPE_FN}?url=${encodeURIComponent(url)}`);
          const data = await res.json();
          if (data.ok) reviewRecipe(data.recipe);
          else pasteRecipe(reasonText(data.reason), url);
        } catch {
          pasteRecipe('Could not reach the importer. You may be offline.', url);
        }
      });
    });
  }

  const reasonText = reason => ({
    'no-recipe': "That page does not publish a recipe Munch can read.",
    blocked: 'That address cannot be fetched.',
    'too-large': 'That page is too big to read.',
    timeout: 'That page took too long to respond.',
    'fetch-failed': 'That page could not be fetched — it may block importers.',
    'bad-request': 'That does not look like a web address.',
  }[reason] || 'That page could not be read.');
```

- [ ] **Step 4: Add the paste-text fallback and the review step**

```js
  /* Failure is a route, not a dead end. */
  function pasteRecipe(why, url = '') {
    const body = `
      <div class="form">
        <div class="hintbar">
          ${icon('alert')}<span>${esc(why)} Paste the ingredients instead — one per line.</span>
        </div>
        ${field({ label: 'Recipe name', control: textInput({ name: 'name', value: '', placeholder: 'e.g. chicken traybake' }) })}
        ${field({ label: 'Ingredients', control: textArea({
          name: 'lines', value: '', placeholder: '600g chicken thighs\n2 lemons, halved\n1 tin chickpeas',
        }) })}
        <div class="sheet__foot">
          <button class="btn btn--ghost" type="button" data-back>Back</button>
          <button class="btn" type="button" data-go>${icon('check')}Read it</button>
        </div>
      </div>`;

    show('Paste a recipe', body, root => {
      root.querySelector('[data-back]').addEventListener('click', () => findRecipe());
      root.querySelector('[data-go]').addEventListener('click', () => {
        const f = readForm(root);
        const lines = f.lines.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) { root.querySelector('[name=lines]').focus(); return; }
        reviewRecipe({
          name: f.name || 'Imported recipe',
          serves: null,
          sourceUrl: url,
          sourceName: url ? new URL(url).hostname.replace(/^www\./, '') : '',
          ingredients: lines,
        });
      });
    });
  }

  /* Nothing is written here. Confirming only mutates the in-memory draft, which is
     persisted when the meal itself is saved — so main()'s existing tap-to-edit
     handles any fix without a second editor. */
  function reviewRecipe(r) {
    const parsed = recipe.parseIngredients(r.ingredients);
    const rows = parsed.map(p => {
      const hit = bestStockMatch(p.name, draft.place);
      return { ...p, hit };
    });
    const inStock = rows.filter(r2 => r2.hit).length;

    const body = `
      <div class="form">
        ${field({ label: 'Recipe name', control: textInput({ name: 'name', value: r.name }) })}

        <p class="field__hint" style="padding:2px">
          ${plural(rows.length, 'ingredient')} · ${inStock} already in stock${r.serves ? ` · serves ${r.serves}` : ''}
          ${r.sourceName ? ` · from ${esc(r.sourceName)}` : ''}
        </p>

        <div class="rows">
          ${rows.map((row, i) => `
            <div class="row row--split">
              <span class="row__hit" style="cursor:default">
                <span class="row__main">
                  <span class="row__name">${esc(row.name)}</span>
                  <span class="row__sub">
                    ${esc(qtyLabel(row.qty, row.unit) || 'no amount')} ·
                    ${row.hit ? 'from stock' : 'to buy'}
                  </span>
                </span>
              </span>
              <button class="iconbtn iconbtn--plain" type="button" data-drop="${i}"
                aria-label="Leave out ${esc(row.name)}">${icon('x')}</button>
            </div>`).join('')}
        </div>

        <p class="field__hint" style="padding:2px">
          Nothing is saved yet. Add them, then tap any ingredient to correct it.
        </p>

        <div class="sheet__foot">
          <button class="btn btn--ghost" type="button" data-back>Back</button>
          <button class="btn" type="button" data-ok>${icon('check')}Add ${plural(rows.length, 'ingredient')}</button>
        </div>
      </div>`;

    show('Review the recipe', body, root => {
      root.querySelector('[data-back]').addEventListener('click', () => findRecipe());

      root.querySelectorAll('[data-drop]').forEach(btn => {
        btn.addEventListener('click', () => {
          r.ingredients = r.ingredients.filter((_, i) => i !== Number(btn.dataset.drop));
          if (!r.ingredients.length) return findRecipe();
          reviewRecipe(r);
        });
      });

      root.querySelector('[data-ok]').addEventListener('click', () => {
        const f = readForm(root);
        if (f.name) draft.name = f.name;
        if (r.serves) {
          draft.note = draft.note ? `${draft.note}\nServes ${r.serves}` : `Serves ${r.serves}`;
        }
        for (const row of rows) {
          draft.items.push({
            id: newId(),
            name: row.name,
            qty: row.qty,
            unit: row.unit,
            category: row.category,
            source: row.hit ? 'inv' : 'buy',
            invId: row.hit ? row.hit.id : null,
          });
        }
        main();
        toast(`${plural(rows.length, 'ingredient')} added`, { iconName: 'check' });
      });
    });
  }
```

No other import changes are needed: `plural` and `qtyLabel` already come from
`../util.js`, and `textArea` and `readForm` from `../ui.js`. The icon name is
`x`, not `close` — `icons.js` has no `close`, and asking for one renders nothing.

- [ ] **Step 5: Verify by hand and with smoke**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  SHOT_DIR=./shots /opt/homebrew/opt/node@24/bin/node tests/smoke.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: `ERRORS: none` from both. Then in the browser: Plan → a day → Dinner → **Find a recipe**. Confirm searching your saved meals filters and shows "N of M already in"; that pasting a real recipe URL reaches the review sheet with sensible amounts; that the cross leaves an ingredient out; that **Add** puts them on the meal and tapping one opens the existing ingredient editor; and that a deliberately bad URL lands on the paste box rather than a dead end.

- [ ] **Step 6: Commit**

```sh
git add js/editors/meal.js
git commit -m "Find a recipe: search saved meals, import from a link"
```

---

## Phase 2 — online fallback

### Task 5: Edge Function — TheMealDB search and lookup

**Files:**
- Modify: `supabase/functions/recipe/index.ts`
- Modify: `tests/recipe-fn.mjs`

**Interfaces:**
- Consumes: the function from Task 3.
- Produces two more actions on the same endpoint:
  - `GET ?q=<text>` → `{ ok: true, results: [{ id, name, image, area }] }`
  - `GET ?id=<mealdb id>` → the **same** `{ ok: true, recipe: {…} }` shape as `?url=`

- [ ] **Step 1: Add the provider adapter**

In `supabase/functions/recipe/index.ts`, above `Deno.serve`:

```ts
/* TheMealDB is the provider because its terms permit storing what Munch stores:
   "You can scrape, copy and modify any content returned from the API, as long as
   you use the official end points." Spoonacular caps caching at one hour and
   Edamam is narrower still, so neither can back a feature that saves meals.
   Test key '1' per their guide; MEALDB_KEY overrides it if a supporter key is set. */
const MEALDB = (path: string) =>
  `https://www.themealdb.com/api/json/v1/${Deno.env.get('MEALDB_KEY') || '1'}/${path}`;

async function mealdb(path: string, signal: AbortSignal) {
  const res = await fetch(MEALDB(path), { signal });
  if (!res.ok) throw new Error('upstream-failed');
  return await res.json();
}

/** strIngredient1..20 + strMeasure1..20 -> "<measure> <ingredient>" lines, so the
    client has one parser and one input format regardless of the source. */
function mealdbLines(meal: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = String(meal[`strIngredient${i}`] ?? '').trim();
    if (!name) continue;
    const measure = String(meal[`strMeasure${i}`] ?? '').trim();
    out.push(`${measure} ${name}`.replace(/\s+/g, ' ').trim());
  }
  return out;
}
```

- [ ] **Step 2: Route the two new actions**

Inside `Deno.serve`, replace the block from `const target = params.get('url');` down to `if (!safe) return fail('blocked', 403);` with:

```ts
  const target = params.get('url');
  const query = params.get('q');
  const mealId = params.get('id');

  const ctrl0 = new AbortController();
  const t0 = setTimeout(() => ctrl0.abort(), TIMEOUT_MS);
  try {
    if (query) {
      const data = await mealdb(`search.php?s=${encodeURIComponent(query)}`, ctrl0.signal);
      const results = (data.meals || []).map((m: Record<string, unknown>) => ({
        id: String(m.idMeal), name: String(m.strMeal),
        image: String(m.strMealThumb || ''), area: String(m.strArea || ''),
      }));
      return new Response(JSON.stringify({ ok: true, results }), { headers: CORS });
    }
    if (mealId) {
      if (!/^\d+$/.test(mealId)) return fail('bad-request');
      const data = await mealdb(`lookup.php?i=${mealId}`, ctrl0.signal);
      const meal = (data.meals || [])[0];
      if (!meal) return fail('no-recipe', 422);
      const ingredients = mealdbLines(meal);
      if (!ingredients.length) return fail('no-recipe', 422);
      return new Response(JSON.stringify({
        ok: true,
        recipe: {
          name: String(meal.strMeal), serves: null,
          sourceUrl: String(meal.strSource || ''), sourceName: 'TheMealDB',
          image: String(meal.strMealThumb || ''), ingredients,
        },
      }), { headers: CORS });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (ctrl0.signal.aborted) return fail('timeout', 504);
    return fail(msg === 'upstream-failed' ? 'upstream-failed' : 'fetch-failed', 502);
  } finally {
    clearTimeout(t0);
  }

  if (!target) return fail('bad-request');
  const safe = checkUrl(target);
  if (!safe) return fail('blocked', 403);
```

- [ ] **Step 3: Redeploy and extend the tests**

Redeploy via the Supabase MCP `deploy_edge_function` (project `aaticbarhuvbjmfjtfey`, name `recipe`, JWT verification off).

Append to `tests/recipe-fn.mjs`, before the final summary lines:

```js
/* --- online search ----------------------------------------------------- */
const search = await call(`q=${encodeURIComponent('chicken')}`);
check('search returns results', search.body.ok && search.body.results?.length > 0,
      `${search.body.results?.length} results`);
check('results carry an id and a name',
      search.body.results?.every(r => /^\d+$/.test(r.id) && r.name), '');

const firstId = search.body.results?.[0]?.id;
const looked = await call(`id=${encodeURIComponent(firstId)}`);
check('lookup returns the same recipe shape',
      looked.body.ok && Array.isArray(looked.body.recipe?.ingredients)
      && looked.body.recipe.ingredients.length > 0,
      `${looked.body.recipe?.ingredients?.length} lines`);
check('lookup credits TheMealDB', looked.body.recipe?.sourceName === 'TheMealDB',
      looked.body.recipe?.sourceName);
check('measure and ingredient are joined into one line',
      looked.body.recipe?.ingredients.every(l => typeof l === 'string' && l.trim() && !l.startsWith(' ')));

const badId = await call('id=not-a-number');
check('a non-numeric id is rejected', badId.body.reason === 'bad-request', JSON.stringify(badId.body));
```

- [ ] **Step 4: Run them**

```sh
/opt/homebrew/opt/node@24/bin/node tests/recipe-fn.mjs
```

Expected: all guard checks still refuse, and the six new online checks pass.

- [ ] **Step 5: Commit**

```sh
git add supabase/functions/recipe/index.ts tests/recipe-fn.mjs
git commit -m "Online recipe search via TheMealDB, behind the same endpoint"
```

---

### Task 6: `Search online instead`, with attribution

**Files:**
- Modify: `js/editors/meal.js` (`findRecipe()` from Task 4)
- Modify: `js/app.js` (the Settings sheet body)

**Interfaces:**
- Consumes: `?q=` and `?id=` from Task 5.
- Produces: nothing.

- [ ] **Step 1: Add the online button to the search step**

In `findRecipe()`, immediately after the local-results block and before the `divider`:

```js
        <button class="btn btn--ghost btn--sm btn--block" type="button" data-online>
          ${icon('search')}Search online instead
        </button>
        <p class="field__hint" style="padding:2px">Recipe data from TheMealDB.</p>
```

and in its `mount`:

```js
      root.querySelector('[data-online]').addEventListener('click', async () => {
        const text = root.querySelector('[name=q]').value.trim();
        if (!text) { root.querySelector('[name=q]').focus(); return; }
        const btn = root.querySelector('[data-online]');
        btn.disabled = true;
        btn.textContent = 'Searching…';
        try {
          const res = await fetch(`${RECIPE_FN}?q=${encodeURIComponent(text)}`);
          const data = await res.json();
          if (!data.ok || !data.results.length) {
            toast('Nothing found online for that', { iconName: 'info' });
            btn.disabled = false;
            btn.textContent = 'Search online instead';
            return;
          }
          onlineResults(text, data.results);
        } catch {
          toast('Could not reach the search service', { iconName: 'alert' });
          btn.disabled = false;
          btn.textContent = 'Search online instead';
        }
      });
```

- [ ] **Step 2: Add the results step**

Beside `findRecipe()`:

```js
  function onlineResults(query, results) {
    const body = `
      <div class="form">
        <p class="field__hint" style="padding:2px">
          ${plural(results.length, 'result')} for “${esc(query)}” · from TheMealDB
        </p>
        <div class="rows">
          ${results.slice(0, 20).map(r => `
            <button class="row" type="button" data-mealdb="${esc(r.id)}">
              <span class="row__main">
                <span class="row__name">${esc(r.name)}</span>
                ${r.area ? `<span class="row__sub">${esc(r.area)}</span>` : ''}
              </span>
            </button>`).join('')}
        </div>
        <div class="sheet__foot">
          <button class="btn btn--ghost" type="button" data-back>Back</button>
        </div>
      </div>`;

    show('Found online', body, root => {
      root.querySelector('[data-back]').addEventListener('click', () => findRecipe(query));
      root.querySelectorAll('[data-mealdb]').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const res = await fetch(`${RECIPE_FN}?id=${encodeURIComponent(btn.dataset.mealdb)}`);
            const data = await res.json();
            if (data.ok) reviewRecipe(data.recipe);
            else toast('Could not read that recipe', { iconName: 'alert' });
          } catch {
            toast('Could not reach the search service', { iconName: 'alert' });
          }
          btn.disabled = false;
        });
      });
    });
  }
```

- [ ] **Step 3: Credit TheMealDB in Settings**

In `js/app.js`, in the Settings sheet body, directly above the `Build` line added earlier:

```js
        <p class="field__hint" style="text-align:center;margin-top:12px">
          Online recipe search uses data from
          <a href="https://www.themealdb.com/" target="_blank" rel="noopener">TheMealDB</a>.
        </p>
```

- [ ] **Step 4: Verify**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  SHOT_DIR=./shots /opt/homebrew/opt/node@24/bin/node tests/smoke.mjs
/opt/homebrew/opt/node@24/bin/node tests/syntax.mjs
/opt/homebrew/opt/node@24/bin/node tests/recipe-fn.mjs
```

Expected: `ERRORS: none`, all files parse, function checks pass. Then by hand: Find a recipe → type `chicken` → **Search online instead** → pick a result → the review sheet shows its ingredients with amounts → Add → they land on the meal. Confirm the TheMealDB credit appears both on the search step and in Settings.

- [ ] **Step 5: Commit**

```sh
git add js/editors/meal.js js/app.js
git commit -m "Search online when your own meals do not have it"
```

---

## Deviations from the spec

Both reduce the amount of new code by reusing what the editor already does:

1. **The review sheet does not re-implement ingredient editing.** The spec described every ingredient as an editable row. Instead the review step is a preview with a leave-out control, and confirming pushes into the in-memory `draft` — where `main()`'s existing tap-a-tag → `editIngredient` flow already offers amount, unit, aisle and stock/buy for each. Nothing is persisted until the meal is saved, so "review before save" still holds.
2. **`parseIngredient` does no stock matching.** The spec had it return `source` and `invId` via `matchInInventory`. It returns `{ qty, unit, name }` and the editor applies its own `bestStockMatch(name, draft.place)`, which is **place-aware** — so a meal set for work is not matched against something in the fridge at home. It also keeps `recipe.js` free of store access, which is what makes it unit-testable.

## Notes carried over from the spec

- Nothing is ever converted between units.
- `PARTABLE` is not extended; none of `tbsp`, `tsp`, `clove` is a part-usable container.
- No serving scaling. `serves` is appended to the meal note and nothing else.
- No schema change. Imports become ordinary `library` and `slot` records that `commit()` stamps.
- `verify_jwt` stays off so import works signed out. The residual exposure is function quota; the guards bound what a caller can do, and turning it on is the escalation if abuse appears.
- A hostname that *resolves* to a private address is not detectable in this runtime, which is why only parsed JSON is ever returned and the size and time caps are hard.

## Known testing gap

The spec listed `too-large` among the function's test cases. There is no automated
case for it: it needs a third-party page that is reliably over 2 MB and stays that
way, and pinning the suite to someone else's page size would make it flaky for a
reason unrelated to our code. The cap is enforced while streaming and returns
`too-large`, but that path is exercised by reading the code rather than by a test.
Worth saying out loud rather than leaving the impression it is covered.
