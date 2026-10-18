// Inventory reader: matches the stash grid in a game screenshot against tarkov.dev item art.
// Everything runs in the browser. Icons are fetched through /icon/<id> (cached on disk by the server).
const INV = { S: 16, T: 120, index: null, ver: 5, maxScore: 48 };
const idb = {
  open: () => new Promise((res, rej) => { const r = indexedDB.open('eft-icons', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async get(k) { try { const db = await this.open(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); } catch { return null; } },
  async set(k, v) { try { const db = await this.open(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch { /* storage unavailable */ } },
};

function canvasPixels(src, sx, sy, sw, sh, dw, dh) {
  const c = document.createElement('canvas');
  c.width = dw; c.height = dh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.fillStyle = '#000'; g.fillRect(0, 0, dw, dh);
  g.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  const d = g.getImageData(0, 0, dw, dh).data;
  const out = new Uint8Array(dw * dh * 3);
  for (let i = 0, j = 0; i < d.length; i += 4) { out[j++] = d[i]; out[j++] = d[i + 1]; out[j++] = d[i + 2]; }
  return out;
}

// Rotate a (W x H) RGB buffer 90 degrees clockwise -> (H x W)
function rotate90(v, W, H) {
  const o = new Uint8Array(v.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 3, d = (x * H + (H - 1 - y)) * 3;
    o[d] = v[s]; o[d + 1] = v[s + 1]; o[d + 2] = v[s + 2];
  }
  return o;
}

async function loadIcon(id) {
  const im = new Image();
  im.src = '/icon/' + id + '.webp?b2';
  await im.decode();
  return im;
}

// How opaque each pixel of the icon art is (the art sits on near-black, the game tints the background).
function alphaOf(vec) {
  const a = new Uint8Array(vec.length / 3);
  for (let i = 0, j = 0; i < vec.length; i += 3, j++) a[j] = Math.min(255, (Math.max(vec[i], vec[i + 1], vec[i + 2]) * 255) / 70);
  return a;
}

// 1 where a pixel is compared, 0 where the game draws its own text (name label top, counts bottom right).
function maskFor(w, h, S) {
  const W = w * S, H = h * S, m = new Uint8Array(W * H).fill(1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (y < S * 0.26) m[y * W + x] = 0;
    if (y > H - S * 0.34 && x > W - S * 0.75) m[y * W + x] = 0;
  }
  return m;
}

// Build (or load) the feature index: one small RGB thumbnail per item icon.
async function getIconIndex(onProgress) {
  if (INV.index) return INV.index;
  const S = INV.S;
  const saved = await idb.get('index-v' + INV.ver);
  const feats = saved && saved.S === S ? saved.feats : {};
  const todo = ITEMS.filter((it) => !(it.id in feats));
  let done = 0;
  const queue = todo.slice();
  async function worker() {
    while (queue.length) {
      const it = queue.pop();
      try {
        const im = await loadIcon(it.id);
        feats[it.id] = canvasPixels(im, 0, 0, im.naturalWidth, im.naturalHeight, it.w * S, it.h * S);
      } catch { feats[it.id] = null; }
      done++;
      if (onProgress && done % 25 === 0) onProgress(done, todo.length, 'icons');
    }
  }
  if (todo.length) {
    await Promise.all(Array.from({ length: 8 }, worker));
    await idb.set('index-v' + INV.ver, { S, feats });
  }
  const bySize = new Map();
  const add = (w, h, id, vec, rot) => {
    const k = w + 'x' + h;
    if (!bySize.has(k)) bySize.set(k, { w, h, mask: maskFor(w, h, S), items: [] });
    bySize.get(k).items.push({ id, vec, alpha: alphaOf(vec), rot });
  };
  for (const it of ITEMS) {
    const v = feats[it.id];
    if (!v || it.gun) continue; // assembled weapons in the stash cannot be matched by their base icon
    add(it.w, it.h, it.id, v, false);
    if (it.w !== it.h) add(it.h, it.w, it.id, rotate90(v, it.w * S, it.h * S), true);
  }
  INV.index = bySize;
  return bySize;
}

/* ---------- grid ---------- */
function lumaOf(img, W, H) {
  const l = new Float32Array(W * H);
  for (let i = 0, j = 0; j < l.length; i += 4, j++) l[j] = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
  return l;
}

// Find the stash grid cell size and origin by looking for the thin cell borders.
function detectGrid(luma, W, H, region) {
  const [rx0, ry0, rx1, ry1] = region;
  const colP = new Float32Array(rx1 - rx0 + 1), rowP = new Float32Array(ry1 - ry0 + 1);
  for (let y = ry0; y < ry1; y += 2) for (let x = rx0; x < rx1; x++) colP[x - rx0] += Math.abs(luma[y * W + x + 1] - luma[y * W + x]);
  for (let x = rx0; x < rx1; x += 2) for (let y = ry0; y < ry1; y++) rowP[y - ry0] += Math.abs(luma[(y + 1) * W + x] - luma[y * W + x]);
  const cs0 = (63 * H) / 1080;
  let bx = null, by = null;
  for (let cs = cs0 * 0.94; cs <= cs0 * 1.06; cs += 0.1) {
    for (let off = 0; off < cs; off += 0.5) {
      let sx = 0, n = 0;
      for (let k = 0; off + k * cs < colP.length - 1; k++) { sx += colP[Math.round(off + k * cs)]; n++; }
      sx /= n;
      let sy = 0, m = 0;
      for (let k = 0; off + k * cs < rowP.length - 1; k++) { sy += rowP[Math.round(off + k * cs)]; m++; }
      sy /= m;
      if (!bx || sx > bx.s) bx = { s: sx, cs, off };
      if (!by || sy > by.s) by = { s: sy, cs, off };
    }
  }
  // phase is ambiguous by one cell: allow a few px before the region edge, otherwise wrap back
  const wrap = (o, c) => (o > c - 6 ? o - c : o);
  return { cs: bx.cs, csy: by.cs, x0: rx0 + wrap(bx.off, bx.cs), y0: ry0 + wrap(by.off, by.cs) };
}

/* ---------- matching ---------- */
function ringBackground(crop, W, H) {
  const px = [];
  for (let x = 0; x < W; x++) { px.push((0 * W + x) * 3, ((H - 1) * W + x) * 3); }
  for (let y = 1; y < H - 1; y++) { px.push((y * W) * 3, (y * W + W - 1) * 3); }
  const bg = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const vals = px.map((p) => crop[p + c]).sort((a, b) => a - b);
    bg[c] = vals[vals.length >> 1];
  }
  return bg;
}

// Mean clipped colour difference between the crop and the icon art composited over the crop's own background.
function score(crop, it, mask, bg, T) {
  const a = crop, v = it.vec, al = it.alpha;
  let s = 0, n = 0;
  for (let p = 0, i = 0; p < mask.length; p++, i += 3) {
    if (!mask[p]) continue;
    const A = al[p], B = 255 - A;
    const e0 = (v[i] * A + bg[0] * B) >> 8, e1 = (v[i + 1] * A + bg[1] * B) >> 8, e2 = (v[i + 2] * A + bg[2] * B) >> 8;
    const d = Math.abs(a[i] - e0) + Math.abs(a[i + 1] - e1) + Math.abs(a[i + 2] - e2);
    s += d < T ? d : T;
    n++;
  }
  return s / n;
}

function cellIsEmpty(luma, W, x0, y0, cs) {
  let sum = 0, sq = 0, n = 0;
  for (let y = y0 + 4; y < y0 + cs - 4; y += 3) for (let x = x0 + 4; x < x0 + cs - 4; x += 3) { const v = luma[Math.round(y) * W + Math.round(x)]; sum += v; sq += v * v; n++; }
  const mean = sum / n, varr = sq / n - mean * mean;
  return varr < 60; // flat, dark cell
}

async function readGrid(bitmap, region, onProgress) {
  const W = bitmap.width, H = bitmap.height, S = INV.S;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  const img = g.getImageData(0, 0, W, H).data;
  const luma = lumaOf(img, W, H);
  const grid = detectGrid(luma, W, H, region);
  const cs = grid.cs;
  const cols = Math.round((region[2] - region[0]) / cs);
  const rows = Math.floor((region[3] - grid.y0) / cs);
  const index = await getIconIndex(onProgress);

  const cands = [];
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const ax = grid.x0 + col * cs, ay = grid.y0 + r * cs;
      if (cellIsEmpty(luma, W, ax, ay, cs)) continue;
      for (const grp of index.values()) {
        const { w, h, mask, items } = grp;
        if (col + w > cols || r + h > rows) continue;
        const crop = canvasPixels(c, ax, ay, w * cs, h * cs, w * S, h * S);
        const bg = ringBackground(crop, w * S, h * S);
        const top = [];
        for (const it of items) {
          const s = score(crop, it, mask, bg, INV.T);
          if (top.length < 5 || s < top[top.length - 1].s) {
            top.push({ id: it.id, s, rot: it.rot });
            top.sort((x, y) => x.s - y.s);
            if (top.length > 5) top.pop();
          }
        }
        if (top.length) cands.push({ r, col, w, h, top });
      }
    }
    if (onProgress) onProgress(r + 1, rows, 'match');
    await new Promise((res) => setTimeout(res, 0));
  }
  // Prefer the candidate with the lowest score per cell, then fill without overlaps.
  cands.sort((a, b) => a.top[0].s - b.top[0].s);
  const taken = new Set();
  const found = [];
  for (const k of cands) {
    if (k.top[0].s > INV.maxScore) break;
    let clash = false;
    for (let y = 0; y < k.h && !clash; y++) for (let x = 0; x < k.w; x++) if (taken.has((k.r + y) * 100 + k.col + x)) { clash = true; break; }
    if (clash) continue;
    for (let y = 0; y < k.h; y++) for (let x = 0; x < k.w; x++) taken.add((k.r + y) * 100 + k.col + x);
    k.amb = k.top.filter((t) => t.s - k.top[0].s < 1.5).length; // near-identical art (for example ammo packs)
    found.push(k);
  }
  return { grid: { ...grid, cols, rows }, found, cands, W, H };
}
