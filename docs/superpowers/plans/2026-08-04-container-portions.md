# Using part of a container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a meal say "2 slices" or "1 spoon" of a container item, and stop cooking from deleting an item whose amount it could not read.

**Architecture:** Two optional fields on an inventory item declare what a portion is called and how many are in one container. A meal ingredient needs no new field — `{ qty: 2, unit: 'slice' }` already says it. `cookSlot` becomes share-based, working off `(qty - 1) + remaining` so `qty` stays a whole count of containers, and gains a non-destructive fallback.

**Tech Stack:** Plain ES modules, no build step, no dependencies. Playwright for the browser tests.

## Global Constraints

- No client dependencies and no build step.
- `store.js` is the only module that touches persisted state.
- Every mutation funnels through `commit()`. Never hand-stamp a sync clock.
- **Nothing is ever converted between units.** A portion count is declared by the user; it is not a conversion table.
- `portionName` and `portionPer` are optional and **never enter `UNITS`**.
- **Cooking must never delete an item because the amount was unreadable.** Removal only when the count genuinely reaches zero.
- `qty` stays a whole count of containers; `remaining` describes the open one.
- `qtyLabel` pluralises a portion name (`2 slices`) and leaves standard units alone (`2 tin`).
- Dark only. UK English in all user-facing copy.
- New modules must be added to `sw.js`'s `SHELL` — `tests/syntax.mjs` enforces it. (No new modules here.)
- Serve with `python3 -m http.server 8765`; use `/opt/homebrew/opt/node@24/bin/node`; pass `CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

---

### Task 1: `jar`, portion fields, and pluralisation

**Files:**
- Modify: `js/store.js` (`UNITS`, `PARTABLE`, `addInvItem`, `updateInvItem`)
- Modify: `js/util.js` (`qtyLabel`)
- Test: `tests/logic.mjs` (append inside `page.evaluate`, before `return out;`)

**Interfaces:**
- Produces:
  - `UNITS` gains `'jar'`; `PARTABLE` gains `'jar'`
  - Inventory items accept and keep `portionName: string|null`, `portionPer: number|null`
  - `qtyLabel(qty, unit)` pluralises any unit not in `util.js`'s `STANDARD_UNITS`
  - `export const STANDARD_UNITS` in `js/util.js`

- [ ] **Step 1: Write the failing test**

```js
  /* --- 21. jar, portions, and how amounts read ------------------------- */
  check('jar is a unit', store.UNITS.includes('jar'));
  check('jar is part-usable', store.PARTABLE.has('jar'));

  const jarId = store.addInvItem({
    name: 'Test marmalade', qty: 1, unit: 'jar', category: 'cupboard', locId,
    portionName: 'spoon', portionPer: 30,
  }).id;
  check('a portion name is kept', store.invItem(jarId).portionName === 'spoon',
        String(store.invItem(jarId).portionName));
  check('a portion count is kept', store.invItem(jarId).portionPer === 30,
        String(store.invItem(jarId).portionPer));
  check('a portion name never enters UNITS', !store.UNITS.includes('spoon'));

  store.updateInvItem(jarId, { note: 'opened' });
  check('an unrelated edit keeps the portion', store.invItem(jarId).portionName === 'spoon');

  const plainId = store.addInvItem({
    name: 'Test flour', qty: 500, unit: 'g', category: 'cupboard', locId,
  }).id;
  check('an item without portions has none', store.invItem(plainId).portionName == null,
        String(store.invItem(plainId).portionName));

  /* A word the user typed pluralises; an abbreviation does not. */
  check('a portion name pluralises', window.munch.util.qtyLabel(2, 'slice') === '2 slices',
        window.munch.util.qtyLabel(2, 'slice'));
  check('one portion does not pluralise', window.munch.util.qtyLabel(1, 'slice') === '1 slice',
        window.munch.util.qtyLabel(1, 'slice'));
  check('a standard unit is left alone', window.munch.util.qtyLabel(2, 'tin') === '2 tin',
        window.munch.util.qtyLabel(2, 'tin'));
  check('grams are left alone', window.munch.util.qtyLabel(500, 'g') === '500 g',
        window.munch.util.qtyLabel(500, 'g'));
  check('pcs still shows the bare number', window.munch.util.qtyLabel(3, 'pcs') === '3',
        window.munch.util.qtyLabel(3, 'pcs'));

  /* The two lists live in different modules to avoid a store <-> util import cycle, so
     assert they agree rather than trusting them to. */
  check('every unit is known to the renderer',
        store.UNITS.every(u => window.munch.util.STANDARD_UNITS.includes(u)),
        JSON.stringify(store.UNITS.filter(u => !window.munch.util.STANDARD_UNITS.includes(u))));
