/* ==========================================================================
   Recipe parsing and ranking. Pure functions only — no network, no DOM, no store
   access — so all of this is unit-testable without a server, and a parsing fix
   never needs the Edge Function redeployed.

   Nothing here converts between units. Recipes say "2 tbsp" and "3 cloves", and
   turning those into millilitres would mean inventing a physical quantity, which
   the app does nowhere else — a cup is 240 ml in one country and 284 in another,
   and "1 cup of flour" by volume is not a mass at all. Anything unreadable keeps
   its wording and loses its amount, which is a shape the app already handles
   everywhere an ingredient has no quantity.
   ========================================================================== */

import { titleCase } from './util.js';

/* Written form -> stored unit. Longest forms first, so 'tablespoons' is not
   consumed by a shorter prefix and 'cloves' is tried before 'clove'. */
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

/* Trailing preparation. Stripped from the end of a name repeatedly, because plenty
   of sites write "2 chicken breasts chopped" with no comma to split on — and
   "Chicken breasts chopped" then matches nothing in stock. */
const PREP_WORDS = [
  'chopped', 'diced', 'sliced', 'crushed', 'minced', 'grated', 'halved', 'quartered',
  'peeled', 'trimmed', 'drained', 'rinsed', 'cubed', 'shredded', 'beaten', 'melted',
  'softened', 'cooked', 'roasted', 'toasted', 'seeded', 'deseeded', 'stoned',
  'finely', 'roughly', 'thinly', 'thickly', 'freshly', 'lightly', 'plus', 'extra',
];

/* Containers that may lead a name once a mass has already been read, as in
   "400g can plum tomato" — the mass is the useful amount, the word is noise. */
const LEADING_CONTAINERS = ['can', 'cans', 'tin', 'tins', 'jar', 'jars', 'pack', 'packs',
                            'packet', 'packets', 'bottle', 'bottles'];

/* One table, one place to extend. Matched on whole words, never substrings: 'ice'
   would otherwise match "rice", "sliced" and "juice", which it did. */
export const CATEGORY_KEYWORDS = {
  protein: ['chicken', 'beef', 'pork', 'lamb', 'mince', 'bacon', 'sausage', 'salmon',
            'tuna', 'cod', 'prawn', 'prawns', 'fish', 'thigh', 'thighs', 'breast',
            'breasts', 'steak', 'steaks', 'tofu', 'chorizo', 'ham'],
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
  cupboard: ['rice', 'pasta', 'noodle', 'noodles', 'oil', 'vinegar', 'stock', 'tin',
             'tinned', 'chickpea', 'chickpeas', 'bean', 'beans', 'lentil', 'lentils',
             'spice', 'spices', 'seasoning', 'cumin', 'paprika', 'curry', 'sugar',
             'honey', 'soy', 'mustard', 'ketchup', 'salt', 'sauce', 'passata', 'stew'],
};

const words = s => String(s || '').toLowerCase().match(/[a-z]+/g) || [];

/* Whole-word, but tolerant of a simple plural: the keyword list holds 'lemon' and
   recipes say 'lemons'. Substring matching used to cover this for free, at the cost
   of 'ice' matching rice, sliced and juice — so the plural is handled explicitly
   rather than by going back to substrings. Irregulars like 'berries' are listed. */
const inList = (list, word) =>
  list.includes(word)
  || (word.endsWith('es') && list.includes(word.slice(0, -2)))
  || (word.endsWith('s') && list.includes(word.slice(0, -1)));

/**
 * A CATEGORIES id. 'other' when nothing matches — always a real aisle the app renders.
 *
 * The head noun is tried first, then the whole name. In English the last word is
 * what the thing *is*: "chicken stock" is stock, not chicken, and "long grain rice"
 * is rice. Scanning left to right instead put chicken stock in the meat aisle.
 *
 * Matching is on whole words. Substring matching had 'ice' claiming "rice",
 * "sliced" and "juice" for the freezer.
 */
