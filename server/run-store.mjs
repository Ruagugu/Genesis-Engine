/* ============================================================
   创世引擎 · Run 存档（阶段 C）
   开局将 GE.data.spaceBodies 迁入 discovered.bodies；
   运行期写入 data/runs/<id>.json，服务重启后恢复推演日志与领袖。
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadGeData } from './load-ge-data.mjs';

const DEFAULT_RUN_ID = process.env.GE_RUN_ID || 'local-seed';
const DEFAULT_SEED = Number(process.env.GE_RUN_SEED || 20260723) >>> 0;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS_DIR = process.env.GE_RUNS_DIR
  ? path.resolve(process.env.GE_RUNS_DIR)
  : path.join(ROOT, 'data', 'runs');

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
    // 阶段 D：时钟 / 席位 / 神谕
    clock: {
      realEpochMs: Date.now(),
      worldYearAtEpoch: Number(data.world?.年数) || 0,
      minutesPerYear: 10,
      paused: true,
      speed: 1,
      lastTickAt: Date.now(),
      yearsSinceRound: 0
    },
    seats: [],
    edicts: [],
    oracleLedger: [],
    flags: { gmFreeOracle: false },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/** 旧存档补齐阶段 D 字段（幂等） */
function ensurePhaseDFields(run) {
  if (!run || typeof run !== 'object') return run;
  if (!run.clock || typeof run.clock !== 'object') {
    run.clock = {
      realEpochMs: Date.now(),
      worldYearAtEpoch: Number(run.year) || 0,
      minutesPerYear: 10,
      paused: true,
      speed: 1,
      lastTickAt: Date.now(),
      yearsSinceRound: 0
    };
  } else {
    if (run.clock.minutesPerYear == null) run.clock.minutesPerYear = 10;
    if (run.clock.paused == null) run.clock.paused = true;
    if (run.clock.speed == null) run.clock.speed = 1;
    if (run.clock.yearsSinceRound == null) run.clock.yearsSinceRound = 0;
    if (run.clock.worldYearAtEpoch == null) run.clock.worldYearAtEpoch = Number(run.year) || 0;
    if (run.clock.realEpochMs == null) run.clock.realEpochMs = Date.now();
  }
  if (!Array.isArray(run.seats)) run.seats = [];
  if (!Array.isArray(run.edicts)) run.edicts = [];
  if (!Array.isArray(run.oracleLedger)) run.oracleLedger = [];
  if (!run.flags || typeof run.flags !== 'object') run.flags = { gmFreeOracle: false };
  if (run.flags.gmFreeOracle == null) run.flags.gmFreeOracle = false;
  return run;
}

const runs = new Map();
let saveTimer = null;
const SAVE_DEBOUNCE_MS = 250;

function ensureRunsDir() {
  try {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
  } catch (err) {
    console.warn('[run-store] mkdir runs dir failed', err && err.message);
  }
}

function runPath(id) {
  const safe = String(id || DEFAULT_RUN_ID).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(RUNS_DIR, safe + '.json');
}

function loadRunFromDisk(id) {
  const file = runPath(id);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw || !raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.id) parsed.id = id;
    if (!parsed.discovered || typeof parsed.discovered !== 'object') return null;
    if (!Array.isArray(parsed.civs)) return null;
    parsed.deduction = parsed.deduction || {
      lenses: ['政治', '军事', '经济', '科技', '思潮', '个人'],
      rounds: 0,
      pendingDecisions: [],
      log: []
    };
    parsed.deduction.log = Array.isArray(parsed.deduction.log) ? parsed.deduction.log : [];
    parsed.deduction.pendingDecisions = Array.isArray(parsed.deduction.pendingDecisions)
      ? parsed.deduction.pendingDecisions
      : [];
    parsed.deductionRounds = Array.isArray(parsed.deductionRounds) ? parsed.deductionRounds : [];
    parsed.facilitySeq = parsed.facilitySeq || Object.create(null);
    parsed.frontierCoords = Array.isArray(parsed.frontierCoords) ? parsed.frontierCoords : [{ x: 0, y: 0, z: 0 }];
    ensurePhaseDFields(parsed);
    return parsed;
  } catch (err) {
    console.warn('[run-store] load failed', id, err && err.message);
    return null;
  }
}

