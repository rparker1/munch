/* ==========================================================================
   Store — single source of truth, persisted to localStorage.
   Everything the views render comes from here; every mutation goes through
   commit() so persistence and re-render stay in lockstep.
   ========================================================================== */

import { uid, iso, today, addDays, normName, titleCase, daysFromToday } from './util.js';

const BASE_KEY = 'munch.state';
const SCHEMA   = 1;

/* Signed-out data lives under the base key; each account gets its own, so
   signing in never overwrites what was already on the device and signing out
   hands it straight back. */
let KEY = BASE_KEY;

/* --- reference data ----------------------------------------------------- */

export const MEALS = [
  { id: 'breakfast', label: 'Breakfast', icon: 'sun'  },
  { id: 'lunch',     label: 'Lunch',     icon: 'noon' },
  { id: 'dinner',    label: 'Dinner',    icon: 'moon' },
];

/* Aisle order doubles as the walk round the shop. Colours are pastels pitched
   for a black background, in the same family as the mint/pink/amber accents. */
export const CATEGORIES = [
  { id: 'produce',  label: 'Fruit & veg',  colour: '#7FD9AE' },
  { id: 'protein',  label: 'Meat & fish',  colour: '#F4A79D' },
  { id: 'dairy',    label: 'Dairy & eggs', colour: '#F9D08A' },
  { id: 'bakery',   label: 'Bakery',       colour: '#E5BE93' },
  { id: 'cupboard', label: 'Cupboard',     colour: '#CFC2A2' },
  { id: 'frozen',   label: 'Frozen',       colour: '#9CCFEE' },
  { id: 'drinks',   label: 'Drinks',       colour: '#C4B2EC' },
  { id: 'snacks',   label: 'Snacks',       colour: '#F6C5CB' },
  { id: 'household',label: 'Household',    colour: '#9EB3C4' },
  { id: 'other',    label: 'Other',        colour: '#8F8F8F' },
];

// tbsp/tsp/clove are appended rather than inserted so the existing order of the
// unit dropdown is unchanged. None of them is a part-usable container, so PARTABLE
// below deliberately does not gain them.
export const UNITS = ['pcs', 'g', 'kg', 'ml', 'L', 'pack', 'tin', 'bunch', 'loaf', 'bottle',
                      'tbsp', 'tsp', 'clove'];

/**
 * Units where a part-used fraction means something physical. Grams and millilitres
 * are already exact, and three apples at 65% is nonsense — so both the slider and
 * every display of the value are gated on this one set, and cannot disagree.
 */
export const PARTABLE = new Set(['pack', 'tin', 'bottle', 'loaf', 'bunch']);

/** 0–1, two decimal places. Anything unparseable becomes null. */
const clampFrac = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
};

export const PLACES = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'work', label: 'Work', icon: 'briefcase' },
];

export const catOf   = id => CATEGORIES.find(c => c.id === id) || CATEGORIES.at(-1);
export const mealOf  = id => MEALS.find(m => m.id === id) || MEALS[0];
export const placeOf = id => PLACES.find(p => p.id === id) || PLACES[0];

/* --- shape -------------------------------------------------------------- */

const emptyState = () => ({
  schema: SCHEMA,
  inventory: [],
  plan: {},
  shopping: [],
  planTicks: {},
  library: [],
  locations: [],
  settings: { seeded: false, horizonDays: 14 },

  // Sync bookkeeping. stamps/tombstones carry the last-write-wins clock per
  // record, dirty is what still needs pushing, syncedAt is how far the last
  // pull got (the server's clock, not this device's).
  stamps: {},
  tombstones: {},
  dirty: {},
  syncedAt: null,
});

let state = emptyState();
let undoStack = [];
const listeners = new Set();

/* --- persistence -------------------------------------------------------- */

let saveTimer = null;

function writeNow() {
  saveTimer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Munch: could not save state', err);
  }
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 120);
}

/**
 * Write immediately, skipping the debounce. iOS can suspend a backgrounded web
 * app without ever running a pending timer, so the shell calls this whenever the
 * page is hidden or unloaded.
 */
export function flush() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  writeNow();
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    state = { ...emptyState(), ...parsed, settings: { ...emptyState().settings, ...(parsed.settings || {}) } };
    return true;
  } catch (err) {
    console.warn('Munch: stored state unreadable, starting fresh', err);
    return false;
  }
}

