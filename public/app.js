// Tarkov map: Leaflet view using tarkov.dev's projection (rotate by coordinateRotation, then affine).
const $ = (id) => document.getElementById(id);

let DATA, SAFE, AMMO = [], map, cur, faction = 'pmc', tab = 'ex';
const intelState = { boss: true, hazMine: true, hazSniper: false, hazOther: true, power: false, btr: true, allLocks: false, locks: new Set() };
const ammoState = { cal: '', sort: 'pen', q: '' };
let timer = null; // { start: ms }
const state = { svgGroups: {}, playerMarker: null, route: null, ring: null, target: null, planFrom: null, lootTypes: new Set(), loose: false, allQuests: false };
let you = null; // last screenshot position
let G = {}; // leaflet layer groups

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
let notes = store.get('eft-notes', {});
let tracked = store.get('eft-quests', {});

const ll = (x, z) => L.latLng(z, x); // game (x, z) -> lat=z, lng=x
const hasYou = () => you && !you.none && !you.error;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pretty = (s) => { const t = String(s).replace(/-/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

function makeCrs(cfg) {
  const [sx, ox, sy, oy] = cfg.transform;
  const th = (cfg.rotation * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  return L.extend({}, L.CRS.Simple, {
    projection: {
      bounds: L.bounds([-1e9, -1e9], [1e9, 1e9]),
      project: (p) => L.point(p.lng * c - p.lat * s, p.lng * s + p.lat * c),
      unproject: (q) => L.latLng(-q.x * s + q.y * c, q.x * c + q.y * s),
    },
    transformation: new L.Transformation(sx, ox, -sy, oy),
  });
}

/* ---------- extracts ---------- */
function safeInfo(m, e) {
  const list = SAFE[m.slug]?.[faction];
  if (!list || !list.includes(e.name)) return null;
  if (e.faction !== faction && e.faction !== 'shared') return null;
  return { note: SAFE.notes[`${m.slug}|${e.name}`] || '' };
}
function classify(m, e) {
  const si = safeInfo(m, e);
  if (si) return { kind: 'safe', note: si.note || 'Walk in, nothing needed' };
  if (e.faction === 'shared') return { kind: 'coop', note: 'Needs a PMC and a Scav together' };
  if (e.paid) return { kind: 'paid', note: 'Costs an item or money' };
  return { kind: 'other', note: 'Flare, key, switch or timer - check before you go' };
}
const visibleExtracts = (m) => m.extracts.filter((e) => e.faction === faction || e.faction === 'shared');
const noteKey = (e) => `${cur.slug}|${e.name}`;

/* ---------- geometry helpers ---------- */
function origin() {
  if (state.planFrom) return state.planFrom;
  return hasYou() ? { x: you.x, z: you.z, you: true } : null;
}
function yawFromQuat(q) {
  // Yaw from the screenshot quaternion. The filename values are read in order as x, z, y, w (Unity axis order).
  const [x, z, y, w] = q;
  return (Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 180) / Math.PI;
}
function arrowRotation() {
  let r = yawFromQuat(you.q) + cur.config.rotation;
  if (cur.config.rotation === 90 || cur.config.rotation === 270) r += 180;
  return r;
}
function screenBearing(o, t) {
  const p = map.project(ll(o.x, o.z), 3), q = map.project(ll(t.x, t.z), 3);
  return (Math.atan2(q.x - p.x, -(q.y - p.y)) * 180) / Math.PI; // clockwise from screen-up
}
function bearingWord(rel) {
  const a = Math.abs(rel), side = rel > 0 ? 'right' : 'left';
  if (a < 22) return 'straight ahead';
  if (a < 67) return 'ahead ' + side;
  if (a < 112) return side;
  if (a < 157) return 'behind ' + side;
  return 'behind you';
}
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
function where(o, t) {
  if (!o || !map) return { m: '', dir: '' };
  const dist = Math.hypot(t.x - o.x, t.z - o.z);
  const b = screenBearing(o, t);
  if (o.you) {
    let rel = b - arrowRotation();
    rel = ((((rel + 180) % 360) + 360) % 360) - 180;
    return { m: `${dist.toFixed(0)} m`, dir: bearingWord(rel) };
  }
  return { m: `${dist.toFixed(0)} m`, dir: ARROWS[Math.round((((b % 360) + 360) % 360) / 45) % 8] + ' on map' };
}

/* ---------- marker builders ---------- */
function markerIcon(kind, size, cls = '') {
  const k = KIND[kind];
  return L.divIcon({
    className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    html: `<div class="mk ${cls}" style="--c:${k.color};width:${size}px;height:${size}px">${glyph(k.glyph, Math.round(size * 0.58), kind === 'quest' ? 2.6 : 2)}</div>`,
  });
}
const tip = (name, sub, extra = '') => `<b>${esc(name)}</b><span class="k">${esc(sub)}${extra ? ' - ' + esc(extra) : ''}</span>`;

/* ---------- map loading ---------- */
async function loadMap(slug) {
  cur = DATA.maps.find((m) => m.slug === slug);
  const cfg = cur.config;
  if (map) map.remove();
  map = L.map('map', { crs: makeCrs(cfg), minZoom: cfg.minZoom - 1, maxZoom: cfg.maxZoom, zoomSnap: 0.25, attributionControl: false, preferCanvas: true });
  state.svgGroups = {}; state.playerMarker = null; state.route = null; state.ring = null; state.target = null; state.planFrom = null;
  state.lootTypes = new Set(); state.loose = false;
  intelState.locks = new Set(); intelState.allLocks = false;
  G = { ex: L.layerGroup().addTo(map), quest: L.layerGroup().addTo(map), intel: L.layerGroup().addTo(map), loot: L.layerGroup().addTo(map), you: L.layerGroup().addTo(map) };

  const b = cfg.svgBounds || cfg.bounds;
  const bounds = L.latLngBounds(ll(b[0][0], b[0][1]), ll(b[1][0], b[1][1]));
  if (cfg.svgFile) {
    const txt = await (await fetch('/data/svg/' + cfg.svgFile)).text();
    const svg = new DOMParser().parseFromString(txt, 'image/svg+xml').documentElement;
    for (const g of svg.querySelectorAll(':scope > g[id]')) {
      state.svgGroups[g.id] = g;
      g.style.display = !cfg.svgLayer || g.id === cfg.svgLayer ? '' : 'none';
    }
    L.svgOverlay(svg, bounds).addTo(map);
  } else if (cfg.tilePath) {
    L.tileLayer(cfg.tilePath, { minZoom: cfg.minZoom, maxZoom: cfg.maxZoom, noWrap: true, bounds }).addTo(map);
  }
  map.fitBounds(bounds);
  map.on('zoom', updateScale);
  updateScale();
  buildFloors();
  drawMarkers();
  drawQuests();
  drawLoot();
  drawIntel();
  drawYou();
  updateRoute();
  renderSummary();
  renderTimer(true);
  renderYou();
  renderTabs();
  renderList();
}

function updateScale() {
  const ppm = cur.config.transform[0] * Math.pow(2, map.getZoom()); // css px per game metre
  const steps = [5, 10, 25, 50, 100, 200, 250, 500, 1000];
  const m = steps.find((s) => s * ppm >= 70) ?? steps[steps.length - 1];
  $('scale').innerHTML = `${m} m<i style="width:${Math.round(m * ppm)}px"></i>`;
}

function buildFloors() {
  const box = $('floors');
  box.innerHTML = '';
  for (const layer of cur.config.layers) {
    if (!state.svgGroups[layer.svgLayer]) continue;
    const lab = document.createElement('label');
    lab.className = 'chk';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!layer.show;
    cb.onchange = () => (state.svgGroups[layer.svgLayer].style.display = cb.checked ? '' : 'none');
    cb.dataset.layer = layer.svgLayer;
    state.svgGroups[layer.svgLayer].style.display = cb.checked ? '' : 'none';
    lab.append(cb, layer.name);
    box.append(lab);
  }
}

function setTarget(t) {
  state.target = t;
  updateRoute();
  renderYou();
  renderList();
}

function drawMarkers() {
  G.ex.clearLayers();
  for (const e of visibleExtracts(cur)) {
    const c = classify(cur, e);
    const safe = c.kind === 'safe';
    const n = notes[noteKey(e)];
    const mk = L.marker(ll(e.x, e.z), { icon: markerIcon(c.kind, safe ? 28 : 22, safe ? 'safe' : ''), zIndexOffset: safe ? 500 : 0 }).addTo(G.ex);
    mk.bindTooltip(safe ? `<b>${esc(e.name)}</b>` : tip(e.name, KIND[c.kind].label, n), safe ? { permanent: true, direction: 'right', className: 'tip flag', offset: [14, 0] } : { direction: 'top', className: 'tip', offset: [0, -10] });
    mk.on('click', () => setTarget({ name: e.name, x: e.x, z: e.z }));
  }
  if ($('cTransit').checked) {
    for (const t of cur.transits) {
      L.marker(ll(t.x, t.z), { icon: markerIcon('transit', 24, 'hex') }).addTo(G.ex)
        .bindTooltip(tip(t.name, 'Transit', 'opens about a minute into the raid'), { direction: 'top', className: 'tip', offset: [0, -10] })
        .on('click', () => setTarget({ name: t.name, x: t.x, z: t.z }));
    }
  }
  if ($('cSpawn').checked) {
    const col = KIND.spawn.color;
    for (const s of cur.spawns.filter((s) => s.sides?.includes(faction))) {
      L.circleMarker(ll(s.x, s.z), { radius: 5, color: col, weight: 2, fillColor: '#0f1519', fillOpacity: 1 }).addTo(G.ex)
        .bindTooltip(tip('Spawn point', 'Click to plan a route from here'), { className: 'tip' })
        .on('click', () => { state.planFrom = { x: s.x, z: s.z, label: 'a spawn point' }; updateRoute(); renderYou(); renderList(); });
    }
  }
}

/* ---------- quests ---------- */
const questVisible = (q) => state.allQuests || tracked[q.id];
function drawQuests() {
  G.quest.clearLayers();
  const col = KIND.quest.color;
  for (const q of cur.quests) {
    if (!questVisible(q)) continue;
    for (const o of q.objs) {
      for (const poly of o.zones) L.polygon(poly.map(([x, z]) => ll(x, z)), { color: col, weight: 1.5, dashArray: '5 4', fillColor: col, fillOpacity: 0.14 }).addTo(G.quest);
      for (const p of o.pts) {
        L.marker(ll(p[0], p[2]), { icon: markerIcon('quest', 20, 'sq') }).addTo(G.quest)
          .bindTooltip(tip(q.name, o.text), { className: 'tip', direction: 'top', offset: [0, -8] });
      }
    }
  }
}

/* ---------- loot ---------- */
function drawLoot() {
  G.loot.clearLayers();
  const { types, containers, loose } = cur.loot;
  const rend = L.canvas({ padding: 0.5 });
  const styles = types.map(lootStyle);
  for (const [ti, x, , z] of containers) {
    if (!state.lootTypes.has(types[ti])) continue;
    L.circleMarker(ll(x, z), { renderer: rend, radius: 4.5, weight: 1.5, color: '#0b0f12', fillColor: styles[ti].color, fillOpacity: 0.95 })
      .bindTooltip(tip(pretty(types[ti]), 'Loot container spot'), { className: 'tip' }).addTo(G.loot);
  }
  if (state.loose) {
    for (const [x, , z, n] of loose) {
      L.circleMarker(ll(x, z), { renderer: rend, radius: 3.5, weight: 1.5, color: '#0b0f12', fillColor: '#ffe27a', fillOpacity: 0.95 })
        .bindTooltip(tip('Loose loot spot', `${n} possible items`), { className: 'tip' }).addTo(G.loot);
    }
  }
}

/* ---------- player ---------- */
function youIcon(rot) {
  return L.divIcon({
    className: '', iconSize: [64, 64], iconAnchor: [32, 32],
    html: `<div class="you-wrap"><svg width="64" height="64" viewBox="0 0 64 64" style="transform:rotate(${rot}deg)">
      <defs><linearGradient id="fov" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff4d79" stop-opacity=".5"/><stop offset="1" stop-color="#ff4d79" stop-opacity="0"/></linearGradient></defs>
      <path d="M32 32 L9 3 A38 38 0 0 1 55 3 Z" fill="url(#fov)"/>
      <circle class="pulse-you" cx="32" cy="32" r="11" fill="none" stroke="#ff4d79" stroke-width="2"/>
      <path d="M32 19 L42 42 L32 36.5 L22 42 Z" fill="#ff4d79" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>`,
  });
}

function drawYou() {
  if (!hasYou() || !map) return;
  const icon = youIcon(arrowRotation());
  if (state.playerMarker) state.playerMarker.setIcon(icon).setLatLng(ll(you.x, you.z));
  else state.playerMarker = L.marker(ll(you.x, you.z), { icon, zIndexOffset: 2000, interactive: false }).addTo(G.you);

  for (const layer of cur.config.layers) {
    const cb = document.querySelector(`#floors input[data-layer="${layer.svgLayer}"]`);
    if (!cb || !layer.extents?.some((e) => e.height)) continue;
    const inRect = (r) => you.x >= Math.min(r[0][0], r[1][0]) && you.x <= Math.max(r[0][0], r[1][0]) && you.z >= Math.min(r[0][1], r[1][1]) && you.z <= Math.max(r[0][1], r[1][1]);
    const here = layer.extents.some((e) => e.height && you.y >= e.height[0] && you.y <= e.height[1] && (!e.bounds || e.bounds.some(inRect)));
    cb.checked = here;
    state.svgGroups[layer.svgLayer].style.display = here ? '' : 'none';
  }
}

function updateRoute() {
  if (state.route) { state.route.remove(); state.route = null; }
  if (state.ring) { state.ring.remove(); state.ring = null; }
  const o = origin();
  if (state.target && map) {
    state.ring = L.marker(ll(state.target.x, state.target.z), { interactive: false, icon: L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22], html: '<div class="ring" style="width:44px;height:44px"></div>' }) }).addTo(G.you);
    if (o) state.route = L.polyline([ll(o.x, o.z), ll(state.target.x, state.target.z)], { color: '#fff', weight: 2.5, dashArray: '2 8', lineCap: 'round', opacity: 0.9 }).addTo(G.you);
  }
}

