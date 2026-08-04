# Recipe search and import

Getting a recipe into Munch means typing its ingredients in by hand, one at a
time, which is enough friction that the plan tends to get filled with the same
half-dozen meals. This adds two ways in: search what you have already saved, and
import something new from a link.

The two halves feed each other. Import is what grows the library; search is what
makes a grown library worth having.

## The constraint that shaped this

A page served from `rparker1.github.io` cannot fetch `bbcgoodfood.com` — the
browser blocks it, and no client-side arrangement gets around it. Anything
involving someone else's page needs a server-side fetch. That is one Supabase
Edge Function, on the project the app already uses.

The second constraint is legal rather than technical, and it eliminated the
obvious provider.

| provider | may ingredient lists be stored? | terms |
| --- | --- | --- |
| Spoonacular | **no** | Caching needs prior written permission and lasts *"a maximum of 1 hour"*. Only *"the recipe id, the recipe title, and the recipe image url"* may be kept indefinitely. On suspension, *"you must delete all data you ever obtained"*. |
| Edamam | **effectively no** | Results are for presentation to the requesting user; caching is limited to some paid plans and to four macronutrients plus URI, title and image. Free tier is personal and non-commercial. *Their ToS page did not render when checked — this row is from search results, not the primary document, and should be re-verified before anyone relies on it.* |
| TheMealDB | **yes** | *"You can scrape, copy and modify any content returned from the API, as long as you use the official end points."* Credit required. |

Munch persists imported meals to the device and syncs them to Supabase. Under
Spoonacular's terms that is a breach an hour later, so the best search API is
unusable for the thing this feature exists to do.

That pushed the design somewhere better: **discovery and import are separate
concerns.** Discovery returns transient results. Import reads ingredients from a
source that permits storage. The provider is therefore swappable without touching
the import path, and stored data never falls under a search API's terms.

## Decisions

| decision | why |
| --- | --- |
| Local search first, online only when asked | Works offline, costs no quota, and the library is the thing worth searching once import exists. |
| URL import, with pasted text as the fallback | Near-universal JSON-LD coverage, and paywalled or JS-only pages then fail into a route rather than a dead end. |
| TheMealDB, free test key `1` | The only candidate whose terms permit storing ingredients. No account. |
| Entry point in the meal editor | `saveToLibrary(mealId, …)` keys saved meals to a meal type; starting from a slot supplies the type and the date for free. |
| Add `tbsp`, `tsp`, `clove`; convert nothing | Recipes are mostly spoons and cloves. Converting them would make the app invent physical quantities, which it does nowhere else. |
| No serving scaling | Halving a recipe does not halve the tin of tomatoes. Separate feature, probably wrong. |

## Architecture

```
                    ┌─ saved meals (offline, instant) ─────────┐
search "chicken" ───┤                                           ├─→ results
                    └─ [Search online] → Edge Fn → TheMealDB ───┘
                                             │
paste a URL ─────────────────────────────────┤ fetch + JSON-LD
                                             ↓
paste recipe text ──────────────→ parsed on device ─→ review ─→ slot + library
```

- `js/recipe.js` — new. Pure functions: parse an ingredient line, guess an aisle,
  match against stock, rank a local search. No network, no DOM.
- `supabase/functions/recipe/index.ts` — new. Everything needing a server.
- `js/editors/meal.js` — the `Find a recipe` entry point and the review sheet.
- `js/store.js` — three new `UNITS` entries. Nothing else; imports land through
  the existing `saveSlot` and `saveToLibrary`.

`store.js` remaining the sole owner of persisted state is unchanged: `recipe.js`
returns plain objects and never writes.

## The Edge Function

One function, three actions, all `GET`.

**`?url=<page>`** — fetch, extract the first `application/ld+json` block whose
`@type` is `Recipe` (including inside `@graph`), return:

```json
{ "ok": true,
  "recipe": {
    "name": "Chicken traybake",
    "serves": 4,
    "sourceUrl": "https://example.com/chicken-traybake",
    "sourceName": "Example Kitchen",
    "image": "https://example.com/img.jpg",
    "ingredients": ["600g skinless chicken thighs", "2 lemons, halved"]
  } }
```

**`?q=<text>`** — TheMealDB `search.php?s=`, mapped to:

```json
{ "ok": true, "results": [{ "id": "52940", "name": "Brown Stew Chicken",
                            "image": "https://…", "area": "Jamaican" }] }
```

**`?id=<mealdb id>`** — TheMealDB `lookup.php?i=`, returning the **same
`recipe` shape** as `?url=`. TheMealDB supplies `strIngredient1..20` and
`strMeasure1..20` separately; the function joins each pair into one
`"<measure> <ingredient>"` string so the client has a single parser with one
input format regardless of where the recipe came from.

Errors are uniform, and the client maps `reason` to a message:

```json
{ "ok": false, "reason": "no-recipe" }
```

`reason` ∈ `no-recipe`, `blocked`, `too-large`, `timeout`, `fetch-failed`,
`bad-request`, `upstream-failed`.

**The function does not parse ingredient strings.** It returns them raw and the
client parses them, so parsing is testable offline with no network and no
deployment, and a parser fix does not need a redeploy.

### Security

A public URL-fetcher is an SSRF and open-proxy risk, so:

- `https:` only. Any other scheme is `blocked`.
- Reject private, loopback and link-local hosts — `127.0.0.0/8`, `10/8`,
  `172.16/12`, `192.168/16`, `169.254/16`, `::1`, `fc00::/7`, and `localhost` —
  **re-checked after every redirect**, not only on the input.
- Maximum 3 redirects.
- 2 MB response cap, enforced while streaming rather than after.
- 8 second timeout.
- Only parsed JSON is returned. Raw HTML never leaves the function.