/** Notify views. */
function emit() { listeners.forEach(fn => fn(state)); }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function commit({ silent = false } = {}) {
  reindex({ stamp: true });
  persist();
  if (!silent) emit();
}

/* ==========================================================================
   Sync bookkeeping
   ==========================================================================

   Every mutation already funnels through commit(), so rather than remembering to
   stamp a clock inside each of the twenty-odd writers — and eventually forgetting
   one — commit() diffs the record view of state against the last one it saw and
   stamps whatever actually moved. Adding a new mutation needs no sync code at all.
   ========================================================================== */

const recKey = (kind, id) => `${kind}:${id}`;
const slotId = (date, mealId) => `${date}|${mealId}`;

/** Timestamps arrive from two clocks in two formats, so never compare as text. */
const at = iso => Date.parse(iso) || 0;

/** Flatten state into the records that get synced. */
function* walkRecords() {
  for (const it of state.inventory) yield { kind: 'inventory', id: it.id, payload: it };
  for (const it of state.shopping) yield { kind: 'shopping', id: it.id, payload: it };
  for (const l of state.library) yield { kind: 'library', id: l.id, payload: l };
  for (const l of state.locations) yield { kind: 'location', id: l.id, payload: l };
  for (const [date, day] of Object.entries(state.plan)) {
    for (const meal of MEALS) {
      if (day[meal.id]) yield { kind: 'slot', id: slotId(date, meal.id), payload: day[meal.id] };
    }
  }
  for (const k of Object.keys(state.planTicks)) yield { kind: 'tick', id: k, payload: { on: true } };
  yield { kind: 'setting', id: 'app', payload: state.settings };
}

/** Put one record back, wherever it belongs. */
function writeRecord(kind, id, payload) {
  if (!payload) return;
  const upsert = (list, item) => {
    const i = list.findIndex(x => x.id === item.id);
    if (i === -1) list.push(item); else list[i] = item;
  };
  if (kind === 'inventory') upsert(state.inventory, payload);
  else if (kind === 'shopping') upsert(state.shopping, payload);
  else if (kind === 'library') upsert(state.library, payload);
  else if (kind === 'location') upsert(state.locations, payload);
  else if (kind === 'tick') state.planTicks[id] = true;
  else if (kind === 'setting') state.settings = { ...emptyState().settings, ...payload };
  else if (kind === 'slot') {
    const [date, mealId] = id.split('|');
    if (!date || !mealId) return;
    if (!state.plan[date]) state.plan[date] = {};
    state.plan[date][mealId] = payload;
  }
}

function dropRecord(kind, id) {
  if (kind === 'inventory') state.inventory = state.inventory.filter(x => x.id !== id);
  else if (kind === 'shopping') state.shopping = state.shopping.filter(x => x.id !== id);
  else if (kind === 'library') state.library = state.library.filter(x => x.id !== id);
  else if (kind === 'location') state.locations = state.locations.filter(x => x.id !== id);
  else if (kind === 'tick') delete state.planTicks[id];
  else if (kind === 'slot') {
    const [date, mealId] = id.split('|');
    const day = state.plan[date];
    if (!day) return;
    delete day[mealId];
    if (!Object.keys(day).length) delete state.plan[date];
  }
  // 'setting' is a singleton and is never deleted.
}

/* What the last diff saw, as key -> serialised payload. */
let seen = new Map();

/**
 * Re-read the record view. With `stamp`, anything that changed since the last
 * pass gets the current clock and is queued for push; without it the pass only
 * establishes a baseline (after a load, or after applying remote records that
 * already carry their own clock).
 */
function reindex({ stamp }) {
  const now = new Date().toISOString();
  const current = new Map();
  for (const rec of walkRecords()) {
    current.set(recKey(rec.kind, rec.id), JSON.stringify(rec.payload));
  }

  if (stamp) {
    for (const [k, json] of current) {
      if (seen.get(k) === json) continue;
      state.stamps[k] = now;
      state.dirty[k] = true;
      delete state.tombstones[k];
    }
    for (const k of seen.keys()) {
      if (current.has(k)) continue;
      state.tombstones[k] = now;
      state.dirty[k] = true;
      delete state.stamps[k];
    }
  }

  seen = current;
}