```

- [ ] **Step 2: Expose `util` for the test**

In `js/app.js`, add the import beside the others:

```js
import * as util from './util.js';
```

and extend the last line:

```js
window.munch = { store, cloud, sync, recipe, util, refresh: () => render(), go: navigate };
```

- [ ] **Step 3: Run it to verify it fails**

```sh
python3 -m http.server 8765 &
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: FAIL on `jar is a unit`, and on the pluralisation checks.

- [ ] **Step 4: Add `jar` and the portion fields**

In `js/store.js`, replace the `UNITS` and `PARTABLE` declarations:

```js
export const UNITS = ['pcs', 'g', 'kg', 'ml', 'L', 'pack', 'tin', 'jar', 'bunch', 'loaf',
                      'bottle', 'tbsp', 'tsp', 'clove'];

/**
 * Units where a part-used fraction means something physical. Grams and millilitres are
 * already exact, and three apples at 65% is nonsense — so both the slider and every
 * display of the value are gated on this one set, and cannot disagree.
 */
export const PARTABLE = new Set(['pack', 'tin', 'jar', 'bottle', 'loaf', 'bunch']);
```

In `addInvItem`, after the `remaining` line:

```js
    // What one helping of this container is called, and how many are in it. Declared by
    // the user, never guessed — this is what lets a meal say "1 spoon" without the app
    // converting anything.
    portionName: data.portionName ? String(data.portionName).trim() : null,
    portionPer: Number(data.portionPer) > 0 ? Number(data.portionPer) : null,
```

In `updateInvItem`, after the `remaining` line:

```js
  if ('portionName' in patch) {
    it.portionName = patch.portionName ? String(patch.portionName).trim() : null;
  }
  if ('portionPer' in patch) {
    it.portionPer = Number(patch.portionPer) > 0 ? Number(patch.portionPer) : null;
  }
```

- [ ] **Step 5: Pluralise portion names**

In `js/util.js`, replace `qtyLabel` and add the list above it:

```js
/**
 * Units that read as abbreviations and must not be pluralised: "500 g", not "500 gs".
 *
 * Duplicated from store.js's UNITS on purpose — store.js imports util.js, so importing
 * back would make a cycle. tests/logic.mjs asserts the two agree, so drift is caught
 * rather than discovered.
 */
export const STANDARD_UNITS = ['pcs', 'g', 'kg', 'ml', 'L', 'pack', 'tin', 'jar', 'bunch',
                               'loaf', 'bottle', 'tbsp', 'tsp', 'clove'];

/** "500 g", "2 × tin", "3 pcs", "2 slices". */
export function qtyLabel(qty, unit) {
  const q = num(qty);
  if (!q || Number(q) === 0) return '';
  if (!unit || unit === 'pcs') return q;
  // A portion name is a word the user typed, so it pluralises. A standard unit is an
  // abbreviation and stays as it is, and one of anything is singular either way.
  const word = STANDARD_UNITS.includes(unit) || Number(q) === 1 ? unit : `${unit}s`;
  return `${q} ${word}`;
}
```