function saveRunToDisk(run) {
  if (!run || !run.id) return false;
  ensureRunsDir();
  const file = runPath(run.id);
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(run), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    console.warn('[run-store] save failed', run.id, err && err.message);
    return false;
  }
}

function scheduleSave(run) {
  if (!run || !run.id) return;
  // 同步标记最新时间；落盘节流，避免每轮 deduce 都阻塞
  runs.set(run.id, run);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    // 写当前内存中全部 run（通常只有 default）
    runs.forEach(r => saveRunToDisk(r));
  }, SAVE_DEBOUNCE_MS);
}

function flushSaves() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  runs.forEach(r => saveRunToDisk(r));
}

function ensureDefault() {
  if (!runs.has(DEFAULT_RUN_ID)) {
    const fromDisk = loadRunFromDisk(DEFAULT_RUN_ID);
    if (fromDisk) {
      ensurePhaseDFields(fromDisk);
      runs.set(DEFAULT_RUN_ID, fromDisk);
    } else {
      const fresh = createRunFromSeed({ id: DEFAULT_RUN_ID });
      runs.set(DEFAULT_RUN_ID, fresh);
      saveRunToDisk(fresh);
    }
  } else {
    ensurePhaseDFields(runs.get(DEFAULT_RUN_ID));
  }
  return runs.get(DEFAULT_RUN_ID);
}

function get(id) {
  if (!id || id === DEFAULT_RUN_ID) return ensureDefault();
  if (runs.has(id)) {
    ensurePhaseDFields(runs.get(id));
    return runs.get(id);
  }
  const fromDisk = loadRunFromDisk(id);
  if (fromDisk) {
    ensurePhaseDFields(fromDisk);
    runs.set(id, fromDisk);
    return fromDisk;
  }
  return null;
}

function create(opts) {
  opts = opts || {};
  const id = opts.id || (`run-${Date.now().toString(36)}`);
  if (runs.has(id) && !opts.reset) return runs.get(id);
  if (!opts.reset) {
    const existing = get(id);
    if (existing) return existing;
  }
  const run = createRunFromSeed({ ...opts, id });
  runs.set(id, run);
  saveRunToDisk(run);
  return run;
}

function reset(id) {
  const rid = id || DEFAULT_RUN_ID;
  const run = createRunFromSeed({ id: rid });
  runs.set(rid, run);
  saveRunToDisk(run);
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

/** 已载入内存的 Run；供阶段 D 时钟服务低频轮询。 */
function activeRuns() {
  ensureDefault();
  return Array.from(runs.values());
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
      clock: null,
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
  ensurePhaseDFields(r);
  const clk = r.clock || {};
  snap.clock = {
    year: Math.floor(Number(r.year) || 0),
    era: r.era,
    paused: !!clk.paused,
    realtimeMinutesPerYear: clk.minutesPerYear || 10,
    yearsSinceRound: Number(clk.yearsSinceRound) || 0,
    continuousYear: Number(clk.worldYearAtEpoch) || Number(r.year) || 0
  };
  snap.seatsPublic = (r.seats || [])
    .filter(s => s && s.role !== 'spectator')
    .map(s => ({
      civId: s.civId,
      role: s.role,
      displayName: s.displayName || null,
      occupied: true
    }));
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
    snap.notes.writeOps = 'deduce+oracle';
    snap.notes.phase = 'D';
  }
  return snap;
}

function touch(run) {
  if (!run) return;
  run.updatedAt = new Date().toISOString();
  scheduleSave(run);
}

export {
  DEFAULT_RUN_ID,
  DEFAULT_SEED,
  RUNS_DIR,
  createRunFromSeed,
  ensurePhaseDFields,
  ensureDefault,
  get,
  create,
  reset,
  list,
  activeRuns,
  toSnapshot,
  touch,
  clone,
  flushSaves,
  saveRunToDisk,
  loadRunFromDisk
};