/** Records still waiting to go up. */
export function pendingRecords() {
  const out = [];
  const payloads = new Map();
  for (const rec of walkRecords()) payloads.set(recKey(rec.kind, rec.id), rec.payload);

  for (const k of Object.keys(state.dirty)) {
    const cut = k.indexOf(':');
    const kind = k.slice(0, cut);
    const id = k.slice(cut + 1);
    const tomb = state.tombstones[k];
    if (tomb) {
      out.push({ key: k, kind, id, payload: null, updatedAt: tomb, deleted: true });
      continue;
    }
    const payload = payloads.get(k);
    if (!payload) { delete state.dirty[k]; continue; }
    out.push({
      key: k, kind, id, payload, deleted: false,
      updatedAt: state.stamps[k] || new Date().toISOString(),
    });
  }
  return out;
}

export const pendingCount = () => Object.keys(state.dirty).length;

export function markPushed(keys) {
  for (const k of keys) delete state.dirty[k];
  persist();
}

/**
 * Merge records pulled from the server. Last write wins on the record's own
 * clock; a local edit that has not been pushed yet only loses if the incoming
 * copy is genuinely newer.
 */
export function applyRemote(rows) {
  let changed = 0;
  for (const row of rows) {
    const k = recKey(row.kind, row.id);
    const mine = state.tombstones[k] || state.stamps[k] || null;
    const theirs = row.updated_at;
    if (mine && at(mine) >= at(theirs)) continue;

    if (row.deleted_at) {
      dropRecord(row.kind, row.id);
      state.tombstones[k] = theirs;
      delete state.stamps[k];
    } else {
      writeRecord(row.kind, row.id, row.payload);
      state.stamps[k] = theirs;
      delete state.tombstones[k];
    }
    delete state.dirty[k];
    changed += 1;
  }

  if (changed) {
    prune();
    reindex({ stamp: false });   // the clocks came with the rows
    persist();
    emit();
  }
  return changed;
}

export const syncedAt = () => state.syncedAt;
export function setSyncedAt(iso) { state.syncedAt = iso; persist(); }

/**
 * Point the store at an account's own workspace, or back at the signed-out one.
 * Data is never merged between them: signing in opens an empty workspace for
 * that account and signing out hands back exactly what was on the device.
 */
export function useAccount(userId) {
  flush();
  KEY = userId ? `${BASE_KEY}.${userId}` : BASE_KEY;
  const restored = load();
  if (!restored) {
    state = emptyState();
    defaultLocations();
    if (!userId) { seedDemo(); state.settings.seeded = true; }
  }
  if (!state.locations.length) defaultLocations();
  prune();
  reindex({ stamp: false });
  persist();
  emit();
  return state;
}

/* --- undo (one deep, for destructive actions) --------------------------- */

export function snapshot(label) {
  undoStack = [{ label, data: JSON.stringify(state) }];
}

export const canUndo = () => undoStack.length > 0;

export function undo() {
  const last = undoStack.pop();
  if (!last) return false;
  state = JSON.parse(last.data);
  commit();
  return true;
}

/* --- read --------------------------------------------------------------- */

export const get = () => state;

export const locations = () => state.locations;
export const locationOf = id => state.locations.find(l => l.id === id) || null;
export const locationsFor = place => state.locations.filter(l => l.place === place);

export function locationLabel(id) {
  const l = locationOf(id);
  if (!l) return 'Unassigned';
  return `${placeOf(l.place).label} · ${l.label}`;
}