- [ ] **Step 6: Run it to verify it passes**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
/opt/homebrew/opt/node@24/bin/node tests/syntax.mjs
```

Expected: all checks PASS, `ERRORS: none`, all files parse and all modules precached.

- [ ] **Step 7: Commit**

```sh
git add js/store.js js/util.js js/app.js tests/logic.mjs
git commit -m "A jar is a unit, and a container can say what a helping is"
```

---

### Task 2: Cooking takes a share, and never deletes on a guess

**Files:**
- Modify: `js/store.js` (`cookSlot`, plus a new `applyShare` helper beside it)
- Modify: `js/editors/meal.js` (the `[data-cook]` toast, to report untracked items)
- Test: `tests/logic.mjs`

**Interfaces:**
- Consumes: `portionName`, `portionPer`, `PARTABLE` from Task 1.
- Produces: `cookSlot(date, mealId)` returns `{ used, untracked, emptiedCount }` — `untracked` is a new array of `{ name }` for ingredients nothing could be done with.

- [ ] **Step 1: Write the failing test**

```js
  /* --- 22. cooking takes a share of a container ------------------------ */
  const mkJar = (qty, remaining) => {
    const id = store.addInvItem({
      name: `Jar ${Math.random().toString(36).slice(2, 7)}`, qty, unit: 'jar',
      category: 'cupboard', locId, portionName: 'spoon', portionPer: 30,
    }).id;
    if (remaining != null) store.setRemaining(id, remaining);
    return id;
  };
  /* A fresh day per call. Reusing one slot would work but saveSlot inherits `done` from
     whatever was there before, so each case gets its own to keep the cause of a failure
     unambiguous. */
  let shareDay = 5;
  const cookWith = (invId, name, qty, unit) => {
    const day = iso(new Date(Date.now() + (shareDay++) * 864e5));
    store.saveSlot(day, 'lunch', {
      name: 'Share test', place: 'home',
      items: [{ name, qty, unit, category: 'cupboard', source: 'inv', invId }],
    });
    return store.cookSlot(day, 'lunch');
  };

  /* 2 of 20 slices leaves the loaf whole but 90% full */
  const loafId = store.addInvItem({
    name: 'Share loaf', qty: 1, unit: 'loaf', category: 'bakery', locId,
    portionName: 'slice', portionPer: 20,
  }).id;
  cookWith(loafId, 'Share loaf', 2, 'slice');
  check('portions leave the count alone', store.invItem(loafId)?.qty === 1,
        String(store.invItem(loafId)?.qty));
  check('portions come off the open container', store.invItem(loafId)?.remaining === 0.9,
        String(store.invItem(loafId)?.remaining));

  /* 3 of 30 spoons from a half jar */
  const j1 = mkJar(1, 0.5);
  cookWith(j1, store.invItem(j1).name, 3, 'spoon');
  check('a part-used jar goes down by the share', store.invItem(j1)?.remaining === 0.4,
        String(store.invItem(j1)?.remaining));

  /* using more than is left finishes it off */
  const j2 = mkJar(1, 0.5);
  cookWith(j2, store.invItem(j2).name, 18, 'spoon');
  check('using more than is left removes it', !store.invItem(j2));

  /* spilling over into the next container */
  const j3 = mkJar(3, 0.5);
  cookWith(j3, store.invItem(j3).name, 18, 'spoon');
  check('spilling over spends one container', store.invItem(j3)?.qty === 2,
        String(store.invItem(j3)?.qty));
  check('and carries the remainder', store.invItem(j3)?.remaining === 0.9,
        String(store.invItem(j3)?.remaining));

  /* a whole container respects the open one rather than resetting it */
  const j4 = mkJar(3, 0.5);
  cookWith(j4, store.invItem(j4).name, 1, 'jar');
  check('a whole container leaves the rest part-used', store.invItem(j4)?.qty === 2
        && store.invItem(j4)?.remaining === 0.5,
        `${store.invItem(j4)?.qty} / ${store.invItem(j4)?.remaining}`);

  /* THE ONE THAT MATTERS: a blank amount must not delete anything */
  const j5 = mkJar(1, null);
  const blankRes = cookWith(j5, store.invItem(j5).name, null, 'jar');
  check('a blank amount leaves the item alone', !!store.invItem(j5));
  check('and its count is untouched', store.invItem(j5)?.qty === 1,
        String(store.invItem(j5)?.qty));
  check('and it is reported as untracked', blankRes?.untracked?.length === 1,
        JSON.stringify(blankRes?.untracked));

  /* a unit matching no portion name is also left alone */
  const j6 = mkJar(1, null);
  cookWith(j6, store.invItem(j6).name, 2, 'dollop');
  check('an unknown unit leaves the item alone', !!store.invItem(j6));

  /* non-container items are untouched by any of this */
  const butterId = store.addInvItem({
    name: 'Share butter', qty: 250, unit: 'g', category: 'dairy', locId,
  }).id;
  cookWith(butterId, 'Share butter', 50, 'g');
  check('grams still subtract', store.invItem(butterId)?.qty === 200,
        String(store.invItem(butterId)?.qty));
  check('and gain no remaining', store.invItem(butterId)?.remaining == null,
        String(store.invItem(butterId)?.remaining));
