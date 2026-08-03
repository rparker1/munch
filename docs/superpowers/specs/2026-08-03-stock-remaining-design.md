# Part-used stock: how much is left

Stock currently records a countable amount and nothing else, so a jar two-thirds
gone is either still "1 jar" or has been fudged down to a number that no longer
means anything. The note field carries "opened, half used" as prose, which the app
cannot read.

This adds an optional fraction alongside the amount: the pack count stays honest,
and how much of it remains becomes a value the app knows about.

## Data model

One new optional field on an inventory record:

```js
remaining: null      // not part-used — indistinguishable from today's behaviour
remaining: 0.65      // 0–1, two decimal places
```

`null` (or absent) is the default. Nothing sets it until the user moves the
slider.

One new mutation in `store.js`:

```js
/** Set how much of a part-used item is left. Clamps 0–1, rounds to 2dp. */
export function setRemaining(id, frac)
```

No Supabase migration. `munch_records` stores an opaque JSONB payload per record
and constrains only `kind`, so the field rides along inside the existing
`inventory` documents. No sync code either: every mutation funnels through
`commit()`, which diffs the record view of state and stamps whatever moved.

### Version skew

Sync is last-write-wins per record, and an older copy of the app may still be
installed on another device. If that build does not preserve unknown keys, a
round-trip through it drops `remaining`. Because absent means "not part-used",
the worst case is an item reverting to un-fractioned — never showing a wrong
fraction. That is an acceptable failure mode and needs no defensive code.

## Visibility

A fraction only means something for a discrete container. One predicate governs
both the control and every display of the value, so the two can never disagree:

```js
const PARTABLE = new Set(['pack', 'tin', 'bottle', 'loaf', 'bunch']);
```

| unit | slider | why |
| --- | --- | --- |
| `pack` `tin` `bottle` `loaf` `bunch` | shown | "65% left" describes something physical |
| `g` `kg` `ml` `L` | hidden | the amount is already exact |
| `pcs` | hidden | 3 apples at 65% is nonsense |

Changing the unit in the editor shows or hides the slider live, via a `change`
listener on the existing native `<select>`.

Switching a partable unit to a non-partable one **hides the slider but keeps the
stored value**, so switching back restores it rather than silently destroying
data. This is precisely why display is gated on the same predicate: otherwise a
retained `remaining` would leak into the inventory row for an item measured in
grams.

## Surfaces

**Peek sheet — primary.** A slider directly under the existing `− 1 +` card. This
is where you land when you have just used half a jar, so it is the one that has to
be quick.

**Editor sheet.** The same slider control, beneath Amount and Unit, presented as
an ordinary labelled form field rather than in the peek sheet's card treatment —
for entering something that is already part-used when it goes in. Its value is
read by `readForm()` along with everything else and applied on save, so it does
not write on release the way the peek slider does.

**Inventory row.** Appends `· 65% left` to the subtitle that already carries the
amount. Today's stat tiles, Plan and Shop are untouched.

Slider step is 5%. Finer is fiddly with a thumb and means nothing for how full a
jar is.

## Reaching zero

Sliding to 0% raises a toast — *"Pesto is empty"* — carrying a **Remove** button.
Nothing happens unless it is tapped. Tapping it calls `store.removeInvItem(id)`
directly, without the `confirmSheet` the editor's delete button uses — the slider
already expressed the intent, and a modal on top of a toast is one step too many —
and replaces itself with the existing *"Removed from stock"* toast carrying Undo.

The item is never deleted automatically, and 0% is a legitimate resting state: an
empty jar you have not thrown out yet is still in the cupboard.

## Non-goals

Meals continue to draw down **whole units**. `remaining` is a record of physical
state, not an input to planning. Feeding it into draw-down would mean fractional
ingredient arithmetic across the plan and the shopping list, which is a much
larger change and is not wanted here.

## Implementation notes

**Commit on `change`, not `input`.** Every `commit()` runs
`reindex({ stamp: true })`, then `persist()`, then `emit()`. Binding the write to
`input` would fire a full state diff, a `localStorage` write and a sync stamp on
every pixel of a drag. `input` updates the percentage label only; `change` writes
once on release.

**No `snapshot()`.** `setRemaining` does not push onto the undo stack, consistent
with `bumpQty`. Undo is for destructive acts; treating a slider drag as undoable
would flood the stack during ordinary use.

**Styling.** A native `input[type=range]`, styled in `css/app.css` to match the
dark palette. No dependency, consistent with the rest of the app.

## Files

| file | change |
| --- | --- |
| `js/store.js` | `setRemaining()`, `PARTABLE`, `remaining` in `addInvItem`/`updateInvItem` |
| `js/editors/item.js` | slider in both the editor and the peek sheet; unit-change wiring; empty toast |
| `js/views/inventory.js` | `· N% left` in the row subtitle |
| `css/app.css` | `.slider` component |
| `tests/logic.mjs` | cases below |

## Tests

Added to `tests/logic.mjs`, which drives the real store in the browser:

- `setRemaining` clamps out-of-range input to 0–1 and rounds to two decimals.
- The value survives a reload, proving it persists and rehydrates.
- Switching a partable unit to `g` retains the stored value while the row stops
  displaying it.
- 0% does not remove the item; it stays in stock until removal is confirmed.
- An item with `remaining` unset is byte-identical in behaviour to one saved
  before this change, so existing stock is unaffected.
