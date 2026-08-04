# The Recipes section

Import currently takes a recipe's ingredients and throws the rest of the page away.
You get a shopping list but not a recipe: no method, no timings, nothing to cook
from. And a saved meal is only reachable by opening the slot it belongs to, so the
collection is invisible.

Searching online makes the gap obvious — "sausage" returns four results, because the
only provider whose terms allow storing recipe data has a small catalogue.

This turns what exists into a section: recipes as things you keep, read and cook
from, with the collection itself as the thing you search.

## Why a bigger search API is not the answer

The instinct is to swap the provider. The terms forbid it, and they forbid it harder
for this feature than for the last one, because the method text is unambiguously the
publisher's content.

| provider | may ingredient lists and method be stored? |
| --- | --- |
| Spoonacular | No. Caching needs written permission and lasts *"a maximum of 1 hour"*; only *"the recipe id, the recipe title, and the recipe image url"* may be kept indefinitely. |
| Edamam | Effectively no. Results are for presentation to the requesting user; caching is limited to some paid plans and to four macronutrients plus URI, title and image. |
| TheMealDB | Yes — *"You can scrape, copy and modify any content returned from the API, as long as you use the official end points."* Small catalogue. |

So: **import is the corpus.** The web is the search space, the directory is what you
kept, and rich local search over your own collection beats keyword search over three
hundred strangers' recipes. Online search stays a thin discovery fallback.

## What the pages already give us

Checked against `bbcgoodfood.com/recipes/chicken-chorizo-jambalaya` on 2026-08-04.
Everything below the line is already fetched and currently discarded:

| field | present | value |
| --- | --- | --- |
| `recipeInstructions` | yes | 4 `HowToStep` objects |
| `totalTime` / `prepTime` / `cookTime` | yes | `PT55M` / `PT10M` / `PT45M` |
| `recipeYield` | yes | `4` |
| `recipeCuisine` | yes | `Cajun & Creole` |
| `recipeCategory` | yes | `Dinner, Main course` |
| `keywords` | yes | chicken and chorizo stew, … |
| `tool` | **no** | — |

Equipment is the only real gap, and it is partly recoverable: step 1 of that recipe
says *"a large frying pan with a lid"*.

## Scope

This spec covers capture and the section. Filters and facets — by time, by cuisine,
by tag, "cookable from what's in" — are a separate spec, designed once there is a
real collection to design against.

## Data model

`library` records gain optional fields, and `mealId` becomes nullable:

```js
{
  id, name, place,
  items: [{ name, qty, unit, category }],

  mealId: 'dinner' | null,        // null = a recipe, not tied to a meal type

  method:  ['Heat 1 tbsp olive oil…', …],
  prepMin: 10, cookMin: 45, totalMin: 55,
  serves: 4,
  cuisine: 'Cajun & Creole',
  tags: ['chicken', 'chorizo'],
  sourceName: 'Good Food',
  sourceUrl: 'https://…',
  image: 'https://…',
}
```

**No Supabase migration.** The `kind` check constraint already permits `'library'`
and the payload is opaque JSONB, so the new fields ride along and `commit()` stamps
them with no sync code. A new `'recipe'` kind would have required altering that
constraint; reshaping the existing one costs nothing.

**Every new field is optional.** Existing saved meals stay valid and appear in the
directory with no method and no timings. Nothing needs migrating on device either.

**`mealId` nullable has one deliberate consequence.** The meal editor's picker
currently filters `store.library(mealId)`; it becomes matches-or-null, so any saved
recipe can be dropped into any slot. That is the "use it directly" requirement, and
it is a one-line change rather than a second concept.

## Capture

Three pure functions in `js/recipe.js`. The Edge Function passes the new fields
through and still parses nothing.

**`parseDuration(iso) → number | null`** — ISO 8601 durations to whole minutes.
`PT55M` → 55, `PT1H30M` → 90, `PT2H` → 120. Anything unparseable returns null rather
than 0, because "no timing given" and "takes no time" are different claims.

A parsed zero — `PT0S`, `PT0M` — also returns null. A recipe that takes no time is
bad data rather than a fast recipe, and rendering "0 min" would state something the
page never claimed.

**`normaliseMethod(instructions) → string[]`** — `recipeInstructions` appears in four
shapes in the wild, and all four must flatten to an ordered list of step strings:

1. an array of `HowToStep` objects, each with `.text`
2. an array of plain strings
3. a single string containing newlines
4. an array of `HowToSection`, each wrapping `itemListElement`

Empty and whitespace-only steps are dropped. HTML tags inside step text are
stripped, since some sites embed markup in `.text`.

**`guessEquipment(method, tool) → string[]`** — the author's `tool` field when
present, otherwise a whole-word scan of the joined method for: pan, frying pan,
saucepan, casserole, roasting tin, baking tray, baking sheet, oven, hob, grill,
griddle, wok, blender, food processor, whisk, sieve, colander, skewers, slow cooker,
air fryer, steamer, ramekin. Deduplicated, in the order found.

Whole-word matching, for the same reason it matters elsewhere in this module: a
substring scan for "pan" hits "pancetta".

## Equipment, and being honest about it

The inferred list renders under the heading **"From the method"** — never
"Equipment". It reads as *the method mentions these*, not as the author's list, which
is the truth. The full method sits directly beneath it, so anything missed is one
glance away.

This is the only place in the app that infers rather than reads. It earns the
exception because equipment is not a quantity — getting it slightly incomplete costs
you nothing, whereas a guessed weight would end up in the shopping list.

## The Recipes tab

Fifth tab, `pot` icon, which `icons.js` already has. It fits without redesign: the
bar is icon-only (`.tab__label { display: none }`) and each tab is `flex: 1 1 0`, so
five tabs is ~69px each on a 393px screen against a 44px touch minimum.

**The directory.** Saved recipes as rows: name, total time, serves, and how many of
its ingredients are in stock. A search box over name, ingredients, tags and cuisine.
An **Import** button, so the collection grows without going through Plan.

**The reader.** Image, then `55 min · 10 prep / 45 cook · serves 4 · Cajun &
Creole`, then the source credited and linked. Then *From the method*, then the
ingredients flagged from-stock or to-buy, then the numbered steps.

Actions: **Use in a meal** and **Delete**.

Stock flags in the reader are computed when it opens, against current stock. A recipe
saved three weeks ago should not claim you still have the chicken.

## Using a recipe

Mirrors `openCopySheet`: a `select` over the next 14 days, a `segmented` control for
the meal type, and a second `segmented` for home or work — defaulting to the
recipe's stored `place`. Then `store.saveSlot(date, mealId, …)`.

The home/work control is not optional dressing: `saveSlot` needs a place, a recipe
reached from the directory has no slot to inherit one from, and the place decides
which stores an ingredient can be matched against.

Ingredients are re-matched against stock at that moment, against the place just
chosen, rather than carried over from when the recipe was saved. A recipe kept three
weeks ago should not claim you still have the chicken, and a work lunch should not be
matched to the fridge at home.

## Search in this spec

`searchLibrary` extends to match tags and cuisine alongside name and ingredients,
still ranked by relevance and then by the proportion already in stock. Filters and
facets are the next spec.

## Testing

In `tests/logic.mjs`, against the pure functions:

- `parseDuration` for `PT55M`, `PT1H30M`, `PT2H`, `PT0S`, `''`, `undefined` and
  malformed input — the last four returning null, not 0.
- `normaliseMethod` for each of the four shapes, plus embedded HTML stripped and
  empty steps dropped.
- `guessEquipment` finds "frying pan" in that jambalaya's method, returns nothing
  when the method mentions no equipment, prefers a supplied `tool`, and does not
  match "pan" inside "pancetta".
- `searchLibrary` matching on a tag and on a cuisine, and a recipe with `mealId:
  null` being offered for any slot.

Browser-level: `smoke.mjs` walks the fifth tab at iPhone width and screenshots the
directory and the reader. A real-page import check asserts the stored recipe has at
least three method steps and a non-null `totalMin`.

## Non-goals

Filters and facets. Nutrition. Serving scaling. Editing method text after import. A
larger online corpus — import is the corpus, and the storage terms above are why.

## Sources

- [spoonacular API terms](https://spoonacular.com/food-api/terms)
- [Edamam API terms](https://www.edamam.com/terms/api/) — did not render when
  checked; that row came from search results and remains unverified
- [TheMealDB terms of use](https://www.themealdb.com/terms_of_use.php)

Terms as read on 2026-08-04. A reading of stated terms, not legal advice.
