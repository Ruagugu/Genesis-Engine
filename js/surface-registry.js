/* ============================================================
   创世引擎 · surface-registry.js — 多星球表面注册表
   GE.surfaces.get / ensure / activate
   当前激活表面同时绑定到 GE.worldGrid / GE.worldState 门面。
   ============================================================ */
window.GE = window.GE || {};

GE.surfaces = (function () {
  'use strict';

  /** @type {Map<string, { def, grid, state, bodyId, surfaceId }>} */
  const cache = new Map();
  let activeBodyId = null;
  let activeSurfaceId = null;

  function bodyById(bodyId) {
    return (GE.data.spaceBodies || []).find(b => b.id === bodyId) || null;
  }

  function surfaceDefForBody(bodyId) {
    const defs = GE.data.bodySurfaces || {};
    // 直接 id、或 bodyId 映射
    if (defs[bodyId]) return defs[bodyId];
    const body = bodyById(bodyId);
    if (body && body.surfaceId && defs[body.surfaceId]) return defs[body.surfaceId];
    // 兼容：母星 strategicMap 尚未迁入 bodySurfaces 时
    if (bodyId === 'gaiya' && GE.data.strategicMap) {
      return Object.assign({ id: 'gaiya:surface', bodyId: 'gaiya' }, GE.data.strategicMap);
    }
    return null;
  }

  function isLandable(body) {
    if (!body) return false;
    if (body.flags && typeof body.flags.landable === 'boolean') return body.flags.landable;
    // 兼容旧 home 字段
    if (body.home || body.isPlayerHome) return true;
    return false;
  }

  function isPlayerHome(body) {
    if (!body) return false;
    if (body.flags && body.flags.isPlayerHome) return true;
    return !!body.home;
  }

  /**
   * 幂等确保表面实例已构建（网格 + 状态）。
   * @returns {{ def, grid, state, bodyId, surfaceId }}
   */
  function ensure(bodyId) {
    const body = bodyById(bodyId);
    if (!body) throw new Error('GE.surfaces.ensure: unknown body ' + bodyId);
    if (!isLandable(body)) throw new Error('GE.surfaces.ensure: body not landable ' + bodyId);

    const def = surfaceDefForBody(bodyId);
    if (!def) throw new Error('GE.surfaces.ensure: no surface def for ' + bodyId);

    const surfaceId = def.id || (bodyId + ':surface');
    if (cache.has(surfaceId)) return cache.get(surfaceId);

    const topology = Object.assign({}, def.topology);
    if (def.surfaceSeed != null) topology.seed = def.surfaceSeed;
    else if (body.surfaceSeed != null) topology.seed = body.surfaceSeed;

    const grid = GE.createWorldGrid(topology);
    const storageKey = 'genesis-engine-surface-' + surfaceId.replace(/[:/]/g, '-') + '-v2';
    const state = GE.createWorldState(Object.assign({}, def, { id: surfaceId, bodyId }), {
      storageKey,
      grid
    });
    state.build();

    const entry = { def: Object.assign({}, def, { id: surfaceId, bodyId }), grid, state, bodyId, surfaceId };
    cache.set(surfaceId, entry);
    // 也按 bodyId 索引一份便于查找
    cache.set('body:' + bodyId, entry);
    return entry;
  }

  function get(surfaceIdOrBodyId) {
    if (cache.has(surfaceIdOrBodyId)) return cache.get(surfaceIdOrBodyId);
    if (cache.has('body:' + surfaceIdOrBodyId)) return cache.get('body:' + surfaceIdOrBodyId);
    return null;
  }

  /**
   * 激活某天体表面：绑定门面，供 view.planet / panels 透明使用。
   * @returns {entry}
   */
  function activate(bodyId) {
    const entry = ensure(bodyId);
    activeBodyId = bodyId;
    activeSurfaceId = entry.surfaceId;
    GE.worldGrid.bind(entry.grid);
    GE.worldState.bind(entry.state);
    if (GE.app && GE.app.state) {
      GE.app.state.activeBodyId = bodyId;
      GE.app.state.activeSurfaceId = entry.surfaceId;
    }
    return entry;
  }

  function getActive() {
    if (!activeSurfaceId) return null;
    return cache.get(activeSurfaceId) || null;
  }

  function listLandable() {
    return (GE.data.spaceBodies || []).filter(isLandable);
  }

  function unload(surfaceIdOrBodyId, options) {
    options = options || {};
    const entry = get(surfaceIdOrBodyId);
    if (!entry) return false;
    if (entry.surfaceId === activeSurfaceId) return false;
    if (options.persist !== false) entry.state.persist();
    cache.delete(entry.surfaceId);
    cache.delete('body:' + entry.bodyId);
    return true;
  }

  function warehouseSnapshot(warehouse) {
    if (!warehouse) return null;
    return {
      capacity: Object.assign({}, warehouse.capacity || {}),
      stock: Object.assign({}, warehouse.stock || {}),
      lastTurn: {
        produced: Object.assign({}, warehouse.lastTurn && warehouse.lastTurn.produced || {}),
        consumed: Object.assign({}, warehouse.lastTurn && warehouse.lastTurn.consumed || {}),
        net: Object.assign({}, warehouse.lastTurn && warehouse.lastTurn.net || {})
      },
      reservePolicy: Object.assign({}, warehouse.reservePolicy || {})
    };
  }

  /** 只读派生的帝国总仓；不会切换当前活动表面。 */
  function getEmpireWarehouse(civId) {
    const catalog = (GE.data && GE.data.resourceCatalog) || {};
    const capacity = {}, stock = {}, produced = {}, consumed = {}, net = {};
    Object.keys(catalog).forEach(id => {
      capacity[id] = 0; stock[id] = 0; produced[id] = 0; consumed[id] = 0; net[id] = 0;
    });
    const surfaces = [];
    listLandable().forEach(body => {
      const resident = !!get(body.id);
      const entry = ensure(body.id);
      const warehouse = warehouseSnapshot(entry.state.getWarehouse(civId));
      if (warehouse) {
        Object.keys(catalog).forEach(id => {
          capacity[id] += Number(warehouse.capacity[id]) || 0;
          stock[id] += Number(warehouse.stock[id]) || 0;
          produced[id] += Number(warehouse.lastTurn.produced[id]) || 0;
          consumed[id] += Number(warehouse.lastTurn.consumed[id]) || 0;
          net[id] += Number(warehouse.lastTurn.net[id]) || 0;
        });
        surfaces.push({ bodyId: body.id, surfaceId: entry.surfaceId, bodyName: body.name, revision: entry.state.revision, warehouse });
      }
      if (!resident && entry.surfaceId !== activeSurfaceId) unload(entry.surfaceId, { persist: false });
    });
    return {
      capacity, stock,
      lastTurn: { produced, consumed, net },
      reservePolicy: { food: .35, fuel: .25, energy: .30, iceWater: .4 },
      surfaces
    };
  }

  /** 一次世界结算中，每个实际有仓库的表面只推进一次。 */
  function advanceAllSurfaceTurns() {
    const revisions = [];
    listLandable().forEach(body => {
      const resident = !!get(body.id);
      const entry = ensure(body.id);
      if (entry.state.warehouseCivIds.length) {
        revisions.push({ bodyId: body.id, surfaceId: entry.surfaceId, revision: entry.state.advanceTurn() });
      }
      if (!resident && entry.surfaceId !== activeSurfaceId) unload(entry.surfaceId, { persist: false });
    });
    return revisions;
  }

  /** 迁移旧单例 localStorage 键到盖亚表面键（一次性）。 */
  function migrateLegacyStorage() {
    try {
      const legacy = localStorage.getItem('genesis-engine-strategic-map-v1');
      const gaiyaKey = 'genesis-engine-surface-gaiya-surface-v2';
      if (legacy && !localStorage.getItem(gaiyaKey)) {
        localStorage.setItem(gaiyaKey, legacy);
      }
    } catch (_) { /* ignore */ }
  }

  function init() {
    migrateLegacyStorage();
    // 默认激活母星（或首个 isPlayerHome）
    const home = (GE.data.spaceBodies || []).find(isPlayerHome) || listLandable()[0];
    if (home) activate(home.id);
  }

  return {
    init,
    ensure,
    get,
    activate,
    getActive,
    listLandable,
    unload,
    getEmpireWarehouse,
    advanceAllSurfaceTurns,
    isLandable,
    isPlayerHome,
    get activeBodyId() { return activeBodyId; },
    get activeSurfaceId() { return activeSurfaceId; },
    /** 调试 / 测试：清空缓存（不删 localStorage） */
    _clearCache() { cache.clear(); activeBodyId = null; activeSurfaceId = null; }
  };
})();