function nearestSpawn() {
  if (!hasYou()) return null;
  let best = null;
  for (const s of cur.spawns.filter((s) => s.sides?.includes(faction))) {
    const d = Math.hypot(s.x - you.x, s.z - you.z);
    if (!best || d < best.d) best = { d, s };
  }
  return best;
}

/* ---------- header + legend ---------- */
function renderSummary() {
  const ex = visibleExtracts(cur);
  const safe = ex.filter((e) => classify(cur, e).kind === 'safe').length;
  const q = cur.quests.length;
  $('summary').innerHTML = ex.length
    ? `<b>${safe} always-open</b> of ${ex.length} exits for ${faction === 'pmc' ? 'PMCs' : 'Scavs'}, ${q} quest${q === 1 ? '' : 's'} here`
    : 'No extract data for this map yet';
}

function renderTabs() {
  const nSafe = visibleExtracts(cur).length;
  $('tabEx').textContent = 'Exits';
  $('tabQ').textContent = 'Quests';
  $('tabI').textContent = 'Intel';
  $('tabA').textContent = 'Ammo';
  $('tabM').textContent = 'Items';
  $('tabH').textContent = 'Hideout';
  $('tabN').textContent = 'Stash';
  $('tabL').textContent = 'Loot';
}

function renderLegend() {
  const items = [['safe', 'Always open'], ['coop', 'Co-op exit'], ['paid', 'Costs something'], ['other', 'Needs something'], ['transit', 'Transit'], ['quest', 'Quest objective'], ['spawn', 'Spawn point'], ['boss', 'Boss spawn area'], ['lock', 'Locked door'], ['hazard', 'Danger zone'], ['power', 'Power switch']];
  $('legendList').innerHTML = items.map(([k, label]) => `<li>${badge(KIND[k].color, KIND[k].glyph, 20)}${label}</li>`).join('')
    + `<li><span class="badge" style="--c:var(--you);width:20px;height:20px"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 3l6 15-6-3.5L6 18z" fill="currentColor"/></svg></span>You (last screenshot)</li>`;
}