export function guessCategory(name) {
  const ws = words(name);
  if (!ws.length) return 'other';

  const head = ws[ws.length - 1];
  for (const [cat, list] of Object.entries(CATEGORY_KEYWORDS)) {
    if (inList(list, head)) return cat;
  }
  for (const [cat, list] of Object.entries(CATEGORY_KEYWORDS)) {
    if (ws.some(w => inList(list, w))) return cat;
  }
  return 'other';
}

/**
 * One ingredient line -> { qty, unit, name }.
 *
 * Returns qty null and the line untouched when no amount can be read. In that case
 * the wording is preserved exactly, trailing clauses included, because trimming a
 * phrase we already failed to parse only loses information: "Salt and pepper, to
 * taste" reads correctly, "Salt and pepper" with no amount does not.
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

  // "1 x 400g tin chopped tomatoes" — drop the multiplier and the pack size, so the
  // unit we find is the container rather than the weight inside it.
  rest = rest.replace(/^x\s*/i, '').replace(/^\d+(?:\.\d+)?\s*(?:g|kg|ml|l)\b\s*/i, '');

  let unit = '';
  for (const [word, stored] of UNIT_WORDS) {
    const re = new RegExp(`^${word}\\b\\.?\\s*`, 'i');
    if (re.test(rest)) { unit = stored; rest = rest.replace(re, ''); break; }
  }
  const massOrVolume = ['g', 'kg', 'ml', 'L'].includes(unit);
  if (!unit) unit = 'pcs';   // a bare count

  // Preparation after the first comma is noise once we have an amount.
  let name = rest.split(',')[0].replace(/^of\s+/i, '').trim();

  // "400g can plum tomato" — the mass is the useful amount; the container is noise.
  if (massOrVolume) {
    const first = name.split(/\s+/)[0]?.toLowerCase();
    if (LEADING_CONTAINERS.includes(first)) name = name.split(/\s+/).slice(1).join(' ');
  }

  // Plenty of sites omit the comma: "2 chicken breasts chopped". Strip trailing
  // preparation until none is left, or the name would disappear.
  for (;;) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length < 2) break;
    if (!PREP_WORDS.includes(parts[parts.length - 1].toLowerCase())) break;
    name = parts.slice(0, -1).join(' ');
  }

  // "2 garlic cloves" — the unit trails the name rather than leading it. Only when
  // no real unit was found, so "600g garlic cloves" keeps its grams.
  if (unit === 'pcs') {
    const parts = name.split(/\s+/).filter(Boolean);
    const last = parts[parts.length - 1]?.toLowerCase();
    const hit = UNIT_WORDS.find(([w]) => w === last);
    if (hit && parts.length > 1) { unit = hit[1]; name = parts.slice(0, -1).join(' '); }
  }

  name = name.trim();
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

const norm = s => String(s || '').toLowerCase().trim();

/**
 * Rank saved meals for a query, annotated with how much of each is already in.
 *
 * Pure: the caller passes the library and the stock names, so this needs no store
 * access and can be tested with fixtures.
 *
 * Ties on text relevance are broken by the *proportion* already in stock, not the
 * count. Two of two is cookable tonight; two of three is a trip to the shop, and
 * counting absolutes would rank them equal.
 */
export function searchLibrary(query, entries, inventoryNames) {
  const q = norm(query);
  const stock = (inventoryNames || []).map(norm);
  const held = name => {
    const n = norm(name);
    return !!n && stock.some(s => s === n || s.includes(n) || n.includes(s));
  };

  return (entries || [])
    .map(entry => {
      const items = entry.items || [];
      const nameHit = !!q && norm(entry.name).includes(q);
      const ingHits = q ? items.filter(i => norm(i.name).includes(q)).length : 0;
      const inStock = items.filter(i => held(i.name)).length;
      // A name match outweighs any number of ingredient matches.
      const score = (nameHit ? 100 : 0) + ingHits * 10;
      return { entry, score, inStock, total: items.length };
    })
    .filter(r => !q || r.score > 0)
    .sort((a, b) => (b.score - a.score)
      || (ready(b) - ready(a))
      || a.entry.name.localeCompare(b.entry.name));
}

/** How complete a meal is, 0–1. A meal with no ingredients is not "ready". */
function ready(r) {
  return r.total ? r.inStock / r.total : 0;
}