**`verify_jwt` is off.** Munch works signed out and requiring sign-in to import
would be a worse app. The residual risk is that anyone who finds the URL can
consume function invocations; the guards above bound what they can do with it, and
turning `verify_jwt` on is the escalation if abuse ever appears.

## Parsing

`parseIngredient(line)` → `{ qty, unit, name, category, source, invId }`.

Recognised units, matched case-insensitively on word boundaries:

| written | stored |
| --- | --- |
| `g`, `gram`, `grams` | `g` |
| `kg`, `kilo`, `kilos` | `kg` |
| `ml`, `millilitre(s)` | `ml` |
| `l`, `litre`, `litres` | `L` |
| `tbsp`, `tablespoon(s)` | `tbsp` |
| `tsp`, `teaspoon(s)` | `tsp` |
| `clove`, `cloves` | `clove` |
| `tin`, `tins`, `can`, `cans` | `tin` |
| `pack`, `packs`, `packet(s)` | `pack` |
| `bottle`, `bottles` | `bottle` |
| `loaf`, `loaves` | `loaf` |
| `bunch`, `bunches` | `bunch` |
| a bare leading number | `pcs` |

Nothing is converted. A line whose amount cannot be read keeps its **full
original wording** as the name with `qty: null` — the same shape an ingredient
with a blank amount already has, so it still reaches the shopping list and simply
never draws down.

```
600g skinless chicken thighs  → 600  g      Chicken thighs
2 tbsp olive oil              → 2    tbsp   Olive oil
3 cloves garlic, crushed      → 3    clove  Garlic
1 x 400g tin chopped tomatoes → 1    tin    Chopped tomatoes
A good handful of parsley     → null  ''    "A good handful of parsley"
Salt and pepper, to taste     → null  ''    "Salt and pepper, to taste"
```

Trailing preparation after a comma (`, crushed`, `, halved`, `, finely
chopped`) is dropped from the name, and the name is then `titleCase`d to match
`addInvItem`. **Both only apply when an amount was successfully read.** When it
was not, the line is preserved byte-for-byte, commas and all — stripping clauses
off a phrase we already failed to understand would only lose information, and
`"Salt and pepper, to taste"` reads correctly while `"Salt and pepper"` with no
amount does not.

`guessCategory(name)` keyword-matches into the existing `CATEGORIES` and defaults
to `other`. The full keyword table lives in one exported constant in `recipe.js`
so it can be extended in a single place, and an unmatched name is always safe
because `other` is a real aisle the app already renders. The mapping is:
chicken/beef/salmon/prawn → `protein`;
lemon/onion/spinach/potato → `produce`; milk/butter/cheese/yoghurt/egg →
`dairy`; bread/flour/loaf → `bakery`; rice/pasta/tin/oil/spice names →
`cupboard`; frozen/peas/ice → `frozen`; wine/juice/coffee/tea → `drinks`.

Stock matching reuses `matchInInventory(name)`, which substring-matches, so it
will sometimes be wrong — "tomatoes" matching "Cherry tomatoes". That is
acceptable because nothing is saved without passing the review sheet.

## Local search

`searchLibrary(query)` ranks saved meals by name and ingredient matches, and
annotates each with how many of its ingredients are already in stock, so
"3 of 4 in stock" can be shown. Ranking prefers more in-stock ingredients on
equal text relevance — the point being to cook what you have.

## UI

`Find a recipe` sits alongside the existing `From library` and `From stock` in the
meal editor. It opens a search sheet:

- Your saved meals, ranked, each showing its in-stock count.
- Below them, `Search online instead`. Only pressing it calls the function.
- A field to paste a link.

Choosing any result opens the **review sheet**: name, serves, source credit, and
every ingredient as an editable row with amount, unit and aisle, each flagged
`from stock` or `to buy`. Nothing is written until confirmed. Confirming fills the
slot and saves to the library.

An unreadable page shows the reason and a text box: *"Couldn't read that page.
Paste the recipe text instead."* The same parser handles it.

## Storage and attribution

No schema change. Imports become ordinary `library` and `slot` records that
`commit()` diffs and stamps, as with every other mutation. `sourceName` and
`sourceUrl` are kept on the library entry so a saved meal can credit where it came
from; TheMealDB is credited in the review sheet and in Settings, per its terms.

## Testing

`recipe.js` is pure, so it gets real coverage in `tests/logic.mjs`: every row of
the unit table, the six worked examples above, preparation-clause stripping,
category guesses, `qty: null` fallback, and stock matching including a deliberate
over-match. `searchLibrary` ranking gets cases for text relevance and for the
in-stock tie-break.

The Edge Function is tested against the deployed function by a new
`tests/recipe-fn.mjs`: a real recipe URL returns ingredients; `http:` is
`blocked`; `127.0.0.1`, `169.254.169.254` and `localhost` are `blocked`; a
redirect chain to a private host is `blocked`; a page with no JSON-LD is
`no-recipe`; an oversized response is `too-large`.

## Non-goals

Serving scaling. Nutrition data. Cooking instructions beyond a note. Unit
conversion. Multi-ingredient online search, which TheMealDB gates behind its
premium tier.

## Phasing

1. `recipe.js`, the review sheet, URL import, paste-text fallback, local search.
   Useful on its own and needs no provider.
2. The online fallback behind the same adapter.

## Sources

- [spoonacular API terms](https://spoonacular.com/food-api/terms)
- [Edamam API terms](https://www.edamam.com/terms/api/) — did not render on
  checking; the row above came from search results and is unverified
- [TheMealDB terms of use](https://www.themealdb.com/terms_of_use.php)
- [TheMealDB API guide](https://www.themealdb.com/api.php)

Terms as read on 2026-08-04. This is a reading of stated terms, not legal advice.
