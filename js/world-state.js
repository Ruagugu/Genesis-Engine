/* ============================================================
   创世引擎 · world-state.js — 战略地块与国家仓储状态
   只持久化变更；基础地形与拓扑由数据和种子确定性重建。
   支持按 surfaceDef 多实例；GE.worldState 为「当前激活表面」门面。
   ============================================================ */
window.GE = window.GE || {};

/**
 * @param {object} surfaceDef  含 topology / regions / catalogs / capitalSeeds / claimRadius
 * @param {{ storageKey: string, grid?: object }} options
 *   grid 可选；缺省时使用 GE.worldGrid（须已绑定到同一表面）
 */
GE.createWorldState = function createWorldState(surfaceDef, options) {
  'use strict';
  if (!surfaceDef) throw new Error('createWorldState: surfaceDef required');
  options = options || {};
  const KEY = options.storageKey || ('genesis-engine-surface-' + (surfaceDef.id || 'default') + '-v1');
  const map = () => surfaceDef;
  const gridApi = () => options.grid || GE.worldGrid;

  let resolved = new Map();
  let warehouses = {};
  let revision = 0;
  let built = false;
  let regionSeeds = null;
  let capitalSeeds = null;

  function ensureSeeds() {
    if (regionSeeds && capitalSeeds) return;
    const g = gridApi();
    regionSeeds = Object.fromEntries(map().regions.map(region => [region.id, g.nearestLatLon(region.lat, region.lon)]));
    capitalSeeds = Object.fromEntries(Object.entries(map().capitalSeeds || {}).map(([civId, seed]) => [civId, g.nearestLatLon(seed.lat, seed.lon)]));
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
    // 气候配置：海洋阈值等可按 surface 覆盖
    const hydrosphere = map().climateProfile && map().climateProfile.hydrosphere != null
      ? map().climateProfile.hydrosphere : 0.37;
    if (land < hydrosphere) return 'ocean';
    if (land < hydrosphere + 0.06) return 'coast';
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
    const catalog = map().buildingCatalog;
    const typeId = tile.terrain === 'plains' ? 'granary' : tile.terrain === 'forest' ? 'grove' :
      tile.terrain === 'hills' || tile.terrain === 'mountain' ? 'forge' : tile.terrain === 'coast' || tile.terrain === 'ocean' ? 'port' : 'extractor';
    if (!catalog[typeId]) return [];
    return [{ id:`${typeId}-${tile.id}`, typeId, name:catalog[typeId].name, level:1 + Math.floor(rng(tile.index * 9) * 2), status:'运行中' }];
  }
  function initialOwner(grid, terrain) {
    const water = terrain === 'ocean' || terrain === 'coast';
    let found = null, score = Infinity;
    ensureSeeds();
    const claims = map().claimRadius || {};
    Object.entries(map().capitalSeeds || {}).forEach(([civId]) => {
      const cap = capitalSeeds[civId];
      if (!cap) return;
      const d = angle(grid.center, cap.center) * 180 / Math.PI;
      const radius = claims[civId] != null ? claims[civId] : 12;
      const allowed = radius + (rng(grid.index * 5 + cap.index) - .5) * 3;
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
    const g = gridApi();
    g.build();
    g.tiles.forEach(grid => {
      const terrain = terrainFor(grid);
      const region = regionFor(grid);
      const ownerCivId = initialOwner(grid, terrain);
      const terrainMeta = map().terrainCatalog[terrain] || { elevation: '低地' };
      const tile = {
        ...grid, terrain, elevationBand: terrainMeta.elevation,
        regionId: region ? region.id : (map().regions[0] && map().regions[0].id),
        ownerCivId, status:ownerCivId ? '已开发' : terrain === 'ocean' ? '深海' : '未开发',
        resources:[], buildings:[], output:{}
      };
      tile.resources = resourceFor(tile);
      tile.buildings = buildingFor(tile);
      resolved.set(tile.id, tile);
    });
    // 仅对在本表面有 capital 的文明建仓；其余文明不建行星仓（帝国总仓后置）
    const presentCivIds = new Set(Object.keys(map().capitalSeeds || {}));
    GE.data.civs.forEach(c => {
      if (presentCivIds.size === 0 || presentCivIds.has(c.id)) {
        warehouses[c.id] = templateWarehouse(c);
      }
    });
    // 若有领地但无 capital 配置（纯勘察星），仍给有地块的文明建仓
    resolved.forEach(t => {
      if (t.ownerCivId && !warehouses[t.ownerCivId]) {
        const civ = GE.data.civs.find(c => c.id === t.ownerCivId);
        if (civ) warehouses[t.ownerCivId] = templateWarehouse(civ);
      }
    });
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
    return { revision, warehouses, tilePatches, surfaceId: surfaceDef.id };
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
    Object.keys(warehouses).forEach(civId => {
      const c = GE.data.civs.find(x => x.id === civId);
      if (!c) return;
      const warehouse = warehouses[civId], summary = getCivSummary(civId);
      const produced = {}, consumed = {}, net = {};
      Object.keys(map().resourceCatalog).forEach(id => {
        const production = summary.output[id] || 0;
        const use = id === 'food' ? Math.max(1, Math.round(c.stats.人口 / 65)) : id === 'energy' ? Math.max(1, Math.round(c.level * 5 + c.stats.科研 / 18)) : id === 'fuel' ? Math.round(c.stats.军力 / 24) : 0;
        // 非母星表面：消耗按本星存在度打折（MVP：有领地才按 15% 人口当量）
        const scale = surfaceDef.bodyId === 'gaiya' ? 1 : Math.min(1, Math.max(0.05, tilesOwnedRatio(civId)));
        const useScaled = Math.round(use * scale);
        produced[id] = production; consumed[id] = useScaled; net[id] = production - useScaled;
        warehouse.stock[id] = Math.max(0, Math.min(warehouse.capacity[id], warehouse.stock[id] + net[id]));
      });
      warehouse.lastTurn = { produced, consumed, net };
    });
    revision++; persist();
    return revision;
  }
  function tilesOwnedRatio(civId) {
    const all = [...resolved.values()];
    if (!all.length) return 0;
    return all.filter(t => t.ownerCivId === civId).length / all.length;
  }
  function clearPersisted() { try { localStorage.removeItem(KEY); } catch (_) {} }

  const api = {
    build, getTile, getRegion, getTilesByCiv, getTilesByRegion, getWarehouse, getCivSummary, advanceTurn, persist, clearPersisted,
    get surfaceId() { return surfaceDef.id; },
    get bodyId() { return surfaceDef.bodyId; },
    get def() { return surfaceDef; },
    get storageKey() { return KEY; },
    get tiles(){ build(); return [...resolved.values()]; },
    get revision(){ return revision; },
    get resources(){ return map().resourceCatalog; },
    get regions(){ return map().regions; }
  };
  return api;
};

/** 当前激活表面状态门面；由 SurfaceRegistry.activate 绑定。 */
GE.worldState = (function () {
  'use strict';
  let active = null;

  function requireActive() {
    if (!active) {
      if (GE.surfaces && typeof GE.surfaces.ensure === 'function') {
        const bodyId = (GE.app && GE.app.state && GE.app.state.activeBodyId) || 'gaiya';
        GE.surfaces.activate(bodyId);
      }
      if (!active) throw new Error('GE.worldState: no active surface');
    }
    return active;
  }

  return {
    bind(state) { active = state || null; },
    get active() { return active; },
    build() { return requireActive().build(); },
    getTile(id) { return requireActive().getTile(id); },
    getRegion(id) { return requireActive().getRegion(id); },
    getTilesByCiv(id) { return requireActive().getTilesByCiv(id); },
    getTilesByRegion(id) { return requireActive().getTilesByRegion(id); },
    getWarehouse(id) { return requireActive().getWarehouse(id); },
    getCivSummary(id) { return requireActive().getCivSummary(id); },
    advanceTurn() { return requireActive().advanceTurn(); },
    persist() { return requireActive().persist(); },
    clearPersisted() { return requireActive().clearPersisted(); },
    get tiles() { return requireActive().tiles; },
    get revision() { return requireActive().revision; },
    get resources() { return requireActive().resources; },
    get regions() { return requireActive().regions; },
    get surfaceId() { return active ? active.surfaceId : null; },
    get bodyId() { return active ? active.bodyId : null; },
    get def() { return active ? active.def : null; }
  };
})();
