// Inline SVG glyphs (24x24, stroke-based) and the category colours shared by markers, rows and the legend.
const GL = {
  exit: 'M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4 M15 8l4 4-4 4 M19 12H9',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1 M17 5.5a2.6 2.6 0 0 1 0 5 M21 19v-1a4 4 0 0 0-3-3.8',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v10 M9.5 9.5h4a1.6 1.6 0 0 1 0 3.2h-3a1.6 1.6 0 0 0 0 3.2h4.2',
  lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  transit: 'M4 12h14 M12 6l6 6-6 6',
  quest: 'M12 5v8.5 M12 18v.6',
  spawn: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2.5v4 M12 17.5v4 M2.5 12h4 M17.5 12h4',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5z M3 8l9 5 9-5 M12 13v8',
  bag: 'M7 9h10l2 11H5z M9.5 9a2.5 2.5 0 0 1 5 0',
  shirt: 'M8.5 4L3 8l3 3 2-1.2V20h8V9.8L18 11l3-3-5.5-4a3.6 3.6 0 0 1-7 0z',
  drawer: 'M4 4h16v16H4z M4 12h16 M10 8h4 M10 16h4',
  safe: 'M4 4h16v16H4z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M7 20v1.5 M17 20v1.5',
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  skull: 'M12 3a7 7 0 0 0-4.5 12.4V19h9v-3.6A7 7 0 0 0 12 3z M9.5 11.2h.01 M14.5 11.2h.01 M10.5 19v2 M13.5 19v2',
  tool: 'M14.5 6.5a4 4 0 0 0 5 5L10 21l-3-3z M14 7l-3-3',
  monitor: 'M3 4h18v12H3z M8 20h8 M12 16v4',
  ammo: 'M10 3h4l1.2 5.5V21H8.8V8.5z M8.8 8.5h6.4',
  mound: 'M3 19h18 M5 19a7 7 0 0 1 14 0 M12 11V6 M9.5 8.5L12 6l2.5 2.5',
  register: 'M4 14h16v6H4z M6 14V8h12v6 M9 11h6',
  key: 'M14.5 9.5a4 4 0 1 1-1.7 3.3L4 21.5V18h3v-3h3l1.9-1.9 M16 9h.01',
  warn: 'M12 3.5L22 20H2z M12 10v5 M12 17.6v.4',
  bolt: 'M13 2L5 14h6l-1 8 8-12h-6z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
  crosshair: 'M12 3v5 M12 16v5 M3 12h5 M16 12h5',
};

function glyph(name, size = 14, sw = 2) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GL[name].split(' M').map((d, i) => `<path d="${i ? 'M' : ''}${d}"/>`).join('')}</svg>`;
}

// Extract kinds: colour + glyph + plain-language label
const KIND = {
  safe: { color: '#5fd38d', glyph: 'exit', label: 'Always open' },
  coop: { color: '#59aef2', glyph: 'people', label: 'Co-op exit' },
  paid: { color: '#f0c94a', glyph: 'coin', label: 'Costs something' },
  other: { color: '#f29b50', glyph: 'lock', label: 'Needs something' },
  transit: { color: '#b394f5', glyph: 'transit', label: 'Transit' },
  quest: { color: '#c58bf0', glyph: 'quest', label: 'Quest' },
  boss: { color: '#ff6b5e', glyph: 'skull', label: 'Boss spawn area' },
  lock: { color: '#f0a35a', glyph: 'key', label: 'Locked door' },
  hazard: { color: '#ff5a5a', glyph: 'warn', label: 'Danger zone' },
  power: { color: '#ffd84a', glyph: 'bolt', label: 'Power switch' },
  btr: { color: '#7ec8ff', glyph: 'transit', label: 'BTR stop' },
  spawn: { color: '#8fd0d6', glyph: 'spawn', label: 'Spawn point' },
};

// Loot containers: map each type name to a category colour and a glyph
const LOOT_CATS = [
  [/weapon|ammo|grenade/i, '#e5604f', 'ammo'],
  [/med/i, '#59aef2', 'cross'],
  [/safe|register/i, '#f5c542', 'safe'],
  [/dead|body|scav|pmc/i, '#b394f5', 'skull'],
  [/cache|buried|ground/i, '#6fcf7f', 'mound'],
  [/pc|computer|tool|technical/i, '#43c6d6', 'monitor'],
  [/jacket/i, '#f29b50', 'shirt'],
  [/duffle|bag/i, '#f29b50', 'bag'],
  [/drawer|cash/i, '#c4ccd0', 'drawer'],
];
function lootStyle(name) {
  for (const [re, color, g] of LOOT_CATS) if (re.test(name)) return { color, glyph: g };
  return { color: '#aab4b8', glyph: 'box' };
}

const badge = (color, g, size = 22) =>
  `<span class="badge" style="--c:${color};width:${size}px;height:${size}px">${glyph(g, Math.round(size * 0.58))}</span>`;