function renderYou() {
  const el = $('you');
  let html = '';
  if (!hasYou()) {
    html = you?.error
      ? `<b>Where am I:</b> ${esc(you.error)}`
      : `<b>Where am I:</b> press your Make screenshot key in raid. Only the filename is read, then the file is deleted.<span class="hint">Watching ${esc(you?.folder || '')}</span>`;
  } else {
    const inBounds = DATA.maps.filter((m) => {
      const [[x1, z1], [x2, z2]] = m.config.bounds;
      return you.x >= Math.min(x1, x2) && you.x <= Math.max(x1, x2) && you.z >= Math.min(z1, z2) && you.z <= Math.max(z1, z2);
    });
    const age = Math.round((Date.now() - you.mtime) / 1000);
    const ageTxt = age < 90 ? `${age}s ago` : `${Math.round(age / 60)} min ago`;
    const hint = inBounds.length && !inBounds.some((m) => m.slug === cur.slug)
      ? `<span class="hint">That fix fits ${inBounds.map((m) => m.name).join(' or ')}. You are viewing ${cur.name}.</span>` : '';
    const sp = nearestSpawn();
    const spawnTxt = sp ? `<span class="hint">${sp.d < 40 ? `On a ${faction.toUpperCase()} spawn point (${sp.d.toFixed(0)} m)` : `Nearest ${faction.toUpperCase()} spawn point is ${sp.d.toFixed(0)} m away`}</span>` : '';
    html = `<div class="pos"><span class="live ${age > 90 ? 'old' : ''}"></span><span><span class="num">x ${you.x.toFixed(0)}  z ${you.z.toFixed(0)}  height ${you.y.toFixed(0)}</span><br>Last fix ${ageTxt}</span>
      <button id="goYou" class="sm" style="margin-left:auto">Centre</button></div>${hint}${spawnTxt}`;
  }
  const o = origin();
  if (state.planFrom) html += `<div id="route"><span class="t">Planning from <b>${esc(state.planFrom.label)}</b></span><button id="clrPlan" class="sm">Back to me</button></div>`;
  if (state.target) {
    const w = o ? where(o, state.target) : null;
    html += `<div id="route"><span class="t">${glyph('transit', 14)} <b>${esc(state.target.name)}</b>${w ? ` <span class="go">${w.m}, ${w.dir}</span>` : ''}<br><span class="s">${w ? 'Straight line, not a walking route' : 'Take a screenshot in raid to get a route'}</span></span><button id="clrTgt" class="sm">Clear</button></div>`;
  }
  el.innerHTML = html;
  if ($('goYou')) $('goYou').onclick = () => map.flyTo(ll(you.x, you.z), Math.max(map.getZoom(), cur.config.minZoom + 2));
  if ($('clrPlan')) $('clrPlan').onclick = () => { state.planFrom = null; updateRoute(); renderYou(); renderList(); };
  if ($('clrTgt')) $('clrTgt').onclick = () => setTarget(null);
}

