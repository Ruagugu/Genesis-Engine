/* ============================================================
   创世引擎 · 图标库（描边 SVG，统一 24 视窗 / 1.6 线宽）
   用法：GE.icon('globe', 18)  →  svg 字符串
   ============================================================ */
window.GE = window.GE || {};

GE.icons = (function () {
  const P = (d) => `<path d="${d}"/>`;
  const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  const L = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const R = (x, y, w, h, rx) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx||0}"/>`;
  const PL = (pts) => `<polyline points="${pts}"/>`;
  const PG = (pts) => `<polygon points="${pts}"/>`;

  const set = {
    logo: `<circle cx="12" cy="12" r="8.2"/><ellipse cx="12" cy="12" rx="11" ry="4.2" transform="rotate(-24 12 12)"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>`,
    globe: `${C(12,12,9)}<path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"/>`,
    universe: `<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="9" ry="3.4"/><ellipse cx="12" cy="12" rx="9" ry="3.4" transform="rotate(64 12 12)"/>`,
    blackhole: `${C(12,12,3.1)}<path d="M12 5.5a6.5 6.5 0 1 0 6.5 6.5" /><path d="M12 2.6a9.4 9.4 0 1 0 9.4 9.4" opacity=".55"/>`,
    crown: `<path d="M3 17l1.4-8L9 13l3-8 3 8 4.6-4L21 17H3z"/><line x1="4" y1="20" x2="20" y2="20"/>`,
    flag: `<path d="M5 21V4"/><path d="M5 4.5c3-1.8 5 1.6 9 .2 2.5-.9 4-.7 5 0v8.6c-1-.7-2.5-.9-5 0-4 1.4-6-2-9-.2z"/>`,
    user: `${C(12,8,4)}<path d="M4.5 20.5c1.6-3.6 4.3-5 7.5-5s5.9 1.4 7.5 5"/>`,
    users: `${C(9,8.5,3.2)}<path d="M2.5 19.5c1.2-3 3.4-4.4 6.5-4.4s5.3 1.4 6.5 4.4"/><path d="M15.5 6.2a3.2 3.2 0 1 1 0 6.4M17.8 15.3c2 .5 3.2 1.8 3.9 4.2"/>`,
    sword: `<path d="M4 20l6.2-6.2M14.5 4.5l5 5-8.2 8.2-3.6 1.4 1.4-3.6 7.4-11z"/><path d="M13 7l4 4"/>`,
    shield: `<path d="M12 3l7 2.6v5.6c0 4.6-3 7.8-7 9.8-4-2-7-5.2-7-9.8V5.6L12 3z"/>`,
    coin: `${C(12,12,8.2)}<path d="M12 7.6v8.8M9 9.6c0-1 1.3-1.8 3-1.8s3 .8 3 1.8-1 1.6-3 2-3 1-3 2 1.3 1.8 3 1.8 3-.8 3-1.8"/>`,
    flask: `<path d="M9.5 3h5M10.5 3v5.2L5 17.5A2.4 2.4 0 0 0 7.2 21h9.6a2.4 2.4 0 0 0 2.2-3.5L13.5 8.2V3"/><line x1="7" y1="14.5" x2="17" y2="14.5"/>`,
    atom: `${C(12,12,1.4)}<ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(64 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-64 12 12)"/>`,
    scroll: `<path d="M7 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8"/><path d="M7 4a2 2 0 0 0-2 2v1h4"/><path d="M7 4v14a2 2 0 0 1-4 0v-3"/><line x1="11" y1="9" x2="16" y2="9"/><line x1="11" y1="13" x2="15" y2="13"/>`,
    compass: `${C(12,12,9)}<polygon points="15.5,8.5 13.6,13.6 8.5,15.5 10.4,10.4"/>`,
    gem: `<path d="M7 3h10l3.5 5L12 21 3.5 8 7 3z"/><path d="M3.5 8h17M9 8l3 13 3-13M7 3l2 5m8-5l-2 5"/>`,
    network: `${C(5,5,2.2)}${C(19,5,2.2)}${C(5,19,2.2)}${C(19,19,2.2)}${C(12,12,2.6)}<path d="M6.6 6.6l3.2 3.2M17.4 6.6l-3.2 3.2M6.6 17.4l3.2-3.2M17.4 17.4l-3.2-3.2"/>`,
    history: `<path d="M4 12a8 8 0 1 1 2.3 5.6"/><polyline points="4,13 4,17.5 8.5,17.5"/><polyline points="12,8 12,12 15,14"/>`,
    star: `<polygon points="12,3 14.6,8.9 21,9.6 16.3,13.9 17.7,20.2 12,16.9 6.3,20.2 7.7,13.9 3,9.6 9.4,8.9"/>`,
    bookmark: `<path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z"/>`,
    dna: `<path d="M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9M8.5 6.5h7M8.5 17.5h7M10 12h4"/>`,
    sparkle: `<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>`,
    gate: `<path d="M5 21V8a7 7 0 0 1 14 0v13"/><path d="M9 21v-9a3 3 0 0 1 6 0v9"/><line x1="3" y1="21" x2="21" y2="21"/>`,
    chip: `${R(6,6,12,12,2)}${R(10,10,4,4,1)}<path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>`,
    brain: `<path d="M9.5 3.5A2.8 2.8 0 0 0 6.7 7 3.2 3.2 0 0 0 4 10.2c0 1 .4 1.9 1.1 2.5A3.4 3.4 0 0 0 7.5 19a3 3 0 0 0 4.5 1V6a2.9 2.9 0 0 0-2.5-2.5z"/><path d="M14.5 3.5A2.8 2.8 0 0 1 17.3 7a3.2 3.2 0 0 1 2.7 3.2c0 1-.4 1.9-1.1 2.5A3.4 3.4 0 0 1 16.5 19a3 3 0 0 1-4.5 1"/>`,
    bell: `<path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>`,
    gear: `${C(12,12,3.2)}<path d="M12 2.5l1 2.4 2.6-.6 1 2.4 2.6.6-.3 2.6 2 1.7-2 1.7.3 2.6-2.6.6-1 2.4-2.6-.6-1 2.4-1-2.4-2.6.6-1-2.4-2.6-.6.3-2.6-2-1.7 2-1.7-.3-2.6 2.6-.6 1-2.4 2.6.6z"/>`,
    x: `<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>`,
    plus: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
    minus: `<line x1="5" y1="12" x2="19" y2="12"/>`,
    search: `${C(11,11,7)}<line x1="16.5" y1="16.5" x2="21" y2="21"/>`,
    chevD: `<polyline points="6,9 12,15 18,9"/>`,
    chevU: `<polyline points="6,15 12,9 18,15"/>`,
    chevR: `<polyline points="9,6 15,12 9,18"/>`,
    chevL: `<polyline points="15,6 9,12 15,18"/>`,
    play: `<polygon points="7,4.5 19.5,12 7,19.5"/>`,
    pause: `<line x1="8" y1="4.5" x2="8" y2="19.5"/><line x1="16" y1="4.5" x2="16" y2="19.5"/>`,
    ff: `<polygon points="4,5 12.5,12 4,19"/><polygon points="12.5,5 20,12 12.5,19"/>`,
    layers: `<polygon points="12,3 21,8 12,13 3,8"/><polyline points="3,12.5 12,17.5 21,12.5"/><polyline points="3,17 12,22 21,17"/>`,
    grid: `${R(3.5,3.5,7,7,1.4)}${R(13.5,3.5,7,7,1.4)}${R(3.5,13.5,7,7,1.4)}${R(13.5,13.5,7,7,1.4)}`,
    satellite: `<path d="M13 7l4-4 4 4-4 4-4-4z"/><path d="M9 11l-4 4 4 4 4-4-4-4z"/><path d="M11.5 8.5l4 4M16 4l-2.5 2.5M8 20l2.5-2.5"/><path d="M4.5 4.5c2 2 2 5 0 7M19.5 12.5c2 2 2 5 0 7" opacity=".7"/>`,
    orbit: `${C(12,12,2.4)}<ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-28 12 12)"/><circle cx="19" cy="7.5" r="1.4" fill="currentColor" stroke="none"/>`,
    station: `<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="7.5" opacity=".6"/>`,
    ship: `<path d="M12 3c2.5 2.5 4 6 4 9l3 3-3 1c-1 2-2.5 4-4 5-1.5-1-3-3-4-5l-3-1 3-3c0-3 1.5-6.5 4-9z"/><circle cx="12" cy="10" r="1.6"/>`,
    moon: `<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5z"/>`,
    sun: `${C(12,12,4)}<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4L19 19M19 5l-1.6 1.6M6.6 17.4L5 19"/>`,
    mountain: `<path d="M3 19l6-11 4 7 3-4 5 8H3z"/><circle cx="17.5" cy="6" r="1.8"/>`,
    tree: `<path d="M12 3l4.5 6h-2.8L18 14h-3.2L19 19H5l4.2-5H6l4.3-5H7.5L12 3z"/><line x1="12" y1="19" x2="12" y2="21.5"/>`,
    water: `<path d="M12 3.5S6 10 6 14a6 6 0 0 0 12 0c0-4-6-10.5-6-10.5z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>`,
    desert: `<path d="M3 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 21c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><circle cx="12" cy="7" r="3"/>`,
    snow: `<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M12 3l-2 2m2-2l2 2M12 21l-2-2m2 2l2-2"/>`,
    volcano: `<path d="M8 9L4 20h16L16 9c-1.5 1.2-2.5-1-4-1s-2.5 2.2-4 1z"/><path d="M11 5c0-1.5 2-1.5 2 0" opacity=".8"/>`,
    male: `${C(10,14,5.5)}<line x1="14" y1="10" x2="20" y2="4"/><polyline points="14.5,4 20,4 20,9.5"/>`,
    female: `${C(12,9,5.5)}<line x1="12" y1="14.5" x2="12" y2="21"/><line x1="8.5" y1="18" x2="15.5" y2="18"/>`,
    heart: `<path d="M12 20.5S4 15.5 4 9.8A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8 2.8c0 5.7-8 10.7-8 10.7z"/>`,
    hourglass: `<path d="M6 3h12M6 21h12M8 3c0 5 8 5 8 9s-8 4-8 9"/><path d="M16 3c0 5-8 5-8 9s8 4 8 9"/>`,
    eye: `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>${C(12,12,3)}`,
    filter: `<polygon points="3,4.5 21,4.5 14,12.5 14,19.5 10,17.5 10,12.5"/>`,
    calendar: `${R(3.5,5,17,16,2)}<line x1="3.5" y1="10" x2="20.5" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>`,
    bolt: `<polygon points="13,2.5 4.5,13.5 11,13.5 10,21.5 19.5,10 13,10"/>`,
    balance: `<line x1="12" y1="3" x2="12" y2="21"/><line x1="5" y1="21" x2="19" y2="21"/><path d="M12 6l-6 1.5M12 6l6 1.5"/><path d="M3 12.5L6 7l3 5.5a3 3 0 0 1-6 0zM15 12.5L18 7l3 5.5a3 3 0 0 1-6 0z"/>`,
    arrowR: `<line x1="4" y1="12" x2="20" y2="12"/><polyline points="13,5 20,12 13,19"/>`,
    arrowUR: `<line x1="6" y1="18" x2="18" y2="6"/><polyline points="7,6 18,6 18,17"/>`,
    dot: `${C(12,12,4)}`,
    signal: `<path d="M4 16.5a10.5 10.5 0 0 1 16 0M7 13a6.5 6.5 0 0 1 10 0" opacity=".8"/><circle cx="12" cy="17.5" r="1.6" fill="currentColor" stroke="none"/>`,
    radar: `${C(12,12,1.4)}<path d="M12 12L18 6"/><path d="M12 4a8 8 0 1 0 8 8M12 7.5a4.5 4.5 0 1 0 4.5 4.5" opacity=".8"/>`,
    send: `<path d="M21 3.5L3 10.8l7 2.2 2.2 7L21 3.5z"/><line x1="10" y1="13" x2="21" y2="3.5"/>`,
    message: `<path d="M20 13.5a2 2 0 0 1-2 2H8l-4.5 4v-13a2 2 0 0 1 2-2H18a2 2 0 0 1 2 2v5z"/>`,
    max: `<polyline points="9,4 4,4 4,9"/><polyline points="15,4 20,4 20,9"/><polyline points="9,20 4,20 4,15"/><polyline points="15,20 20,20 20,15"/>`,
    refresh: `<polyline points="21,5 21,11 15,11"/><path d="M20.5 11a8.5 8.5 0 1 0-1 4.5"/>`,
    download: `<path d="M12 3.5v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 17.5v2a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-2"/>`,
    warn: `<path d="M12 3.5L22 20H2L12 3.5z"/><line x1="12" y1="9.5" x2="12" y2="14"/><circle cx="12" cy="16.8" r=".4" fill="currentColor"/>`,
    info: `${C(12,12,9)}<line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.8" r=".4" fill="currentColor"/>`,
    check: `<polyline points="4.5,12.5 9.5,17.5 19.5,6.5"/>`,
    checkC: `${C(12,12,9)}<polyline points="8,12.2 11,15.2 16.5,9"/>`,
    skull: `<path d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 3 1.7 4.8 3 5.7V19a1.5 1.5 0 0 0 1.5 1.5h6A1.5 1.5 0 0 0 16.5 19v-2.8c1.3-.9 3-2.7 3-5.7A7.5 7.5 0 0 0 12 3z"/>${C(9,11,1.2)}${C(15,11,1.2)}`,
    book: `<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17.5H6.5A2.5 2.5 0 0 0 4 22V4.5z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>`,
    target: `${C(12,12,8.5)}${C(12,12,5)}${C(12,12,1.6)}`,
    link: `<path d="M9.5 14.5l5-5"/><path d="M11 6.5l2-2a4 4 0 0 1 5.5 5.5l-2 2M13 17.5l-2 2A4 4 0 0 1 5.5 14l2-2"/>`,
    hex: `<polygon points="12,2.5 20.2,7.25 20.2,16.75 12,21.5 3.8,16.75 3.8,7.25"/>`,
    pulses: `<polyline points="3,12 7.5,12 10,5.5 13.5,18.5 16,12 21,12"/>`,
    hand: `<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5v-1a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a6.5 6.5 0 0 1-6.5 6.5h-1c-2.5 0-4-1-5.5-3L4 14c-1-1.5.5-3 2-2l2 1.5"/>`
  };

  function icon(name, size, cls) {
    const body = set[name] || set.dot;
    const s = size || 18;
    return `<svg class="ic ${cls||''}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }
  function has(name){ return !!set[name]; }
  return { icon, has, set };
})();
