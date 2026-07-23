/* ============================================================
   创世引擎 · rules_only 真推演引擎（阶段 C）
   Character 规则决策 → LensCritic → Resolver → WorldBuilder
   ============================================================ */
import {
  mulberry32,
  hashCoord,
  buildGalaxyStub,
  expandGalaxyToSkeleton,
  expandSystemToDetailed,
  pickFrontierCoord,
  periodFor
} from './procedural-universe.mjs';
import { clone, touch } from './run-store.mjs';

const LENS_KEYS = ['政治', '军事', '经济', '科技', '思潮', '个人'];

const CAPS = {
  maxNewGalaxies: 2,
  maxNewSystemsDetailed: 1,
  maxNewBodies: 12
};

const FACILITY_KINDS = [
  { action: 'station.build', type: '空间站', facilityKind: 'outpost', visualClass: 'station_modular', costHint: 'alloys' },
  { action: 'facility.deploy', type: '轨道设施', facilityKind: 'array', visualClass: 'array', costHint: 'electronics' },
  { action: 'facility.deploy', type: '轨道设施', facilityKind: 'comm_mesh', visualClass: 'constellation', costHint: 'electronics' },
  { action: 'facility.deploy', type: '防御平台', facilityKind: 'platform', visualClass: 'defense', costHint: 'alloys' },
  { action: 'facility.deploy', type: '采矿站', facilityKind: 'asteroid_clamp', visualClass: 'mining', costHint: 'alloys' }
];

const EXPLORE_ACTIONS = ['explore.system', 'galaxy.probe', 'explore.body'];

function ability(char, name, fallback) {
  const a = (char.abilities || []).find(x => x.name === name);
  return a ? Number(a.val) || fallback : fallback;
}

function stanceBias(stance) {
  const s = String(stance || '');
  if (/激进|冒险|扩张|先发/.test(s)) return 1.2;
  if (/稳健|守成|观望|中立/.test(s)) return 0.85;
  if (/封锁|威慑|蓄势/.test(s)) return 0.95;
  return 1;
}

function roleTemplates(role, stance) {
  const r = String(role || '');
  if (/领袖/.test(r)) {
    return [
      { kind: 'policy', text: '调整国策节奏，巩固内部共识', weight: 1.1 },
      { kind: 'diplomacy', text: '试探邻邦意图，重估盟约边界', weight: 0.9 },
      { kind: 'explore.system', text: '批准邻域深空探测授权', weight: 0.75 },
      { kind: 'station.build', text: '批准新建轨道前哨以固化制空权', weight: 0.55 }
    ];
  }
  if (/设计|科研|工程师|总设计/.test(r)) {
    return [
      { kind: 'research', text: '推进关键科研节点，要求试车窗口', weight: 1.2 },
      { kind: 'facility.deploy', text: '部署传感阵列以校准理论模型', weight: 0.9 },
      { kind: 'explore.body', text: '申请对未勘察天体的轨道勘察', weight: 0.7 }
    ];
  }
  if (/军|舰队|统帅/.test(r)) {
    return [
      { kind: 'military', text: '提高戒备等级，调整轨道巡逻密度', weight: 1.15 },
      { kind: 'facility.deploy', text: '部署防御平台巩固近地屏障', weight: 0.85 },
      { kind: 'station.build', text: '要求建立前进补给站', weight: 0.5 }
    ];
  }
  if (/先知|神职|祭祀|潮母/.test(r)) {
    return [
      { kind: 'faith', text: '举行预兆仪式，解读潮汐异象', weight: 1.1 },
      { kind: 'explore.body', text: '坚持下潜或远观禁忌坐标', weight: 0.8 },
      { kind: 'galaxy.probe', text: '以灵视指向未知星域', weight: 0.65 }
    ];
  }
  if (/工匠|商/.test(r)) {
    return [
      { kind: 'trade', text: '守住核心技艺，重谈贸易条款', weight: 1.1 },
      { kind: 'facility.deploy', text: '在资源带部署采矿站', weight: 0.85 }
    ];
  }
  return [
    { kind: 'policy', text: '观望局势，保全本族根基', weight: 1 },
    { kind: 'explore.system', text: '资助一次有限航程的探测', weight: 0.6 }
  ];
}

