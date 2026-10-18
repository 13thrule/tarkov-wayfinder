// Downloads the map config, extract data and SVG art, and builds data/maps.json.
// Run: node scripts/fetch-data.mjs
// api.tarkov.dev/graphql is down (since ~2026-07), so this uses json.tarkov.dev instead.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'data');
await mkdir(path.join(data, 'svg'), { recursive: true });

async function get(url, asText = false) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return asText ? r.text() : r.json();
}

console.log('Fetching map config + game data...');
const [config, raw, en, tasksRaw, tasksEn, itemsRaw, itemsEn, tradersRaw, tradersEn, hideoutRaw, hideoutEn, craftsRaw] = await Promise.all([
  get('https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json'),
  get('https://json.tarkov.dev/regular/maps'),
  get('https://json.tarkov.dev/regular/maps_en'),
  get('https://json.tarkov.dev/regular/tasks'),
  get('https://json.tarkov.dev/regular/tasks_en'),
  get('https://json.tarkov.dev/regular/items'),
  get('https://json.tarkov.dev/regular/items_en'),
  get('https://json.tarkov.dev/regular/traders'),
  get('https://json.tarkov.dev/regular/traders_en'),
  get('https://json.tarkov.dev/regular/hideout'),
  get('https://json.tarkov.dev/regular/hideout_en'),
  get('https://json.tarkov.dev/regular/crafts'),
]);
const traderName = (id) => tradersEn.data[id + ' Nickname'] ?? id;
const BOSS_SKIP = /^(PmcBot|ExUsec|exUsecFree|pmcBot|followerBully|Sentry|vs|blackDivision|bossBullyBlackDiv|bossWedge|bossTagillaAgro|bossScourge)/i;
const itemName = (id) => itemsEn.data[id + ' Name'] ?? null;
const tn = tasksEn.data;
const tasks = Array.isArray(tasksRaw.data.tasks) ? tasksRaw.data.tasks : Object.values(tasksRaw.data.tasks);
const ALIAS = { 'night-factory': 'factory', 'ground-zero-21': 'ground-zero', 'the-lab-dark': 'the-lab' };
const idToSlug = new Map(Object.values(raw.data.maps).map((m) => [m.id, ALIAS[m.normalizedName] ?? m.normalizedName]));
const lootNames = new Map(Object.values(raw.data.lootContainers).map((c) => [c.id, en[c.name] || c.normalizedName]));
const r1 = (n) => Math.round(n * 10) / 10;
const names = en.data;
const byNorm = new Map(Object.values(raw.data.maps).map((m) => [m.normalizedName, m]));
const t = (k) => names[k] ?? names[k + ' Name'] ?? null;

const out = [];
for (const entry of config) {
  const cfg = entry.maps.find((m) => m.projection === 'interactive');
  const game = byNorm.get(entry.normalizedName);
  if (!cfg || !game) continue;

  let svgFile = null;
  if (cfg.svgPath) {
    svgFile = cfg.svgPath.split('/').pop();
    const dest = path.join(data, 'svg', svgFile);
    if (!existsSync(dest)) {
      console.log('  svg', svgFile);
      await writeFile(dest, await get(cfg.svgPath, true));
    }
  }

  out.push({
    slug: entry.normalizedName,
    name: t(game.id) ?? game.name,
    config: {
      transform: cfg.transform,
      rotation: cfg.coordinateRotation,
      bounds: cfg.bounds,
      svgBounds: cfg.svgBounds ?? null,
      svgLayer: cfg.svgLayer ?? null,
      layers: cfg.layers ?? [],
      heightRange: cfg.heightRange ?? null,
      minZoom: cfg.minZoom ?? 1,
      maxZoom: cfg.maxZoom ?? 6,
      tilePath: cfg.tilePath ?? null,
      svgFile,
      author: cfg.author ?? null,
    },
    extracts: (game.extracts ?? []).map((e) => ({
      name: t(e.name) ?? e.name,
      rawName: e.name,
      faction: e.faction,
      paid: !!e.transferItem,
      x: e.position.x, y: e.position.y, z: e.position.z,
    })),
    transits: (game.transits ?? []).map((tr) => ({
      name: t(tr.description?.replace(/_DESC$/, '_DESC')) ?? t(tr.description) ?? tr.description,
      x: tr.position.x, y: tr.position.y, z: tr.position.z,
    })),
    ...lootAndQuests(entry.normalizedName, game),
    intel: intel(game),
    spawns: (game.spawns ?? [])
      .filter((s) => s.categories?.includes('player'))
      .map((s) => ({ sides: s.sides, zone: s.zoneName, x: s.position.x, y: s.position.y, z: s.position.z })),
  });
}

