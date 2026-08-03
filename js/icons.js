/* Inline SVG icon set — single stroke weight, 24×24 box, no emoji. */

const P = {
  home:     '<path d="M4 11.2 12 4l8 7.2"/><path d="M6 10v9.2a.8.8 0 0 0 .8.8h10.4a.8.8 0 0 0 .8-.8V10"/><path d="M10 21v-5.2h4V21"/>',
  fridge:   '<rect x="5" y="2.8" width="14" height="18.4" rx="2.6"/><path d="M5 10.4h14"/><path d="M8.6 6.2v1.8"/><path d="M8.6 13.4v2.4"/>',
  plan:     '<rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.8"/><path d="M3.4 10h17.2"/><path d="M8.2 3v3.4M15.8 3v3.4"/><path d="M8 14h3M8 17.4h6.4"/>',
  cart:     '<path d="M2.8 4h2.1l2.6 10.6a1.6 1.6 0 0 0 1.55 1.2h8.1a1.6 1.6 0 0 0 1.55-1.2L20.3 8H6"/><circle cx="9.6" cy="20" r="1.3"/><circle cx="17.4" cy="20" r="1.3"/>',
  sun:      '<circle cx="12" cy="12" r="3.9"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/>',
  noon:     '<circle cx="12" cy="12.6" r="4"/><path d="M2.8 18.4h18.4"/><path d="M12 4v2.2M5.2 7.6l1.5 1.5M18.8 7.6l-1.5 1.5"/>',
  moon:     '<path d="M20 14.4A8.2 8.2 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4Z"/>',
  plus:     '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  check:    '<path d="M4.8 12.6 9.6 17.4 19.2 6.8"/>',
  chevron:  '<path d="M9 5.5 15.5 12 9 18.5"/>',
  search:   '<circle cx="10.8" cy="10.8" r="6.6"/><path d="M15.8 15.8 20.4 20.4"/>',
  x:        '<path d="M6 6l12 12M18 6L6 18"/>',
  trash:    '<path d="M4 7.2h16"/><path d="M9.4 7.2V4.8h5.2v2.4"/><path d="M6.2 7.2l.9 12.2a1.4 1.4 0 0 0 1.4 1.3h7a1.4 1.4 0 0 0 1.4-1.3l.9-12.2"/><path d="M10.4 11v6M13.6 11v6"/>',
  clock:    '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2.2"/>',
  alert:    '<path d="M12 3.6 21 19.4H3L12 3.6Z"/><path d="M12 9.6v4.2"/><path d="M12 16.8h.01" stroke-width="2.4"/>',
  info:     '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4"/><path d="M12 7.8h.01" stroke-width="2.4"/>',
  leaf:     '<path d="M5 19c-1.8-6.6 2.2-13.4 14.6-14.6C21 16.4 13.6 21 5 19Z"/><path d="M4.4 20.4C7.6 14 11.6 10.6 16.4 8.6"/>',
  pot:      '<path d="M4.4 9.6h15.2v4.2a5.6 5.6 0 0 1-5.6 5.6h-4a5.6 5.6 0 0 1-5.6-5.6V9.6Z"/><path d="M19.6 11.2h2.2M4.4 11.2H2.2"/><path d="M9 6.4c0-1 1.2-1.4 1.2-2.6M14 6.4c0-1 1.2-1.4 1.2-2.6"/>',
  bag:      '<path d="M5.4 8h13.2l1 12.2a.9.9 0 0 1-.9 1H5.3a.9.9 0 0 1-.9-1L5.4 8Z"/><path d="M8.8 10.4V6.6a3.2 3.2 0 0 1 6.4 0v3.8"/>',
  briefcase:'<rect x="3" y="7.4" width="18" height="12.8" rx="2.4"/><path d="M8.8 7.4V5.6a1.8 1.8 0 0 1 1.8-1.8h2.8a1.8 1.8 0 0 1 1.8 1.8v1.8"/><path d="M3 12.6h18"/>',
  cog:      '<path d="M4 7.4h8.2M17.4 7.4H20"/><circle cx="14.8" cy="7.4" r="2.5"/><path d="M4 16.6h2.6M11.8 16.6H20"/><circle cx="9.2" cy="16.6" r="2.5"/>',
  pencil:   '<path d="M4.4 19.6l.95-4.05L15.9 5.1a2 2 0 0 1 2.83 0l.17.17a2 2 0 0 1 0 2.83L8.45 18.65 4.4 19.6Z"/><path d="M14.3 6.9l2.8 2.8"/>',
  undo:     '<path d="M4 9.6h9.2a5.6 5.6 0 1 1 0 11.2H8"/><path d="M7.6 5.6 3.6 9.6l4 4"/>',
  spark:    '<path d="M12 3.2l1.9 5.3 5.3 1.9-5.3 1.9L12 17.6l-1.9-5.3-5.3-1.9 5.3-1.9L12 3.2Z"/><path d="M18.6 16.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"/>',
  flame:    '<path d="M12 21c3.9 0 6.4-2.5 6.4-6 0-4.6-4.4-6.2-4-11.4C10.6 4.8 9 8.4 9.6 11.4 8 10.6 7.4 9 7.4 9c-1 1.4-1.8 3.4-1.8 6 0 3.5 2.5 6 6.4 6Z"/>',
  copy:     '<rect x="8.6" y="8.6" width="11.4" height="11.4" rx="2.2"/><path d="M15.4 5.6a2.2 2.2 0 0 0-2.2-1.6H6.2A2.2 2.2 0 0 0 4 6.2v7a2.2 2.2 0 0 0 1.6 2.2"/>',
  pin:      '<path d="M12 21.4s6.4-6 6.4-11a6.4 6.4 0 1 0-12.8 0c0 5 6.4 11 6.4 11Z"/><circle cx="12" cy="10.4" r="2.4"/>',
  share:    '<path d="M12 15.4V3.6"/><path d="M8 7.4 12 3.4l4 4"/><path d="M5.4 13v6.4a1.6 1.6 0 0 0 1.6 1.6h10a1.6 1.6 0 0 0 1.6-1.6V13"/>',
  refresh:  '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.4 3.6v4.6h-4.6"/>',
  minus:    '<path d="M5.2 12h13.6"/>',
  box:      '<path d="M20.4 8.4 12 4 3.6 8.4v7.2L12 20l8.4-4.4V8.4Z"/><path d="M3.6 8.4 12 12.8l8.4-4.4M12 12.8V20"/>',
};

/** Inline an icon. `cls` lands on the <svg>. */
export function icon(name, cls = '') {
  const body = P[name] || P.box;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${body}</svg>`;
}