/** Inventory sorted by urgency: overdue first, then soonest use-by, then name. */
export function inventory({ place = null, locId = null, query = '' } = {}) {
  const q = normName(query);
  return state.inventory
    .filter(it => {
      if (locId && it.locId !== locId) return false;
      if (place) {
        const l = locationOf(it.locId);
        if (!l || l.place !== place) return false;
      }
      if (q && !normName(it.name).includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      const da = a.useBy ? daysFromToday(a.useBy) : 9e5;
      const db = b.useBy ? daysFromToday(b.useBy) : 9e5;
      if (da !== db) return da - db;
      return normName(a.name).localeCompare(normName(b.name));
    });
}

export const invItem = id => state.inventory.find(i => i.id === id) || null;

/** Items at or past their use-by within `within` days. */
export function expiring(within = 3) {
  return state.inventory
    .filter(i => i.useBy && daysFromToday(i.useBy) <= within)
    .sort((a, b) => daysFromToday(a.useBy) - daysFromToday(b.useBy));
}

/** The three slots for a date, always all three keys present. */
export function dayPlan(date) {
  const d = state.plan[date] || {};
  return Object.fromEntries(MEALS.map(m => [m.id, d[m.id] || null]));
}

export function plannedCount(date) {
  const d = state.plan[date] || {};
  return MEALS.filter(m => d[m.id]).length;
}

export const slot = (date, mealId) => (state.plan[date] || {})[mealId] || null;

/* --- shopping list derivation ------------------------------------------- */

/**
 * Lines the meal plan implies: every `buy` ingredient on an uncooked meal from
 * today onward, merged by name + unit and summed.
 */
export function derivedLines() {
  const horizon = state.settings.horizonDays ?? 14;
  const from = today();
  const to = addDays(from, horizon);
  const map = new Map();

  for (const [date, day] of Object.entries(state.plan)) {
    if (date < from || date > to) continue;
    for (const meal of MEALS) {
      const s = day[meal.id];
      if (!s || s.done) continue;
      for (const ing of s.items || []) {
        if (ing.source !== 'buy') continue;
        const key = `p:${normName(ing.name)}|${ing.unit || ''}`;
        let line = map.get(key);
        if (!line) {
          line = {
            key,
            kind: 'plan',
            name: titleCase(ing.name),
            unit: ing.unit || '',
            qty: 0,
            anyQty: false,
            category: ing.category || 'other',
            refs: [],
          };
          map.set(key, line);
        }
        const q = Number(ing.qty);
        if (isFinite(q) && q > 0) { line.qty += q; line.anyQty = true; }
        line.refs.push({ date, mealId: meal.id, mealLabel: meal.label, slotName: s.name });
      }
    }
  }

  return Array.from(map.values()).map(l => ({
    ...l,
    qty: l.anyQty ? l.qty : null,
    done: !!state.planTicks[l.key],
  }));
}

/** Manual lines plus plan-derived lines, grouped by category in aisle order. */
export function shoppingList() {
  const manual = state.shopping.map(m => ({
    key: `m:${m.id}`,
    kind: 'manual',
    id: m.id,
    name: m.name,
    qty: m.qty ?? null,
    unit: m.unit || '',
    category: m.category || 'other',
    note: m.note || '',
    done: !!m.done,
    refs: [],
  }));

  const all = [...derivedLines(), ...manual];
  const groups = CATEGORIES
    .map(c => ({
      cat: c,
      lines: all
        .filter(l => l.category === c.id)
        .sort((a, b) => (a.done - b.done) || normName(a.name).localeCompare(normName(b.name))),
    }))
    .filter(g => g.lines.length);

  return { groups, all, outstanding: all.filter(l => !l.done).length, total: all.length };
}

/** Inventory rows whose name matches a shopping line — "you may already have this". */
export function matchInInventory(name) {
  const q = normName(name);
  if (!q) return [];
  return state.inventory.filter(i => normName(i.name) === q || normName(i.name).includes(q));
}

/* --- write: inventory --------------------------------------------------- */

export function addInvItem(data) {
  const item = {
    id: uid('inv'),
    name: titleCase(data.name || 'Item'),
    qty: data.qty === '' || data.qty == null ? null : Number(data.qty),
    unit: data.unit || 'pcs',
    remaining: clampFrac(data.remaining),
    category: data.category || 'other',
    locId: data.locId || state.locations[0]?.id || null,
    useBy: data.useBy || '',
    note: data.note || '',
    addedAt: iso(),
  };
  state.inventory.push(item);
  commit();
  return item;
}

export function updateInvItem(id, patch) {
  const it = invItem(id);
  if (!it) return null;
  Object.assign(it, patch);
  if (patch.name) it.name = titleCase(patch.name);
  if ('qty' in patch) it.qty = patch.qty === '' || patch.qty == null ? null : Number(patch.qty);
  if ('remaining' in patch) it.remaining = clampFrac(patch.remaining);
  commit();
  return it;
}

export function removeInvItem(id) {
  snapshot('Item deleted');
  state.inventory = state.inventory.filter(i => i.id !== id);
  // Unlink from any plan slot so we never render a dangling reference.
  for (const day of Object.values(state.plan)) {
    for (const meal of MEALS) {
      const s = day[meal.id];
      if (!s) continue;
      for (const ing of s.items || []) {
        if (ing.invId === id) { ing.invId = null; ing.source = 'buy'; }
      }
    }
  }
  commit();
}

/** Nudge a quantity up or down; deleting at zero is the caller's choice. */
export function bumpQty(id, delta) {
  const it = invItem(id);
  if (!it) return null;
  const step = it.unit === 'g' || it.unit === 'ml' ? 50 : 1;
  const base = Number(it.qty) || 0;
  it.qty = Math.max(0, Math.round((base + delta * step) * 100) / 100);
  commit();
  return it;
}

/**
 * How much of a part-used container is left, 0–1. `null` means "not part-used",
 * which is how every item starts and is indistinguishable from one saved before
 * this field existed. No snapshot(): a slider drag is not a destructive act, so
 * it stays off the undo stack, same as bumpQty.
 */
export function setRemaining(id, frac) {
  const it = invItem(id);
  if (!it) return null;
  it.remaining = clampFrac(frac);
  commit();
  return it;
}

/* --- write: plan -------------------------------------------------------- */

function ensureDay(date) {
  if (!state.plan[date]) state.plan[date] = {};
  return state.plan[date];
}

export function saveSlot(date, mealId, data) {
  const day = ensureDay(date);
  const prev = day[mealId];
  day[mealId] = {
    name: titleCase(data.name || mealOf(mealId).label),
    place: data.place || prev?.place || 'home',
    items: (data.items || []).map(i => ({
      id: i.id || uid('ing'),
      name: titleCase(i.name),
      qty: i.qty === '' || i.qty == null ? null : Number(i.qty),
      unit: i.unit || '',
      category: i.category || 'other',
      source: i.source === 'inv' ? 'inv' : 'buy',
      invId: i.source === 'inv' ? (i.invId || null) : null,
    })),
    note: data.note || '',
    done: prev?.done || false,
  };
  commit();
  return day[mealId];
}

export function clearSlot(date, mealId) {
  snapshot('Meal cleared');
  const day = state.plan[date];
  if (day) {
    delete day[mealId];
    if (!Object.keys(day).length) delete state.plan[date];
  }
  commit();
}

export function copySlot(from, to) {
  const src = slot(from.date, from.mealId);
  if (!src) return null;
  const day = ensureDay(to.date);
  day[to.mealId] = {
    ...structuredClone(src),
    done: false,
    items: (src.items || []).map(i => ({ ...i, id: uid('ing') })),
  };
  commit();
  return day[to.mealId];
}

/**
 * Mark a meal cooked and draw down the inventory it used.
 * Returns a plain-language summary of what changed.
 */
export function cookSlot(date, mealId) {
  const s = slot(date, mealId);
  if (!s) return null;
  snapshot('Meal marked as eaten');

  const used = [];
  const emptied = [];

  for (const ing of s.items || []) {
    if (ing.source !== 'inv' || !ing.invId) continue;
    const it = invItem(ing.invId);
    if (!it) continue;

    const take = Number(ing.qty);
    const have = Number(it.qty);

    if (isFinite(take) && take > 0 && isFinite(have)) {
      const left = Math.round((have - take) * 100) / 100;
      it.qty = Math.max(0, left);
      used.push({ name: it.name, took: take, unit: it.unit });
      if (it.qty <= 0) emptied.push(it.id);
    } else {
      // No usable quantity on either side — treat the item as finished.
      emptied.push(it.id);
      used.push({ name: it.name, took: null, unit: it.unit });
    }
  }

  if (emptied.length) state.inventory = state.inventory.filter(i => !emptied.includes(i.id));
  s.done = true;
  commit();
  return { used, emptiedCount: emptied.length };
}

export function uncookSlot(date, mealId) {
  const s = slot(date, mealId);
  if (!s) return;
  s.done = false;
  commit();
}

/* --- write: meal library ----------------------------------------------- */

export function saveToLibrary(mealId, data) {
  const entry = {
    id: uid('lib'),
    name: titleCase(data.name || 'Meal'),
    mealId,
    place: data.place || 'home',
    items: (data.items || []).map(i => ({
      name: titleCase(i.name),
      qty: i.qty ?? null,
      unit: i.unit || '',
      category: i.category || 'other',
    })),
  };
  // Replace any same-named entry for this meal type rather than piling up.
  state.library = state.library.filter(l => !(l.mealId === mealId && normName(l.name) === normName(entry.name)));
  state.library.unshift(entry);
  state.library = state.library.slice(0, 60);
  commit();
  return entry;
}

export const library = mealId => state.library.filter(l => !mealId || l.mealId === mealId);

export function removeFromLibrary(id) {
  state.library = state.library.filter(l => l.id !== id);
  commit();
}

/* --- write: shopping ---------------------------------------------------- */

export function addShopItem(data) {
  const item = {
    id: uid('shop'),
    name: titleCase(data.name || 'Item'),
    qty: data.qty === '' || data.qty == null ? null : Number(data.qty),
    unit: data.unit || '',
    category: data.category || 'other',
    note: data.note || '',
    done: false,
    addedAt: iso(),
  };
  state.shopping.push(item);
  commit();
  return item;
}

export function updateShopItem(id, patch) {
  const it = state.shopping.find(s => s.id === id);
  if (!it) return null;
  Object.assign(it, patch);
  if (patch.name) it.name = titleCase(patch.name);
  commit();
  return it;
}

export function removeShopItem(id) {
  state.shopping = state.shopping.filter(s => s.id !== id);
  commit();
}

/** Tick or untick any line, derived or manual. */
export function toggleLine(line) {
  if (line.kind === 'manual') {
    const it = state.shopping.find(s => s.id === line.id);
    if (it) it.done = !it.done;
  } else if (state.planTicks[line.key]) {
    delete state.planTicks[line.key];
  } else {
    state.planTicks[line.key] = true;
  }
  commit();
}

/**
 * Remove ticked lines that can actually be removed — the hand-added ones.
 * Plan-derived lines stay ticked: the meal still needs them, so they belong on
 * the list until the meal is logged as eaten or the ingredient comes from stock.
 */
export function clearTicked() {
  snapshot('Ticked items cleared');
  const n = state.shopping.filter(s => s.done).length;
  state.shopping = state.shopping.filter(s => !s.done);
  commit();
  return n;
}

/** How many ticked lines clearTicked() would actually remove. */
export const clearableCount = () => state.shopping.filter(s => s.done).length;

/**
 * Move a bought line into the inventory.
 *
 * For a plan-derived line this also re-points the meals that asked for it, so
 * the ingredient switches from "to buy" to "from stock" and the line leaves the
 * list for good rather than reappearing the next time the list is tidied.
 */
export function stockUp(line, { locId, useBy, category }) {
  const item = addInvItem({
    name: line.name,
    qty: line.qty,
    unit: line.unit || 'pcs',
    category: category || line.category,
    locId,
    useBy,
  });

  if (line.kind === 'manual') {
    removeShopItem(line.id);
    return item;
  }

  const wanted = normName(line.name);
  for (const [date, day] of Object.entries(state.plan)) {
    if (date < today()) continue;
    for (const meal of MEALS) {
      const s = day[meal.id];
      if (!s || s.done) continue;
      for (const ing of s.items || []) {
        if (ing.source !== 'buy' || normName(ing.name) !== wanted) continue;
        ing.source = 'inv';
        ing.invId = item.id;
      }
    }
  }
  delete state.planTicks[line.key];
  commit();
  return item;
}

/* --- locations ---------------------------------------------------------- */

export function addLocation(label, place) {
  const loc = { id: uid('loc'), label: titleCase(label || 'Store'), place: place || 'home' };
  state.locations.push(loc);
  commit();
  return loc;
}

export function removeLocation(id) {
  if (state.locations.length <= 1) return false;
  snapshot('Location removed');
  state.locations = state.locations.filter(l => l.id !== id);
  const fallback = state.locations[0].id;
  state.inventory.forEach(i => { if (i.locId === id) i.locId = fallback; });
  commit();
  return true;
}

/* --- settings ----------------------------------------------------------- */

export function setSetting(key, value) {
  state.settings[key] = value;
  commit();
}

/* --- maintenance -------------------------------------------------------- */

/** Drop plan ticks with no matching line, and plan days older than 60 days. */
function prune() {
  const live = new Set(derivedLines().map(l => l.key));
  for (const k of Object.keys(state.planTicks)) {
    if (!live.has(k)) delete state.planTicks[k];
  }
  const cutoff = addDays(today(), -60);
  for (const date of Object.keys(state.plan)) {
    if (date < cutoff) delete state.plan[date];
  }
}

/**
 * Empty everything: stock, meals, list, saved meals. Places are kept, since an
 * empty app with nowhere to put anything is not a useful starting point.
 *
 * Defaults to leaving it genuinely empty. It used to reseed the sample data,
 * which meant that on an untouched app the screen looked identical afterwards and
 * the button appeared not to work at all.
 *
 * commit() diffs the records, so every wiped item becomes a tombstone — which is
 * what carries the wipe up to a signed-in account rather than letting the next
 * pull put it all back.
 */
export function resetAll({ seed = false } = {}) {
  snapshot(seed ? 'Sample data loaded' : 'Everything cleared');
  const keepLocations = state.locations.length ? structuredClone(state.locations) : null;
  const settings = { ...state.settings };
  const syncedAt = state.syncedAt;

  state = emptyState();
  state.syncedAt = syncedAt;
  state.settings = { ...settings, seeded: true };
  if (keepLocations) state.locations = keepLocations;
  else defaultLocations();

  if (seed) seedDemo();
  commit();
}

export function exportText() {
  const { groups } = shoppingList();
  const lines = ['Munch — shopping list', ''];
  for (const g of groups) {
    const open = g.lines.filter(l => !l.done);
    if (!open.length) continue;
    lines.push(g.cat.label.toUpperCase());
    for (const l of open) {
      const q = l.qty ? ` — ${l.qty}${l.unit ? ` ${l.unit}` : ''}` : '';
      lines.push(`  - ${l.name}${q}`);
    }
    lines.push('');
  }
  if (lines.length <= 2) lines.push('(nothing outstanding)');
  return lines.join('\n');
}

/* --- first run ---------------------------------------------------------- */

function defaultLocations() {
  state.locations = [
    { id: 'loc_home_fridge', label: 'Fridge',      place: 'home' },
    { id: 'loc_home_freezer',label: 'Freezer',     place: 'home' },
    { id: 'loc_home_cup',    label: 'Cupboard',    place: 'home' },
    { id: 'loc_work_fridge', label: 'Fridge',      place: 'work' },
    { id: 'loc_work_desk',   label: 'Desk drawer', place: 'work' },
  ];
}

function seedDemo() {
  const d = n => addDays(today(), n);
  const inv = [
    ['Chicken breasts',  600, 'g',    'protein',  'loc_home_fridge',  2],
    ['Greek yoghurt',    500, 'g',    'dairy',    'loc_home_fridge',  6],
    ['Cherry tomatoes',  300, 'g',    'produce',  'loc_home_fridge',  1],
    ['Spinach',          200, 'g',    'produce',  'loc_home_fridge',  0],
    ['Halloumi',         225, 'g',    'dairy',    'loc_home_fridge',  9],
    ['Eggs',              10, 'pcs',  'dairy',    'loc_home_fridge', 12],
    ['Sourdough loaf',     1, 'loaf', 'bakery',   'loc_home_cup',     3],
    ['Basmati rice',       1, 'kg',   'cupboard', 'loc_home_cup',   240],
    ['Olive oil',        500, 'ml',   'cupboard', 'loc_home_cup',   300],
    ['Chopped tomatoes',   3, 'tin',  'cupboard', 'loc_home_cup',   400],
    ['Frozen peas',      900, 'g',    'frozen',   'loc_home_freezer',180],
    ['Salmon fillets',     2, 'pcs',  'frozen',   'loc_home_freezer', 90],
    ['Oat milk',           1, 'L',    'dairy',    'loc_work_fridge',  8],
    ['Hummus',           200, 'g',    'dairy',    'loc_work_fridge',  4],
    ['Porridge oats',    500, 'g',    'cupboard', 'loc_work_desk',  150],
    ['Instant coffee',   200, 'g',    'drinks',   'loc_work_desk',  365],
  ];
  state.inventory = inv.map(([name, qty, unit, category, locId, days]) => ({
    id: uid('inv'), name, qty, unit, category, locId, useBy: d(days), note: '', addedAt: today(),
  }));

  const find = name => state.inventory.find(i => i.name === name);
  const ing = (name, qty, unit, category, source = 'buy') => {
    const hit = source === 'inv' ? find(name) : null;
    return { id: uid('ing'), name, qty, unit, category, source, invId: hit?.id || null };
  };

  state.plan = {
    [today()]: {
      breakfast: {
        name: 'Porridge & berries', place: 'work', done: false, note: 'Made in the office kitchen',
        items: [ing('Porridge oats', 60, 'g', 'cupboard', 'inv'), ing('Oat milk', 200, 'ml', 'dairy', 'inv'), ing('Blueberries', 150, 'g', 'produce')],
      },
      lunch: {
        name: 'Hummus & flatbread', place: 'work', done: false, note: '',
        items: [ing('Hummus', 100, 'g', 'dairy', 'inv'), ing('Flatbreads', 1, 'pack', 'bakery'), ing('Cucumber', 1, 'pcs', 'produce')],
      },
      dinner: {
        name: 'Chicken traybake', place: 'home', done: false, note: 'Oven 200°C, 35 min',
        items: [
          ing('Chicken breasts', 300, 'g', 'protein', 'inv'),
          ing('Cherry tomatoes', 200, 'g', 'produce', 'inv'),
          ing('Spinach', 100, 'g', 'produce', 'inv'),
          ing('New potatoes', 500, 'g', 'produce'),
        ],
      },
    },
    [d(1)]: {
      breakfast: {
        name: 'Yoghurt, oats & honey', place: 'home', done: false, note: '',
        items: [ing('Greek yoghurt', 150, 'g', 'dairy', 'inv'), ing('Honey', 1, 'bottle', 'cupboard')],
      },
      dinner: {
        name: 'Salmon, rice & peas', place: 'home', done: false, note: '',
        items: [
          ing('Salmon fillets', 2, 'pcs', 'frozen', 'inv'),
          ing('Basmati rice', 150, 'g', 'cupboard', 'inv'),
          ing('Frozen peas', 200, 'g', 'frozen', 'inv'),
          ing('Lemon', 1, 'pcs', 'produce'),
        ],
      },
    },
    [d(2)]: {
      dinner: {
        name: 'Halloumi & tomato pasta', place: 'home', done: false, note: '',
        items: [
          ing('Halloumi', 225, 'g', 'dairy', 'inv'),
          ing('Chopped tomatoes', 1, 'tin', 'cupboard', 'inv'),
          ing('Penne', 500, 'g', 'cupboard'),
          ing('Fresh basil', 1, 'bunch', 'produce'),
        ],
      },
    },
  };

  state.shopping = [
    { id: uid('shop'), name: 'Washing-up liquid', qty: 1, unit: 'bottle', category: 'household', note: '', done: false, addedAt: today() },
    { id: uid('shop'), name: 'Bananas', qty: 6, unit: 'pcs', category: 'produce', note: '', done: false, addedAt: today() },
  ];

  state.library = [
    { id: uid('lib'), name: 'Chicken traybake', mealId: 'dinner', place: 'home',
      items: [
        { name: 'Chicken breasts', qty: 300, unit: 'g', category: 'protein' },
        { name: 'Cherry tomatoes', qty: 200, unit: 'g', category: 'produce' },
        { name: 'New potatoes',    qty: 500, unit: 'g', category: 'produce' },
      ] },
    { id: uid('lib'), name: 'Porridge & berries', mealId: 'breakfast', place: 'work',
      items: [
        { name: 'Porridge oats', qty: 60,  unit: 'g',  category: 'cupboard' },
        { name: 'Oat milk',      qty: 200, unit: 'ml', category: 'dairy' },
        { name: 'Blueberries',   qty: 150, unit: 'g',  category: 'produce' },
      ] },
    { id: uid('lib'), name: 'Omelette & salad', mealId: 'lunch', place: 'home',
      items: [
        { name: 'Eggs',    qty: 3,   unit: 'pcs', category: 'dairy' },
        { name: 'Spinach', qty: 80,  unit: 'g',   category: 'produce' },
      ] },
  ];
}

/**
 * Boot the store. `accountId` opens that account's workspace; omit it for the
 * signed-out one. The sample data only ever seeds the signed-out workspace — an
 * account starts empty.
 */
export function init(accountId = null) {
  KEY = accountId ? `${BASE_KEY}.${accountId}` : BASE_KEY;
  const restored = load();
  if (!restored || !state.locations.length) defaultLocations();
  if (!restored && !accountId) {
    seedDemo();
    state.settings.seeded = true;
  }
  prune();
  reindex({ stamp: false });   // baseline, so a plain load pushes nothing
  persist();
  return state;
}