const allItems = Array.isArray(itemsRaw.data.items) ? itemsRaw.data.items : Object.values(itemsRaw.data.items);
const ammo = allItems.filter((i) => i.properties?.propertiesType === 'ItemPropertiesAmmo' && !i.types?.includes('disabled')).map((i) => {
  const p = i.properties;
  return {
    id: i.id, name: itemName(i.id) ?? i.normalizedName, short: itemsEn.data[i.id + ' ShortName'] ?? null,
    caliber: String(p.caliber ?? '').replace(/^Caliber/, ''), dmg: p.damage ?? 0, pen: p.penetrationPower ?? 0, armor: p.armorDamage ?? 0,
    frag: Math.round((p.fragmentationChance ?? 0) * 100), speed: Math.round(p.initialSpeed ?? 0), proj: p.projectileCount ?? 1,
    tracer: !!p.tracer, sub: (p.initialSpeed ?? 999) < 343, image: i.iconLink ?? null,
  };
}).filter((a) => a.dmg || a.pen);
await writeFile(path.join(data, 'ammo.json'), JSON.stringify(ammo));

// The data ties many car trunks to two unrelated keys (Factory emergency exit key, USEC cottage second
// safe key). That looks like placeholder data, so trunks whose key is shared by 5+ trunks are not
// attributed to that key.
const trunkCount = new Map();
for (const m of out) for (const l of m.intel.locks) if (l.type === 'trunk') trunkCount.set(l.keyId, (trunkCount.get(l.keyId) ?? 0) + 1);
for (const m of out) {
  for (const l of m.intel.locks) {
    if (l.type === 'trunk' && trunkCount.get(l.keyId) >= 5) { l.key = 'Car trunk (key not confirmed)'; l.keyId = null; }
  }
}

// Items: flea prices, best trader buy/sell, and which map doors each key opens.
const opens = new Map(); // keyId -> { slug: doorCount }
for (const m of out) {
  for (const l of m.intel.locks) {
    if (!l.keyId) continue;
    const o = opens.get(l.keyId) ?? {};
    o[m.slug] = (o[m.slug] ?? 0) + 1;
    opens.set(l.keyId, o);
  }
}
const items = [];
for (const i of allItems) {
  const name = itemName(i.id);
  if (!name || i.types?.includes('disabled')) continue;
  const sells = (i.sellToTrader ?? []).filter((s) => s.priceRUB > 0).sort((a, b) => b.priceRUB - a.priceRUB);
  const buys = (i.buyFromTrader ?? []).filter((b) => b.priceRUB > 0).sort((a, b) => a.priceRUB - b.priceRUB);
  const isKey = i.properties?.propertiesType === 'ItemPropertiesKey';
  if (!i.avg24hPrice && !i.lastLowPrice && !sells.length && !buys.length && !isKey) continue;
  items.push({
    id: i.id, n: name, s: itemsEn.data[i.id + ' ShortName'] ?? null, w: i.width ?? 1, h: i.height ?? 1,
    base: i.basePrice ?? 0, avg: i.avg24hPrice ?? null, low: i.lastLowPrice ?? null, scan: i.lastScan ?? null, flea: i.types?.includes('noFlea') ? 0 : 1,
    sell: sells[0] ? { t: traderName(sells[0].trader), p: sells[0].priceRUB } : null,
    buy: buys[0] ? { t: traderName(buys[0].trader), p: buys[0].priceRUB, lvl: buys[0].minTraderLevel ?? null } : null,
    key: isKey ? { uses: i.properties.uses ?? null, opens: opens.get(i.id) ?? {} } : null,
    gun: i.types?.includes('gun') ? 1 : 0, stack: i.properties?.stackMaxSize > 1 ? i.properties.stackMaxSize : 0,
    wiki: i.wikiLink ?? null,
  });
}
await writeFile(path.join(data, 'items.json'), JSON.stringify(items));

