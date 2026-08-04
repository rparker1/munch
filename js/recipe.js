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

/* One table, one place to extend. First matching category wins, so a name that
   hits two lists always lands the same way rather than depending on key order. */
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

/** A CATEGORIES id. 'other' when nothing matches — always a real aisle the app renders. */
export function guessCategory(name) {
  const n = String(name || '').toLowerCase();
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some(w => n.includes(w))) return cat;
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
  if (!unit) unit = 'pcs';   // a bare count

  // Preparation after the first comma is noise once we have an amount.
  const name = rest.split(',')[0].replace(/^of\s+/i, '').trim();
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
