/* ============================================================
   创世引擎 · Run 内存存档（阶段 C）
   开局将 GE.data.spaceBodies 迁入 discovered.bodies；
   仅持久化已发现集合 + 补丁，不预铺无限宇宙。
   ============================================================ */
import { loadGeData } from './load-ge-data.mjs';

const DEFAULT_RUN_ID = process.env.GE_RUN_ID || 'local-seed';
const DEFAULT_SEED = Number(process.env.GE_RUN_SEED || 20260723) >>> 0;

function clone(v) {
  if (v == null) return v;
  return JSON.parse(JSON.stringify(v));
}

function deepFreezeSeedBodies(bodies) {
  return (bodies || []).map(b => {
    const body = clone(b);
    if (body.parentBodyId && !body.parent) body.parent = body.parentBodyId;
    body.galaxyId = body.galaxyId || 'g:0:0:0';
    body.systemId = body.systemId || 's:g:0:0:0:xiyang';
    body.completeness = body.completeness || 'detailed';
    if (body.flags && body.flags.artificial) {
      body.flags.surveyed = body.flags.surveyed || 'orbital';
    }
    return body;
  });
}

/**
 * @returns {import('./run-types').Run}
 */
function createRunFromSeed(opts) {
  opts = opts || {};
  const ge = loadGeData();
  const data = ge.data;
  const seed = (opts.seed != null ? opts.seed : DEFAULT_SEED) >>> 0;
  const id = opts.id || DEFAULT_RUN_ID;

  const bodies = deepFreezeSeedBodies(data.spaceBodies);
  const galaxies = [
    {
      id: 'g:0:0:0',
      name: '本星系团·曦阳邻域',
      coord: { x: 0, y: 0, z: 0 },
      completeness: 'detailed',
      seedHandle: seed
    }
  ];
  const systems = [
    {
      id: 's:g:0:0:0:xiyang',
      galaxyId: 'g:0:0:0',
      name: '曦阳系',
      starId: 'xiyang',
      completeness: 'detailed',
      localIndex: 0,
      seedHandle: seed ^ 0x1111
    }
  ];

  return {
    id,
    seed,
    year: Number(data.world?.年数) || 0,
    revision: 0,
    era: clone(data.world?.纪元) || { 纪元: '曙光纪元', 纪年: '第4纪元', 核心特性: '' },
    agentMode: opts.agentMode || 'rules_only',
    world: clone(data.world),
    civs: clone(data.civs),
    races: clone(data.races),
    relations: clone(data.relations),
    legacies: clone(data.legacies),
    eraCausal: clone(data.eraCausal),
    chronicle: clone(data.chronicle || []),
    favorites: clone(data.favorites || []),
    transcendent: clone(data.transcendent),
    thresholds: clone(data.thresholds || []),
    eras: clone(data.eras || []),
    civLevels: clone(data.civLevels || []),
    energyScale: clone(data.energyScale || []),
    catalogs: {
      terrain: clone(data.terrainCatalog || {}),
      resource: clone(data.resourceCatalog || {}),
      building: clone(data.buildingCatalog || {})
    },
    bodySurfaces: clone(data.bodySurfaces || {}),
    strategicMap: clone(data.strategicMap || null),
    deduction: clone(data.deduction || {
      lenses: ['政治', '军事', '经济', '科技', '思潮', '个人'],
      rounds: 4,
      pendingDecisions: [],
      log: []
    }),
    discovered: {
      galaxies,
      systems,
      bodies
    },
    // 设施序号：按文明
    facilitySeq: Object.create(null),
    // 探测 frontier：已占用 galactic 格子
    frontierCoords: [{ x: 0, y: 0, z: 0 }],
    deductionRounds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

const runs = new Map();

function ensureDefault() {
  if (!runs.has(DEFAULT_RUN_ID)) {
    runs.set(DEFAULT_RUN_ID, createRunFromSeed({ id: DEFAULT_RUN_ID }));
  }
  return runs.get(DEFAULT_RUN_ID);
}

function get(id) {
  if (!id || id === DEFAULT_RUN_ID) return ensureDefault();
  return runs.get(id) || null;
}

function create(opts) {
  opts = opts || {};
  const id = opts.id || (`run-${Date.now().toString(36)}`);
  if (runs.has(id) && !opts.reset) return runs.get(id);
  const run = createRunFromSeed({ ...opts, id });
  runs.set(id, run);
  return run;
}

function reset(id) {
  const rid = id || DEFAULT_RUN_ID;
  const run = createRunFromSeed({ id: rid });
  runs.set(rid, run);
  return run;
}

function list() {
  ensureDefault();
  return Array.from(runs.values()).map(r => ({
    id: r.id,
    seed: r.seed,
    year: r.year,
    revision: r.revision,
    agentMode: r.agentMode,
    bodyCount: r.discovered.bodies.length,
    galaxyCount: r.discovered.galaxies.length,
    systemCount: r.discovered.systems.length,
    updatedAt: r.updatedAt
  }));
}

/** 从 Run 构建 snapshot 兼容对象 */
function toSnapshot(run, geBuild) {
  ensureDefault();
  const r = run || ensureDefault();
  // 用种子 catalogs 与 bodySurfaces 拼装；spaceBodies 来自 discovered
  const dataShape = {
    world: { ...r.world, 年数: r.year, 纪元: r.era },
    civLevels: r.civLevels,
    energyScale: r.energyScale,
    civs: r.civs,
    races: r.races,
    transcendent: r.transcendent,
    favorites: r.favorites,
    chronicle: r.chronicle,
    thresholds: r.thresholds,
    spaceBodies: r.discovered.bodies,
    relations: r.relations,
    legacies: r.legacies,
    eraCausal: r.eraCausal,
    deduction: r.deduction,
    eras: r.eras,
    terrainCatalog: r.catalogs.terrain,
    resourceCatalog: r.catalogs.resource,
    buildingCatalog: r.catalogs.building,
    bodySurfaces: r.bodySurfaces,
    strategicMap: r.strategicMap
  };

  let snap;
  if (geBuild) {
    snap = geBuild(dataShape, {
      runId: r.id,
      revision: r.revision,
      generatedAt: new Date().toISOString()
    });
  } else {
    // 轻量回退（测试 / 无 snapshot 模块时）
    snap = {
      schemaVersion: 1,
      apiVersion: 'v1',
      runId: r.id,
      revision: r.revision,
      generatedAt: new Date().toISOString(),
      clock: { year: r.year, era: r.era, paused: true, realtimeMinutesPerYear: 10 },
      world: dataShape.world,
      civs: r.civs,
      spaceBodies: r.discovered.bodies,
      bodySurfaces: r.bodySurfaces,
      deduction: r.deduction,
      catalogs: r.catalogs,
      landableBodyIds: r.discovered.bodies
        .filter(b => b.flags && b.flags.landable)
        .map(b => b.id),
      surfaceStates: {},
      notes: { tiles: 'not-included', warehouses: 'client-local-or-surfaceStates', writeOps: 'deduce' }
    };
  }

  snap.revision = r.revision;
  snap.runId = r.id;
  snap.discovered = {
    galaxyIds: r.discovered.galaxies.map(g => g.id),
    systemIds: r.discovered.systems.map(s => s.id),
    bodyCount: r.discovered.bodies.length,
    galaxies: r.discovered.galaxies.map(g => ({
      id: g.id, name: g.name, coord: g.coord, completeness: g.completeness
    })),
    systems: r.discovered.systems.map(s => ({
      id: s.id, galaxyId: s.galaxyId, name: s.name, completeness: s.completeness
    }))
  };
  if (snap.notes) {
    snap.notes.writeOps = 'deduce';
    snap.notes.phase = 'C';
  }
  return snap;
}

function touch(run) {
  run.updatedAt = new Date().toISOString();
}

export {
  DEFAULT_RUN_ID,
  DEFAULT_SEED,
  createRunFromSeed,
  ensureDefault,
  get,
  create,
  reset,
  list,
  toSnapshot,
  touch,
  clone
};
