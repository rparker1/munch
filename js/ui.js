/* ==========================================================================
   UI kit — bottom sheet, toaster, and the form fragments the sheets are
   assembled from. Views build HTML strings; this module owns the chrome.
   ========================================================================== */

import { $, esc, html, haptic } from './util.js';
import { icon } from './icons.js';

/* --- bottom sheet ------------------------------------------------------- */

const host  = $('#sheetHost');
const panel = $('.sheet', host);
const titleEl = $('#sheetTitle');
const bodyEl  = $('#sheetBody');
const actionsEl = $('#sheetActions');

let onDismiss = null;
let onConfirm = null;
let lastFocus = null;

/** Head-bar tick, next to the close cross. Omit `confirm` and nothing renders. */
function renderConfirm(confirm) {
  onConfirm = confirm?.run || null;
  actionsEl.innerHTML = confirm
    ? `<button class="iconbtn iconbtn--primary sheet__act" type="button" data-confirm
         aria-label="${esc(confirm.label || 'Save')}">${icon('check')}</button>`
    : '';
}

/**
 * Open the sheet.
 * @param {object}   o
 * @param {string}   o.title
 * @param {string}   o.body      HTML for the scrolling body
 * @param {Function} [o.mount]   called with the body element after insertion
 * @param {Function} [o.dismiss] called when the sheet closes
 * @param {object}   [o.confirm] { label, run } — renders a tick beside the cross
 */
export function openSheet({ title, body, mount, dismiss, confirm = null }) {
  lastFocus = document.activeElement;
  onDismiss = dismiss || null;
  titleEl.textContent = title;
  bodyEl.innerHTML = body;
  renderConfirm(confirm);
  host.hidden = false;
  host.classList.remove('is-closing');
  panel.classList.remove('is-closing');
  document.body.style.overflow = 'hidden';
  if (mount) mount(bodyEl);
  bindSelectAll(bodyEl);
  bindSliders(bodyEl);
  // Focus the first real control, but never auto-open the keyboard on iOS.
  // preventScroll is load-bearing: the panel is mid-`rise` here, so letting the
  // browser scroll the input into view leaves the body scrolled to the bottom.
  const first = bodyEl.querySelector('[data-autofocus]');
  if (first) first.focus({ preventScroll: true });
  // The body element outlives each sheet, so its offset has to be reset by hand
  // — and again after focus, for Safari versions that ignore preventScroll.
  bodyEl.scrollTop = 0;
}

export function closeSheet() {
  if (host.hidden) return;
  panel.classList.add('is-closing');
  host.classList.add('is-closing');
  const finish = () => {
    host.hidden = true;
    bodyEl.innerHTML = '';
    actionsEl.innerHTML = '';
    onConfirm = null;
    document.body.style.overflow = '';
    panel.classList.remove('is-closing');
    host.classList.remove('is-closing');
    const cb = onDismiss;
    onDismiss = null;
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
    if (cb) cb();
  };
  setTimeout(finish, 190);
}

export const sheetOpen = () => !host.hidden;
export const sheetBody = () => bodyEl;

host.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) closeSheet();
  else if (e.target.closest('[data-confirm]')) onConfirm?.();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheetOpen()) closeSheet();
});

/** Replace the body of an already-open sheet (used for multi-step flows). */
export function setSheet({ title, body, mount }) {
  if (title) titleEl.textContent = title;
  bodyEl.innerHTML = body;
  bodyEl.scrollTop = 0;
  if (mount) mount(bodyEl);
  bindSelectAll(bodyEl);
  bindSliders(bodyEl);
}

/* --- toaster ------------------------------------------------------------ */

const toaster = $('#toaster');

/**
 * Transient message. `action` renders a button: { label, run }.
 */
export function toast(message, { iconName = null, action = null, ms = 3200 } = {}) {
  const el = html(`
    <div class="toast">
      ${iconName ? icon(iconName) : ''}
      <span>${esc(message)}</span>
      ${action ? `<button type="button">${esc(action.label)}</button>` : ''}
    </div>`);

  if (action) {
    el.querySelector('button').addEventListener('click', () => {
      action.run();
      dismiss();
    });
  }

  let timer = setTimeout(dismiss, ms);
  function dismiss() {
    clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 240);
  }

  toaster.append(el);
  while (toaster.children.length > 2) toaster.firstElementChild.remove();
  haptic();
  return dismiss;
}

/* --- confirm ------------------------------------------------------------ */

export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false, run }) {
  openSheet({
    title,
    body: `
      <p style="font-size:15px;line-height:1.5;color:var(--ink-2)">${esc(message)}</p>
      <div class="sheet__foot">
        <button class="btn btn--ghost" type="button" data-close>Cancel</button>
        <button class="btn ${danger ? 'btn--danger' : ''}" type="button" data-go>${esc(confirmLabel)}</button>
      </div>`,
    mount(root) {
      root.querySelector('[data-go]').addEventListener('click', () => {
        closeSheet();
        run();
      });
    },
  });
}

/* --- form fragments ----------------------------------------------------- */