```

- [ ] **Step 2: Run it to verify it fails**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: FAIL on the portion checks, and critically on `a blank amount leaves the item alone` — today that path deletes it.

- [ ] **Step 3: Replace `cookSlot`**

In `js/store.js`, replace the whole of `cookSlot` with:

```js
/**
 * Take `share` containers-worth off an item, keeping qty a whole count of containers.
 *
 * `remaining` describes the container currently open, so what is actually in stock is
 * (qty - 1) + remaining. Recomputing both from that total is what stops qty ever
 * becoming 0.8 of a loaf, which never meant anything.
 */
function applyShare(it, share, emptied) {
  const qty = Number(it.qty);
  if (!isFinite(qty) || qty <= 0) { emptied.push(it.id); return; }

  const open = it.remaining == null ? 1 : Number(it.remaining);
  const total = (qty - 1) + (isFinite(open) ? open : 1);
  const left = Math.round((total - share) * 100) / 100;

  if (left <= 0) { emptied.push(it.id); return; }

  it.qty = Math.ceil(left);
  const rem = Math.round((left - (it.qty - 1)) * 100) / 100;
  // A full container is "not part-used", which is null rather than 1.
  it.remaining = rem >= 1 ? null : rem;
}

export function cookSlot(date, mealId) {
  const s = slot(date, mealId);
  if (!s) return null;
  snapshot('Meal marked as eaten');

  const used = [];
  const untracked = [];
  const emptied = [];

  for (const ing of s.items || []) {
    if (ing.source !== 'inv' || !ing.invId) continue;
    const it = invItem(ing.invId);
    if (!it) continue;

    const take = Number(ing.qty);
    const usable = isFinite(take) && take > 0;
    const per = Number(it.portionPer);

    // 1. Portions of a container: "2 slices" of a 20-slice loaf.
    if (usable && it.portionName && ing.unit === it.portionName && per > 0) {
      applyShare(it, take / per, emptied);
      used.push({ name: it.name, took: take, unit: it.portionName });
      continue;
    }

    // 2. Whole containers of a container item. Through the same arithmetic, so taking
    // one jar from three with the open one half gone leaves two still half gone.
    if (usable && PARTABLE.has(it.unit)) {
      applyShare(it, take, emptied);
      used.push({ name: it.name, took: take, unit: it.unit });
      continue;
    }

    // 3. Anything else measurable. `remaining` means nothing for 600 g of chicken.
    if (usable && isFinite(Number(it.qty))) {
      it.qty = Math.max(0, Math.round((Number(it.qty) - take) * 100) / 100);
      used.push({ name: it.name, took: take, unit: it.unit });
      if (it.qty <= 0) emptied.push(it.id);
      continue;
    }

    // 4. Nothing usable. Leave it alone and say so — this used to delete the item,
    // which meant "marmalade on toast" with no amount threw away the whole jar.
    untracked.push({ name: it.name });
  }

  if (emptied.length) state.inventory = state.inventory.filter(i => !emptied.includes(i.id));
  s.done = true;
  commit();
  return { used, untracked, emptiedCount: emptied.length };
}
```

- [ ] **Step 4: Say so in the toast**

In `js/editors/meal.js`, replace the toast inside the `[data-cook]` handler:

```js
        const n = res?.used.length || 0;
        const skipped = res?.untracked.length || 0;
        const parts = [];
        if (n) parts.push(`${plural(n, 'item')} drawn from stock`);
        if (skipped) parts.push(`${plural(skipped, 'item')} left alone — no amount given`);
        toast(parts.length ? `Logged — ${parts.join(', ')}` : 'Logged as eaten', {
          iconName: 'flame',
          action: { label: 'Undo', run: () => { store.undo(); after?.(); } },
        });
