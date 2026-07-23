/* ============================================================
   创世引擎 · 表面定义生成（阶段 C5）
   从 landable Body 确定性合成 bodySurfaces 条目（无 tiles）。
   幂等：同 bodyId + surfaceSeed → 同 def。
   ============================================================ */

const FREQS = [8, 16, 32, 64];

function clampFreq(n) {
  const x = Number(n) || 32;
  let best = 32;
  let d = Infinity;
  FREQS.forEach(f => {
    const dd = Math.abs(f - x);
    if (dd < d) { d = dd; best = f; }
  });
  return best;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const REGION_A = ['玄', '苍', '白', '赤', '金', '青', '银', '暗', '耀', '寂', '霜', '焰', '渊', '潮', '岩', '尘'];
const REGION_B = ['海', '原', '脊', '谷', '湾', '盆', '冠', '壁', '环', '洲', '漠', '峡', '垒', '台', '渊', '角'];

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

function topologyFromBody(body, biome) {
  const seed = body.surfaceSeed != null
    ? (body.surfaceSeed >>> 0)
    : hashStr(body.id || 'body');
  let frequency = 32;
  let planetRadiusKm = 5000;
  let nominalTileWidthKm = 100;
  if (biome === 'airless_moon') {
    frequency = 32;
    planetRadiusKm = 1200 + (seed % 800);
    nominalTileWidthKm = 80;
  } else if (biome === 'cold_dwarf') {
    frequency = 16;
    planetRadiusKm = 900 + (seed % 600);
    nominalTileWidthKm = 90;
  } else if (biome === 'arid_rock') {
    frequency = 32;
    planetRadiusKm = 4000 + (seed % 2000);
    nominalTileWidthKm = 100;
  } else {
    frequency = 32;
    planetRadiusKm = 5000 + (seed % 2000);
    nominalTileWidthKm = 110;
  }
  // 远距 / 新发现体默认用 16 减负；已知详细勘察可更高
  if (body.flags && body.flags.surveyed === 'remote') frequency = Math.min(frequency, 16);
  if (body.flags && body.flags.surveyed === 'surface') frequency = clampFreq(Math.max(frequency, 32));

  return {
    kind: 'icosahedron-dual',
    frequency: clampFreq(frequency),
    seed,
    planetRadiusKm,
    nominalTileWidthKm
  };
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

function regionPalette(biome) {
  if (biome === 'airless_moon') return ['#6a7080', '#c8ccd8', '#2a3040', '#a8a49a', '#8890a0'];
  if (biome === 'cold_dwarf') return ['#6a7080', '#4a5568', '#8a90a8', '#3a4050'];
  if (biome === 'arid_rock') return ['#c98452', '#8a3a22', '#4a3830', '#d4683a', '#a06040'];
  return ['#4fd2ff', '#e6a948', '#6fd08c', '#d97b4f', '#7f8cf0', '#b6c8de', '#d68b52', '#5fa6c4'];
}

function buildRegions(body, biome, rnd) {
  const colors = regionPalette(biome);
  const n = biome === 'cold_dwarf' ? 2 : biome === 'airless_moon' ? 4 : 4;
  const regions = [];
  for (let i = 0; i < n; i++) {
    const name = REGION_A[Math.floor(rnd() * REGION_A.length)]
      + REGION_B[Math.floor(rnd() * REGION_B.length)]
      + (i === 0 ? '主区' : '');
    const lat = Math.round((rnd() * 140 - 70) * 10) / 10;
    const lon = Math.round((rnd() * 360 - 180) * 10) / 10;
    const radius = Math.round(28 + rnd() * 22);
    regions.push({
      id: `${body.id}-r${i}`,
      name,
      color: colors[i % colors.length],
      lat,
      lon,
      radius,
      description: `程序勘察划定的${biome}区域。`
    });
  }
  return regions;
}

/**
 * 合成表面定义（无 tiles，catalog 用键集合；完整 catalog 由调用方挂全局目录）
 * @param {object} body
 * @param {object} [catalogs] { terrain, resource, building } 全量目录
 */
function buildSurfaceDef(body, catalogs) {
  catalogs = catalogs || {};
  if (!body || !body.id) throw new Error('buildSurfaceDef: body required');
  if (body.flags && body.flags.artificial) {
    throw new Error('buildSurfaceDef: artificial body has no surface');
  }
  const landable = body.flags
    ? !!body.flags.landable
    : !!(body.home || body.isPlayerHome);
  if (!landable) throw new Error('buildSurfaceDef: body not landable');

  const surfaceId = body.surfaceId || `${body.id}:surface`;
  const biomeKind = biomeFromBody(body);
  const topology = topologyFromBody(body, biomeKind);
  const rnd = mulberry32(topology.seed ^ 0x51ace);
  const climateProfile = body.climateProfile
    ? JSON.parse(JSON.stringify(body.climateProfile))
    : {
        hydrosphere: biomeKind === 'terrestrial' ? 0.3 : 0.05,
        meanTemp: biomeKind === 'arid_rock' ? 'hot' : biomeKind === 'cold_dwarf' ? 'frigid' : 'cold',
        energyAffinity: 0.1
      };

  const def = {
    schemaVersion: 1,
    id: surfaceId,
    bodyId: body.id,
    biomeKind,
    topology,
    climateProfile,
    regions: buildRegions(body, biomeKind, rnd),
    capitalSeeds: {},
    claimRadius: {},
    // 全量目录引用（Run 侧与客户端都会有全局 catalogs）
    terrainCatalog: catalogs.terrain || {},
    resourceCatalog: catalogs.resource || {},
    buildingCatalog: catalogs.building || {}
  };
  return def;
}

/**
 * 幂等确保：若 run/bodySurfaces 已有则返回；否则生成并挂上 body.surfaceId
 */
function ensureSurfaceOnRun(run, bodyId) {
  if (!run) throw new Error('ensureSurfaceOnRun: run required');
  const body = (run.discovered.bodies || []).find(b => b.id === bodyId);
  if (!body) {
    return { ok: false, status: 404, error: 'not_found', resource: 'body', id: bodyId };
  }
  if (body.flags && body.flags.artificial) {
    return { ok: false, status: 400, error: 'not_landable', message: 'artificial facility has no surface' };
  }
  const landable = body.flags
    ? !!body.flags.landable
    : !!(body.home || body.isPlayerHome);
  if (!landable) {
    return { ok: false, status: 400, error: 'not_landable', id: bodyId };
  }

  run.bodySurfaces = run.bodySurfaces || {};
  const surfaceId = body.surfaceId || `${bodyId}:surface`;
  let created = false;
  if (!run.bodySurfaces[surfaceId]) {
    if (body.surfaceSeed == null) {
      body.surfaceSeed = hashStr(bodyId + ':' + (run.seed || 0));
    }
    body.surfaceId = surfaceId;
    const catalogs = {
      terrain: (run.catalogs && run.catalogs.terrain) || {},
      resource: (run.catalogs && run.catalogs.resource) || {},
      building: (run.catalogs && run.catalogs.building) || {}
    };
    run.bodySurfaces[surfaceId] = buildSurfaceDef(body, catalogs);
    created = true;
    // 提升勘察等级
    if (body.flags && body.flags.surveyed === 'remote') body.flags.surveyed = 'orbital';
    run.revision = (run.revision || 0) + 1;
    run.updatedAt = new Date().toISOString();
  }

  const def = run.bodySurfaces[surfaceId];
  return {
    ok: true,
    created,
    revision: run.revision,
    body: {
      id: body.id,
      surfaceId: body.surfaceId,
      surfaceSeed: body.surfaceSeed,
      flags: body.flags
    },
    surface: {
      schemaVersion: def.schemaVersion,
      id: def.id,
      bodyId: def.bodyId,
      biomeKind: def.biomeKind,
      topology: def.topology,
      climateProfile: def.climateProfile,
      regions: def.regions,
      capitalSeeds: def.capitalSeeds || {},
      claimRadius: def.claimRadius || {},
      resourceKeys: Object.keys(def.resourceCatalog || {}),
      buildingKeys: Object.keys(def.buildingCatalog || {}),
      terrainKeys: Object.keys(def.terrainCatalog || {}),
      notes: { tiles: 'not-included', use: 'client deterministic rebuild' }
    }
  };
}

export {
  buildSurfaceDef,
  ensureSurfaceOnRun,
  biomeFromBody,
  topologyFromBody,
  clampFreq
};