/**
 * 每个 agent.enabled / isAgent 人物产出 1 条决策
 */
function characterDecisions(run, rnd) {
  const decisions = [];
  const year = run.year;
  (run.civs || []).forEach(civ => {
    const leaders = civ.leaders || [];
    leaders.forEach(ch => {
      const enabled = ch.isAgent !== false && (!ch.agent || ch.agent.enabled !== false);
      if (!enabled) return;
      if (ch.agent && ch.agent.status && ch.agent.status !== 'active') return;

      const templates = roleTemplates(ch.role, ch.agentStance);
      const bias = stanceBias(ch.agentStance);
      let best = templates[0];
      let bestScore = -1;
      templates.forEach(t => {
        const strat = ability(ch, '战略', 50) / 100;
        const will = ability(ch, '意志', 50) / 100;
        const score = t.weight * bias * (0.55 + 0.45 * rnd()) * (0.7 + 0.3 * strat + 0.2 * will);
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      });

      const urgency = bestScore > 1.1 ? '高' : bestScore > 0.8 ? '中' : '低';
      const decisionText = `${ch.name}：${best.text}（${ch.agentStance || '无明确立场'}）`;
      decisions.push({
        characterId: ch.id,
        characterName: ch.name,
        civId: civ.id,
        civName: civ.name,
        role: ch.role,
        kind: best.kind,
        decision: decisionText,
        urgency,
        stance: ch.agentStance || '',
        year
      });
    });
  });
  return decisions;
}

function lensTemplates(decisions, edict) {
  if (edict) {
    return {
      政治: '神谕重塑权力预期与合法性叙事',
      军事: '各方进入最高戒备，轨道与陆权同时绷紧',
      经济: '市场出现避险潮，战略物资被提前囤积',
      科技: '异常现象等待解析，科研议程被改写',
      思潮: '神迹引发信仰震荡与质疑',
      个人: '领袖动机被重新校准，私心与公义短暂对齐'
    };
  }
  const kinds = decisions.map(d => d.kind);
  const hasExplore = kinds.some(k => EXPLORE_ACTIONS.includes(k));
  const hasFac = kinds.some(k => k === 'station.build' || k === 'facility.deploy');
  const hasMil = kinds.some(k => k === 'military');
  const hasRes = kinds.some(k => k === 'research');
  return {
    政治: hasExplore ? '探测授权成为议会辩论焦点' : '各文明内部派系继续拉扯决策边界',
    军事: hasMil || hasFac ? '轨道戒备与防御部署同步抬升' : '前线暂无热战，但威慑姿态未松',
    经济: hasFac ? '航天与基建预算继续挤压民生科目' : '贸易通道在冷战阴影下勉力维持',
    科技: hasRes || hasExplore ? '观测数据回流，关键节点获得新样本' : '实验室按既定节奏推进，未有突破宣告',
    思潮: hasExplore ? '星空信仰因新坐标被点亮而升温' : '陆权与星权叙事持续分化',
    个人: decisions[0]
      ? `${decisions[0].characterName} 的抉择牵动同僚立场`
      : '关键人物在沉默中积蓄下一动'
  };
}

function nextFacilityId(run, civId) {
  const key = civId || 'unknown';
  run.facilitySeq[key] = (run.facilitySeq[key] || 0) + 1;
  return `fac:${key}:${run.facilitySeq[key]}`;
}