```

- [ ] **Step 5: Run it to verify it passes**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/sync.mjs
```

Expected: all `logic.mjs` checks PASS, and `sync.mjs` still passes — the inventory record shape changed, so it matters.

- [ ] **Step 6: Commit**

```sh
git add js/store.js js/editors/meal.js tests/logic.mjs
git commit -m "Cook a share of a container, and never bin an item over a blank amount"
```

---

### Task 3: Declaring portions on the item

**Files:**
- Modify: `js/editors/item.js` (`openItemEditor` — body and `save`)

**Interfaces:**
- Consumes: `portionName`/`portionPer` from Task 1, `PARTABLE` (already imported in this file).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the fields to the form**

In `js/editors/item.js`, add to the `start` literal for a new item, after `remaining`:

```js
    portionName: prefill.portionName || '',
    portionPer: prefill.portionPer ?? '',
```

Then inside the `[data-remwrap]` block, after the existing part-used `field(...)`, so both
appear and disappear together on the same `PARTABLE` test:

```js
        ${PARTABLE.has(start.unit) ? `
          <div class="grid-qty">
            ${field({ label: 'One helping is a', control: textInput({
              name: 'portionName', value: start.portionName || '',
              placeholder: PORTION_HINT[start.unit] || 'portion',
            }) })}
            ${field({ label: `How many in a ${esc(start.unit)}`, control: textInput({
              name: 'portionPer', value: start.portionPer === '' ? '' : num(start.portionPer),
              placeholder: 'e.g. 20', attrs: 'inputmode="numeric"',
            }) })}
          </div>
          <span class="field__hint">
            Optional. Set it and a meal can say “2 slices” instead of a fraction of the whole thing.
          </span>` : ''}
```

Add the hint table near `QUICK_DATES` at the top of the file. These are placeholders, never
values — a pre-filled 20 would be Munch claiming to know how many slices are in your loaf:

```js
/* Suggestions only. Nothing is pre-filled: the count has to come from the user. */
const PORTION_HINT = {
  loaf: 'slice', jar: 'spoon', tin: 'spoon', pack: 'piece',
  bottle: 'glass', bunch: 'sprig',
};
```

- [ ] **Step 2: Rebuild them when the unit changes**

The existing `unitSel` `change` handler rebuilds `[data-remwrap]`. Replace its rebuild
branch so it renders both controls rather than only the slider:

```js
      unitSel.addEventListener('change', () => {
        const shown = !!remWrap.querySelector('input[type=range]');
        if (PARTABLE.has(unitSel.value)) {
          if (shown) return;
          remWrap.innerHTML = `
            ${field({
              label: 'How much is left',
              control: slider({ name: 'remaining', value: start.remaining }),
            })}
            <div class="grid-qty">
              ${field({ label: 'One helping is a', control: textInput({
                name: 'portionName', value: start.portionName || '',
                placeholder: PORTION_HINT[unitSel.value] || 'portion',
              }) })}
              ${field({ label: `How many in a ${esc(unitSel.value)}`, control: textInput({
                name: 'portionPer', value: start.portionPer === '' ? '' : num(start.portionPer),
                placeholder: 'e.g. 20', attrs: 'inputmode="numeric"',
              }) })}
            </div>`;
          bindSliders(remWrap);
        } else if (shown) {
          remWrap.innerHTML = '';
        }
      });
```

- [ ] **Step 3: Carry them into the patch on save**

In `save`, beside the existing `remaining` line:

```js
        // Absent means the controls were not on screen, which must leave a stored
        // portion alone rather than clearing it — same rule as the slider.
        if (f.portionName !== undefined) patch.portionName = f.portionName || null;
        if (f.portionPer !== undefined) patch.portionPer = f.portionPer === '' ? null : Number(f.portionPer);
```

- [ ] **Step 4: Verify**

```sh
/opt/homebrew/opt/node@24/bin/node tests/syntax.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  SHOT_DIR=./shots /opt/homebrew/opt/node@24/bin/node tests/smoke.mjs
```

Expected: parse and precache clean, `ERRORS: none`. Then by hand: open a `jar` item, set
`spoon` × 30, save, reopen — both survive. Switch the unit to `g` and the pair vanishes with
the slider; save and reopen as `jar` and the values are still there.

- [ ] **Step 5: Commit**

```sh
git add js/editors/item.js
git commit -m "Say what a helping of a container is, on the item"
```

---

### Task 4: Choosing portions when assigning from stock