/* ---------- sidebar tabs ---------- */
function renderList() {
  if (tab === 'ex') renderExtracts();
  else if (tab === 'q') renderQuests();
  else if (tab === 'i') renderIntelTab();
  else if (tab === 'a') renderAmmoTab();
  else if (tab === 'm') renderItemsTab();
  else if (tab === 'h') renderHideoutTab();
  else if (tab === 'n') renderInventoryTab();
  else renderLootTab();
}

function renderExtracts() {
  const list = $('list');
  const keepScroll = list.scrollTop;
  list.innerHTML = '';
  const o = origin();
  const items = visibleExtracts(cur).map((e) => ({ e, c: classify(cur, e) }));
  const dist = (e) => Math.hypot(e.x - o.x, e.z - o.z);
  const order = { safe: 0, coop: 1, paid: 2, other: 3 };
  items.sort((a, b) => order[a.c.kind] - order[b.c.kind] || (o ? dist(a.e) - dist(b.e) : a.e.name.localeCompare(b.e.name)));

  if (SAFE.none.includes(cur.slug)) list.insertAdjacentHTML('beforeend', `<div class="sec warn">No plain walk-in exit on this map</div>`);
  if (!items.length) list.insertAdjacentHTML('beforeend', `<div class="sec">No extract data for this map yet</div>`);
  const counts = {};
  for (const { c } of items) counts[c.kind] = (counts[c.kind] || 0) + 1;
  let last = null;
  const headings = { safe: 'Always open', coop: 'Co-op', paid: 'Costs something', other: 'Needs something' };
  for (const { e, c } of items) {
    if (c.kind !== last) { list.insertAdjacentHTML('beforeend', `<div class="sec">${headings[c.kind]}<span class="cnt">${counts[c.kind]}</span></div>`); last = c.kind; }
    const key = noteKey(e);
    const w = o ? where(o, e) : null;
    const div = document.createElement('div');
    div.className = 'ex' + (state.target?.name === e.name ? ' tgt' : '');
    div.innerHTML = `${badge(KIND[c.kind].color, KIND[c.kind].glyph, 26)}
      <span class="t"><span class="n">${esc(e.name)}</span> <button class="sm" data-note="1" title="Add a note" aria-label="Add a note" style="padding:0 6px">✎</button><br>
      <span class="s">${esc(c.note)}</span>${notes[key] ? `<br><span class="note">${esc(notes[key])}</span>` : ''}</span>
      ${w ? `<span class="d">${w.m}<small>${esc(w.dir)}</small></span>` : ''}`;
    div.onclick = (ev) => {
      if (ev.target.closest('input')) return;
      if (ev.target.dataset.note) { editNote(div, key); return; }
      setTarget({ name: e.name, x: e.x, z: e.z });
      map.flyTo(ll(e.x, e.z), Math.max(map.getZoom(), cur.config.minZoom + 2));
    };
    list.append(div);
  }
  list.scrollTop = keepScroll;
}

