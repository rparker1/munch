/* ==========================================================================
   Charts — hand-built SVG, no library. Three shapes:
     donut()    thick ring with rounded segment ends and callout bubbles
     bars()     rounded-cap columns on a track, tappable, with a tooltip
     statbars() label / big figure / thin progress, in a row of three
   Every one takes plain data and returns an HTML string.
   ========================================================================== */

import { esc } from './util.js';

/* --- donut -------------------------------------------------------------- */

const R = 74;          // ring radius within a 200×200 box
const W = 30;          // stroke width
const CIRC = 2 * Math.PI * R;

/**
 * @param {object}   o
 * @param {Array}    o.segments  [{ value, colour, label }] — biggest first reads best
 * @param {string}   o.total     the figure for the middle
 * @param {string}  [o.caption]  small line above the figure
 * @param {number}  [o.bubbles]  how many segments get a callout (default 3)
 */
export function donut({ segments, total, caption = 'Total', bubbles = 3 }) {
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

  let at = 0;                       // running fraction around the ring
  const arcs = [];
  const tags = [];

  for (const [i, s] of live.entries()) {
    const frac = s.value / sum;
    const len = frac * CIRC;
    // A round cap adds W/2 beyond each end, so a segment's painted length is
    // (drawn + W). Pulling the drawn length in by a full W makes the painted
    // span match its true share exactly and stops neighbours overlapping. Very
    // thin slices cannot satisfy that, so they keep a sliver and are clamped.
    const inset = live.length > 1 ? Math.min(W, Math.max(0, len - W * 0.18)) : 0;
    arcs.push(`
      <circle cx="100" cy="100" r="${R}" fill="none"
        stroke="${s.colour}" stroke-width="${W}" stroke-linecap="round"
        stroke-dasharray="${(len - inset).toFixed(2)} ${(CIRC - len + inset).toFixed(2)}"
        stroke-dashoffset="${(-at * CIRC - inset / 2).toFixed(2)}"/>`);

    if (i < bubbles && frac > 0.06) {
      // Bubble sits just outside the ring, at the middle of the segment.
      const mid = (at + frac / 2) * 2 * Math.PI - Math.PI / 2;
      const rr = R + W / 2 + 4;
      const x = 100 + Math.cos(mid) * rr;
      const y = 100 + Math.sin(mid) * rr;
      tags.push(`
        <span class="donut__tag" style="left:${(x / 2).toFixed(2)}%;top:${(y / 2).toFixed(2)}%">
          ${esc(s.label)}
        </span>`);
    }
    at += frac;
  }

  // No track behind the segments: they always sum to the whole, so a track only
  // shows through the gaps as a faint ghost ring.
  return `
    <div class="donut">
      <svg class="donut__svg" viewBox="0 0 200 200" aria-hidden="true">
        ${arcs.join('')}
      </svg>
      <div class="donut__mid">
        <span class="donut__cap">${esc(caption)}</span>
        <span class="donut__total">${esc(total)}</span>
      </div>
      ${tags.join('')}
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
 * @param {Array} stats [{ label, figure, pct, colour }]
 */
export function statbars(stats) {
  return `
    <div class="statbars">
      ${stats.map(s => `
        <div class="statbar">
          <span class="statbar__label">${esc(s.label)}</span>
          <span class="statbar__figure">${esc(s.figure)}</span>
          <span class="statbar__track">
            <span class="statbar__fill" style="width:${Math.max(0, Math.min(100, s.pct)).toFixed(1)}%;background:${s.colour}"></span>
          </span>
        </div>`).join('')}
    </div>`;
}
