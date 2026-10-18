// Extra tools: intel (bosses, locked doors, hazards, power), ammo chart, raid timer.
// Loaded after app.js declarations are available at call time (shares its globals).

/* ---------- intel: bosses, locked doors, hazards, power ---------- */
const HAZ = {
  minefield: { key: 'hazMine', color: '#ff5a5a', label: 'Minefield', note: 'Landmines, stay out' },
  sniper: { key: 'hazSniper', color: '#f0c94a', label: 'Scav sniper zone', note: 'A marksman scav can be posted here' },
  hazard: { key: 'hazOther', color: '#b394f5', label: 'Hazard zone', note: 'Dangerous area' },
};
function drawIntel() {
  G.intel.clearLayers();
  const I = cur.intel;
  if (!I) return;
  for (const h of I.hazards) {
    const hz = HAZ[h.type] || HAZ.hazard;
    if (!intelState[hz.key]) continue;
    L.polygon(h.poly.map(([x, z]) => ll(x, z)), { color: hz.color, weight: 1.5, dashArray: '4 3', fillColor: hz.color, fillOpacity: 0.18 })
      .bindTooltip(tip(hz.label, hz.note), { className: 'tip', sticky: true }).addTo(G.intel);
  }
  if (intelState.boss) {
    for (const b of I.bosses) {
      for (const l of b.locs) {
        if (l.x == null) continue;
        L.marker(ll(l.x, l.z), { icon: markerIcon('boss', 26) }).addTo(G.intel)
          .bindTooltip(tip(b.name, `${b.chance}% chance to spawn`, l.name ? `${l.name} ${l.chance}%` : ''), { className: 'tip', direction: 'top', offset: [0, -10] });
      }
    }
  }
  for (const l of I.locks) {
    if (!(intelState.allLocks || intelState.locks.has(l.key))) continue;
    L.marker(ll(l.x, l.z), { icon: markerIcon('lock', 20) }).addTo(G.intel)
      .bindTooltip(tip(l.key, l.power ? 'Door that needs power' : pretty(l.type)), { className: 'tip', direction: 'top', offset: [0, -8] });
  }
  if (intelState.power) {
    for (const w of I.switches) L.marker(ll(w.x, w.z), { icon: markerIcon('power', 22) }).addTo(G.intel).bindTooltip(tip('Power switch', 'Some exits and doors need power'), { className: 'tip' });
  }
  if (intelState.btr) {
    for (const b of I.btr) L.marker(ll(b.x, b.z), { icon: markerIcon('btr', 20, 'hex') }).addTo(G.intel).bindTooltip(tip('BTR stop', 'The armoured vehicle drives this route'), { className: 'tip' });
  }
}

function renderIntelTab() {
  const list = $('list');
  const I = cur.intel;
  list.innerHTML = '';
  list.insertAdjacentHTML('beforeend', `<div class="card">${I.raidMinutes ? `Raid length <b style="color:var(--text)">${I.raidMinutes} minutes</b>. ` : ''}Spawn chances come from json.tarkov.dev and change with updates.</div>`);

  list.insertAdjacentHTML('beforeend', `<div class="sec">Bosses<span class="cnt">${I.bosses.length}</span></div>`);
  if (!I.bosses.length) list.insertAdjacentHTML('beforeend', '<div class="boss s">No bosses listed for this map.</div>');
  for (const b of I.bosses) {
    const zones = [...new Set(b.locs.map((l) => l.name).filter(Boolean))].slice(0, 6).join(', ');
    list.insertAdjacentHTML('beforeend', `<div class="boss"><span class="n">${esc(b.name)}</span> <span class="s">${b.chance}% chance</span>
      <div class="bar"><i style="width:${Math.min(100, b.chance)}%"></i></div>${zones ? `<div class="s" style="margin-top:4px">Can spawn at: ${esc(zones)}</div>` : ''}${b.escorts ? `<div class="s">Brings about ${b.escorts} guards</div>` : ''}</div>`);
  }

  list.insertAdjacentHTML('beforeend', '<div class="sec">Show on map</div>');
  const tog = (key, g, kind, label, count) => {
    const row = document.createElement('label');
    row.className = 'tog';
    row.innerHTML = `<input type="checkbox" ${intelState[key] ? 'checked' : ''}>${badge(KIND[kind].color, g, 22)}<span class="t">${label}</span><span class="d" style="color:var(--dim)">${count}</span>`;
    row.querySelector('input').onchange = (e) => { intelState[key] = e.target.checked; drawIntel(); };
    list.append(row);
  };
  tog('boss', 'skull', 'boss', 'Boss spawn areas', I.bosses.reduce((n, b) => n + b.locs.filter((l) => l.x != null).length, 0));
  for (const type of ['minefield', 'sniper', 'hazard']) {
    const n = I.hazards.filter((h) => h.type === type).length;
    if (n) tog(HAZ[type].key, 'warn', 'hazard', HAZ[type].label + 's', n);
  }
  tog('power', 'bolt', 'power', 'Power switches', I.switches.length);
  tog('btr', 'transit', 'btr', 'BTR stops', I.btr.length);

  const groups = new Map();
  for (const l of I.locks) groups.set(l.key, (groups.get(l.key) || 0) + 1);
  list.insertAdjacentHTML('beforeend', `<div class="sec">Locked doors<span class="cnt">${I.locks.length}</span></div>`);
  const all = document.createElement('label');
  all.className = 'tog';
  all.innerHTML = `<input type="checkbox" ${intelState.allLocks ? 'checked' : ''}><span class="t">Show every locked door</span>`;
  all.querySelector('input').onchange = (e) => { intelState.allLocks = e.target.checked; drawIntel(); };
  list.append(all);
  [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).forEach(([key, n]) => {
    const row = document.createElement('label');
    row.className = 'tog';
    row.innerHTML = `<input type="checkbox" ${intelState.locks.has(key) ? 'checked' : ''}>${badge(KIND.lock.color, 'key', 22)}<span class="t">${esc(key)}</span><span class="d" style="color:var(--dim)">${n}</span>`;
    row.querySelector('input').onchange = (e) => { if (e.target.checked) intelState.locks.add(key); else intelState.locks.delete(key); drawIntel(); };
    list.append(row);
  });
}

