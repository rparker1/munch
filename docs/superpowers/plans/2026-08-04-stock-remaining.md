# Part-used stock ("how much is left") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record an optional 0–1 fraction on a stock item saying how much of a part-used container is left, editable by slider in the peek and editor sheets.

**Architecture:** One optional `remaining` field on the inventory record, one new mutation `setRemaining()` in `store.js`, and a reusable `slider()` fragment in the UI kit. A single exported `PARTABLE` set gates both the control and every display of the value, so they cannot disagree. The peek slider writes on `change`; the editor slider is read by `readForm()` on save.

**Tech Stack:** Plain ES modules, no build step, no dependencies. Native `input[type=range]`. Playwright for the browser tests.

## Global Constraints

- No dependencies and no build step. Nothing may be added to the app's runtime.
- `store.js` is the only module that touches persisted state. Views render from it and call `ctx.refresh()`.
- Every mutation funnels through `commit()`. Never hand-stamp a sync clock; `commit()` diffs and stamps.
- Do not call `snapshot()` for non-destructive changes — undo is for destructive acts only, consistent with `bumpQty`.
- Dark only. No light theme, no `prefers-color-scheme` branch.
- UK English in all user-facing copy.
- `PARTABLE` = exactly `pack`, `tin`, `bottle`, `loaf`, `bunch`.
- Slider step is exactly 5.
- Fractions are stored 0–1, clamped, rounded to 2 decimal places. Absent is `null`.
- Serve the app for tests with `python3 -m http.server 8765` from the repo root.
- Tests need Node 22+ (`tests/syntax.mjs` uses `fs/promises` `glob`). On this machine use `/opt/homebrew/opt/node@24/bin/node`.
- Pass the browser binary via `CHROMIUM`, e.g. `CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

---

### Task 1: Store layer — `PARTABLE`, `remaining`, `setRemaining()`

**Files:**
- Modify: `js/store.js` (near `UNITS` at line 40; `addInvItem` 486; `updateInvItem` 503; new export after `bumpQty` 538)
- Test: `tests/logic.mjs` (append inside the `page.evaluate` block, immediately before `return out;`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export const PARTABLE: Set<string>` — `{'pack','tin','bottle','loaf','bunch'}`
  - `export function setRemaining(id: string, frac: number|null): object|null` — clamps 0–1, rounds 2dp, `null` clears; returns the item or `null` if the id is unknown
  - Inventory records gain `remaining: number|null`

- [ ] **Step 1: Write the failing test**

Append inside the `page.evaluate` callback in `tests/logic.mjs`, directly before `return out;`:

```js
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
```

Then extend the persistence check lower down in the same file. Replace:

```js
const persisted = await page.evaluate(() => {
  const s = window.munch.store.get();
  return s.inventory.some(i => i.name === 'Desk oats') && s.settings.horizonDays === 30;
});
```

with:

```js
const persisted = await page.evaluate(() => {
  const s = window.munch.store.get();
  // Deliberately distinctive: the seed data ships a 'Chopped tomatoes' tin, and
  // find() would match that one — which has no fraction — instead of ours.
  const tin = s.inventory.find(i => i.name === 'Test tin');
  return s.inventory.some(i => i.name === 'Desk oats')
      && s.settings.horizonDays === 30
      && tin?.remaining === 0.5;
});
```

- [ ] **Step 2: Run the test to verify it fails**

```sh
python3 -m http.server 8765 &
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: the new checks FAIL. The first failure will be a `pageerror` for `store.setRemaining is not a function`.

- [ ] **Step 3: Write the implementation**

In `js/store.js`, immediately after the `UNITS` export (line 40):

```js
/** Units where a part-used fraction means something physical. */
export const PARTABLE = new Set(['pack', 'tin', 'bottle', 'loaf', 'bunch']);

/** 0–1, two decimal places. Anything unparseable becomes null. */
const clampFrac = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
};
```

In `addInvItem`, add one property to the item literal, after `unit`:

```js
    remaining: clampFrac(data.remaining),
