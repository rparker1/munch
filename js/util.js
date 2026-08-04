/* Small helpers: DOM, dates, formatting. No dependencies. */

/* --- DOM ---------------------------------------------------------------- */

/** Escape for interpolation into innerHTML. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Build an element from an HTML string. */
export function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

/** Delegated listener. Handler gets (matchedElement, event). */
export function on(root, type, sel, fn) {
  root.addEventListener(type, e => {
    const el = e.target.closest(sel);
    if (el && root.contains(el)) fn(el, e);
  });
}

export function haptic(ms = 8) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* unsupported */ } }
}

/* --- ids ---------------------------------------------------------------- */

let seq = 0;
export function uid(prefix = 'i') {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* --- dates -------------------------------------------------------------- */

/** Local calendar date as YYYY-MM-DD (never UTC-shifted). */
export function iso(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const today = () => iso();

export function addDays(isoStr, n) {
  const d = parseISO(isoStr);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** Whole days from today to `isoStr`. Negative = in the past. */
export function daysFromToday(isoStr) {
  if (!isoStr) return null;
  return Math.round((parseISO(isoStr) - parseISO(today())) / 86400000);
}

/** Monday of the week containing `isoStr` (UK convention). */
export function weekStart(isoStr) {
  const d = parseISO(isoStr);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return iso(d);
}

const DOW   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const dow = isoStr => DOW[parseISO(isoStr).getDay()];
export const dayNum = isoStr => parseISO(isoStr).getDate();

/** "Today" / "Tomorrow" / "Thu 7 Aug". */
export function niceDate(isoStr) {
  const n = daysFromToday(isoStr);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const d = parseISO(isoStr);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

/** "Monday 3 August" — the long form, for the Today header. */
export function longDate(isoStr) {
  const d = parseISO(isoStr);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

/** "7 Aug" — compact, no weekday. */
export function shortDate(isoStr) {
  const d = parseISO(isoStr);
  return `${d.getDate()} ${MONTH[d.getMonth()]}`;
}

/** Relative use-by phrasing plus a severity band. */
export function expiryInfo(useBy) {
  if (!useBy) return null;
  const n = daysFromToday(useBy);
  if (n < 0)   return { n, tone: 'bad',  label: n === -1 ? '1 day over' : `${-n} days over` };
  if (n === 0) return { n, tone: 'bad',  label: 'Use today' };
  if (n === 1) return { n, tone: 'warn', label: 'Use tomorrow' };
  if (n <= 3)  return { n, tone: 'warn', label: `${n} days left` };
  if (n <= 7)  return { n, tone: 'ok',   label: `${n} days left` };
  return { n, tone: 'ok', label: `Use by ${shortDate(useBy)}` };
}

/* --- numbers & text ----------------------------------------------------- */

/** Trim trailing zeros: 1.50 -> "1.5", 2.00 -> "2". */
export function num(v) {
  const n = Number(v);
  if (!isFinite(n)) return '';
  return String(Math.round(n * 100) / 100);
}

/**
 * Units that read as abbreviations and must not be pluralised: "500 g", not "500 gs".
 *
 * Duplicated from store.js's UNITS on purpose — store.js imports util.js, so importing
 * back would make a cycle. tests/logic.mjs asserts the two agree, so drift is caught
 * rather than discovered.
 */
export const STANDARD_UNITS = ['pcs', 'g', 'kg', 'ml', 'L', 'pack', 'tin', 'jar', 'bunch',
                               'loaf', 'bottle', 'tbsp', 'tsp', 'clove'];

/** "500 g", "2 tin", "3 pcs", "2 slices". */
export function qtyLabel(qty, unit) {
  const q = num(qty);
  if (!q || Number(q) === 0) return '';
  if (!unit || unit === 'pcs') return q;
  // A portion name is a word the user typed, so it pluralises. A standard unit is an
  // abbreviation and stays as it is, and one of anything is singular either way.
  const word = STANDARD_UNITS.includes(unit) || Number(q) === 1 ? unit : `${unit}s`;
  return `${q} ${word}`;
}

/** Comparison key for merging shopping lines. */
export const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function titleCase(s) {
  const t = String(s || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Two-letter monogram for row avatars. */
export function initials(name) {
  const parts = normName(name).split(' ').filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[1][0];
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function debounce(fn, ms = 180) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