function pickParentForFacility(run, kind, civId, rnd) {
  const bodies = run.discovered.bodies;
  const landables = bodies.filter(b => b.flags && b.flags.landable && !b.flags.artificial);
  const stars = bodies.filter(b => b.type === '恒星');
  const belt = bodies.find(b => b.type === '小行星带');
  if (kind === 'asteroid_clamp' || kind === 'refinery') {
    if (belt) return { parent: null, a: (belt.orbit?.a || 370) + (rnd() - 0.5) * 30 };
    return { parent: null, a: 350 + rnd() * 40 };
  }
  // 默认挂母星或本文明首都星
  let parent = bodies.find(b => b.flags && b.flags.isPlayerHome) || landables[0];
  if (civId === 'bronze' && belt) return { parent: null, a: (belt.orbit?.a || 370) + 8 };
  if (!parent && stars[0]) return { parent: null, a: 200 + rnd() * 100 };
  if (!parent) return { parent: 'gaiya', a: 14 + rnd() * 16 };
  const base = parent.radius || 8;
  return { parent: parent.id, a: Math.round((base * 1.6 + 6 + rnd() * 18) * 10) / 10 };
}

function buildFacilityBody(run, decision, rnd) {
  const meta = FACILITY_KINDS.find(f => f.action === decision.kind || f.facilityKind === decision.kind)
    || FACILITY_KINDS[0];
  // 按 kind 细选
  let pick = meta;
  if (decision.kind === 'station.build') pick = FACILITY_KINDS[0];
  else if (/军|防御|威慑/.test(decision.decision + decision.stance)) pick = FACILITY_KINDS[3];
  else if (/采矿|匠|贸易|资源/.test(decision.decision + decision.role)) pick = FACILITY_KINDS[4];
  else if (/科研|设计|传感|阵列/.test(decision.decision + decision.role)) pick = FACILITY_KINDS[1];
  else pick = FACILITY_KINDS[Math.floor(rnd() * FACILITY_KINDS.length)];

  const id = nextFacilityId(run, decision.civId);
  const slot = pickParentForFacility(run, pick.facilityKind, decision.civId, rnd);
  const civ = (run.civs || []).find(c => c.id === decision.civId);
  const tint = (civ && civ.color) || '#5fd6e6';
  const seq = run.facilitySeq[decision.civId] || 1;
  const name = `${civ ? civ.short || civ.name : '未知'}·${slot.parent || '深空'}·${seq}`;

  const a = slot.a;
  return {
    id,
    name,
    type: pick.type,
    subtype: pick.facilityKind,
    color: tint,
    radius: 1.8 + rnd() * 0.8,
    parent: slot.parent,
    orbit: {
      a,
      e: 0.01 + rnd() * 0.03,
      inc: Math.round((rnd() * 40) * 10) / 10,
      period: slot.parent ? Math.max(1.2, Math.round(periodFor(a) / 80 * 10) / 10) : periodFor(a),
      phase: Math.round(rnd() * Math.PI * 2 * 1000) / 1000
    },
    galaxyId: 'g:0:0:0',
    systemId: 's:g:0:0:0:xiyang',
    completeness: 'detailed',
    flags: {
      landable: false,
      surveyed: 'orbital',
      artificial: true,
      civId: decision.civId,
      facilityKind: pick.facilityKind
    },
    visual: {
      class: pick.visualClass,
      kind: pick.facilityKind,
      scale: 'small',
      civTint: tint,
      status: 'active'
    },
    builtAtYear: run.year,
    builtByCharacterId: decision.characterId,
    desc: `${decision.characterName} 推动建造的${pick.type}，于 ${run.year} 年部署。`
  };
}

function validateBody(run, body, newBatch) {
  if (!body || !body.id) return { ok: false, reason: 'missing_id' };
  const allIds = new Set(run.discovered.bodies.map(b => b.id));
  (newBatch || []).forEach(b => allIds.add(b.id));
  if (allIds.has(body.id) && !run.discovered.bodies.find(b => b.id === body.id)) {
    // 在 newBatch 内重复
  }
  if (run.discovered.bodies.some(b => b.id === body.id)) return { ok: false, reason: 'duplicate_id' };
  if (body.flags && body.flags.artificial) {
    if (body.flags.landable) return { ok: false, reason: 'facility_landable' };
    if (body.parent) {
      const parentOk = run.discovered.bodies.some(b => b.id === body.parent)
        || (newBatch || []).some(b => b.id === body.parent);
      if (!parentOk) return { ok: false, reason: 'missing_parent' };
    }
  }
  if (body.orbit && body.orbit.a != null && body.orbit.a <= 0) return { ok: false, reason: 'bad_orbit' };
  return { ok: true };
}

