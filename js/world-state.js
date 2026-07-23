/* ============================================================
   创世引擎 · world-state.js — 战略地块与国家仓储状态
   只持久化变更；基础地形与拓扑由数据和种子确定性重建。
   ============================================================ */
window.GE = window.GE || {};

GE.worldState = (function () {
  'use strict';
  const KEY = 'genesis-engine-strategic-map-v1';
  const map = () => GE.data.strategicMap;
  let resolved = new Map();
  let warehouses = {};
  let revision = 0;
  let built = false;
  let regionSeeds = null;
  let capitalSeeds = null;

  function ensureSeeds() {
    if (regionSeeds && capitalSeeds) return;
    regionSeeds = Object.fromEntries(map().regions.map(region => [region.id, GE.worldGrid.nearestLatLon(region.lat, region.lon)]));
    capitalSeeds = Object.fromEntries(Object.entries(map().capitalSeeds).map(([civId, seed]) => [civId, GE.worldGrid.nearestLatLon(seed.lat, seed.lon)]));
  }
  function rng(v) {
    let n = Math.sin(v * 12.9898 + map().topology.seed * 0.0001) * 43758.5453;
    return n - Math.floor(n);
  }
  function angle(a, b) { return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))); }
  function terrainFor(grid) {
    const [x, y, z] = grid.center;
    const lat = Math.abs(grid.lat) / 90;
    const land = 0.55 * rng(x * 7 + y * 13 + z * 17) + 0.45 * rng(x * 23 - y * 11 + z * 5);
    if (land < .37) return 'ocean';
    if (land < .43) return 'coast';
    if (lat > .87) return 'ice';
    if (lat > .72) return 'tundra';
    if (land > .84) return 'mountain';
    if (land > .73) return 'hills';
    if (lat < .30 && rng(x * 31 + z * 19) < .43) return 'desert';
    return rng(y * 41 + z * 29) > .59 ? 'forest' : 'plains';
  }
  function regionFor(grid) {
    let best = null, score = Infinity;
    ensureSeeds();
    map().regions.forEach(region => {
      const seed = regionSeeds[region.id];
      const d = angle(grid.center, seed.center) * 180 / Math.PI;
      const weighted = d / region.radius;
      if (weighted < score) { score = weighted; best = region; }
    });
    return best;
  }
  function resourceFor(tile) {
    const r = rng(tile.index * 3.31);
    const out = [];
    const add = (resourceId, richness) => out.push({ resourceId, richness, discovered:true, exhausted:false });
    if (tile.terrain === 'plains') { add('food', 2 + Math.floor(r * 3)); if (r > .70) add('materials', 1); }
    if (tile.terrain === 'forest') { add('biomass', 2 + Math.floor(r * 3)); if (r > .76) add('essence', 1); }
    if (tile.terrain === 'hills' || tile.terrain === 'mountain') { add('metals', 2 + Math.floor(r * 3)); if (r > .64) add('rareMinerals', 1 + Math.floor(r * 2)); }
    if (tile.terrain === 'desert') { add('fuel', 1 + Math.floor(r * 3)); if (r > .72) add('essence', 1); }
    if (tile.terrain === 'coast' || tile.terrain === 'ocean') { add('food', 1 + Math.floor(r * 2)); if (r > .77) add('fuel', 1); }
    if (tile.terrain === 'tundra' || tile.terrain === 'ice') { if (r > .48) add('fuel', 1 + Math.floor(r * 2)); }
    return out;
  }
  function buildingFor(tile) {
    const r = rng(tile.index * 17.17);
    if (!tile.ownerCivId || r > .025) return [];
    const typeId = tile.terrain === 'plains' ? 'granary' : tile.terrain === 'forest' ? 'grove' :
      tile.terrain === 'hills' || tile.terrain === 'mountain' ? 'forge' : tile.terrain === 'coast' || tile.terrain === 'ocean' ? 'port' : 'extractor';
    return [{ id:`${typeId}-${tile.id}`, typeId, name:map().buildingCatalog[typeId].name, level:1 + Math.floor(rng(tile.index * 9) * 2), status:'运行中' }];
  }
  function initialOwner(grid, terrain) {
    const water = terrain === 'ocean' || terrain === 'coast';
    let found = null, score = Infinity;
    ensureSeeds();
    Object.entries(map().capitalSeeds).forEach(([civId]) => {
      const cap = capitalSeeds[civId];
      const d = angle(grid.center, cap.center) * 180 / Math.PI;
      const allowed = map().claimRadius[civId] + (rng(grid.index * 5 + cap.index) - .5) * 3;
      if (d < allowed && d < score && (civId === 'abyss' ? water : !water)) { found = civId; score = d; }
    });
    return found;
  }
  function templateWarehouse(civ) {
    const base = 420 + civ.stats.经济 * 9;
    const stock = {}, capacity = {}, produced = {}, consumed = {}, net = {};
    Object.keys(map().resourceCatalog).forEach((id, index) => {
      capacity[id] = Math.round(base * (index === 0 ? 2 : 1));
      stock[id] = Math.round(capacity[id] * (.36 + rng(civ.stats.人口 * (index + 3)) * .35));
      produced[id] = 0; consumed[id] = 0; net[id] = 0;
    });
    return { capacity, stock, lastTurn:{ produced, consumed, net }, reservePolicy:{ food:.35, fuel:.25, energy:.30 } };
  }
  function build() {
    if (built) return api;
    GE.worldGrid.build();
    GE.worldGrid.tiles.forEach(grid => {
      const terrain = terrainFor(grid);
      const region = regionFor(grid);
      const ownerCivId = initialOwner(grid, terrain);
      const tile = {
        ...grid, terrain, elevationBand:map().terrainCatalog[terrain].elevation,
        regionId:region.id, ownerCivId, status:ownerCivId ? '已开发' : terrain === 'ocean' ? '深海' : '未开发',
        resources:[], buildings:[], output:{}
      };
      tile.resources = resourceFor(tile);
      tile.buildings = buildingFor(tile);
      resolved.set(tile.id, tile);
    });
    GE.data.civs.forEach(c => { warehouses[c.id] = templateWarehouse(c); });
    hydrate();
    rebuildOutputs();
    built = true;
    return api;
  }
  function rebuildOutputs() {
    resolved.forEach(tile => {
      const output = {};
      tile.resources.forEach(r => { if (!r.exhausted) output[r.resourceId] = (output[r.resourceId] || 0) + r.richness; });
      tile.buildings.forEach(b => Object.entries(map().buildingCatalog[b.typeId]?.outputs || {}).forEach(([id, value]) => { output[id] = (output[id] || 0) + value * b.level; }));
      tile.output = output;
    });
  }
  function serialize() {
    const tilePatches = {};
    resolved.forEach(t => { if (t._changed) tilePatches[t.id] = { ownerCivId:t.ownerCivId, status:t.status, resources:t.resources, buildings:t.buildings }; });
    return { revision, warehouses, tilePatches };
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(serialize())); } catch (_) {} }
  function hydrate() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY)); if (!saved) return;
      revision = saved.revision || 0;
      if (saved.warehouses) warehouses = saved.warehouses;
      Object.entries(saved.tilePatches || {}).forEach(([id, patch]) => { const t = resolved.get(id); if (t) Object.assign(t, patch, { _changed:true }); });
    } catch (_) { /* invalid local state is ignored */ }
  }
  function getTile(id) { build(); return resolved.get(id) || null; }
  function getRegion(id) { return map().regions.find(r => r.id === id) || null; }
  function getTilesByCiv(civId) { build(); return [...resolved.values()].filter(t => t.ownerCivId === civId); }
  function getTilesByRegion(regionId) { build(); return [...resolved.values()].filter(t => t.regionId === regionId); }
  function getWarehouse(civId) { build(); return warehouses[civId] || null; }
  function getCivSummary(civId) {
    const tiles = getTilesByCiv(civId), regions = [...new Set(tiles.map(t => t.regionId))];
    const output = {}, buildings = [];
    tiles.forEach(t => { Object.entries(t.output).forEach(([id, v]) => output[id] = (output[id] || 0) + v); buildings.push(...t.buildings); });
    return { tiles, regions, output, buildings, areaKm2:tiles.length * Math.round(Math.pow(map().topology.nominalTileWidthKm, 2) * .87) };
  }
  function advanceTurn() {
    build();
    GE.data.civs.forEach(c => {
      const warehouse = warehouses[c.id], summary = getCivSummary(c.id);
      const produced = {}, consumed = {}, net = {};
      Object.keys(map().resourceCatalog).forEach(id => {
        const production = summary.output[id] || 0;
        const use = id === 'food' ? Math.max(1, Math.round(c.stats.人口 / 65)) : id === 'energy' ? Math.max(1, Math.round(c.level * 5 + c.stats.科研 / 18)) : id === 'fuel' ? Math.round(c.stats.军力 / 24) : 0;
        produced[id] = production; consumed[id] = use; net[id] = production - use;
        warehouse.stock[id] = Math.max(0, Math.min(warehouse.capacity[id], warehouse.stock[id] + net[id]));
      });
      warehouse.lastTurn = { produced, consumed, net };
    });
    revision++; persist();
    return revision;
  }
  function clearPersisted() { try { localStorage.removeItem(KEY); } catch (_) {} }
  const api = { build, getTile, getRegion, getTilesByCiv, getTilesByRegion, getWarehouse, getCivSummary, advanceTurn, persist, clearPersisted,
    get tiles(){ build(); return [...resolved.values()]; }, get revision(){ return revision; }, get resources(){ return map().resourceCatalog; }, get regions(){ return map().regions; } };
  return api;
})();
