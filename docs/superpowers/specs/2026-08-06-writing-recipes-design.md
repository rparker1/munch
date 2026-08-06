# Writing a recipe by hand

Recipes only arrive by import. Anything you cook from memory, or off a card, or that
someone told you, has no way in — and an imported recipe with a typo in it cannot be
corrected, because the reader is read-only.

This adds a form that writes one from nothing and edits one that already exists.

## Most of it already exists

`recipe.parseIngredients` turns `600g chicken thighs` into `{ qty: 600, unit: 'g', name:
'Chicken thighs', category: 'protein' }`, and `normaliseMethod` already treats one string
of newlines as an ordered list of steps — it is one of the four shapes it handles for
imports.

So hand entry is two text boxes rather than a row-by-row builder. On a phone that is the
difference between typing a recipe and fighting one, and it reuses parsing already tested
against real pages.

## The problem found while designing the edit path

`saveToLibrary` cannot be used to save an edit. Two reasons, both in its shape:

```js
state.library = state.library.filter(
  l => !(l.mealId === entry.mealId && normName(l.name) === normName(entry.name)),
);
state.library.unshift(entry);   // and a fresh uid('lib')
```

It dedupes on **name**, so saving a *renamed* recipe removes nothing and leaves the
original behind as a duplicate. And it builds a new entry from the fields it is given, so
an edit that does not mention `tags`, `image`, `sourceName` or `sourceUrl` silently drops
them — exactly the fields an imported recipe has and a hand-written one does not.

Editing needs a real update, so `store.js` gains one:

```js
/**
 * Change a saved recipe in place. Keeps its id, and anything the patch omits.
 * Returns the updated entry, or null if the id is unknown.
 */
export function updateLibraryEntry(id, patch)
```

Mutating in place also keeps the id stable, which matters for sync: a rename becomes one
changed record rather than a delete and an insert.

## Where it lives

`js/editors/recipe.js`, which already owns the reader, gains:

```js
export function openRecipeForm({ id = null, after })
```

Empty with no `id`, pre-filled with one. One form, two entry points:

- The Recipes **`+`** opens a short labelled sheet — *Write one* / *Import a link* — rather
  than going straight to import as it does now. One tap on each path, but both are named
  instead of guessed from an icon, and the empty state can offer both.
- The reader gains **Edit** beside *Use in a meal*.

The `+` must stop routing through the meal editor for the writing path. Import does that
today, creating a throwaway dinner slot, which was an acceptable trade for import but is
not for writing: writing a recipe should not put a meal in your plan.

## The form

| field | notes |
| --- | --- |
| Name | required; the only thing that is |
| Home or work | not decoration — it decides which stores the reader matches its ingredients against |
| Serves | optional |
| Prep, Cook | optional, in minutes |
| Total | optional. **Blank means prep + cook.** |
| Cuisine | optional free text |
| Method | one textarea, one step per line, through `normaliseMethod` |

Three time fields cannot contradict each other because only two are authored: a blank total
is derived, a filled one is yours. Showing a stated total *and* deriving one would let the
two disagree, which is worse than either.

**Tags are deliberately absent from the form.** Search already covers name, ingredients and
cuisine, and typing tags by hand earns very little. Imported tags are preserved through an
edit — they are simply not shown.

No step-by-step method builder. Steps are lines in a textarea, so reordering and rewording
are just editing text, which is what a phone keyboard is good at.

## Ingredients

Two halves, because writing and correcting are different jobs:

**Adding** — a textarea takes as many lines as you like and adds them all at once through
`parseIngredients`, so amounts, units and aisles arrive already worked out. The box empties
after adding, ready for more.

**Correcting** — what is on the recipe shows as rows below, each tappable to change its
amount, unit, name or aisle, or to remove it.

That split is the point. A single always-on text box would have to re-parse every line on
every save, so an aisle corrected by hand would revert to whatever the guesser thinks the
next time anything else was edited. Bulk in, per-row out, and nothing corrected is ever
re-guessed.

The per-row editor is local to this form. `meal.js`'s `editIngredient` is not reusable here
— it is built around a meal draft and stock matching, neither of which a recipe has.

## Saving

- **New** — `saveToLibrary(null, {...})`. `mealId` null, so the recipe can be used from any
  slot, exactly as an imported one is.
- **Existing** — `updateLibraryEntry(id, {...})` with only the fields the form owns, so
  `tags`, `image`, `sourceName` and `sourceUrl` survive untouched.

`mealId` is one of the fields the form does not own, so it survives too. That matters for
the meal templates saved before recipes existed: they show up in the collection with a
`mealId` and no method, and editing one must not quietly turn it into an untyped recipe.
Adding a method to one is a perfectly good thing to do.

A recipe with no name is not saved; the name field takes focus instead. Everything else may
be blank, and a recipe that is only a name and a method is perfectly valid — that is most
of what gets written from memory.

## Testing

In `tests/logic.mjs`:

- `updateLibraryEntry` keeps the id, applies the patch, and leaves fields the patch omits
  untouched — asserted with `tags` and `sourceName` on an imported-shaped entry.
- Renaming through `updateLibraryEntry` leaves exactly one entry, where `saveToLibrary`
  would have left two.
- `updateLibraryEntry` on an unknown id returns null and changes nothing.
- A block of lines parses to the right amounts and aisles, reusing `parseIngredients`.
- Total falls back to prep + cook only when blank, and a stated total wins.

In the browser, by hand: write a recipe from the `+`, save it, find it in the collection,
open it, **Edit**, change the name and one ingredient's aisle, save, and confirm the aisle
stuck and nothing else moved. Then edit an *imported* recipe's name and confirm its source
credit and tags are still there afterwards.

`smoke.mjs` stays clean.

## Non-goals

Duplicating a recipe. Tags in the hand form. Photos. A step-by-step method builder.
Reordering ingredients — they render in the order added, and removing and re-adding is
enough.
