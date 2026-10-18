// Inventory tab UI: load a screenshot, review the guesses beside it, fix mistakes, see totals.
const invUI = { bm: null, res: null, rows: [], status: '', basis: 'avg', sel: -1, busy: false, name: '' };
const itemById = (id) => ITEMS.find((i) => i.id === id);

function unitValue(it, basis) {
  if (!it) return 0;
  const trader = it.sell ? it.sell.p : 0;
  if (basis === 'trader') return trader || it.base || 0;
  if (basis === 'low') return it.low || it.avg || trader || it.base || 0;
  return it.avg || it.low || trader || it.base || 0;
}

const isUncertain = (r) => !r.manual && (r.low || r.amb > 1);

// Totals are split: rows the matcher is sure about, and rows you still need to confirm.
function invTotals() {
  const t = { avg: 0, low: 0, trader: 0, u: { avg: 0, low: 0, trader: 0, n: 0 } };
  for (const r of invUI.rows) {
    if (r.ignore) continue;
    const it = itemById(r.id);
    const dst = isUncertain(r) ? t.u : t;
    dst.avg += unitValue(it, 'avg') * r.qty;
    dst.low += unitValue(it, 'low') * r.qty;
    dst.trader += unitValue(it, 'trader') * r.qty;
    if (dst === t.u) t.u.n++;
  }
  return t;
}

function drawInvPreview() {
  const cv = $('invCanvas');
  if (!cv || !invUI.bm || !invUI.res) return;
  const { grid, W } = invUI.res;
  const x0 = grid.x0, y0 = grid.y0, cs = grid.cs;
  const sw = grid.cols * cs, sh = grid.rows * cs;
  const scale = 330 / sw;
  cv.width = 330; cv.height = Math.round(sh * scale);
  const g = cv.getContext('2d');
  g.drawImage(invUI.bm, x0, y0, sw, sh, 0, 0, cv.width, cv.height);
  invUI.rows.forEach((r, i) => {
    const bx = r.col * cs * scale, by = r.row * cs * scale, bw = r.w * cs * scale, bh = r.h * cs * scale;
    g.lineWidth = i === invUI.sel ? 3 : 1.5;
    g.strokeStyle = r.ignore ? '#555' : isUncertain(r) ? '#f29b50' : '#5fd38d';
    g.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
  });
}

function renderInventoryTab() {
  const list = $('list');
  if (!ITEMS.length) { list.innerHTML = '<div class="card">Item data is missing. Run node scripts/fetch-data.mjs.</div>'; return; }
  const t = invTotals();
  list.innerHTML = `<div class="card">Open your stash in game and take a screenshot with your screenshot key. The app matches the item art against tarkov.dev icons. It makes mistakes, so check each row.
    <div class="row"><button id="invLatest">Read my latest in-game screenshot</button>
    <button id="invPick">Choose a file</button><input type="file" id="invFile" accept="image/*" style="display:none"></div>
    <div class="s" id="invStatus" style="margin-top:6px">${esc(invUI.status)}</div></div>
    ${invUI.res ? `<div style="padding:4px 16px"><canvas id="invCanvas" style="width:100%;border:1px solid var(--line);border-radius:6px;cursor:pointer"></canvas></div>
    <div class="card"><div style="color:var(--text);font:600 18px var(--display)">${rub(unitBasis(t))}</div>
      <div class="s">Confirmed rows. Trader ${rub(t.trader)}, flea average ${rub(t.avg)}, flea lowest offer ${rub(t.low)}.</div>
      ${t.u.n ? `<div class="warnTxt" style="margin-top:6px">${t.u.n} uncertain row${t.u.n > 1 ? 's' : ''} worth about ${rub(uncertainBasis(t))} are not in that total. Check them below, then press Looks right.</div>` : ''}
      <div class="row"><select id="invBasis" aria-label="Value basis"><option value="avg" ${invUI.basis === 'avg' ? 'selected' : ''}>Count by flea average</option><option value="low" ${invUI.basis === 'low' ? 'selected' : ''}>Count by flea lowest offer</option><option value="trader" ${invUI.basis === 'trader' ? 'selected' : ''}>Count by trader sell price</option></select></div>
      <div class="s" style="margin-top:6px">Stack sizes are not read from the screenshot. Set the number for ammo, money and similar. Weapons are not matched, add them by hand.</div></div>
    <div id="invRows"></div>
    <div class="sec">Add an item by hand</div><div class="card" style="margin-top:4px"><input type="text" id="invAdd" placeholder="Search an item" style="width:100%"><div id="invAddRes"></div></div>` : ''}`;
  $('invLatest').onclick = () => runInventory('latest');
  $('invPick').onclick = () => $('invFile').click();
  $('invFile').onchange = (e) => { if (e.target.files[0]) runInventory(e.target.files[0]); };
  if (!invUI.res) return;
  $('invBasis').onchange = (e) => { invUI.basis = e.target.value; renderInventoryTab(); };
  drawInvPreview();
  $('invCanvas').onclick = (e) => {
    const rc = e.target.getBoundingClientRect(), { grid } = invUI.res;
    const sc = (grid.cols * grid.cs) / rc.width;
    const px = (e.clientX - rc.left) * sc, py = (e.clientY - rc.top) * sc;
    const i = invUI.rows.findIndex((r) => px >= r.col * grid.cs && px < (r.col + r.w) * grid.cs && py >= r.row * grid.cs && py < (r.row + r.h) * grid.cs);
    invUI.sel = i; drawInvPreview();
    if (i >= 0) { const el = document.querySelector(`[data-row="${i}"]`); if (el) el.scrollIntoView({ block: 'center' }); }
  };
  renderInvRows();
  const q = $('invAdd');
  q.oninput = () => {
    const rows = itemMatches(q.value).slice(0, 8);
    $('invAddRes').innerHTML = rows.map((it) => `<div class="qrow" data-add="${it.id}" style="padding:4px 0">${esc(it.n)} <span class="s">${rub(unitValue(it, 'avg'))}</span></div>`).join('');
    $('invAddRes').querySelectorAll('[data-add]').forEach((el) => { el.onclick = () => { invUI.rows.push({ id: el.dataset.add, qty: 1, col: -1, row: -1, w: 0, h: 0, alts: [], manual: true }); renderInventoryTab(); }; });
  };
}