/**
 * WorldBuilder：处理 explore* + facility*
 */
function worldBuilder(run, decisions, rnd) {
  const worldDelta = {
    newGalaxies: [],
    newSystems: [],
    newBodies: [],
    updatedBodies: [],
    removedBodyIds: []
  };

  let gCount = 0;
  let sysDet = 0;
  let bodyCount = 0;

  // 先设施
  const facDecisions = decisions.filter(d => d.kind === 'station.build' || d.kind === 'facility.deploy');
  facDecisions.forEach(d => {
    if (bodyCount >= CAPS.maxNewBodies) return;
    const body = buildFacilityBody(run, d, rnd);
    const v = validateBody(run, body, worldDelta.newBodies);
    if (!v.ok) return;
    run.discovered.bodies.push(body);
    worldDelta.newBodies.push(clone(body));
    bodyCount++;
  });

  // 探测：优先 galaxy.probe / explore.system
  const explore = decisions.filter(d => EXPLORE_ACTIONS.includes(d.kind));
  explore.forEach(d => {
    if (d.kind === 'galaxy.probe' || d.kind === 'explore.system') {
      if (gCount >= CAPS.maxNewGalaxies) return;
      const coord = pickFrontierCoord(run, rnd);
      const key = `${coord.x},${coord.y},${coord.z}`;
      if ((run.frontierCoords || []).some(c => `${c.x},${c.y},${c.z}` === key)) return;

      let galaxy = buildGalaxyStub(run.seed, coord);
      // 若同 id 已存在则跳过
      if (run.discovered.galaxies.some(g => g.id === galaxy.id)) return;

      run.frontierCoords.push(coord);
      // 半数直接扩到 skeleton，探测成功则 detailed
      const deep = d.kind === 'explore.system' || rnd() > 0.35;
      if (deep && sysDet < CAPS.maxNewSystemsDetailed) {
        const sk = expandGalaxyToSkeleton(galaxy, run.seed);
        galaxy = sk.galaxy;
        let system = sk.system;
        if (bodyCount + 6 <= CAPS.maxNewBodies) {
          const det = expandSystemToDetailed(system, galaxy, run.seed);
          system = det.system;
          galaxy = det.galaxy;
          const accepted = [];
          det.bodies.forEach(b => {
            if (bodyCount >= CAPS.maxNewBodies) return;
            const v = validateBody(run, b, worldDelta.newBodies.concat(accepted));
            if (!v.ok) return;
            accepted.push(b);
            bodyCount++;
          });
          accepted.forEach(b => {
            run.discovered.bodies.push(b);
            worldDelta.newBodies.push(clone(b));
          });
          run.discovered.systems.push(system);
          worldDelta.newSystems.push(clone(system));
          sysDet++;
        } else {
          run.discovered.systems.push(system);
          worldDelta.newSystems.push(clone(system));
        }
      }
      run.discovered.galaxies.push(galaxy);
      worldDelta.newGalaxies.push(clone(galaxy));
      gCount++;
    } else if (d.kind === 'explore.body') {
      // 提升某个 remote landable 的 surveyed 等级
      const cand = run.discovered.bodies.find(
        b => b.flags && b.flags.landable && b.flags.surveyed === 'remote' && !b.flags.artificial
      );
      if (cand) {
        cand.flags.surveyed = 'orbital';
        worldDelta.updatedBodies.push(clone(cand));
      }
    }
  });

  return worldDelta;
}