/* ---------- ammo chart (all maps) ---------- */
const PEN_COLORS = ['#8b989e', '#d9d06b', '#f2c14a', '#f29b50', '#ef7a50', '#e5604f', '#d94a8a'];
const penColor = (p) => PEN_COLORS[Math.min(6, Math.floor(p / 10))];

function renderAmmoTab() {
  const list = $('list');
  const cals = [...new Set(AMMO.map((a) => a.caliber))].sort();
  list.innerHTML = `<div class="card">Penetration colour is roughly the armour class a round can defeat (30 to 39 beats about class 3). Real results depend on armour durability.
    <div class="row"><select id="aCal" aria-label="Caliber"><option value="">All calibers</option>${cals.map((c) => `<option ${c === ammoState.cal ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <input type="text" id="aQ" placeholder="Search ammo" value="${esc(ammoState.q)}" style="flex:1;min-width:0"></div></div>
    <div class="atbl h"><span>Ammo</span><span data-s="dmg">Dmg</span><span data-s="pen">Pen</span><span data-s="armor">Armor</span></div><div id="aRows"></div>`;
  const fill = () => {
    const q = ammoState.q.toLowerCase();
    const rows = AMMO.filter((a) => (!ammoState.cal || a.caliber === ammoState.cal) && (!q || (a.name + ' ' + (a.short || '')).toLowerCase().includes(q)))
      .sort((a, b) => b[ammoState.sort] - a[ammoState.sort]).slice(0, 150);
    $('aRows').innerHTML = rows.map((a) => `<div class="atbl r"><span class="t"><span class="n">${esc(a.short || a.name)}</span><br><span class="s">${esc(a.caliber)}, ${a.speed} m/s, ${a.frag}% frag${a.sub ? ', subsonic' : ''}${a.proj > 1 ? ', ' + a.proj + ' pellets' : ''}</span></span>
      <span class="num">${a.dmg}</span><span class="num"><span class="pen" style="background:${penColor(a.pen)}">${a.pen}</span></span><span class="num">${a.armor}</span></div>`).join('') || '<div class="card">No ammo matches.</div>';
  };
  $('aCal').onchange = (e) => { ammoState.cal = e.target.value; fill(); };
  $('aQ').oninput = (e) => { ammoState.q = e.target.value; fill(); };
  list.querySelectorAll('.atbl.h span[data-s]').forEach((sp) => { sp.onclick = () => { ammoState.sort = sp.dataset.s; fill(); }; });
  fill();
}

/* ---------- raid timer ---------- */
let timerKey = '';
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
function renderTimer(force) {
  const el = $('timer');
  if (!el || !cur) return;
  const mins = cur.intel?.raidMinutes || 35;
  const key = (timer ? 'on' : 'off') + cur.slug;
  if (force || key !== timerKey) {
    timerKey = key;
    if (!timer) {
      el.innerHTML = `<button id="tStart">${glyph('clock', 14)} Start raid timer</button><span class="s">${mins} minute raid</span>`;
      $('tStart').onclick = () => { timer = { start: Date.now() }; store.set('eft-timer', timer); renderTimer(true); };
    } else {
      el.innerHTML = '<span class="big" id="tBig"></span><span class="s" id="tSub"></span><button id="tReset" class="sm">Reset</button>';
      $('tReset').onclick = () => { timer = null; store.set('eft-timer', null); renderTimer(true); };
    }
  }
  if (timer) {
    const elapsed = (Date.now() - timer.start) / 1000;
    const left = Math.max(0, mins * 60 - elapsed);
    $('tBig').textContent = mmss(left);
    $('tBig').classList.toggle('low', left < 300);
    $('tSub').textContent = left === 0 ? 'Raid time is up' : elapsed < 60 ? `Transits open in ${Math.ceil(60 - elapsed)}s` : `${mmss(elapsed)} in, transits are open`;
  }
}
