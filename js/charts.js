/* ==========================================================================
   Charts — hand-built SVG, no library. Three shapes:
     donut()    ring split by share, with gaps between segments
     bars()     rounded-cap columns on a track, tappable, with a tooltip
     statbars() label / big figure / thin progress, in a row of three
   Every one takes plain data and returns an HTML string.
   ========================================================================== */

import { esc } from './util.js';

/* --- donut -------------------------------------------------------------- */

const R = 76;          // ring radius within a 200×200 box
const W = 21;          // stroke width
const GAP = 7;         // blank arc length between segments
const CIRC = 2 * Math.PI * R;

/**
 * A plain ring, split by share.
 *
 * Round caps were the first attempt, following the reference, but they overhang
 * each end by half the stroke width — so a small slice became a floating pill
 * rather than an arc, and the ring read as lumpy. Butt caps with a fixed blank
 * gap keep every segment the same weight however thin it is. Labelling lives in
 * the legend underneath rather than in callout bubbles, which collided with each
 * other once there were more than two or three aisles.
 *
 * @param {object}   o
 * @param {Array}    o.segments  [{ value, colour }] — biggest first reads best
 * @param {string}   o.total     the figure for the middle
 * @param {string}  [o.caption]  small line above the figure
 */
export function donut({ segments, total, caption = 'Total' }) {
  const live = segments.filter(s => s.value > 0);
  const sum = live.reduce((a, s) => a + s.value, 0);

  if (!sum) {
    return `
      <div class="donut">
        <svg class="donut__svg" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="${R}" stroke="var(--surface-2)" stroke-width="${W}" fill="none"/>
        </svg>
        <div class="donut__mid">
          <span class="donut__cap">${esc(caption)}</span>
          <span class="donut__total">${esc(total)}</span>
        </div>
      </div>`;
  }

  let at = 0;                       // running distance around the ring
  const arcs = [];
  // With one segment there is nothing to separate, so it closes into a full ring.
  const gap = live.length > 1 ? GAP : 0;

  for (const s of live) {
    const len = (s.value / sum) * CIRC;
    const drawn = Math.max(gap > 0 ? 1.5 : len, len - gap);
    arcs.push(`
      <circle cx="100" cy="100" r="${R}" fill="none"
        stroke="${s.colour}" stroke-width="${W}" stroke-linecap="butt"
        stroke-dasharray="${drawn.toFixed(2)} ${(CIRC - drawn).toFixed(2)}"
        stroke-dashoffset="${(-at).toFixed(2)}"/>`);
    at += len;
  }

  return `
    <div class="donut">
      <svg class="donut__svg" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="${R}" stroke="var(--surface-2)" stroke-width="${W}" fill="none"/>
        ${arcs.join('')}
      </svg>
      <div class="donut__mid">
        <span class="donut__cap">${esc(caption)}</span>
        <span class="donut__total">${esc(total)}</span>
      </div>
    </div>`;
}

/* --- bars --------------------------------------------------------------- */

/**
 * @param {object} o
 * @param {Array}  o.items    [{ key, label, value, tip }]
 * @param {number} o.max      top of the scale
 * @param {string} [o.active] key of the highlighted column
 * @param {Array}  [o.ticks]  y-axis labels, top first
 * @param {string} [o.attr]   data attribute name put on each column
 */
export function bars({ items, max, active = null, ticks = [], attr = 'bar' }) {
  const cols = items.map(it => {
    const pct = max > 0 ? Math.min(100, (it.value / max) * 100) : 0;
    const on = it.key === active;
    // Tooltip and marker ride the top of the fill so they read against the
    // value. The tooltip's anchor is clamped short of the ceiling: on a
    // full-height column it would otherwise float out of the chart and collide
    // with whatever sits above it.
    const tipAt = Math.min(pct, 74);
    return `
      <button class="bar${on ? ' is-active' : ''}" type="button"
        data-${esc(attr)}="${esc(it.key)}" aria-pressed="${on}"
        aria-label="${esc(it.label)}: ${esc(it.tip || String(it.value))}">
        <span class="bar__track">
          <span class="bar__fill" style="height:${pct.toFixed(1)}%"></span>
          ${on ? `<span class="bar__knob" style="bottom:${pct.toFixed(1)}%"></span>` : ''}
          ${on && it.tip ? `<span class="bar__tip" style="bottom:${tipAt.toFixed(1)}%">${esc(it.tip)}</span>` : ''}
        </span>
        <span class="bar__label">${esc(it.label)}</span>
      </button>`;
  }).join('');

  return `
    <div class="barchart">
      ${ticks.length ? `
        <div class="barchart__axis">
          ${ticks.map(t => `<span>${esc(t)}</span>`).join('')}
        </div>` : ''}
      <div class="barchart__cols">${cols}</div>
    </div>`;
}

/* --- stat bars ---------------------------------------------------------- */

/**
 * @param {Array} stats [{ label, figure, sub?, pct, colour }]
 */
export function statbars(stats) {
  return `
    <div class="statbars">
      ${stats.map(s => `
        <div class="statbar">
          <span class="statbar__label">${esc(s.label)}</span>
          <span class="statbar__figure">${esc(s.figure)}${s.sub ? `<i>${esc(s.sub)}</i>` : ''}</span>
          <span class="statbar__track">
            <span class="statbar__fill" style="width:${Math.max(0, Math.min(100, s.pct)).toFixed(1)}%;background:${s.colour}"></span>
          </span>
        </div>`).join('')}
    </div>`;
}