function applyResolver(run, decisions, lenses, edict) {
  const patches = {
    warehouses: 'client-surfaces-still-authoritative-for-tiles',
    relations: [],
    tiles: 'not-server-simulated-in-C',
    tech: [],
    characters: []
  };

  // 年岁
  const yearDelta = edict ? 1 : 7;
  run.year += yearDelta;
  if (run.world) run.world.年数 = run.year;

  // 科技：有 research 决策的文明推进
  decisions.forEach(d => {
    if (d.kind !== 'research') return;
    const civ = (run.civs || []).find(c => c.id === d.civId);
    if (!civ || !civ.科技树) return;
    civ.科技树.下一阶段 = Math.min(100, (Number(civ.科技树.下一阶段) || 0) + 3);
    const nodes = civ.科技树.节点 || {};
    Object.keys(nodes).forEach(k => {
      const n = nodes[k];
      if (n && n.状态 === '研究中' && typeof n.进度 === 'number') {
        n.进度 = Math.min(100, n.进度 + 5 + Math.floor(ability(
          (civ.leaders || []).find(l => l.id === d.characterId) || {},
          '学识',
          40
        ) / 20));
        patches.tech.push({ civId: civ.id, node: k, progress: n.进度 });
      }
    });
  });

  // 关系微扰：军事决策可能加剧对立
  if (decisions.some(d => d.kind === 'military')) {
    const rel = (run.relations || []).find(r =>
      (r.a === 'dawn' && r.b === 'aurel') || (r.a === 'aurel' && r.b === 'dawn')
    );
    if (rel && !/热战/.test(rel.state)) {
      rel.reason = (rel.reason || '') + ' · 本轮戒备升级';
      patches.relations.push({ a: rel.a, b: rel.b, state: rel.state });
    }
  }

  // pendingDecisions 刷新为最新人物决策摘要
  run.deduction = run.deduction || {
    lenses: LENS_KEYS,
    rounds: 4,
    pendingDecisions: [],
    log: []
  };
  run.deduction.pendingDecisions = decisions.map(d => ({
    civ: d.civId,
    leader: d.characterName,
    characterId: d.characterId,
    decision: d.decision,
    urgency: d.urgency,
    stance: d.stance,
    kind: d.kind
  }));

  return { yearDelta, patches };
}

function buildChronicle(run, decisions, worldDelta, lenses, edict) {
  const names = decisions.map(d => d.characterName).filter(Boolean);
  const uniqueNames = [...new Set(names)];
  const facNames = (worldDelta.newBodies || [])
    .filter(b => b.flags && b.flags.artificial)
    .map(b => b.name);
  const newSys = (worldDelta.newSystems || []).map(s => s.name);
  const newGal = (worldDelta.newGalaxies || []).map(g => g.name);

  let text;
  if (edict) {
    text = `神谕「${edict}」降下。${uniqueNames.slice(0, 4).join('、') || '诸领袖'} 紧急校准立场，世界随之震颤。`;
  } else {
    const parts = [];
    parts.push(`${uniqueNames.slice(0, 5).join('、') || '诸文明领袖'} 各自拍板。`);
    if (facNames.length) parts.push(`新建设施：${facNames.join('、')}。`);
    if (newGal.length) parts.push(`星图扩展：发现 ${newGal.join('、')}。`);
    if (newSys.length) parts.push(`解析星系：${newSys.join('、')}。`);
    if (!facNames.length && !newGal.length) {
      parts.push(lenses.政治 || '局势在沉默中推进。');
    }
    text = parts.join('');
  }

  const entry = {
    年份: `${run.era?.纪年 || '第4纪元'} · ${run.year}年`,
    纪元: run.era?.纪元 || '曙光纪元',
    事件: text,
    人物: uniqueNames,
    文明: [...new Set(decisions.map(d => d.civName))],
    round: (run.deductionRounds?.length || 0) + 1
  };
  run.chronicle = run.chronicle || [];
  run.chronicle.unshift(entry);
  return entry;
}

/**
 * 主入口：推进一轮
 * @param {object} run
 * @param {{ force?: boolean, edict?: string }} opts
 */
