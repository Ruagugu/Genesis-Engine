/* ============================================================
   创世引擎 · snapshot.js — 只读世界快照协议（阶段 B）
   - buildFromData：从运行时 GE.data 派生协议对象
   - applyToData：用快照覆盖 / 补全 GE.data（不写表面地块）
   - hydrate：local | http 两种 Provider
   协议不含全量 tiles；表面仅下发定义与摘要。
   ============================================================ */
window.GE = window.GE || {};

GE.snapshot = (function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const API_VERSION = 'v1';

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function surfaceDefPublic(def) {
    if (!def) return null;
    return {
      schemaVersion: def.schemaVersion || 1,
      id: def.id,
      bodyId: def.bodyId,
      biomeKind: def.biomeKind || null,
      topology: clone(def.topology || {}),
      climateProfile: clone(def.climateProfile || null),
      regions: clone(def.regions || []),
      capitalSeeds: clone(def.capitalSeeds || {}),
      claimRadius: clone(def.claimRadius || {}),
      // 目录以键集合 + 全局 catalogs 引用，避免重复膨胀
      resourceKeys: Object.keys(def.resourceCatalog || {}),
      buildingKeys: Object.keys(def.buildingCatalog || {}),
      terrainKeys: Object.keys(def.terrainCatalog || {})
    };
  }

  function pickCatalog(full, keys) {
    const out = {};
    (keys || []).forEach(id => {
      if (full && full[id]) out[id] = clone(full[id]);
    });
    return out;
  }

  function bodyPublic(body) {
    if (!body) return null;
    return {
      id: body.id,
      name: body.name,
      type: body.type,
      subtype: body.subtype || null,
      color: body.color,
      radius: body.radius,
      radiusVisual: body.radius,
      orbit: clone(body.orbit),
      parentBodyId: body.parent || body.parentBodyId || null,
      ring: !!body.ring,
      desc: body.desc || '',
      flags: clone(body.flags || {
        landable: !!(body.home || body.isPlayerHome),
        isPlayerHome: !!(body.home || body.isPlayerHome),
        surveyed: 'none'
      }),
      surfaceId: body.surfaceId || null,
      surfaceSeed: body.surfaceSeed != null ? body.surfaceSeed : null,
      climateProfile: clone(body.climateProfile || null),
      // 兼容旧字段
      home: !!(body.home || (body.flags && body.flags.isPlayerHome))
    };
  }

  /**
   * 从 data 包构建版本化只读快照。
   * @param {object} data  GE.data 形状
   * @param {{ runId?: string, revision?: number, generatedAt?: string }} options
   */
  function buildFromData(data, options) {
    options = options || {};
    if (!data) throw new Error('GE.snapshot.buildFromData: data required');

    const world = clone(data.world) || {};
    const bodySurfaces = {};
    Object.entries(data.bodySurfaces || {}).forEach(([id, def]) => {
      bodySurfaces[id] = surfaceDefPublic(def);
    });
    // 兼容 strategicMap 未迁入 bodySurfaces 的旧数据
    if (!bodySurfaces['gaiya:surface'] && data.strategicMap) {
      bodySurfaces['gaiya:surface'] = surfaceDefPublic(
        Object.assign({ id: 'gaiya:surface', bodyId: 'gaiya' }, data.strategicMap)
      );
    }

    const landable = (data.spaceBodies || []).filter(b => {
      if (b.flags && typeof b.flags.landable === 'boolean') return b.flags.landable;
      return !!(b.home || b.isPlayerHome);
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      apiVersion: API_VERSION,
      runId: options.runId || 'local-seed',
      revision: options.revision != null ? options.revision : 0,
      generatedAt: options.generatedAt || new Date().toISOString(),
      clock: {
        year: world.年数 || 0,
        era: clone(world.纪元) || null,
        paused: true,
        realtimeMinutesPerYear: 10
      },
      world,
      civLevels: clone(data.civLevels || []),
      energyScale: clone(data.energyScale || []),
      civs: clone(data.civs || []),
      races: clone(data.races || []),
      transcendent: clone(data.transcendent || null),
      favorites: clone(data.favorites || []),
      chronicle: clone(data.chronicle || []),
      thresholds: clone(data.thresholds || []),
      spaceBodies: (data.spaceBodies || []).map(bodyPublic),
      relations: clone(data.relations || []),
      legacies: clone(data.legacies || []),
      eraCausal: clone(data.eraCausal || null),
      deduction: clone(data.deduction || { lenses: [], rounds: 0, pendingDecisions: [], log: [] }),
      eras: clone(data.eras || []),
      catalogs: {
        terrain: clone(data.terrainCatalog || {}),
        resource: clone(data.resourceCatalog || {}),
        building: clone(data.buildingCatalog || {})
      },
      bodySurfaces,
      landableBodyIds: landable.map(b => b.id),
      // 表面运行时态（地块 / 仓储）阶段 B 默认不下发；由客户端确定性重建
      surfaceStates: options.surfaceStates || {},
      notes: {
        tiles: 'not-included',
        warehouses: 'client-local-or-surfaceStates',
        writeOps: 'none'
      }
    };
  }

  /**
   * 将快照写回 data 容器。不触碰 surface 网格实例。
   * @param {object} snapshot
   * @param {object} target  默认 GE.data
   */
  function applyToData(snapshot, target) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('GE.snapshot.applyToData: invalid snapshot');
    }
    if (snapshot.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('GE.snapshot.applyToData: unsupported schemaVersion ' + snapshot.schemaVersion);
    }
    target = target || GE.data;
    if (!target) throw new Error('GE.snapshot.applyToData: no target data');

    const catalogs = snapshot.catalogs || {};
    const terrainCatalog = catalogs.terrain || target.terrainCatalog || {};
    const resourceCatalog = catalogs.resource || target.resourceCatalog || {};
    const buildingCatalog = catalogs.building || target.buildingCatalog || {};

    if (snapshot.world) target.world = clone(snapshot.world);
    if (snapshot.civLevels) target.civLevels = clone(snapshot.civLevels);
    if (snapshot.energyScale) target.energyScale = clone(snapshot.energyScale);
    if (snapshot.civs) target.civs = clone(snapshot.civs);
    if (snapshot.races) target.races = clone(snapshot.races);
    if (snapshot.transcendent !== undefined) target.transcendent = clone(snapshot.transcendent);
    if (snapshot.favorites) target.favorites = clone(snapshot.favorites);
    if (snapshot.chronicle) target.chronicle = clone(snapshot.chronicle);
    if (snapshot.thresholds) target.thresholds = clone(snapshot.thresholds);
    if (snapshot.relations) target.relations = clone(snapshot.relations);
    if (snapshot.legacies) target.legacies = clone(snapshot.legacies);
    if (snapshot.eraCausal !== undefined) target.eraCausal = clone(snapshot.eraCausal);
    if (snapshot.deduction) target.deduction = clone(snapshot.deduction);
    if (snapshot.eras) target.eras = clone(snapshot.eras);

    target.terrainCatalog = clone(terrainCatalog);
    target.resourceCatalog = clone(resourceCatalog);
    target.buildingCatalog = clone(buildingCatalog);

    if (snapshot.spaceBodies) {
      target.spaceBodies = snapshot.spaceBodies.map(b => {
        const body = clone(b);
        if (body.parentBodyId && !body.parent) body.parent = body.parentBodyId;
        if (body.flags && body.flags.isPlayerHome) body.home = true;
        return body;
      });
    }

    if (snapshot.bodySurfaces) {
      const rebuilt = {};
      Object.entries(snapshot.bodySurfaces).forEach(([id, def]) => {
        const full = clone(def);
        full.terrainCatalog = pickCatalog(terrainCatalog, def.terrainKeys) || clone(terrainCatalog);
        // 若 keys 为空则回退全局子集语义：用全目录（表面生成器会忽略未知键）
        full.resourceCatalog = (def.resourceKeys && def.resourceKeys.length)
          ? pickCatalog(resourceCatalog, def.resourceKeys)
          : clone(resourceCatalog);
        full.buildingCatalog = (def.buildingKeys && def.buildingKeys.length)
          ? pickCatalog(buildingCatalog, def.buildingKeys)
          : clone(buildingCatalog);
        delete full.resourceKeys;
        delete full.buildingKeys;
        delete full.terrainKeys;
        rebuilt[id] = full;
      });
      target.bodySurfaces = rebuilt;
      if (rebuilt['gaiya:surface']) target.strategicMap = rebuilt['gaiya:surface'];
    }

    return target;
  }

  function detectMode() {
    try {
      const q = new URLSearchParams(location.search || '');
      const fromQuery = q.get('data') || q.get('snapshot');
      if (fromQuery === 'http' || fromQuery === 'api') return 'http';
      if (fromQuery === 'local') return 'local';
      if (window.GE_SNAPSHOT_MODE === 'http') return 'http';
      if (localStorage.getItem('ge-snapshot-mode') === 'http') return 'http';
    } catch (_) { /* ignore */ }
    return 'local';
  }

  function apiBase() {
    try {
      const q = new URLSearchParams(location.search || '');
      const base = q.get('api') || window.GE_API_BASE || '';
      return String(base).replace(/\/$/, '');
    } catch (_) {
      return '';
    }
  }

  async function fetchSnapshot(base) {
    const url = (base || '') + '/api/v1/snapshot';
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('snapshot fetch failed ' + res.status + (text ? ': ' + text.slice(0, 160) : ''));
    }
    return res.json();
  }

  /**
   * 启动前水合。local：用已加载的 GE.data 构建快照；http：拉取并 apply。
   * @param {{ mode?: 'local'|'http', baseUrl?: string }} config
   */
  async function hydrate(config) {
    config = config || {};
    const mode = config.mode || detectMode();
    let snap;
    if (mode === 'http') {
      snap = await fetchSnapshot(config.baseUrl != null ? config.baseUrl : apiBase());
      applyToData(snap, GE.data);
    } else {
      snap = buildFromData(GE.data, { runId: 'local-seed' });
    }
    api.last = snap;
    api.mode = mode;
    return snap;
  }

  const api = {
    SCHEMA_VERSION,
    API_VERSION,
    buildFromData,
    applyToData,
    hydrate,
    detectMode,
    apiBase,
    fetchSnapshot,
    mode: 'local',
    last: null
  };
  return api;
})();