const unitBasis = (t) => t[invUI.basis];
const uncertainBasis = (t) => t.u[invUI.basis];

function renderInvRows() {
  const box = $('invRows');
  box.innerHTML = '';
  invUI.rows.forEach((r, i) => {
    const it = itemById(r.id);
    const unit = unitValue(it, invUI.basis);
    const div = document.createElement('div');
    div.className = 'item';
    div.dataset.row = i;
    div.style.opacity = r.ignore ? 0.4 : 1;
    if (isUncertain(r) && !r.ignore) div.style.borderLeft = '3px solid #f29b50';
    if (i === invUI.sel) div.style.background = '#1d2c35';
    const alts = [r.id, ...r.alts.filter((a) => a !== r.id)];
    div.innerHTML = `<div class="t"><select data-pick style="width:100%;font:600 13px var(--body)">${alts.map((id) => `<option value="${id}" ${id === r.id ? 'selected' : ''}>${esc(itemById(id)?.n || id)}</option>`).join('')}</select>
      <div class="s" style="margin-top:3px">${r.manual ? 'Added by hand' : r.amb > 1 ? `<span class="warnTxt">${r.amb} items look the same, check the name in the screenshot</span>` : r.low ? '<span class="warnTxt">Low confidence</span>' : 'Good match'}${it?.stack ? ` <span class="warnTxt">stackable, set the amount</span>` : ''}</div>
      <div class="row" style="margin-top:4px"><label class="chk">Amount <input type="number" min="1" value="${r.qty}" data-qty style="width:70px;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:3px 6px"></label>
      ${isUncertain(r) && !r.ignore ? '<button class="sm" data-ok>Looks right</button>' : ''}<button class="sm" data-ignore>${r.ignore ? 'Count it' : 'Not an item / skip'}</button></div></div>
      <div class="d">${rub(unit * r.qty)}<small>${rub(unit)} each</small></div>`;
    div.querySelector('[data-pick]').onchange = (e) => { r.id = e.target.value; r.low = false; r.amb = 1; renderInventoryTab(); };
    div.querySelector('[data-qty]').onchange = (e) => { r.qty = Math.max(1, Number(e.target.value) || 1); renderInventoryTab(); };
    const okBtn = div.querySelector('[data-ok]');
    if (okBtn) okBtn.onclick = () => { r.low = false; r.amb = 1; renderInventoryTab(); };
    div.querySelector('[data-ignore]').onclick = () => { r.ignore = !r.ignore; renderInventoryTab(); };
    div.onclick = (e) => { if (e.target.closest('select,input,button,label')) return; invUI.sel = i; drawInvPreview(); renderInvRows(); };
    box.append(div);
  });
}

async function runInventory(src) {
  if (invUI.busy) return;
  invUI.busy = true;
  const setStatus = (t) => { invUI.status = t; const el = $('invStatus'); if (el) el.textContent = t; };
  try {
    setStatus('Loading the screenshot...');
    let blob;
    if (src === 'latest') {
      const r = await fetch('/api/menu-shot');
      if (!r.ok) throw new Error('No menu screenshot found in your Escape from Tarkov Screenshots folder. Open your stash in game and press your screenshot key.');
      invUI.name = decodeURIComponent(r.headers.get('X-Shot-Name') || '');
      blob = await r.blob();
    } else { blob = src; invUI.name = src.name; }
    invUI.bm = await createImageBitmap(blob);
    const W = invUI.bm.width, H = invUI.bm.height;
    setStatus('Preparing item icons. The first time takes a few minutes, then it is instant.');
    const res = await readGrid(invUI.bm, [Math.round(0.659 * W), Math.round(0.0735 * H), Math.round(0.989 * W), Math.round(0.882 * H)], (d, n, k) => setStatus(k === 'icons' ? `Preparing item icons: ${d} of ${n}` : `Matching row ${d} of ${n}`));
    invUI.res = res;
    invUI.sel = -1;
    invUI.rows = res.found.sort((a, b) => a.r - b.r || a.col - b.col).map((k) => ({
      id: k.top[0].id, qty: 1, row: k.r, col: k.col, w: k.w, h: k.h, amb: k.amb || 1, low: k.top[0].s > 34,
      alts: k.top.map((t) => t.id),
    }));
    invUI.status = `Found ${invUI.rows.length} items in ${invUI.name || 'the screenshot'}. Check them against the picture.`;
  } catch (e) {
    invUI.status = e.message || String(e);
  } finally {
    invUI.busy = false;
    if (tab === 'n') renderInventoryTab();
  }
}