function editNote(div, key) {
  const t = div.querySelector('.t');
  if (t.querySelector('input')) return;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'noteinp'; inp.value = notes[key] || ''; inp.placeholder = 'Your note, Enter to save';
  t.append(inp);
  inp.focus();
  const save = () => {
    const v = inp.value.trim();
    if (v) notes[key] = v; else delete notes[key];
    store.set('eft-notes', notes);
    drawMarkers();
    renderList();
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = notes[key] || ''; inp.blur(); } };
  inp.onblur = save;
}

function renderQuests() {
  const list = $('list');
  list.innerHTML = `<div class="card"><label class="chk"><input type="checkbox" id="qAll" ${state.allQuests ? 'checked' : ''}>Show every quest objective on the map</label>
    <div style="margin-top:6px">Tick the quests you are doing to pin just those. Quest data comes from json.tarkov.dev and can lag behind the game.</div></div>`;
  $('qAll').onchange = (e) => { state.allQuests = e.target.checked; drawQuests(); };
  if (!cur.quests.length) list.insertAdjacentHTML('beforeend', `<div class="sec">No quest locations on this map</div>`);
  for (const q of cur.quests) {
    const div = document.createElement('div');
    div.className = 'qrow';
    div.innerHTML = `<input type="checkbox" ${tracked[q.id] ? 'checked' : ''} style="margin-top:4px;accent-color:var(--brass)" aria-label="Track ${esc(q.name)}">
      <span class="t"><span class="n">${esc(q.name)}</span> <span class="s">level ${q.level}</span>
      ${q.objs.map((o) => `<div class="qobj ${o.optional ? 'q-opt' : ''}">${esc(o.text)}</div>`).join('')}</span>`;
    div.querySelector('input').onchange = (e) => {
      if (e.target.checked) tracked[q.id] = true; else delete tracked[q.id];
      store.set('eft-quests', tracked);
      drawQuests();
    };
    div.onclick = (ev) => {
      if (ev.target.tagName === 'INPUT') return;
      const pts = q.objs.flatMap((o) => o.pts.map((p) => ll(p[0], p[2])));
      if (pts.length) map.flyToBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: cur.config.maxZoom - 1 });
      if (!tracked[q.id]) { tracked[q.id] = true; store.set('eft-quests', tracked); drawQuests(); div.querySelector('input').checked = true; }
    };
    list.append(div);
  }
}