// Hideout upgrades and crafts, with a name and a rouble value for every item they reference.
const stationList = Object.values(hideoutRaw.data);
const craftList = Array.isArray(craftsRaw.data) ? craftsRaw.data : Object.values(craftsRaw.data);
const byItem = new Map(allItems.map((i) => [i.id, i]));
const used = new Set();
const useItem = (id) => { used.add(id); return id; };
const stationName = new Map(stationList.map((s) => [s.id, hideoutEn.data[s.name] ?? s.normalizedName]));
const stations = stationList.map((s) => ({
  id: s.id, name: stationName.get(s.id),
  levels: (s.levels ?? []).map((l) => ({
    level: l.level, time: l.constructionTime ?? 0,
    items: (l.itemRequirements ?? []).map((r) => ({ id: useItem(r.item), c: r.count, fir: !!r.attributes?.foundInRaid })),
    stations: (l.stationLevelRequirements ?? []).map((r) => ({ name: stationName.get(r.station) ?? '?', level: r.level })),
    traders: (l.traderRequirements ?? []).map((r) => ({ name: traderName(r.trader), level: r.level ?? r.value ?? null })),
    skills: (l.skillRequirements ?? []).map((r) => ({ skill: r.skill, level: r.level })),
  })),
}));
const crafts = craftList.map((c) => ({
  id: c.id, station: stationName.get(c.station) ?? '?', level: c.level ?? 1, dur: c.duration ?? 0,
  inp: (c.requiredItems ?? []).map((r) => ({ id: useItem(r.item), c: r.count, tool: !!r.attributes?.tool })),
  out: c.productItem ? { id: useItem(c.productItem.item), c: c.productItem.count ?? 1 } : null,
})).filter((c) => c.out);
const ROUBLES = '5449016a4bdc2d6f028b456f';
const itemNames = {};
const value = {};
for (const id of used) {
  itemNames[id] = itemName(id) ?? id;
  const it = byItem.get(id);
  const sell = (it?.sellToTrader ?? []).reduce((m, s) => Math.max(m, s.priceRUB ?? 0), 0);
  value[id] = id === ROUBLES ? 1 : (it?.avg24hPrice || it?.lastLowPrice || sell || it?.basePrice || 0);
}
await writeFile(path.join(data, 'hideout.json'), JSON.stringify({ stations, crafts, names: itemNames, value }));
console.log('hideout stations', stations.length, 'crafts', crafts.length, 'items referenced', used.size);
console.log('items', items.length, 'keys', items.filter((x) => x.key).length, 'keys with known doors', items.filter((x) => x.key && Object.keys(x.key.opens).length).length);
console.log('ammo', ammo.length);
await writeFile(path.join(data, 'maps.json'), JSON.stringify({ fetched: new Date().toISOString(), maps: out }));
for (const m of out) {
  console.log(m.slug.padEnd(16), 'loot', String(m.loot.containers.length).padStart(3), 'quests', String(m.quests.length).padStart(3), 'extracts', String(m.extracts.length).padStart(2), 'transits', m.transits.length, 'spawns', m.spawns.length, m.config.svgFile ?? (m.config.tilePath ? '(tiles)' : '(no art)'));
}