export function field({ label, hint, control }) {
  return `
    <div class="field">
      ${label ? `<span class="field__label">${esc(label)}</span>` : ''}
      ${control}
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </div>`;
}

/**
 * A text field.
 *
 * iOS suggestions and autocorrect were left to chance: every field said
 * autocomplete="off" and none of autocorrect, autocapitalize or spellcheck was set. They
 * are stated here instead. `autocomplete` is now only suppressed on numeric and date
 * fields — on a free-text field there was never a reason to fight the browser, and it is
 * the likeliest thing to have been suppressing the predictive bar.
 */
export function textInput({
  name, value = '', placeholder = '', type = 'text',
  autofocus = false, selectOnFocus = false, attrs = '',
}) {
  const numeric = /inputmode="(decimal|numeric)"/.test(attrs) || type === 'date' || type === 'search';
  const keyboard = numeric
    ? 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"'
    : 'autocorrect="on" autocapitalize="sentences" spellcheck="true"';
  return `<input class="input" type="${type}" name="${esc(name)}" value="${esc(value)}"
    placeholder="${esc(placeholder)}" enterkeyhint="done" ${keyboard}
    ${autofocus ? 'data-autofocus' : ''} ${selectOnFocus ? 'data-selectall' : ''} ${attrs}>`;
}

/**
 * Entering a field marked `selectOnFocus` selects what is already there, so the
 * first keystroke replaces it instead of landing wherever the caret happened to
 * fall. A second, deliberate tap still positions the caret normally.
 */
export function bindSelectAll(root) {
  root.querySelectorAll('[data-selectall]').forEach(el => {
    let armed = false;
    const all = () => { try { el.setSelectionRange(0, el.value.length); } catch { /* unsupported type */ } };
    el.addEventListener('focus', () => { armed = true; requestAnimationFrame(all); });
    // iOS places the caret on the tap that follows focus, undoing the selection.
    el.addEventListener('click', () => { if (armed) { all(); armed = false; } });
    el.addEventListener('blur', () => { armed = false; });
  });
}

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

export function textArea({ name, value = '', placeholder = '' }) {
  return `<textarea class="textarea" name="${esc(name)}" placeholder="${esc(placeholder)}"
    autocorrect="on" autocapitalize="sentences" spellcheck="true"
    rows="3">${esc(value)}</textarea>`;
}

export function select({ name, value, options, blank = null }) {
  const opts = options.map(o => {
    const v = o.value ?? o.id;
    const l = o.label ?? String(v);
    return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`;
  }).join('');
  return `<select class="select" name="${esc(name)}">${blank ? `<option value="">${esc(blank)}</option>` : ''}${opts}</select>`;
}

/** Two-or-three way switch. Reads back via `data-value` on the wrapper. */
export function segmented({ name, value, options }) {
  return `
    <div class="segmented" data-segmented="${esc(name)}" data-value="${esc(value)}">
      ${options.map(o => `
        <button type="button" data-opt="${esc(o.value)}" aria-pressed="${o.value === value}">
          ${esc(o.label)}
        </button>`).join('')}
    </div>`;
}

/** Wrap-around chip picker. Reads back via `data-value`. */
export function chipGroup({ name, value, options }) {
  return `
    <div class="optgrid" data-chipgroup="${esc(name)}" data-value="${esc(value)}">
      ${options.map(o => `
        <button type="button" class="chip" data-opt="${esc(o.value ?? o.id)}"
          aria-pressed="${(o.value ?? o.id) === value}">${esc(o.label)}</button>`).join('')}
    </div>`;
}

/** Wire up every segmented/chipGroup inside `root` so `data-value` stays true. */
export function bindPickers(root) {
  root.querySelectorAll('[data-segmented], [data-chipgroup]').forEach(group => {
    group.addEventListener('click', e => {
      const btn = e.target.closest('[data-opt]');
      if (!btn || !group.contains(btn)) return;
      group.dataset.value = btn.dataset.opt;
      group.querySelectorAll('[data-opt]').forEach(b => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      group.dispatchEvent(new CustomEvent('pick', { detail: btn.dataset.opt, bubbles: true }));
      haptic(6);
    });
  });
}

/** Collect a sheet form: named inputs plus picker groups, all in one object. */
export function readForm(root) {
  const out = {};
  root.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
  });
  root.querySelectorAll('[data-segmented]').forEach(g => { out[g.dataset.segmented] = g.dataset.value; });
  root.querySelectorAll('[data-chipgroup]').forEach(g => { out[g.dataset.chipgroup] = g.dataset.value; });
  return out;
}

/* --- shared blocks ------------------------------------------------------ */

export function emptyState({ iconName = 'box', title, body, action = null }) {
  return `
    <div class="empty">
      ${icon(iconName)}
      <p class="empty__title">${esc(title)}</p>
      <p class="empty__body">${esc(body)}</p>
      ${action ? `<button class="btn" type="button" data-act="${esc(action.act)}">${icon('plus')}${esc(action.label)}</button>` : ''}
    </div>`;
}

export const pill = (text, tone = '', iconName = null) =>
  `<span class="pill${tone ? ` pill--${tone}` : ''}">${iconName ? icon(iconName) : ''}${esc(text)}</span>`;
