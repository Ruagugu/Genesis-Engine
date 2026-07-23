/* ============================================================
   创世引擎 · surface-registry.js — 多星球表面注册表
   GE.surfaces.get / ensure / activate / ensureRemote
   当前激活表面同时绑定到 GE.worldGrid / GE.worldState 门面。
   阶段 C5：缺 def 时确定性合成；可 POST surface/ensure 同步 Run。
   ============================================================ */
window.GE = window.GE || {};

GE.surfaces = (function () {
  'use strict';

  /** @type {Map<string, { def, grid, state, bodyId, surfaceId }>} */
  const cache = new Map();
  let activeBodyId = null;
  let activeSurfaceId = null;

  const FREQS = [8, 16, 32, 64];
  const REGION_A = ['玄', '苍', '白', '赤', '金', '青', '银', '暗', '耀', '寂', '霜', '焰', '渊', '潮', '岩', '尘'];
  const REGION_B = ['海', '原', '脊', '谷', '湾', '盆', '冠', '壁', '环', '洲', '漠', '峡', '垒', '台', '渊', '角'];

  function bodyById(bodyId) {
    return (GE.data.spaceBodies || []).find(b => b.id === bodyId) || null;
  }

  function clampFreq(n) {
    const x = Number(n) || 32;
    let best = 32, d = Infinity;
    FREQS.forEach(f => {
      const dd = Math.abs(f - x);
      if (dd < d) { d = dd; best = f; }
    });
    return best;
  }

  function hashStr(s) {
    let h = 2166136261;
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function biomeFromBody(body) {
    const t = body.type || '';
    const sub = body.subtype || '';
    const cp = body.climateProfile || {};
    const temp = cp.meanTemp || '';
    if (t === '卫星' || /月/.test(sub)) return 'airless_moon';
    if (t === '矮行星' || temp === 'frigid') return 'cold_dwarf';
    if (t === '岩质行星' || temp === 'hot' || /干旱|炙烤/.test(sub)) return 'arid_rock';
    if (t === '类地行星' || temp === 'temperate') return 'terrestrial';
    if (cp.hydrosphere != null && cp.hydrosphere < 0.1) return 'arid_rock';
    return 'terrestrial';
  }

  function regionPalette(biome) {
    if (biome === 'airless_moon') return ['#6a7080', '#c8ccd8', '#2a3040', '#a8a49a'];
    if (biome === 'cold_dwarf') return ['#6a7080', '#4a5568', '#8a90a8', '#3a4050'];
    if (biome === 'arid_rock') return ['#c98452', '#8a3a22', '#4a3830', '#d4683a'];
    return ['#4fd2ff', '#e6a948', '#6fd08c', '#d97b4f', '#7f8cf0', '#b6c8de'];
  }

  /** 从 Body 确定性合成表面定义（与 server/surface-ensure 对齐的薄实现） */
  function synthesizeDef(body) {
    const biomeKind = biomeFromBody(body);
    const seed = body.surfaceSeed != null ? (body.surfaceSeed >>> 0) : hashStr(body.id || 'body');
    let frequency = biomeKind === 'cold_dwarf' ? 16 : 32;
    if (body.flags && body.flags.surveyed === 'remote') frequency = Math.min(frequency, 16);
    let planetRadiusKm = 5000;
    let nominalTileWidthKm = 100;
    if (biomeKind === 'airless_moon') { planetRadiusKm = 1200 + (seed % 800); nominalTileWidthKm = 80; }
    else if (biomeKind === 'cold_dwarf') { planetRadiusKm = 900 + (seed % 600); nominalTileWidthKm = 90; }
    else if (biomeKind === 'arid_rock') { planetRadiusKm = 4000 + (seed % 2000); }
    else { planetRadiusKm = 5000 + (seed % 2000); nominalTileWidthKm = 110; }

    const rnd = mulberry32(seed ^ 0x51ace);
    const colors = regionPalette(biomeKind);
    const n = biomeKind === 'cold_dwarf' ? 2 : 4;
    const regions = [];
    for (let i = 0; i < n; i++) {
      regions.push({
        id: body.id + '-r' + i,
        name: REGION_A[Math.floor(rnd() * REGION_A.length)] + REGION_B[Math.floor(rnd() * REGION_B.length)] + (i === 0 ? '主区' : ''),
        color: colors[i % colors.length],
        lat: Math.round((rnd() * 140 - 70) * 10) / 10,
        lon: Math.round((rnd() * 360 - 180) * 10) / 10,
        radius: Math.round(28 + rnd() * 22),
        description: '程序勘察划定区域。'
      });
    }

    const surfaceId = body.surfaceId || (body.id + ':surface');
    return {
      schemaVersion: 1,
      id: surfaceId,
      bodyId: body.id,
      biomeKind,
      topology: {
        kind: 'icosahedron-dual',
        frequency: clampFreq(frequency),
        seed,
        planetRadiusKm,
        nominalTileWidthKm
      },
      climateProfile: body.climateProfile
        ? JSON.parse(JSON.stringify(body.climateProfile))
        : {
            hydrosphere: biomeKind === 'terrestrial' ? 0.3 : 0.05,
            meanTemp: biomeKind === 'arid_rock' ? 'hot' : biomeKind === 'cold_dwarf' ? 'frigid' : 'cold',
            energyAffinity: 0.1
          },
      regions,
      capitalSeeds: {},
      claimRadius: {},
      terrainCatalog: (GE.data && GE.data.terrainCatalog) || {},
      resourceCatalog: (GE.data && GE.data.resourceCatalog) || {},
      buildingCatalog: (GE.data && GE.data.buildingCatalog) || {}
    };
  }

  function surfaceDefForBody(bodyId) {
    const defs = GE.data.bodySurfaces || {};
    if (defs[bodyId]) return defs[bodyId];
    const body = bodyById(bodyId);
    if (body && body.surfaceId && defs[body.surfaceId]) return defs[body.surfaceId];
    if (bodyId === 'gaiya' && GE.data.strategicMap) {
      return Object.assign({ id: 'gaiya:surface', bodyId: 'gaiya' }, GE.data.strategicMap);
    }
    return null;
  }

  function isLandable(body) {
    if (!body) return false;
    if (body.flags && typeof body.flags.landable === 'boolean') return body.flags.landable;
    if (body.home || body.isPlayerHome) return true;
    return false;
  }

  function isPlayerHome(body) {
    if (!body) return false;
    if (body.flags && body.flags.isPlayerHome) return true;
    return !!body.home;
  }

  /** 确保 bodySurfaces 中有定义；缺则本地合成并挂入 GE.data。 */
  function ensureDef(bodyId) {
    const body = bodyById(bodyId);
    if (!body) throw new Error('GE.surfaces.ensureDef: unknown body ' + bodyId);
    if (!isLandable(body)) throw new Error('GE.surfaces.ensureDef: not landable ' + bodyId);

    let def = surfaceDefForBody(bodyId);
    if (def) return def;

    if (body.surfaceSeed == null) body.surfaceSeed = hashStr(bodyId);
    if (!body.surfaceId) body.surfaceId = bodyId + ':surface';
    def = synthesizeDef(body);
    GE.data.bodySurfaces = GE.data.bodySurfaces || {};
    GE.data.bodySurfaces[def.id] = def;
    return def;
  }

  /**
   * 幂等确保表面实例已构建（网格 + 状态）。
   * @returns {{ def, grid, state, bodyId, surfaceId }}
   */
  function ensure(bodyId) {
    const body = bodyById(bodyId);
    if (!body) throw new Error('GE.surfaces.ensure: unknown body ' + bodyId);
    if (!isLandable(body)) throw new Error('GE.surfaces.ensure: body not landable ' + bodyId);

    const def = ensureDef(bodyId);
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
    cache.set('body:' + bodyId, entry);
    return entry;
  }

  /**
   * 调用服务端 POST …/surface/ensure，再本地 ensure。
   * 失败时回落本地合成（不阻断登陆）。
   */
  async function ensureRemote(bodyId, opts) {
    opts = opts || {};
    const body = bodyById(bodyId);
    if (!body) throw new Error('ensureRemote: unknown body ' + bodyId);
    if (!isLandable(body)) throw new Error('ensureRemote: not landable ' + bodyId);

    if (!opts.force && surfaceDefForBody(bodyId) && !opts.alwaysRemote) {
      return { local: true, entry: ensure(bodyId), remote: null };
    }

    let remote = null;
    try {
      let base = '';
      if (GE.llmConfig) base = GE.llmConfig.worldBase() || '';
      else if (GE.snapshot && typeof GE.snapshot.apiBase === 'function') base = GE.snapshot.apiBase() || '';
      const url = `${base}/api/v1/bodies/${encodeURIComponent(bodyId)}/surface/ensure`;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs || 8000) : null;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: '{}',
          cache: 'no-store',
          signal: ctrl ? ctrl.signal : undefined
        });
        if (res.ok) {
          remote = await res.json();
          if (remote.surface) {
            GE.data.bodySurfaces = GE.data.bodySurfaces || {};
            const s = remote.surface;
            const full = {
              schemaVersion: s.schemaVersion || 1,
              id: s.id,
              bodyId: s.bodyId || bodyId,
              biomeKind: s.biomeKind,
              topology: s.topology,
              climateProfile: s.climateProfile,
              regions: s.regions || [],
              capitalSeeds: s.capitalSeeds || {},
              claimRadius: s.claimRadius || {},
              terrainCatalog: GE.data.terrainCatalog || {},
              resourceCatalog: GE.data.resourceCatalog || {},
              buildingCatalog: GE.data.buildingCatalog || {}
            };
            GE.data.bodySurfaces[full.id] = full;
            if (remote.body) {
              const b = bodyById(bodyId);
              if (b) {
                if (remote.body.surfaceId) b.surfaceId = remote.body.surfaceId;
                if (remote.body.surfaceSeed != null) b.surfaceSeed = remote.body.surfaceSeed;
                if (remote.body.flags) b.flags = Object.assign({}, b.flags || {}, remote.body.flags);
              }
            }
          }
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err) {
      console.warn('[创世引擎] surface ensure remote failed, using local synth', err);
    }

    return { local: !remote, entry: ensure(bodyId), remote };
  }

  function get(surfaceIdOrBodyId) {
    if (cache.has(surfaceIdOrBodyId)) return cache.get(surfaceIdOrBodyId);
    if (cache.has('body:' + surfaceIdOrBodyId)) return cache.get('body:' + surfaceIdOrBodyId);
    return null;
  }

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

  async function activateAsync(bodyId, opts) {
    await ensureRemote(bodyId, opts);
    return activate(bodyId);
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

  function getEmpireWarehouse(civId) {
    const catalog = (GE.data && GE.data.resourceCatalog) || {};
    const capacity = {}, stock = {}, produced = {}, consumed = {}, net = {};
    Object.keys(catalog).forEach(id => {
      capacity[id] = 0; stock[id] = 0; produced[id] = 0; consumed[id] = 0; net[id] = 0;
    });
    const surfaces = [];
    listLandable().forEach(body => {
      // 仅统计已有 def 或已缓存的表面，避免对所有新发现体强行建仓
      if (!surfaceDefForBody(body.id) && !get(body.id)) return;
      const resident = !!get(body.id);
      let entry;
      try { entry = ensure(body.id); } catch (_) { return; }
      const warehouse = warehouseSnapshot(entry.state.getWarehouse(civId));
      if (warehouse) {
        Object.keys(catalog).forEach(id => {
          capacity[id] += Number(warehouse.capacity[id]) || 0;
          stock[id] += Number(warehouse.stock[id]) || 0;
          produced[id] += Number(warehouse.lastTurn.produced[id]) || 0;
          consumed[id] += Number(warehouse.lastTurn.consumed[id]) || 0;
          net[id] += Number(warehouse.lastTurn.net[id]) || 0;
        });
        surfaces.push({
          bodyId: body.id, surfaceId: entry.surfaceId, bodyName: body.name,
          revision: entry.state.revision, warehouse
        });
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

  function advanceAllSurfaceTurns() {
    const revisions = [];
    listLandable().forEach(body => {
      if (!surfaceDefForBody(body.id) && !get(body.id)) return;
      const resident = !!get(body.id);
      let entry;
      try { entry = ensure(body.id); } catch (_) { return; }
      if (entry.state.warehouseCivIds && entry.state.warehouseCivIds.length) {
        revisions.push({ bodyId: body.id, surfaceId: entry.surfaceId, revision: entry.state.advanceTurn() });
      }
      if (!resident && entry.surfaceId !== activeSurfaceId) unload(entry.surfaceId, { persist: false });
    });
    return revisions;
  }

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
    const home = (GE.data.spaceBodies || []).find(isPlayerHome) || listLandable()[0];
    if (home) activate(home.id);
  }

  return {
    init,
    ensure,
    ensureDef,
    ensureRemote,
    synthesizeDef,
    get,
    activate,
    activateAsync,
    getActive,
    listLandable,
    unload,
    getEmpireWarehouse,
    advanceAllSurfaceTurns,
    isLandable,
    isPlayerHome,
    get activeBodyId() { return activeBodyId; },
    get activeSurfaceId() { return activeSurfaceId; },
    _clearCache() { cache.clear(); activeBodyId = null; activeSurfaceId = null; }
  };
})();