function renderLootTab() {
  const list = $('list');
  const { types, containers, loose } = cur.loot;
  if (!containers.length && !loose.length) { list.innerHTML = `<div class="sec">No loot data for this map</div>`; return; }
  const counts = new Array(types.length).fill(0);
  for (const c of containers) counts[c[0]]++;
  list.innerHTML = `<div class="card">Shows where containers can spawn, not what is inside. Tick the types you want on the map.
    <div class="row"><button class="sm" id="lAll">Show all</button><button class="sm" id="lNone">Clear</button>
    <label class="chk"><input type="checkbox" id="lLoose" ${state.loose ? 'checked' : ''}>Loose loot (${loose.length})</label></div></div>`;
  $('lAll').onclick = () => { state.lootTypes = new Set(types); drawLoot(); renderLootTab(); };
  $('lNone').onclick = () => { state.lootTypes = new Set(); drawLoot(); renderLootTab(); };
  $('lLoose').onchange = (e) => { state.loose = e.target.checked; drawLoot(); };
  types.map((name, i) => ({ name, i, n: counts[i] })).sort((a, b) => b.n - a.n).forEach(({ name, n }) => {
    const st = lootStyle(name);
    const div = document.createElement('label');
    div.className = 'qrow';
    div.style.alignItems = 'center';
    div.innerHTML = `<input type="checkbox" ${state.lootTypes.has(name) ? 'checked' : ''} style="accent-color:var(--brass)" aria-label="${esc(pretty(name))}">
      ${badge(st.color, st.glyph, 24)}<span class="t"><span class="n">${esc(pretty(name))}</span></span><span class="d">${n}</span>`;
    div.querySelector('input').onchange = (e) => {
      if (e.target.checked) state.lootTypes.add(name); else state.lootTypes.delete(name);
      drawLoot();
    };
    list.append(div);
  });
}

