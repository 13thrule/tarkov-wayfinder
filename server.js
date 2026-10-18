// Local-only server: static UI, cached map data, and a screenshot-filename watcher.
// It only reads FILENAMES in the screenshots folder, never the files or the game.
import http from 'node:http';
import { readFile, readdir, stat, unlink, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8801);
// Where Escape from Tarkov saves screenshots. Windows may redirect Documents into OneDrive, so try both.
// Override with the EFT_SCREENSHOTS environment variable.
function findShotsFolder() {
  if (process.env.EFT_SCREENSHOTS) return process.env.EFT_SCREENSHOTS;
  const home = os.homedir();
  const options = [
    path.join(home, 'Documents', 'Escape from Tarkov', 'Screenshots'),
    path.join(home, 'OneDrive', 'Documents', 'Escape from Tarkov', 'Screenshots'),
  ];
  return options.find((p) => existsSync(p)) || options[0];
}
const SHOTS = findShotsFolder();
const KEEP_SHOTS = !!process.env.EFT_KEEP_SHOTS; // set to 1 to stop the app deleting screenshots it has read

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

// 2026-09-04[04-56]_-230.88, 3.59, -375.83_-0.02798, -0.17807, 0.00669, -0.98360_0.64 (0).png
const SHOT_RE = /^(\d{4}-\d{2}-\d{2})\[(\d{2}-\d{2})\]_(-?\d+\.\d+), (-?\d+\.\d+), (-?\d+\.\d+)_(-?\d+\.\d+), (-?\d+\.\d+), (-?\d+\.\d+), (-?\d+\.\d+)_/;

// Once a screenshot's filename has been read, the PNG is deleted (the file can still be locked
// right after the game writes it, so retry). Only files with a coordinate filename are touched.
const FIX_FILE = path.join(root, 'data', 'last-fix.json');
let last = null;
readFile(FIX_FILE, 'utf8').then((t) => { last = JSON.parse(t); }).catch(() => {});
const deleting = new Set();

async function deleteShot(file) {
  if (deleting.has(file)) return;
  deleting.add(file);
  for (let i = 0; i < 10; i++) {
    try { await unlink(file); break; } catch (e) { if (e.code === 'ENOENT') break; await new Promise((r) => setTimeout(r, 300)); }
  }
  deleting.delete(file);
}

async function latestShot() {
  let files;
  try { files = await readdir(SHOTS); } catch { return { error: `Cannot read ${SHOTS}` }; }
  const found = [];
  for (const f of files) {
    if (!f.toLowerCase().endsWith('.png')) continue;
    const m = SHOT_RE.exec(f);
    if (!m) continue; // menu screenshots have no coordinates
    const mtime = (await stat(path.join(SHOTS, f)).catch(() => null))?.mtimeMs;
    if (mtime) found.push({ f, m, mtime });
  }
  found.sort((a, b) => b.mtime - a.mtime);
  if (found[0] && (!last || found[0].mtime > last.mtime)) {
    const n = found[0].m.slice(3).map(Number);
    last = { file: found[0].f, mtime: found[0].mtime, x: n[0], y: n[1], z: n[2], q: n.slice(3, 7), folder: SHOTS };
  }
  if (!KEEP_SHOTS) for (const s of found) deleteShot(path.join(SHOTS, s.f));
  if (found[0]) writeFile(FIX_FILE, JSON.stringify(last)).catch(() => {}); // survive a server restart
  return last || { none: true, folder: SHOTS };
}

const ICON_DIR = path.join(root, 'data', 'icons');
// Item icons come from assets.tarkov.dev; they are fetched once and cached so the browser can read their pixels.
async function serveIcon(res, id, variant = 'base-image', tag = 'b') {
  const file = path.join(ICON_DIR, id + '-' + tag + '.webp');
  try { return await serveFile(res, file, 'image/webp', 'public, max-age=86400'); } catch { /* not cached yet */ }
  try {
    const r = await fetch('https://assets.tarkov.dev/' + id + '-' + variant + '.webp');
    if (!r.ok) { res.writeHead(404); return res.end(); }
    const buf = Buffer.from(await r.arrayBuffer());
    await mkdir(ICON_DIR, { recursive: true });
    await writeFile(file, buf);
    res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=86400' });
    res.end(buf);
  } catch { res.writeHead(502); res.end(); }
}

// Newest menu screenshot (no coordinates in the name, so it is never deleted): used by the inventory reader.
async function latestMenuShot() {
  let files;
  try { files = await readdir(SHOTS); } catch { return null; }
  let best = null;
  for (const f of files) {
    if (!f.toLowerCase().endsWith('.png') || SHOT_RE.test(f)) continue;
    const st = await stat(path.join(SHOTS, f)).catch(() => null);
    if (st && (!best || st.mtimeMs > best.mtime)) best = { f, mtime: st.mtimeMs };
  }
  return best;
}

async function serveFile(res, file, type, cache = 'no-cache') {
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': type || TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(body);
  } catch (e) {
    if (type) throw e;
    res.writeHead(404); res.end('not found');
  }
}

// First run: download the map art and game data (needs an internet connection, takes a minute or two).
if (!existsSync(path.join(root, 'data', 'maps.json'))) {
  console.log('First run: downloading map and item data. This takes a minute or two...');
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'fetch-data.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('Setup failed. Check your internet connection and run: node scripts/fetch-data.mjs'); process.exit(1); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  if (p === '/api/position') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(await latestShot()));
  }
  if (p.startsWith('/icon/')) {
    const id = p.slice(6).replace(/.webp$/, '');
    if (!/^[0-9a-f]{24}$/.test(id)) { res.writeHead(400); return res.end(); }
    return serveIcon(res, id);
  }
  if (p.startsWith('/gicon/')) {
    const id = p.slice(7).replace(/.webp$/, '');
    if (!/^[0-9a-f]{24}$/.test(id)) { res.writeHead(400); return res.end(); }
    return serveIcon(res, id, 'grid-image', 'g');
  }
  if (p === '/api/menu-shot') {
    const b = await latestMenuShot();
    if (!b) { res.writeHead(404); return res.end('no menu screenshot found'); }
    res.setHeader('X-Shot-Name', encodeURIComponent(b.f));
    return serveFile(res, path.join(SHOTS, b.f), 'image/png', 'no-store').catch(() => { res.writeHead(500); res.end(); });
  }
  if (p === '/data/maps.json') return serveFile(res, path.join(root, 'data', 'maps.json'));
  if (p === '/data/hideout.json') return serveFile(res, path.join(root, 'data', 'hideout.json'));
  if (p === '/data/items.json') return serveFile(res, path.join(root, 'data', 'items.json'));
  if (p === '/data/ammo.json') return serveFile(res, path.join(root, 'data', 'ammo.json'));
  if (p === '/data/safe.json') return serveFile(res, path.join(root, 'data', 'safe.json'));
  if (p.startsWith('/data/svg/')) return serveFile(res, path.join(root, 'data', 'svg', path.basename(p)));
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const file = path.join(root, 'public', rel);
  if (!file.startsWith(path.join(root, 'public'))) { res.writeHead(403); return res.end(); }
  serveFile(res, file);
}).listen(PORT, '127.0.0.1', () => console.log(`Tarkov Wayfinder is running: http://localhost:${PORT}\nWatching for screenshots in: ${SHOTS}${KEEP_SHOTS ? ' (keeping them)' : ''}`));