function lootAndQuests(slug, game) {
  const types = [];
  const typeIdx = new Map();
  const containers = [];
  for (const c of game.lootContainers ?? []) {
    const name = lootNames.get(c.lootContainer);
    if (!name) continue;
    if (!typeIdx.has(name)) { typeIdx.set(name, types.length); types.push(name); }
    containers.push([typeIdx.get(name), r1(c.position.x), r1(c.position.y), r1(c.position.z)]);
  }
  const loose = (game.lootLoose ?? []).map((l) => [r1(l.position.x), r1(l.position.y), r1(l.position.z), l.items?.length ?? 0]);

  const ids = new Set([...idToSlug].filter(([, sl]) => sl === slug).map(([id]) => id));
  const quests = [];
  for (const t of tasks) {
    const objs = [];
    for (const o of t.objectives ?? []) {
      const text = tn[o.description] ?? o.type;
      const pts = [];
      const zones = [];
      for (const z of o.zones ?? []) {
        if (!ids.has(z.map)) continue;
        pts.push([r1(z.position.x), r1(z.position.y), r1(z.position.z)]);
        if (z.outline?.length) zones.push(z.outline.map((p) => [r1(p.x), r1(p.z)]));
      }
      for (const pl of o.possibleLocations ?? []) {
        if (!ids.has(pl.map)) continue;
        for (const p of pl.positions.slice(0, 12)) pts.push([r1(p.x), r1(p.y), r1(p.z)]);
      }
      if (pts.length) objs.push({ text, type: o.type, optional: !!o.optional, pts, zones });
    }
    if (objs.length) quests.push({ id: t.id, name: tn[t.name] ?? t.name, level: t.minPlayerLevel ?? 0, wiki: t.wikiLink ?? null, objs });
  }
  quests.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return { loot: { types, containers, loose }, quests };
}

function intel(game) {
  const clean = (n) => String(n ?? '').replace(/^Zone/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  const byBoss = new Map();
  for (const b of game.bosses ?? []) {
    if (!/^boss|^sectant/i.test(b.mob) || BOSS_SKIP.test(b.mob)) continue;
    const name = names[b.mob] ?? clean(b.mob);
    const e = byBoss.get(name) ?? { name, chance: 0, locs: [], escorts: 0 };
    e.chance = Math.max(e.chance, Math.round((b.spawnChance ?? 0) * 100));
    e.escorts = Math.max(e.escorts, (b.escorts ?? []).reduce((n, x) => n + (x.amount?.[0]?.count ?? 0), 0));
    for (const l of b.spawnLocations ?? []) {
      const pos = l.positions ?? [];
      const x = pos.length ? pos.reduce((a, p) => a + p.x, 0) / pos.length : null;
      const z = pos.length ? pos.reduce((a, p) => a + p.z, 0) / pos.length : null;
      e.locs.push({ name: clean(l.name), chance: Math.round((l.chance ?? 0) * 100), x: x == null ? null : r1(x), z: z == null ? null : r1(z) });
    }
    byBoss.set(name, e);
  }
  return {
    raidMinutes: game.raidDuration ?? null,
    bosses: [...byBoss.values()],
    locks: (game.locks ?? []).map((l) => ({ keyId: l.key, key: itemName(l.key) ?? 'Unknown key', type: l.lockType, power: !!l.needsPower, x: r1(l.position.x), y: r1(l.position.y), z: r1(l.position.z) })),
    hazards: (game.hazards ?? []).filter((h) => h.outline?.length).map((h) => ({ type: h.hazardType, name: clean(h.name), poly: h.outline.map((p) => [r1(p.x), r1(p.z)]) })),
    switches: (game.switches ?? []).map((w) => ({ x: r1(w.position.x), y: r1(w.position.y), z: r1(w.position.z) })),
    btr: (game.btrStops ?? []).map((b) => ({ x: r1(b.position?.x ?? b.x), z: r1(b.position?.z ?? b.z) })).filter((b) => Number.isFinite(b.x)),
  };
}
