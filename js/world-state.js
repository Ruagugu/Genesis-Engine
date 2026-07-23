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
  const KEY = options.storageKey || ('genesis-engine-surface-' + (surfaceDef.id || 'default') + '-v2');
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

  /** biomeKind: terrestrial | arid_rock | airless_moon | cold_dwarf */
  function biomeKind() {
    if (map().biomeKind) return map().biomeKind;
    const cp = map().climateProfile || {};
    const body = (GE.data.spaceBodies || []).find(b => b.id === map().bodyId);
    const type = body && body.type;
    if (type === '卫星') return 'airless_moon';
    if (type === '矮行星' || cp.meanTemp === 'frigid') return 'cold_dwarf';
    if (type === '岩质行星' || cp.meanTemp === 'hot') return 'arid_rock';
    return 'terrestrial';
  }

  function terrainFor(grid) {
    const [x, y, z] = grid.center;
    const lat = Math.abs(grid.lat) / 90;
    const noise = 0.55 * rng(x * 7 + y * 13 + z * 17) + 0.45 * rng(x * 23 - y * 11 + z * 5);
    const fine = rng(x * 31 + z * 19);
    const kind = biomeKind();
    const cp = map().climateProfile || {};
    const hydrosphere = cp.hydrosphere != null ? cp.hydrosphere : 0.37;
    const energy = cp.energyAffinity != null ? cp.energyAffinity : 0.3;

    if (kind === 'terrestrial') {
      if (noise < hydrosphere) return 'ocean';
      if (noise < hydrosphere + 0.06) return 'coast';
      if (lat > .87) return 'ice';
      if (lat > .72) return 'tundra';
      if (noise > .84) return 'mountain';
      if (noise > .73) return 'hills';
      if (lat < .30 && fine < .43) return 'desert';
      return rng(y * 41 + z * 29) > .59 ? 'forest' : 'plains';
    }

    if (kind === 'arid_rock') {
      // 几乎无开放水体；永影盆地算「可庇护」低地
      if (lat > .78 && noise < 0.42) return 'shadow_basin';
      if (noise > 0.82 || (fine > 0.85 && lat > 0.35)) return 'volcanic_ridge';
      if (noise > 0.68 || Math.abs(Math.sin(grid.lat * 0.08 + fine * 4)) > 0.78) return 'rift';
      if (noise < 0.38) return 'basalt';
      return 'glass_plain';
    }

    if (kind === 'airless_moon') {
      // 永久阴影坑（极地 + 低噪声）
      if (lat > 0.82 && noise < 0.48) return 'psr';
      if (fine > 0.78) return 'crater';
      if (noise < 0.42) return 'mare';
      if (noise > 0.72) return 'highlands';
      return 'regolith';
    }

    // cold_dwarf
    if (noise > 0.78 && energy > 0.02 && fine > 0.55) return 'essence_vein';
    if (lat > 0.7) return 'dark_ice';
    if (noise < 0.4) return 'dust_basin';
    if (fine > 0.6) return 'frost_plain';
    return 'dark_ice';
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
    const add = (resourceId, richness) => {
      if (!map().resourceCatalog[resourceId]) return;
      out.push({ resourceId, richness, discovered: true, exhausted: false });
    };
    const t = tile.terrain;
    const kind = biomeKind();

    if (kind === 'terrestrial') {
      if (t === 'plains') { add('food', 2 + Math.floor(r * 3)); if (r > .70) add('materials', 1); }
      if (t === 'forest') { add('biomass', 2 + Math.floor(r * 3)); if (r > .76) add('essence', 1); }
      if (t === 'hills' || t === 'mountain') { add('metals', 2 + Math.floor(r * 3)); if (r > .64) add('rareMinerals', 1 + Math.floor(r * 2)); }
      if (t === 'desert') { add('fuel', 1 + Math.floor(r * 3)); if (r > .72) add('essence', 1); }
      if (t === 'coast' || t === 'ocean') { add('food', 1 + Math.floor(r * 2)); if (r > .77) add('fuel', 1); }
      if (t === 'tundra' || t === 'ice') { if (r > .48) add('fuel', 1 + Math.floor(r * 2)); }
      return out;
    }

    if (kind === 'arid_rock') {
      if (t === 'glass_plain') { add('materials', 1 + Math.floor(r * 2)); if (r > .55) add('sulfur', 1 + Math.floor(r * 2)); }
      if (t === 'basalt') { add('metals', 2 + Math.floor(r * 2)); add('materials', 1); }
      if (t === 'rift') { add('metals', 2 + Math.floor(r * 3)); add('rareMinerals', 1 + Math.floor(r * 2)); if (r > .5) add('sulfur', 2); }
      if (t === 'volcanic_ridge') { add('sulfur', 2 + Math.floor(r * 3)); add('fuel', 1 + Math.floor(r * 2)); if (r > .6) add('energy', 1); }
      if (t === 'shadow_basin') { add('materials', 1); if (r > .4) add('iceWater', 1 + Math.floor(r * 2)); if (r > .7) add('essence', 1); }
      if (!out.length) add('materials', 1);
      return out;
    }

    if (kind === 'airless_moon') {
      if (t === 'mare') { add('regolithOre', 2 + Math.floor(r * 2)); if (r > .55) add('metals', 1); if (r > .72) add('helium3', 1); }
      if (t === 'highlands') { add('regolithOre', 1 + Math.floor(r * 2)); add('materials', 1 + Math.floor(r * 2)); }
      if (t === 'crater') { add('metals', 1 + Math.floor(r * 2)); if (r > .5) add('rareMinerals', 1); }
      if (t === 'psr') { add('iceWater', 2 + Math.floor(r * 3)); if (r > .45) add('helium3', 1 + Math.floor(r * 2)); }
      if (t === 'regolith') { add('regolithOre', 2 + Math.floor(r * 2)); if (r > .65) add('helium3', 1); }
      if (!out.length) add('regolithOre', 1);
      return out;
    }

    // cold_dwarf
    if (t === 'frost_plain') { add('iceWater', 2 + Math.floor(r * 2)); add('materials', 1); }
    if (t === 'dark_ice') { add('iceWater', 1 + Math.floor(r * 2)); add('metals', 1); if (r > .6) add('rareMinerals', 1); }
    if (t === 'dust_basin') { add('regolithOre', 1 + Math.floor(r * 2)); add('fuel', 1); }
    if (t === 'essence_vein') { add('essence', 2 + Math.floor(r * 3)); if (r > .4) add('energy', 1 + Math.floor(r * 2)); }
    if (!out.length) add('iceWater', 1);
    return out;
  }

  function buildingFor(tile) {
    const r = rng(tile.index * 17.17);
    if (!tile.ownerCivId || r > .025) return [];
    const catalog = map().buildingCatalog;
    const t = tile.terrain;
    const kind = biomeKind();
    let typeId = null;
    if (kind === 'terrestrial') {
      typeId = t === 'plains' ? 'granary' : t === 'forest' ? 'grove' :
        t === 'hills' || t === 'mountain' ? 'forge' : t === 'coast' || t === 'ocean' ? 'port' : 'extractor';
    } else if (kind === 'arid_rock') {
      typeId = t === 'rift' || t === 'basalt' ? 'drill' : t === 'volcanic_ridge' ? 'extractor' :
        t === 'shadow_basin' ? 'icePlant' : 'solarArray';
    } else if (kind === 'airless_moon') {
      typeId = t === 'psr' ? 'icePlant' : t === 'mare' || t === 'regolith' ? 'solarArray' : 'drill';
    } else {
      typeId = t === 'essence_vein' ? 'essenceTap' : t === 'frost_plain' || t === 'dark_ice' ? 'icePlant' : 'drill';
    }
    if (!typeId || !catalog[typeId]) return [];
    return [{ id: `${typeId}-${tile.id}`, typeId, name: catalog[typeId].name, level: 1 + Math.floor(rng(tile.index * 9) * 2), status: '运行中' }];
  }

  function isWaterTerrain(terrain) {
    return terrain === 'ocean' || terrain === 'coast';
  }

  function initialOwner(grid, terrain) {
    // 无人殖民表面：无 capitalSeeds → 全无主
    const claims = map().claimRadius || {};
    const seeds = map().capitalSeeds || {};
    if (!Object.keys(seeds).length) return null;
    const water = isWaterTerrain(terrain);
    let found = null, score = Infinity;
    ensureSeeds();
    Object.entries(seeds).forEach(([civId]) => {
      const cap = capitalSeeds[civId];
      if (!cap) return;
      const d = angle(grid.center, cap.center) * 180 / Math.PI;
      const radius = claims[civId] != null ? claims[civId] : 12;
      const allowed = radius + (rng(grid.index * 5 + cap.index) - .5) * 3;
      if (d < allowed && d < score && (civId === 'abyss' ? water : !water)) { found = civId; score = d; }
    });
    return found;
  }

  function statusFor(terrain, ownerCivId) {
    if (ownerCivId) return '已开发';
    if (isWaterTerrain(terrain)) return '深海';
    if (terrain === 'psr') return '永夜未勘';
    if (terrain === 'shadow_basin') return '永影未勘';
    if (terrain === 'glass_plain' || terrain === 'rift') return '炙热荒原';
    if (terrain === 'mare' || terrain === 'regolith' || terrain === 'highlands') return '真空表面';
    if (terrain === 'frost_plain' || terrain === 'dark_ice' || terrain === 'dust_basin') return '寒寂';
    if (terrain === 'essence_vein') return '灵脉外露';
    return '未开发';
  }

  function templateWarehouse(civ) {
    const base = 420 + civ.stats.经济 * 9;
    const stock = {}, capacity = {}, produced = {}, consumed = {}, net = {};
    // 仅初始化本表面会出现的资源键（+ 通用）
    const keys = Object.keys(map().resourceCatalog);
    keys.forEach((id, index) => {
      capacity[id] = Math.round(base * (index === 0 ? 2 : 1) * (biomeKind() === 'terrestrial' ? 1 : 0.45));
      stock[id] = Math.round(capacity[id] * (.2 + rng(civ.stats.人口 * (index + 3)) * .25));
      produced[id] = 0; consumed[id] = 0; net[id] = 0;
    });
    return { capacity, stock, lastTurn: { produced, consumed, net }, reservePolicy: { food: .35, fuel: .25, energy: .30, iceWater: .4 } };
  }
  function normalizeWarehouse(civ, warehouse) {
    const base = 420 + civ.stats.经济 * 9;
    const defaults = { food: .35, fuel: .25, energy: .30, iceWater: .4 };
    warehouse = warehouse || {};
    warehouse.capacity = warehouse.capacity || {};
    warehouse.stock = warehouse.stock || {};
    warehouse.lastTurn = warehouse.lastTurn || {};
    warehouse.lastTurn.produced = warehouse.lastTurn.produced || {};
    warehouse.lastTurn.consumed = warehouse.lastTurn.consumed || {};
    warehouse.lastTurn.net = warehouse.lastTurn.net || {};
    warehouse.reservePolicy = Object.assign({}, defaults, warehouse.reservePolicy || {});
    Object.keys(map().resourceCatalog).forEach((id, index) => {
      if (!Number.isFinite(warehouse.capacity[id])) {
        warehouse.capacity[id] = Math.round(base * (index === 0 ? 2 : 1) * (biomeKind() === 'terrestrial' ? 1 : 0.45));
      }
      if (!Number.isFinite(warehouse.stock[id])) warehouse.stock[id] = 0;
      if (!Number.isFinite(warehouse.lastTurn.produced[id])) warehouse.lastTurn.produced[id] = 0;
      if (!Number.isFinite(warehouse.lastTurn.consumed[id])) warehouse.lastTurn.consumed[id] = 0;
      if (!Number.isFinite(warehouse.lastTurn.net[id])) warehouse.lastTurn.net[id] = 0;
    });
    return warehouse;
  }
  function build() {
    if (built) return api;
    const g = gridApi();
    g.build();
    g.tiles.forEach(grid => {
      const terrain = terrainFor(grid);
      const region = regionFor(grid);
      const ownerCivId = initialOwner(grid, terrain);
      const terrainMeta = map().terrainCatalog[terrain] || { elevation: '低地', name: terrain };
      const tile = {
        ...grid, terrain, elevationBand: terrainMeta.elevation,
        regionId: region ? region.id : (map().regions[0] && map().regions[0].id),
        ownerCivId, status: statusFor(terrain, ownerCivId),
        resources: [], buildings: [], output: {}
      };
      tile.resources = resourceFor(tile);
      tile.buildings = buildingFor(tile);
      resolved.set(tile.id, tile);
    });
    // 仅对在本表面有 capital 的文明建仓；其余文明不建行星仓（帝国总仓后置）
    const presentCivIds = new Set(Object.keys(map().capitalSeeds || {}));
    GE.data.civs.forEach(c => {
      if (presentCivIds.has(c.id)) {
        warehouses[c.id] = templateWarehouse(c);
      }
    });
    hydrate();
    // 只有首都或实际领地才能支撑行星仓；同时清理旧版本写入空表面的幽灵仓
    const establishedCivIds = new Set(presentCivIds);
    resolved.forEach(t => { if (t.ownerCivId) establishedCivIds.add(t.ownerCivId); });
    Object.keys(warehouses).forEach(civId => {
      if (!establishedCivIds.has(civId)) delete warehouses[civId];
    });
    establishedCivIds.forEach(civId => {
      if (warehouses[civId]) return;
      const civ = GE.data.civs.find(c => c.id === civId);
      if (civ) warehouses[civId] = templateWarehouse(civ);
    });
    Object.entries(warehouses).forEach(([civId, warehouse]) => {
      const civ = GE.data.civs.find(c => c.id === civId);
      if (civ) warehouses[civId] = normalizeWarehouse(civ, warehouse);
      else delete warehouses[civId];
    });
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
    const kind = biomeKind();
    Object.keys(warehouses).forEach(civId => {
      const c = GE.data.civs.find(x => x.id === civId);
      if (!c) return;
      const warehouse = warehouses[civId], summary = getCivSummary(civId);
      const produced = {}, consumed = {}, net = {};
      Object.keys(map().resourceCatalog).forEach(id => {
        const production = summary.output[id] || 0;
        // 非宜居体：无粮食人口消耗，改为能源/水冰维持
        let use = 0;
        if (kind === 'terrestrial') {
          use = id === 'food' ? Math.max(1, Math.round(c.stats.人口 / 65))
            : id === 'energy' ? Math.max(1, Math.round(c.level * 5 + c.stats.科研 / 18))
            : id === 'fuel' ? Math.round(c.stats.军力 / 24) : 0;
        } else {
          use = id === 'energy' ? Math.max(1, Math.round(2 + c.level * 2))
            : id === 'iceWater' ? Math.max(0, Math.round(1 + summary.tiles.length / 80))
            : id === 'fuel' ? Math.round(c.stats.军力 / 40) : 0;
        }
        const scale = map().bodyId === 'gaiya' ? 1 : Math.min(1, Math.max(0.05, tilesOwnedRatio(civId)));
        const useScaled = Math.round(use * scale);
        produced[id] = production; consumed[id] = useScaled; net[id] = production - useScaled;
        if (warehouse.stock[id] == null) warehouse.stock[id] = 0;
        if (warehouse.capacity[id] == null) warehouse.capacity[id] = 200;
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
    get regions(){ return map().regions; },
    get warehouseCivIds(){ build(); return Object.keys(warehouses); }
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