**Files:**
- Modify: `js/editors/meal.js` (`fromStock`, and `editIngredient`'s unit options)

**Interfaces:**
- Consumes: `portionName`/`portionPer` from Task 1; `PARTABLE` (needs adding to this file's `store.js` import).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Import `PARTABLE`**

In `js/editors/meal.js`, extend the named import:

```js
import { MEALS, CATEGORIES, UNITS, PLACES, PARTABLE, catOf, mealOf, placeOf } from '../store.js';
```

- [ ] **Step 2: Let `chosen` carry a unit as well as an amount**

In `fromStock`, `chosen` is currently `invId -> qty string`. It becomes
`invId -> { qty, unit }`. Replace `togglePick`:

```js
        const togglePick = id => {
          if (chosen.has(id)) chosen.delete(id);
          else {
            const it = store.invItem(id);
            // Default to the item's own unit and its current amount, as before.
            chosen.set(id, { qty: it?.qty != null ? num(it.qty) : '', unit: it?.unit || '' });
          }
          render();
        };
```

and the `[data-qty]` handler:

```js
        root.querySelectorAll('[data-qty]').forEach(inp => {
          inp.addEventListener('input', () => {
            const cur = chosen.get(inp.dataset.qty);
            chosen.set(inp.dataset.qty, { ...cur, qty: inp.value });
          });
          inp.addEventListener('click', e => e.stopPropagation());
        });
```

- [ ] **Step 3: Make the unit label a toggle**

In the picker row template, replace the fixed unit span:

```js
                      <button type="button" class="chip" data-unit="${esc(it.id)}"
                        style="min-height:38px;padding:6px 8px"
                        aria-label="Change the unit for ${esc(it.name)}">${esc(chosen.get(it.id).unit || '—')}</button>
```

and in `mount`, wire it. On an item with no portion declared it asks once and writes the
answer to the item, so every later meal just says `1 spoon`:

```js
        root.querySelectorAll('[data-unit]').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.dataset.unit;
            const it = store.invItem(id);
            if (!it) return;
            if (!PARTABLE.has(it.unit)) return;          // nothing to toggle to
            if (!it.portionName || !(Number(it.portionPer) > 0)) return askPortion(id);
            const cur = chosen.get(id);
            const next = cur.unit === it.portionName ? it.unit : it.portionName;
            chosen.set(id, { qty: cur.qty, unit: next });
            render();
          });
        });
```

- [ ] **Step 4: Add the one-time prompt**

Beside `fromStock`, add:

```js
  /* Asked the first time a container is used by the helping rather than whole. Writes the
     answer onto the item, so it is asked once and never again. */
  function askPortion(invId) {
    const it = store.invItem(invId);
    if (!it) return;

    const hint = { loaf: 'slice', jar: 'spoon', tin: 'spoon', pack: 'piece',
                   bottle: 'glass', bunch: 'sprig' }[it.unit] || 'portion';

    const body = `
      <div class="form">
        <p class="field__hint" style="padding:2px">
          To use part of ${esc(it.name)} rather than a whole ${esc(it.unit)}, Munch needs to
          know what a helping is. It only asks once.
        </p>
        ${field({ label: 'One helping is a', control: textInput({
          name: 'portionName', value: '', placeholder: hint, autofocus: true,
        }) })}
        ${field({ label: `How many in a ${esc(it.unit)}`, control: textInput({
          name: 'portionPer', value: '', placeholder: 'e.g. 20', attrs: 'inputmode="numeric"',
        }) })}
        <div class="sheet__foot">
          <button class="btn btn--ghost" type="button" data-back>Back</button>
          <button class="btn" type="button" data-go>${icon('check')}Save</button>
        </div>
      </div>`;

    show(`Helpings of ${it.name}`, body, root => {
      root.querySelector('[data-back]').addEventListener('click', fromStock);
      root.querySelector('[data-go]').addEventListener('click', () => {
        const f = readForm(root);
        const per = Number(f.portionPer);
        if (!f.portionName || !(per > 0)) {
          root.querySelector('[name=portionName]').focus({ preventScroll: true });
          return;
        }
        store.updateInvItem(invId, { portionName: f.portionName, portionPer: per });
        after?.();
        fromStock();
      });
    });
  }
```

Note this returns via `fromStock()`, which rebuilds the picker from scratch. The previous
selection is lost, which is the honest trade for not threading picker state through a
sub-step — and the item now has its portion, so re-picking takes one tap.

- [ ] **Step 5: Use the chosen unit when adding**

In the `[data-add]` handler, replace the loop body:

```js
          for (const [id, sel] of chosen) {
            const it = store.invItem(id);
            if (!it) continue;
            const qty = sel.qty === '' ? null : Number(sel.qty);
            const existingIng = draft.items.find(i => i.invId === id);
            if (existingIng) { existingIng.qty = qty; existingIng.unit = sel.unit; continue; }
            draft.items.push({
              id: newId(),
              name: it.name,
              qty,
              unit: sel.unit,
              category: it.category || 'other',
              source: 'inv',
              invId: id,
            });
          }
```

- [ ] **Step 6: Keep the portion unit through an edit**

`editIngredient`'s unit `<select>` is built from `UNITS`, so an ingredient measured in
`slices` matches no option and silently falls back to the first one, losing it. In
`editIngredient`, before the body, and using it for the select's options:

```js
    // A portion name is not in UNITS, so add the linked item's own so an edit does not
    // quietly rewrite "2 slices" as "2 pcs".
    const linked = ing.invId ? store.invItem(ing.invId) : null;
    const unitOpts = linked?.portionName && !UNITS.includes(linked.portionName)
      ? [...unitOptions, { value: linked.portionName, label: linked.portionName }]
      : unitOptions;
```

and change the unit field to use it:

```js
          ${field({ label: 'Unit', control: select({ name: 'unit', value: ing.unit, options: unitOpts }) })}
```

- [ ] **Step 7: Verify**

```sh
/opt/homebrew/opt/node@24/bin/node tests/syntax.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  SHOT_DIR=./shots /opt/homebrew/opt/node@24/bin/node tests/smoke.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: parse clean, `ERRORS: none`, all logic checks pass. Then by hand, the whole point
of the exercise: add a `jar` of marmalade and a `loaf`, make a meal, assign both from stock,
tap the unit chips to `spoon` and `slice`, enter `1` and `2`, add them, and mark it eaten.
The jar and loaf should both stay at a count of 1 with their part-used sliders moved, and
nothing should be deleted.

- [ ] **Step 8: Commit**

```sh
git add js/editors/meal.js
git commit -m "Assign a helping from stock, not a fraction of the whole thing"
```

---

### Task 5: State the keyboard behaviour instead of leaving it to chance

**Files:**
- Modify: `js/ui.js` (`textInput`, `textArea`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

Unrelated to portions, and shipping separately so it can be judged on its own.

- [ ] **Step 1: Set the attributes explicitly**

In `js/ui.js`, replace `textInput` and `textArea`:

```js
/**
 * A text field.
 *
 * iOS suggestions and autocorrect were left to chance: every field said
 * autocomplete="off" and none of autocorrect, autocapitalize or spellcheck was set. They
 * are stated here instead. `autocomplete` is only suppressed on numeric fields — on a
 * free-text field there was never a reason to fight the browser, and it may be what was
 * suppressing the predictive bar.
 */
export function textInput({
  name, value = '', placeholder = '', type = 'text',
  autofocus = false, selectOnFocus = false, attrs = '',
}) {
  const numeric = /inputmode="(decimal|numeric)"/.test(attrs) || type === 'date';
  const keyboard = numeric
    ? 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"'
    : 'autocorrect="on" autocapitalize="sentences" spellcheck="true"';
  return `<input class="input" type="${type}" name="${esc(name)}" value="${esc(value)}"
    placeholder="${esc(placeholder)}" enterkeyhint="done" ${keyboard}
    ${autofocus ? 'data-autofocus' : ''} ${selectOnFocus ? 'data-selectall' : ''} ${attrs}>`;
}

export function textArea({ name, value = '', placeholder = '' }) {
  return `<textarea class="textarea" name="${esc(name)}" placeholder="${esc(placeholder)}"
    autocorrect="on" autocapitalize="sentences" spellcheck="true"
    rows="3">${esc(value)}</textarea>`;
}
```

- [ ] **Step 2: Verify the right fields got the right treatment**

```sh
/opt/homebrew/opt/node@24/bin/node tests/syntax.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  SHOT_DIR=./shots /opt/homebrew/opt/node@24/bin/node tests/smoke.mjs
```

Then confirm in the browser console that a name field and an amount field differ:

```js
document.querySelector('[name=name]').getAttribute('autocorrect')      // "on"
document.querySelector('[name=qty]').getAttribute('autocorrect')       // "off"
```

Expected: `on` for the name, `off` for the amount — a number pad has nothing to correct.

**Whether this restores the predictive bar can only be confirmed on the phone.** Say so
when handing it over rather than claiming it is fixed; the sheet-scroll bug did not
reproduce under emulation either.

- [ ] **Step 3: Commit**

```sh
git add js/ui.js
git commit -m "State the keyboard behaviour instead of leaving it to chance"
```

---

## Notes carried over from the spec

- Portion names never enter `UNITS`; they belong to one item.
- Portion-unit ingredients are always `source: 'inv'`, and the shopping list is built from
  `buy` ingredients only, so they can never reach it.
- A portion renamed later leaves older ingredients matching nothing, so they fall to rule 4
  and are left alone — the safe direction to fail in.
- Nothing converts portions to mass or volume.
- Creating a recipe by hand is the next spec, not this one.