```

In `updateInvItem`, after the existing `if ('qty' in patch)` line:

```js
  if ('remaining' in patch) it.remaining = clampFrac(patch.remaining);
```

After `bumpQty` (line 538), add:

```js
/**
 * How much of a part-used container is left, 0–1. `null` means "not part-used",
 * which is how every item starts and is indistinguishable from an item saved
 * before this field existed.
 */
export function setRemaining(id, frac) {
  const it = invItem(id);
  if (!it) return null;
  it.remaining = clampFrac(frac);
  commit();
  return it;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: every check PASSes, `state and settings survive a reload` PASSes, `ERRORS: none`.

- [ ] **Step 5: Commit**

```sh
git add js/store.js tests/logic.mjs
git commit -m "Record how much of a part-used container is left"
```

---

### Task 2: UI kit slider, and the peek sheet

**Files:**
- Modify: `js/ui.js` (new `slider()` beside `textInput`; new `bindSliders()` beside `bindSelectAll()`; call it in `openSheet` and `setSheet`)
- Modify: `css/app.css` (new block after the `.sheet__act` rules)
- Modify: `js/editors/item.js` (`openItemPeek`, lines 155–234)

**Interfaces:**
- Consumes: `store.PARTABLE`, `store.setRemaining(id, frac)` from Task 1.
- Produces:
  - `export function slider({ name, value }): string` — `value` is a 0–1 fraction or `null`; renders a `0–100` range input named `name` with `step=5`, wrapped in `[data-slider="<name>"]`, plus a live `%` readout
  - `export function bindSliders(root): void` — keeps each readout in step with its input on `input`

- [ ] **Step 1: Add the fragment, the binder and the styling**

In `js/ui.js`, after `textInput` and its `bindSelectAll`:

```js
/**
 * Range input over a 0–1 fraction, shown as a percentage. Reads back through
 * `readForm()` as a 0–100 string, so callers divide by 100.
 */
export function slider({ name, value = 1 }) {
  const pct = Math.round((value ?? 1) * 100);
  return `
    <div class="slider" data-slider="${esc(name)}">
      <input type="range" name="${esc(name)}" min="0" max="100" step="5" value="${pct}"
        aria-label="How much is left">
      <span class="slider__val tnum" data-slider-val>${pct}%</span>
    </div>`;
}

/** Keep each slider's readout in step with its input while dragging. */
export function bindSliders(root) {
  root.querySelectorAll('[data-slider]').forEach(wrap => {
    const input = wrap.querySelector('input[type=range]');
    const out = wrap.querySelector('[data-slider-val]');
    if (!input || !out) return;
    input.addEventListener('input', () => { out.textContent = `${input.value}%`; });
  });
}
```

In `openSheet`, on the line that currently reads `bindSelectAll(bodyEl);`, add a second call directly beneath it:

```js
  bindSliders(bodyEl);
```

Do the same in `setSheet`, beneath its `bindSelectAll(bodyEl);`.

In `css/app.css`, after the `.sheet__act svg` rule:

```css
/* --- slider ------------------------------------------------------------- */
.slider { display: flex; align-items: center; gap: 14px; }
.slider__val { flex: 0 0 auto; min-width: 46px; text-align: right; font-size: 15px; font-weight: 700; }

.slider input[type=range] {
  -webkit-appearance: none; appearance: none;
  flex: 1; width: 100%; height: 28px; margin: 0; background: none;
}
.slider input[type=range]::-webkit-slider-runnable-track {
  height: 8px; border-radius: var(--r-pill); background: var(--surface-2);
}
.slider input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 26px; height: 26px; margin-top: -9px;
  border-radius: 50%; background: var(--mint);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .45);
}
.slider input[type=range]::-moz-range-track {
  height: 8px; border-radius: var(--r-pill); background: var(--surface-2);
}
.slider input[type=range]::-moz-range-thumb {
  width: 26px; height: 26px; border: 0; border-radius: 50%; background: var(--mint);
}
```

- [ ] **Step 2: Put the slider in the peek sheet**

In `js/editors/item.js`, extend the existing import from `../store.js` so it reads:

```js
import { CATEGORIES, UNITS, PLACES, PARTABLE } from '../store.js';
```

and extend the import from `../ui.js` to include `slider` (Task 3 adds `bindSliders`; leaving it out here keeps this commit free of an unused import):

```js
import {
  openSheet, closeSheet, toast, confirmSheet,
  field, textInput, textArea, select, segmented, chipGroup, slider, bindPickers, readForm,
} from '../ui.js';
```

In `openItemPeek`'s template, immediately after the closing `</div>` of the `− qty +` card and before `<div class="rows">`:

```js
          ${PARTABLE.has(cur.unit) ? `
            <div class="field">
              <span class="field__label">How much is left</span>
              ${slider({ name: 'remaining', value: cur.remaining })}
            </div>` : ''}
```

In that sheet's `mount(root)`, after the `[data-bump]` loop:

```js
        // Writes on `change`, not `input`: every commit() reindexes, persists and
        // stamps for sync, so a drag must not fire one per pixel.
        const range = root.querySelector('[data-slider=remaining] input');
        range?.addEventListener('change', () => {
          const frac = Number(range.value) / 100;
          store.setRemaining(id, frac);
          after?.();
          if (frac !== 0) return;
          toast(`${cur.name} is empty`, {
            iconName: 'info',
            action: {
              label: 'Remove',
              run: () => {
                store.removeInvItem(id);
                after?.();
                closeSheet();
                toast('Removed from stock', {
                  iconName: 'trash',
                  action: { label: 'Undo', run: () => { store.undo(); after?.(); } },
                });
              },
            },
          });
        });
```

Do **not** call `render()` here — it reopens the sheet and would tear the slider out from under the thumb mid-drag.

- [ ] **Step 3: Verify in the browser**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  SHOT_DIR=./shots /opt/homebrew/opt/node@24/bin/node tests/smoke.mjs
```

Expected: `ERRORS: none`, and all four `layout ... ok` lines. Then open `http://127.0.0.1:8765/`, add an item with unit `tin`, tap it, and confirm: the slider appears, the readout tracks the thumb, releasing it persists (reload and re-open), and dragging to 0% raises the *"is empty"* toast with a working **Remove**.

- [ ] **Step 4: Commit**

```sh
git add js/ui.js css/app.css js/editors/item.js
git commit -m "Slider for how much of a part-used item is left"
```

---

### Task 3: Editor sheet, with live unit gating

**Files:**
- Modify: `js/editors/item.js` (`openItemEditor`, lines 31–152)

**Interfaces:**
- Consumes: `slider()`, `bindSliders()`, `field()` from Task 2; `PARTABLE` from Task 1.
- Produces: nothing new. The editor writes `remaining` through the existing `store.addInvItem` / `store.updateInvItem` patch.

- [ ] **Step 0: Add `bindSliders` to the ui.js import**

```js
import {
  openSheet, closeSheet, toast, confirmSheet,
  field, textInput, textArea, select, segmented, chipGroup, slider, bindPickers, bindSliders, readForm,
} from '../ui.js';
```

- [ ] **Step 1: Add `remaining` to the new-item defaults**

In `openItemEditor`, in the `start` literal for a new item, after `unit`:

```js
    remaining: prefill.remaining ?? null,
```

- [ ] **Step 2: Render the field, wrapped so it can be swapped**

Directly after the `</div>` closing `.grid-qty`:

```js
      <div data-remwrap>
        ${PARTABLE.has(start.unit) ? field({
          label: 'How much is left',
          control: slider({ name: 'remaining', value: start.remaining }),
        }) : ''}
      </div>
```

- [ ] **Step 3: Show or hide it live when the unit changes**

In the editor's `mount(root)`, after the `[data-segmented=place]` listener:

```js
      // Removed from the DOM rather than hidden, so readForm() cannot see it and
      // a stored fraction survives a trip through a non-partable unit untouched.
      const unitSel = root.querySelector('[name=unit]');
      const remWrap = root.querySelector('[data-remwrap]');
      unitSel.addEventListener('change', () => {
        const shown = !!remWrap.querySelector('input[type=range]');
        if (PARTABLE.has(unitSel.value)) {
          if (shown) return;
          remWrap.innerHTML = field({
            label: 'How much is left',
            control: slider({ name: 'remaining', value: start.remaining }),
          });
          bindSliders(remWrap);
        } else if (shown) {
          remWrap.innerHTML = '';
        }
      });
```

- [ ] **Step 4: Carry it into the patch on save**

In `save`, directly after the `const patch = { ... };` literal:

```js
        // Absent means the slider was not on screen, which must leave any stored
        // fraction alone rather than clearing it.
        if (f.remaining !== undefined) patch.remaining = Number(f.remaining) / 100;
```

- [ ] **Step 5: Verify in the browser**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  SHOT_DIR=./shots /opt/homebrew/opt/node@24/bin/node tests/smoke.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
```

Expected: both `ERRORS: none` and every `logic.mjs` check PASS. Then by hand: add an item as `pcs` (no slider), switch the unit to `pack` (slider appears at 100%), drag to 40%, save, re-open (still 40%), switch to `g` (slider vanishes), save, re-open as `pack` — still 40%, not cleared.

- [ ] **Step 6: Commit**

```sh
git add js/editors/item.js
git commit -m "Set how much is left when adding or editing stock"
```

---

### Task 4: Show it on the stock row

**Files:**
- Modify: `js/views/inventory.js` (imports at line 5–11; `itemRow` at 214–234)

**Interfaces:**
- Consumes: `PARTABLE` from Task 1, and the `remaining` field on inventory records.
- Produces: nothing.

- [ ] **Step 1: Import the gate**

Change line 6 of `js/views/inventory.js` to:

```js
import { PLACES, placeOf, PARTABLE } from '../store.js';
```

- [ ] **Step 2: Add the fraction to the row subtitle**

In `itemRow`, replace the `row__sub` span with:

```js
        <span class="row__sub">
          ${esc(cat.label)}
          ${PARTABLE.has(it.unit) && it.remaining != null
            ? `<i class="dot"></i>${Math.round(it.remaining * 100)}% left` : ''}
          ${it.note ? `<i class="dot"></i>${esc(it.note.slice(0, 26))}` : ''}
        </span>
```

The `PARTABLE` guard is what stops a fraction retained through a unit change from surfacing on an item now measured in grams.

- [ ] **Step 3: Verify**

```sh
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  SHOT_DIR=./shots /opt/homebrew/opt/node@24/bin/node tests/smoke.mjs
```

Expected: `ERRORS: none`. Then check `shots/03-stock.png`, or the Stock list in the browser: an item set to 65% of a `pack` reads `Cupboard · 65% left`; the same item switched to `g` shows no fraction.

- [ ] **Step 4: Full suite and commit**

```sh
/opt/homebrew/opt/node@24/bin/node tests/syntax.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/logic.mjs
CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  /opt/homebrew/opt/node@24/bin/node tests/sync.mjs
git add js/views/inventory.js
git commit -m "Show how much is left on the stock row"
```

---

## Notes carried over from the spec

- **Meals still draw down whole units.** `remaining` is a record of physical state, never an input to planning. No change to `cookSlot` or the shopping list.
- **No Supabase migration.** `walkRecords()` yields the whole item object as the record payload and `writeRecord()` upserts it wholesale, so `remaining` syncs with no sync code at all.
- **Version skew is a non-issue in practice.** `writeRecord` stores the payload as received and `updateInvItem` uses `Object.assign`, so an older build preserves unknown keys rather than stripping them. The worst case remains an item reverting to "not part-used", never showing a wrong fraction.
