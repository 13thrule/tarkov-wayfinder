// Items tab: flea and trader prices, price per slot, and which map doors a key opens.
let ITEMS = [];
const itemState = { q: '' };
const rub = (n) => (n == null ? '-' : Math.round(n).toLocaleString('en-GB') + ' ₽');
const daysOld = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 86400000 : null);

function itemMatches(q) {
  const t = q.toLowerCase().trim();
  if (!t) return [];
  const scored = [];
  for (const it of ITEMS) {
    const n = it.n.toLowerCase();
    const s = (it.s || '').toLowerCase();
    let score = 0;
    if (n === t || s === t) score = 4;
    else if (n.startsWith(t) || s.startsWith(t)) score = 3;
    else if (n.includes(t) || s.includes(t)) score = 2;
    if (score) scored.push([score, it]);
  }
  return scored.sort((a, b) => b[0] - a[0] || (b[1].avg ?? 0) - (a[1].avg ?? 0)).slice(0, 40).map((x) => x[1]);
}

async function showKeyOnMap(slug, keyName) {
  if (cur.slug !== slug) { $('mapSel').value = slug; await loadMap(slug); }
  intelState.locks.add(keyName);
  drawIntel();
  const doors = cur.intel.locks.filter((l) => l.key === keyName).map((l) => ll(l.x, l.z));
  if (doors.length) map.flyToBounds(L.latLngBounds(doors).pad(0.6), { maxZoom: cur.config.maxZoom - 1 });
}

function renderItemsTab() {
  const list = $('list');
  list.innerHTML = `<div class="card">Search any item, key or round. Prices are flea market averages in roubles, before fees, and can be out of date.
    <div class="row"><input type="text" id="iQ" placeholder="Search, for example: factory key, LEDX, bitcoin" value="${esc(itemState.q)}" style="flex:1;min-width:0"></div></div><div id="iRows"></div>`;
  const fill = () => {
    const rows = itemMatches(itemState.q);
    const box = $('iRows');
    if (!itemState.q.trim()) { box.innerHTML = ''; return; }
    if (!rows.length) { box.innerHTML = '<div class="card">No item matches that.</div>'; return; }
    box.innerHTML = '';
    for (const it of rows) {
      const slots = it.w * it.h;
      const age = daysOld(it.scan);
      const stale = age != null && age > 7;
      const perSlot = it.avg ? it.avg / slots : null;
      const div = document.createElement('div');
      div.className = 'item';
      const lines = [];
      if (it.avg) lines.push(`Flea average <b>${rub(it.avg)}</b>${it.low ? `, lowest offer ${rub(it.low)}` : ''}${stale ? ` <span class="warnTxt">(price ${Math.round(age)} days old)</span>` : ''}`);
      else if (!it.flea) lines.push('Not sold on the flea market');
      else lines.push('No recent flea price');
      if (it.sell) lines.push(`Sells to ${esc(it.sell.t)} for <b>${rub(it.sell.p)}</b>`);
      if (it.buy) lines.push(`Buy from ${esc(it.buy.t)} for ${rub(it.buy.p)}${it.buy.lvl ? ` (trader level ${it.buy.lvl})` : ''}`);
      let keyHtml = '';
      if (it.key) {
        const opens = Object.entries(it.key.opens);
        keyHtml = `<div class="s" style="margin-top:4px">${it.key.uses ? `${it.key.uses} uses. ` : ''}${opens.length ? 'Opens doors on:' : 'No door locations in the data for this key.'}</div>`
          + opens.map(([slug, n]) => { const m = DATA.maps.find((x) => x.slug === slug); return m ? `<button class="sm" data-show="${esc(slug)}" style="margin:3px 4px 0 0">${esc(m.name)} (${n})</button>` : ''; }).join('');
      }
      div.innerHTML = `<div class="t"><span class="n">${esc(it.n)}</span> <span class="s">${it.w}x${it.h}, ${slots} slot${slots > 1 ? 's' : ''}</span>
        ${lines.map((l) => `<div class="s">${l}</div>`).join('')}${keyHtml}
        ${it.wiki ? `<div class="s"><a href="${esc(it.wiki)}" target="_blank" rel="noopener">Wiki page</a></div>` : ''}</div>
        <div class="d">${perSlot ? rub(perSlot) : ''}${perSlot ? '<small>per slot</small>' : ''}</div>`;
      div.querySelectorAll('[data-show]').forEach((b) => { b.onclick = () => showKeyOnMap(b.dataset.show, it.n); });
      box.append(div);
    }
  };
  $('iQ').oninput = (e) => { itemState.q = e.target.value; fill(); };
  fill();
}
