/* ============================================================
   创世引擎 · 程序无限骨架（阶段 C）
   runSeed + galacticCoord → 确定性 stub / skeleton / detailed
   不预生成；仅在探测/推演时 materialize。
   ============================================================ */

const TWO_PI = Math.PI * 2;

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashCoord(seed, x, y, z) {
  let h = (seed ^ (x * 374761393) ^ (y * 668265263) ^ (z * 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const STAR_TYPES = [
  { type: '恒星', subtype: '红矮星', color: '#ff8a6a', radius: [14, 20] },
  { type: '恒星', subtype: '黄矮星', color: '#ffd9a0', radius: [22, 28] },
  { type: '恒星', subtype: '白矮星', color: '#e8f0ff', radius: [8, 12] },
  { type: '恒星', subtype: '蓝巨星', color: '#a0c8ff', radius: [32, 42] }
];

const PLANET_SLOTS = [
  { type: '岩质行星', subtype: '炙烤型', color: '#c98452', landable: true, aMul: [0.35, 0.55] },
  { type: '类地行星', subtype: '宜居候选', color: '#4fa8e0', landable: true, aMul: [0.7, 1.1] },
  { type: '气态巨星', subtype: '风暴型', color: '#d8a86a', landable: false, aMul: [1.6, 2.4], ring: true },
  { type: '冰巨星', subtype: '外缘', color: '#8fd0e8', landable: false, aMul: [2.8, 3.8], ring: false },
  { type: '矮行星', subtype: '边陲', color: '#8a90a8', landable: true, aMul: [4.0, 5.2] }
];

const NAME_A = ['玄', '苍', '白', '赤', '金', '青', '银', '暗', '耀', '寂', '晨', '暮', '潮', '霜', '焰', '渊'];
const NAME_B = ['枢', '阙', '庭', '渊', '海', '原', '脊', '环', '灯', '门', '角', '湾', '礁', '庭', '垒', '台'];
const NAME_SYS = ['织女', '牵牛', '北落', '天市', '太微', '紫微', '角宿', '心宿', '参宿', '井宿', '翼宿', '轸宿', '奎宿', '娄宿', '胃宿', '昴宿'];

function pickName(rnd, pool, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += pool[Math.floor(rnd() * pool.length)];
  return s;
}

function galaxyId(coord) {
  return `g:${coord.x}:${coord.y}:${coord.z}`;
}

function systemId(gId, localIndex) {
  return `s:${gId}:${localIndex}`;
}

function bodyId(sId, kind, n) {
  return `b:${sId}:${kind}${n}`;
}

function periodFor(a) {
  // 粗开普勒：T ∝ a^1.5，以盖亚 a=230 → 365 为参照
  return Math.max(20, Math.round(365 * Math.pow(Math.max(a, 40) / 230, 1.5)));
}

/**
 * 生成星系 stub（仅句柄，不展开恒星/行星）
 */
function buildGalaxyStub(runSeed, coord) {
  const h = hashCoord(runSeed, coord.x, coord.y, coord.z);
  const rnd = mulberry32(h);
  const name = NAME_SYS[Math.floor(rnd() * NAME_SYS.length)] + '域·' + pickName(rnd, NAME_A, 1);
  return {
    id: galaxyId(coord),
    name,
    coord: { x: coord.x, y: coord.y, z: coord.z },
    completeness: 'stub',
    seedHandle: h
  };
}

/**
 * stub → skeleton：恒星 + 行星槽位数
 */
function expandGalaxyToSkeleton(galaxy, runSeed) {
  const rnd = mulberry32((galaxy.seedHandle ^ runSeed ^ 0x5a5a) >>> 0);
  const starT = STAR_TYPES[Math.floor(rnd() * STAR_TYPES.length)];
  const nPlanets = 2 + Math.floor(rnd() * 4); // 2..5
  const localIndex = 0;
  const sId = systemId(galaxy.id, localIndex);
  const starName = pickName(rnd, NAME_A, 1) + pickName(rnd, NAME_B, 1);
  const system = {
    id: sId,
    galaxyId: galaxy.id,
    name: starName + '系',
    starId: bodyId(sId, 'star', 0),
    completeness: 'skeleton',
    localIndex,
    seedHandle: (galaxy.seedHandle ^ 0x2222) >>> 0,
    planetSlots: nPlanets,
    starType: starT
  };
  galaxy.completeness = 'skeleton';
  galaxy.primarySystemId = sId;
  return { galaxy, system };
}

/**
 * skeleton → detailed：完整 Body 列表
 */
function expandSystemToDetailed(system, galaxy, runSeed) {
  const rnd = mulberry32((system.seedHandle ^ runSeed ^ 0xabcd) >>> 0);
  const starT = system.starType || STAR_TYPES[1];
  const bodies = [];
  const r0 = starT.radius[0] + rnd() * (starT.radius[1] - starT.radius[0]);
  const star = {
    id: system.starId,
    name: system.name.replace(/系$/, '') || '无名恒星',
    type: starT.type,
    subtype: starT.subtype,
    color: starT.color,
    radius: Math.round(r0 * 10) / 10,
    orbit: null,
    parent: null,
    galaxyId: galaxy.id,
    systemId: system.id,
    completeness: 'detailed',
    flags: { landable: false, surveyed: 'remote' },
    desc: `程序发现的${starT.subtype}，位于 ${galaxy.name}。`
  };
  bodies.push(star);

  const baseA = 120 + rnd() * 80;
  const n = system.planetSlots || 3;
  for (let i = 0; i < n; i++) {
    const slot = PLANET_SLOTS[Math.min(i, PLANET_SLOTS.length - 1)];
    const aMul = slot.aMul[0] + rnd() * (slot.aMul[1] - slot.aMul[0]);
    const a = Math.round(baseA * aMul * (1 + i * 0.15));
    const landable = !!slot.landable && rnd() > 0.25;
    const id = bodyId(system.id, 'p', i + 1);
    const pname = pickName(rnd, NAME_A, 1) + pickName(rnd, NAME_B, 1);
    const body = {
      id,
      name: pname,
      type: slot.type,
      subtype: slot.subtype,
      color: slot.color,
      radius: slot.landable ? 3 + rnd() * 5 : 8 + rnd() * 10,
      orbit: {
        a,
        e: Math.round(rnd() * 0.08 * 1000) / 1000,
        inc: Math.round((rnd() * 6 - 1) * 10) / 10,
        period: periodFor(a),
        phase: Math.round(rnd() * TWO_PI * 1000) / 1000
      },
      parent: null,
      ring: !!slot.ring && rnd() > 0.5,
      galaxyId: galaxy.id,
      systemId: system.id,
      completeness: 'detailed',
      flags: {
        landable,
        surveyed: landable ? 'remote' : 'remote',
        colonized: false
      },
      surfaceId: landable ? `${id}:surface` : null,
      surfaceSeed: landable ? (hashCoord(runSeed, a, i, system.seedHandle) >>> 0) : null,
      climateProfile: landable
        ? {
            hydrosphere: Math.round(rnd() * 0.5 * 100) / 100,
            meanTemp: ['hot', 'temperate', 'cold', 'frigid'][Math.floor(rnd() * 4)],
            energyAffinity: Math.round(rnd() * 0.6 * 100) / 100
          }
        : null,
      desc: `由深空探测解析出的${slot.type}，轨道半长轴约 ${a}。`
    };
    bodies.push(body);
  }

  system.completeness = 'detailed';
  galaxy.completeness = galaxy.completeness === 'stub' ? 'skeleton' : galaxy.completeness;
  if (galaxy.completeness !== 'detailed') galaxy.completeness = 'detailed';
  return { system, galaxy, bodies };
}

/**
 * 从 run 的 frontier 选一个未占用邻格
 */
function pickFrontierCoord(run, rnd) {
  const used = new Set((run.frontierCoords || []).map(c => `${c.x},${c.y},${c.z}`));
  // 在已发现格子周围的 26-邻域找空位；若满则扩大半径
  const base = (run.frontierCoords && run.frontierCoords[0]) || { x: 0, y: 0, z: 0 };
  const candidates = [];
  for (let r = 1; r <= 4; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const c = { x: base.x + dx, y: base.y + dy, z: base.z + dz };
          const k = `${c.x},${c.y},${c.z}`;
          if (!used.has(k)) candidates.push(c);
        }
      }
    }
    if (candidates.length) break;
  }
  if (!candidates.length) {
    // 极端兜底：沿 x 正方向推
    let x = 1;
    while (used.has(`${x},0,0`)) x++;
    return { x, y: 0, z: 0 };
  }
  return candidates[Math.floor(rnd() * candidates.length)];
}

export {
  mulberry32,
  hashCoord,
  galaxyId,
  systemId,
  bodyId,
  buildGalaxyStub,
  expandGalaxyToSkeleton,
  expandSystemToDetailed,
  pickFrontierCoord,
  periodFor
};
