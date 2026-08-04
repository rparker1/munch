# Using part of a container

Marmalade on toast needed `0.1` of a tin and `0.2` of a loaf. Neither number means
anything to a person, and marmalade is not in a tin.

The cause is in `fromStock`: the amount box renders the item's own unit as fixed text,
so the only thing expressible is a fraction of a container. `0.1` was the right answer
to the wrong question.

## The trap found on the way

`cookSlot` treats an unreadable amount as *finished* and **deletes the item**:

```js
} else {
  // No usable quantity on either side — treat the item as finished.
  emptied.push(it.id);
}
```

So "marmalade on toast" with a blank amount would have thrown away the whole jar.
Entering `0.1` was a workaround for a destructive default.

Deleting on "don't know" is indefensible, so that changes regardless of everything
below: an unreadable amount will leave the item alone and say so. Removal happens only
when the count genuinely reaches zero.

## Model

Two optional fields on an inventory item, meaningful only for `PARTABLE` units:

```js
portionName: 'spoon',   // free text, singular, belongs to this item alone
portionPer: 30,         // how many in one container
```

Either blank means no portions and the item behaves exactly as today. **Neither enters
`UNITS`** — a portion belongs to its item, so "slice" can never appear in the unit
dropdown for olive oil.

A meal ingredient needs **no new field**. It already carries `qty` and `unit`, so
`{ qty: 2, unit: 'slice' }` says everything; draw-down recognises that `unit` equals the
linked item's `portionName`.

Portion-unit ingredients are always `source: 'inv'`, and the shopping list is built from
`buy` ingredients only, so they can never reach it and cannot merge oddly with anything.

### Pluralisation

`qtyLabel` will pluralise a portion name — `2 slices` — and leave standard units alone,
so `2 tin` stays as it is. A word the user typed reads wrong unpluralised in a way a
unit abbreviation does not. The rule is mechanical: pluralise when the unit is not in
`UNITS`.

## Where portions are set

**On the item.** In the stock editor, below the part-used slider and shown for container
units only: a free-text *Portion* field and a *how many in one* count. Placeholders hint
per unit — loaf → slice, jar → spoon, pack → piece, tin → spoon, bottle → glass, bunch →
sprig — as hints only. Nothing is pre-filled, because a pre-filled 20 is the app claiming
to know how many slices are in your loaf.

**Or the first time it matters.** In `fromStock`, the fixed unit label beside the amount
becomes a toggle: `jar` ⇄ `spoon`. On an item with no portion declared, tapping it asks
once — what it is called, how many in one — writes both to the item, and every later meal
just says `1 spoon`.

Setting them on the item is therefore optional housekeeping rather than a prerequisite.

## Cooking

`cookSlot` gains one branch and loses its destructive default. For each stock-sourced
ingredient, in order:

1. **Portions.** `ing.unit === item.portionName` and `portionPer > 0`:
   `share = qty / portionPer` containers-worth, applied as below.
2. **Whole containers of a container item.** A `PARTABLE` item with a usable amount in
   its own unit: `share = qty` containers-worth, applied the same way. This matters —
   taking "1 jar" from three jars with the open one half gone should leave two jars still
   half gone, not two jars mysteriously full. When `remaining` is unset the arithmetic is
   identical to a plain subtraction, so nothing about today's behaviour changes except the
   case that was wrong.
3. **Anything else measurable.** A non-container item with a finite amount: subtracted
   from `item.qty` exactly as today. `remaining` means nothing for 600 g of chicken.
4. **Neither.** The item is **left untouched**, and the result reports it as untracked
   rather than removing it.

A portion name renamed on the item later leaves older ingredients matching nothing, so
they fall to rule 4 and are left alone. That is the safe direction to fail in.

### Applying a share

`remaining` describes the container currently open, so the amount actually in stock is:

```
total = (qty - 1) + (remaining ?? 1)
left  = total - share
```

- `left <= 0` → the item is finished and removed, as an emptied item is today.
- otherwise → `qty = ceil(left)` and `remaining = round(left - (qty - 1), 2dp)`.

Worked through:

| before | using | after |
| --- | --- | --- |
| 1 loaf, remaining unset | 2 of 20 slices → 0.1 | 1 loaf, remaining 0.9 |
| 1 jar, remaining 0.5 | 3 of 30 spoons → 0.1 | 1 jar, remaining 0.4 |
| 1 jar, remaining 0.5 | 18 of 30 spoons → 0.6 | removed |
| 3 jars, remaining 0.5 | 18 of 30 spoons → 0.6 | 2 jars, remaining 0.9 |
| 2 loaves, remaining unset | 25 of 20 slices → 1.25 | 1 loaf, remaining 0.75 |

`qty` stays a whole count of containers throughout. That is the point: a loaf count of
`0.8` was never meaningful, and `remaining` already existed to say how much of the open
one is left.

If `qty` is null there is no count to work from, so rule 3 applies and nothing is
touched.

## One knock-on to get right

`editIngredient`'s unit dropdown is built from `UNITS`. An ingredient measured in
`slices` would find no matching option and silently fall back to the first one, losing
the portion unit on any edit. The dropdown must include the linked item's `portionName`
when there is one.

## Two unrelated fixes, shipping alongside

Both are small and neither touches the portions model.

**`jar` joins `UNITS` and `PARTABLE`.** Marmalade is not in a tin, and a jar is
part-usable, so it earns the slider.

**Keyboard attributes are set explicitly.** Every text input renders
`autocomplete="off"` and sets none of `autocorrect`, `autocapitalize` or `spellcheck`,
leaving iOS suggestions and autocorrect to chance. They will be stated: `autocorrect`
and `spellcheck` on, `autocapitalize="sentences"`, and `autocomplete` relaxed on
free-text fields where suppressing browser autofill was never the intent. Numeric
fields keep `inputmode="decimal"` and gain `autocorrect="off"`, since a number pad has
nothing to correct.

Whether this restores the predictive bar can only be confirmed on the device — the same
lesson as the sheet-scroll bug, which did not reproduce under emulation either.

## Testing

In `logic.mjs`, against the store:

- Every row of the worked-through table above.
- A blank amount on a stock ingredient leaves the item present and unchanged — the
  regression that matters most.
- An amount in the item's own unit still draws down as before when `remaining` is unset,
  and respects the open container when it is set — 1 jar taken from three jars at 50%
  leaves two jars at 50%.
- A non-container item is unaffected by any of this: 50 g from 250 g of butter leaves
  200 g, with no `remaining` written.
- An ingredient whose unit matches no current `portionName` is left untouched rather than
  removed, which is what happens if a portion is renamed after the fact.
- `portionName` never appears in `UNITS`.
- `qtyLabel(2, 'slice')` is `2 slices`; `qtyLabel(2, 'tin')` is `2 tin`.
- An ingredient measured in portions survives an edit through `editIngredient` with its
  unit intact.
- `jar` is in both `UNITS` and `PARTABLE`.

Browser-level: `smoke.mjs` stays clean, and the from-stock picker's unit toggle is
exercised by hand on the device, since that is where the keyboard question also lands.

## Non-goals

Converting portions to mass or volume — the app invents no quantities, and a portion
count is yours, not a conversion table. Guessing portion counts. Portions on non-container
units. Creating recipes by hand, which is the next spec.