/* ---------- polling ---------- */
let lastMtime = 0;
async function poll() {
  try {
    const p = await (await fetch('/api/position')).json();
    const changed = p.mtime !== lastMtime || p.none !== you?.none;
    if (changed) {
      const fresh = p.mtime && p.mtime !== lastMtime;
      lastMtime = p.mtime || 0;
      you = p;
      drawYou();
      updateRoute();
      if (!document.activeElement?.classList.contains('noteinp')) renderList();
      if (fresh && !p.error) map.panTo(ll(p.x, p.z));
    }
    renderYou();
  } catch { /* server restarting */ }
}

async function init() {
  [DATA, SAFE, AMMO, ITEMS, HID] = await Promise.all([fetch('/data/maps.json').then((r) => r.json()), fetch('/data/safe.json').then((r) => r.json()), fetch('/data/ammo.json').then((r) => r.json()).catch(() => []), fetch('/data/items.json').then((r) => r.json()).catch(() => []), fetch('/data/hideout.json').then((r) => r.json()).catch(() => null)]);
  timer = store.get('eft-timer', null);
  if (timer && Date.now() - timer.start > 3 * 3600e3) timer = null;
  renderLegend();
  const sel = $('mapSel');
  for (const m of DATA.maps) sel.add(new Option(m.name + (m.extracts.length ? '' : ' (no extract data)'), m.slug));
  sel.onchange = () => loadMap(sel.value);
  const setF = (f) => { faction = f; $('fPmc').classList.toggle('on', f === 'pmc'); $('fScav').classList.toggle('on', f === 'scav'); drawMarkers(); renderSummary(); renderTabs(); renderYou(); renderList(); };
  $('fPmc').onclick = () => setF('pmc');
  $('fScav').onclick = () => setF('scav');
  $('cTransit').onchange = $('cSpawn').onchange = drawMarkers;
  const setTab = (t) => {
    tab = t;
    for (const [id, k] of [['tabEx', 'ex'], ['tabQ', 'q'], ['tabL', 'l'], ['tabI', 'i'], ['tabA', 'a'], ['tabM', 'm'], ['tabH', 'h'], ['tabN', 'n']]) $(id).classList.toggle('on', t === k);
    renderList();
  };
  $('tabEx').onclick = () => setTab('ex');
  $('tabQ').onclick = () => setTab('q');
  $('tabL').onclick = () => setTab('l');
  $('tabI').onclick = () => setTab('i');
  $('tabA').onclick = () => setTab('a');
  $('tabM').onclick = () => setTab('m');
  $('tabH').onclick = () => setTab('h');
  $('tabN').onclick = () => setTab('n');
  const start = DATA.maps.find((m) => m.slug === 'customs') || DATA.maps[0];
  sel.value = start.slug;
  await loadMap(start.slug);
  poll();
  setInterval(poll, 1500);
  setInterval(() => renderTimer(false), 1000);
}
init();