function deduce(run, opts) {
  opts = opts || {};
  const roundN = (run.deductionRounds?.length || 0) + 1;
  const seed = (run.seed ^ (run.revision * 2654435761) ^ (roundN * 40503)) >>> 0;
  const rnd = mulberry32(seed);

  // 1) Character
  let decisions = characterDecisions(run, rnd);

  // 神谕：不替代人物决策，但覆盖叙事；仍保留决策供编年挂名
  if (opts.edict) {
    // 轻量：不强制 explore/facility，除非 force
  }

  // 2) 裁剪：单回合设施/探测帽（在 WorldBuilder 再强制）
  // 若没有任何 explore/facility，rules_only 仍可能只做政策——验收需要增长时
  // 每 2 轮保证至少一次弱探测意图（由最高战略人物挂名）
  if (!opts.edict && roundN % 2 === 0) {
    const hasExplore = decisions.some(d => EXPLORE_ACTIONS.includes(d.kind));
    if (!hasExplore && decisions.length) {
      const host = decisions.slice().sort((a, b) => {
        const ca = (run.civs || []).find(c => c.id === a.civId);
        const cb = (run.civs || []).find(c => c.id === b.civId);
        const la = (ca?.leaders || []).find(l => l.id === a.characterId);
        const lb = (cb?.leaders || []).find(l => l.id === b.characterId);
        return ability(lb || {}, '战略', 0) - ability(la || {}, '战略', 0);
      })[0];
      if (host) {
        host.kind = 'galaxy.probe';
        host.decision = `${host.characterName}：批准邻域深空探针投放（规则保底扩展）`;
      }
    }
  }

  // 每 3 轮保底一次设施（晨曦工程师/领袖）
  if (!opts.edict && roundN % 3 === 0) {
    const hasFac = decisions.some(d => d.kind === 'station.build' || d.kind === 'facility.deploy');
    if (!hasFac) {
      const eng = decisions.find(d => /设计|科研|工程师/.test(d.role || ''))
        || decisions.find(d => d.civId === 'dawn')
        || decisions[0];
      if (eng) {
        eng.kind = 'facility.deploy';
        eng.decision = `${eng.characterName}：批准部署新轨道设施以固化探测成果`;
      }
    }
  }

  // 3) Lens
  const lenses = lensTemplates(decisions, opts.edict);

  // 4) WorldBuilder
  const worldDelta = opts.edict && !opts.force
    ? { newGalaxies: [], newSystems: [], newBodies: [], updatedBodies: [], removedBodyIds: [] }
    : worldBuilder(run, decisions, rnd);

  // 5) Resolver
  const { yearDelta, patches } = applyResolver(run, decisions, lenses, opts.edict);

  // 6) Chronicle
  const chronicleEntry = buildChronicle(run, decisions, worldDelta, lenses, opts.edict);

  // 7) log + revision
  const summary = chronicleEntry.事件;
  const log = {
    round: roundN,
    year: `${run.era?.纪年 || '第4纪元'} · ${run.year}年`,
    summary,
    lenses,
    decisions: decisions.map(d => ({
      characterId: d.characterId,
      characterName: d.characterName,
      civId: d.civId,
      kind: d.kind,
      decision: d.decision
    })),
    worldDelta: {
      newGalaxies: worldDelta.newGalaxies.length,
      newSystems: worldDelta.newSystems.length,
      newBodies: worldDelta.newBodies.length
    }
  };
  run.deduction.log = run.deduction.log || [];
  run.deduction.log.unshift(log);

  run.revision += 1;
  const roundRecord = {
    n: roundN,
    phase: 'done',
    year: run.year,
    revision: run.revision,
    agentMode: run.agentMode || 'rules_only',
    edict: opts.edict || null
  };
  run.deductionRounds = run.deductionRounds || [];
  run.deductionRounds.push(roundRecord);
  touch(run);

  return {
    runId: run.id,
    revision: run.revision,
    year: run.year,
    round: roundRecord,
    decisions: decisions.map(d => ({
      characterId: d.characterId,
      characterName: d.characterName,
      civId: d.civId,
      civName: d.civName,
      role: d.role,
      kind: d.kind,
      decision: d.decision,
      urgency: d.urgency,
      stance: d.stance
    })),
    lenses,
    patchesSummary: patches,
    worldDelta,
    chronicle: [chronicleEntry],
    yearDelta
  };
}

export { deduce, CAPS, LENS_KEYS, characterDecisions, validateBody };
