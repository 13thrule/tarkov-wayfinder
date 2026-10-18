// Hideout tab: upgrade requirements with a shopping list, and a craft profit table.
let HID = null;
const hideoutState = { view: 'up', open: new Set(), station: '', q: '', sort: 'phr', mine: false };
let hLevels = store.get('eft-hideout', {}); // station name -> current level
let hPlan = store.get('eft-hideout-plan', {}); // station name -> true when the next level is planned

const hName = (id) => HID.names[id] || id;
const hVal = (id) => HID.value[id] || 0;
const fmtDur = (sec) => {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.round((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m`;
};
const lvlOf = (name) => hLevels[name] || 0;
const nextLevel = (st) => st.levels.find((l) => l.level === lvlOf(st.name) + 1) || null;

function levelCost(l) { return l.items.reduce((n, r) => n + r.c * hVal(r.id), 0); }

function reqHtml(l) {
  const bits = [];
  bits.push(`<div class="s">Build time ${fmtDur(l.time)}, items worth about ${rub(levelCost(l))}</div>`);
  bits.push(...l.items.map((r) => `<div class="s">${r.c.toLocaleString('en-GB')} x ${esc(hName(r.id))}${r.fir ? ' <span class="warnTxt">(found in raid)</span>' : ''}</div>`));
  bits.push(...l.stations.map((r) => `<div class="s">Needs ${esc(r.name)} level ${r.level}</div>`));
  bits.push(...l.traders.map((r) => `<div class="s">Needs ${esc(r.name)} loyalty level ${r.level ?? '?'}</div>`));
  bits.push(...l.skills.map((r) => `<div class="s">Needs ${esc(r.skill)} skill level ${r.level}</div>`));
  return bits.join('');
}

function renderHideoutTab() {
  const list = $('list');
  if (!HID) { list.innerHTML = '<div class="card">Hideout data is missing. Run node scripts/fetch-data.mjs.</div>'; return; }
  list.innerHTML = `<div class="tabs" style="padding:6px 12px;border:0"><div class="seg"><button id="hUp" class="${hideoutState.view === 'up' ? 'on' : ''}">Upgrades</button><button id="hCr" class="${hideoutState.view === 'cr' ? 'on' : ''}">Crafts</button></div></div><div id="hBody"></div>`;
  $('hUp').onclick = () => { hideoutState.view = 'up'; renderHideoutTab(); };
  $('hCr').onclick = () => { hideoutState.view = 'cr'; renderHideoutTab(); };
  if (hideoutState.view === 'up') renderUpgrades(); else renderCrafts();
}

function renderUpgrades() {
  const body = $('hBody');
  const stations = [...HID.stations].sort((a, b) => a.name.localeCompare(b.name));
  const planned = stations.filter((s) => hPlan[s.name] && nextLevel(s));
  const agg = new Map();
  for (const s of planned) {
    for (const r of nextLevel(s).items) {
      const e = agg.get(r.id) || { id: r.id, c: 0, fir: false };
      e.c += r.c; e.fir = e.fir || r.fir;
      agg.set(r.id, e);
    }
  }
  const rows = [...agg.values()].sort((a, b) => b.c * hVal(b.id) - a.c * hVal(a.id));
  const total = rows.reduce((n, r) => n + r.c * hVal(r.id), 0);
  let html = `<div class="card">Set the level each station is at, tick the ones you want to upgrade next, and the shopping list below adds up what you need. Values are flea averages, so treat the total as a rough guide.</div>`;
  if (planned.length) {
    html += `<div class="sec">Shopping list<span class="cnt">${planned.length} upgrade${planned.length > 1 ? 's' : ''}</span></div><div class="card" style="margin-top:4px">
      ${rows.map((r) => `<div class="s"><b style="color:var(--text)">${r.c.toLocaleString('en-GB')}</b> x ${esc(hName(r.id))}${r.fir ? ' <span class="warnTxt">found in raid</span>' : ''}</div>`).join('')}
      <div style="margin-top:6px;color:var(--text)">About <b>${rub(total)}</b> in total</div></div>`;
  }
  html += '<div class="sec">Stations</div>';
  body.innerHTML = html;
  for (const st of stations) {
    const cur = lvlOf(st.name), max = st.levels.length, nl = nextLevel(st);
    const row = document.createElement('div');
    row.className = 'item';
    row.style.flexDirection = 'column';
    row.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span class="n" style="flex:1">${esc(st.name)}</span>
      <button class="sm" data-d="-1" aria-label="Lower level">-</button><span class="d" style="min-width:56px;text-align:center">Level ${cur} / ${max}</span><button class="sm" data-d="1" aria-label="Raise level">+</button></div>
      ${nl ? `<label class="chk" style="margin-top:6px"><input type="checkbox" ${hPlan[st.name] ? 'checked' : ''}> Plan level ${nl.level} <span class="s">(${nl.items.length} item types, ${fmtDur(nl.time)})</span></label>
      <button class="sm" data-more="1" style="align-self:flex-start;margin-top:6px">${hideoutState.open.has(st.name) ? 'Hide requirements' : 'Show requirements'}</button>
      ${hideoutState.open.has(st.name) ? `<div style="margin-top:6px">${reqHtml(nl)}</div>` : ''}` : '<div class="s" style="margin-top:4px">Fully upgraded</div>'}`;
    row.querySelectorAll('[data-d]').forEach((b) => {
      b.onclick = () => {
        hLevels[st.name] = Math.max(0, Math.min(max, cur + Number(b.dataset.d)));
        store.set('eft-hideout', hLevels);
        if (!nextLevel(st)) delete hPlan[st.name];
        renderUpgrades();
      };
    });
    const cb = row.querySelector('input[type=checkbox]');
    if (cb) cb.onchange = () => { if (cb.checked) hPlan[st.name] = true; else delete hPlan[st.name]; store.set('eft-hideout-plan', hPlan); renderUpgrades(); };
    const more = row.querySelector('[data-more]');
    if (more) more.onclick = () => { if (hideoutState.open.has(st.name)) hideoutState.open.delete(st.name); else hideoutState.open.add(st.name); renderUpgrades(); };
    body.append(row);
  }
}

function craftStats(c) {
  const cost = c.inp.filter((r) => !r.tool).reduce((n, r) => n + r.c * hVal(r.id), 0);
  const made = c.out.c * hVal(c.out.id);
  const profit = made - cost;
  return { cost, made, profit, phr: c.dur ? profit / (c.dur / 3600) : 0 };
}

function renderCrafts() {
  const body = $('hBody');
  const stationNames = [...new Set(HID.crafts.map((c) => c.station))].sort();
  body.innerHTML = `<div class="card">Profit is what the product is worth minus the items it uses, using flea averages before fees. Tools are not used up. The best-looking crafts are often items with few flea offers, where the average is unreliable, so check the live flea price before you start one.
    <div class="row"><select id="cSt" aria-label="Station"><option value="">All stations</option>${stationNames.map((n) => `<option ${n === hideoutState.station ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <input type="text" id="cQ" placeholder="Search products" value="${esc(hideoutState.q)}" style="flex:1;min-width:0"></div>
    <div class="row"><label class="chk"><input type="checkbox" id="cMine" ${hideoutState.mine ? 'checked' : ''}>Only what my station levels allow</label></div>
    <div class="row"><button class="sm" data-sort="phr">Profit per hour</button><button class="sm" data-sort="profit">Profit</button><button class="sm" data-sort="dur">Fastest</button></div></div><div id="cRows"></div>`;
  const fill = () => {
    const q = hideoutState.q.toLowerCase();
    let rows = HID.crafts
      .filter((c) => (!hideoutState.station || c.station === hideoutState.station) && (!q || hName(c.out.id).toLowerCase().includes(q))
        && (!hideoutState.mine || c.level <= lvlOf(c.station)))
      .map((c) => ({ c, s: craftStats(c) }));
    rows.sort((a, b) => hideoutState.sort === 'dur' ? a.c.dur - b.c.dur : hideoutState.sort === 'profit' ? b.s.profit - a.s.profit : b.s.phr - a.s.phr);
    rows = rows.slice(0, 80);
    $('cRows').innerHTML = rows.map(({ c, s }) => {
      const tools = c.inp.filter((r) => r.tool).map((r) => hName(r.id));
      const missing = c.inp.some((r) => !r.tool && !hVal(r.id)) || !hVal(c.out.id);
      return `<div class="item"><div class="t"><span class="n">${c.out.c > 1 ? c.out.c + ' x ' : ''}${esc(hName(c.out.id))}</span><br>
        <span class="s">${esc(c.station)} level ${c.level}, takes ${fmtDur(c.dur)}</span>
        <div class="s">Uses ${c.inp.filter((r) => !r.tool).map((r) => `${r.c} ${esc(hName(r.id))}`).join(', ')}</div>
        ${tools.length ? `<div class="s">Tools: ${tools.map(esc).join(', ')}</div>` : ''}
        <div class="s">Cost ${rub(s.cost)}, worth ${rub(s.made)}${missing ? ' <span class="warnTxt">(some prices missing)</span>' : ''}</div></div>
        <div class="d" style="color:${s.profit >= 0 ? '#5fd38d' : '#ff6b5e'}">${s.profit >= 0 ? '+' : ''}${rub(s.profit)}<small>${rub(s.phr)} per hour</small></div></div>`;
    }).join('') || '<div class="card">No crafts match.</div>';
  };
  $('cSt').onchange = (e) => { hideoutState.station = e.target.value; fill(); };
  $('cQ').oninput = (e) => { hideoutState.q = e.target.value; fill(); };
  $('cMine').onchange = (e) => { hideoutState.mine = e.target.checked; fill(); };
  body.querySelectorAll('[data-sort]').forEach((b) => { b.onclick = () => { hideoutState.sort = b.dataset.sort; fill(); }; });
  fill();
}
