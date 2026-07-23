/* ============================================================
   创世引擎 · 真推演引擎（阶段 C / C6）
   Character 规则决策 →（可选 LLM hybrid）→ LensCritic → Resolver → WorldBuilder
   agentMode: rules_only | hybrid | full
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
import { chat as llmChat, parseJsonLoose, llmConfigured } from './llm-provider.mjs';
import * as llmLog from './llm-log.mjs';

const LENS_KEYS = ['政治', '军事', '经济', '科技', '思潮', '个人'];

const CAPS = {
  maxNewGalaxies: 2,
  maxNewSystemsDetailed: 1,
  maxNewBodies: 12
};

const ALLOWED_KINDS = new Set([
  'policy', 'diplomacy', 'research', 'military', 'faith', 'trade',
  'explore.system', 'galaxy.probe', 'explore.body',
  'station.build', 'facility.deploy'
]);

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
  // 锚点用天体中文名，避免 UI 出现「晨曦·gaiya·1」
  const parentBody = slot.parent
    ? (run.discovered.bodies || []).find(b => b.id === slot.parent)
    : null;
  const anchor = (parentBody && parentBody.name) || (slot.parent ? String(slot.parent) : '深空');
  const civLabel = (civ && (civ.short || civ.name)) || '未知';
  const name = `${civLabel}·${anchor}·${seq}`;

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

function applySoftGuarantees(run, decisions, roundN, opts) {
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
  return decisions;
}

function resolveAgentMode(run, opts) {
  const raw = (opts && opts.agentMode) || run.agentMode || 'rules_only';
  if (raw === 'hybrid' || raw === 'full') return raw;
  return 'rules_only';
}

/**
 * hybrid/full：用一次批量 LLM 调用润色 / 改写规则决策；失败整批回落规则。
 * @returns {Promise<{ decisions: object[], lenses: object|null, meta: object }>}
 */
async function enhanceWithLlm(run, decisions, opts, agentMode, roundN) {
  const meta = {
    requested: agentMode,
    used: 'rules_only',
    llmCalls: 0,
    llmMs: 0,
    fallback: null,
    error: null,
    logIds: []
  };
  const llm = opts && opts.llm;
  if (!llmConfigured(llm)) {
    meta.fallback = 'llm_not_configured';
    return { decisions, lenses: null, meta };
  }

  const roster = decisions.map(d => ({
    characterId: d.characterId,
    characterName: d.characterName,
    civId: d.civId,
    civName: d.civName,
    role: d.role,
    stance: d.stance,
    ruleKind: d.kind,
    ruleDecision: d.decision,
    urgency: d.urgency
  }));

  const worldBrief = {
    year: run.year,
    era: run.era,
    bodyCount: (run.discovered?.bodies || []).length,
    galaxyCount: (run.discovered?.galaxies || []).length,
    recentFacilities: (run.discovered?.bodies || [])
      .filter(b => b.flags && b.flags.artificial)
      .slice(-4)
      .map(b => b.name)
  };

  const kindList = [...ALLOWED_KINDS].join(', ');
  const system = [
    '你是创世引擎推演中的 CharacterAgent 编排器。',
    '根据各人物设定与规则草稿，输出本轮最终决策。',
    '硬约束：',
    `- kind 必须是以下之一：${kindList}`,
    '- 每人恰好 1 条决策；characterId 必须与输入一致，不得新增人物',
    '- decision 用中文，以「人名：」开头，体现英雄史观，30～80 字',
    '- 不要解释过程，只输出一个 JSON 对象',
    'JSON schema:',
    '{"decisions":[{"characterId":"","kind":"","decision":"","urgency":"高|中|低"}],',
    '"lenses":{"政治":"","军事":"","经济":"","科技":"","思潮":"","个人":""}}'
  ].join('\n');

  const user = JSON.stringify({
    mode: agentMode,
    world: worldBrief,
    draftDecisions: roster,
    note: agentMode === 'full'
      ? '可较大幅度改写 kind 与文案，但仍须服务人物立场与世界因果。'
      : '以规则草稿为底，润色文案；仅在明显更合理时微调 kind。'
  }, null, 0);

  const timeoutMs = Math.max(4000, Math.min(Number(llm.timeoutMs) || 25000, 60000));
  const result = await llmChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    {
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      temperature: llm.temperature != null ? llm.temperature : (agentMode === 'full' ? 0.85 : 0.65),
      timeoutMs
    }
  );
  meta.llmCalls = 1;
  meta.llmMs = result.ms || 0;

  if (!result.ok) {
    meta.fallback = 'llm_error';
    meta.error = result.error || 'llm_failed';
    const logEntry = llmLog.record({
      runId: run.id,
      round: roundN,
      purpose: 'character_enhance',
      model: llm.model,
      baseHost: llmLog.hostFromBase(llm.baseUrl),
      ok: false,
      ms: result.ms,
      error: meta.error,
      systemPreview: system,
      promptPreview: user,
      content: '',
      fallback: 'llm_error'
    });
    meta.logIds.push(logEntry.id);
    return { decisions, lenses: null, meta };
  }

  const parsed = parseJsonLoose(result.content);
  if (!parsed || !Array.isArray(parsed.decisions)) {
    meta.fallback = 'llm_parse_error';
    meta.error = 'invalid_json';
    const logEntry = llmLog.record({
      runId: run.id,
      round: roundN,
      purpose: 'character_enhance',
      model: llm.model,
      baseHost: llmLog.hostFromBase(llm.baseUrl),
      ok: true,
      ms: result.ms,
      systemPreview: system,
      promptPreview: user,
      content: result.content,
      usage: result.raw?.usage || null,
      parseOk: false,
      fallback: 'llm_parse_error'
    });
    meta.logIds.push(logEntry.id);
    return { decisions, lenses: null, meta };
  }

  const byId = new Map(decisions.map(d => [d.characterId, d]));
  let applied = 0;
  parsed.decisions.forEach(item => {
    if (!item || !item.characterId) return;
    const base = byId.get(item.characterId);
    if (!base) return;
    const kind = String(item.kind || '').trim();
    if (ALLOWED_KINDS.has(kind)) base.kind = kind;
    const text = String(item.decision || '').trim();
    if (text) {
      // 保证挂人名
      base.decision = text.includes(base.characterName)
        ? text.slice(0, 160)
        : `${base.characterName}：${text.slice(0, 140)}`;
    }
    if (item.urgency && /高|中|低/.test(String(item.urgency))) {
      base.urgency = String(item.urgency);
    }
    base.source = 'llm';
    applied++;
  });

  if (applied === 0) {
    meta.fallback = 'llm_no_match';
    meta.error = 'no_character_matched';
    const logEntry = llmLog.record({
      runId: run.id,
      round: roundN,
      purpose: 'character_enhance',
      model: llm.model,
      baseHost: llmLog.hostFromBase(llm.baseUrl),
      ok: true,
      ms: result.ms,
      systemPreview: system,
      promptPreview: user,
      content: result.content,
      usage: result.raw?.usage || null,
      parseOk: true,
      applied: 0,
      fallback: 'llm_no_match'
    });
    meta.logIds.push(logEntry.id);
    return { decisions, lenses: null, meta };
  }

  let lenses = null;
  if (parsed.lenses && typeof parsed.lenses === 'object') {
    lenses = {};
    LENS_KEYS.forEach(k => {
      const v = parsed.lenses[k];
      if (v != null && String(v).trim()) lenses[k] = String(v).trim().slice(0, 120);
    });
    if (!Object.keys(lenses).length) lenses = null;
  }

  meta.used = agentMode;
  meta.applied = applied;
  const logEntry = llmLog.record({
    runId: run.id,
    round: roundN,
    purpose: 'character_enhance',
    model: llm.model,
    baseHost: llmLog.hostFromBase(llm.baseUrl),
    ok: true,
    ms: result.ms,
    systemPreview: system,
    promptPreview: user,
    content: result.content,
    usage: result.raw?.usage || null,
    parseOk: true,
    applied
  });
  meta.logIds.push(logEntry.id);
  return { decisions, lenses, meta };
}

/**
 * 可选：为新发现天体润色中文名 / 描述（失败静默忽略）
 */
async function detailFillBodies(run, worldDelta, opts, agentMode, llmMeta, roundN) {
  if (agentMode === 'rules_only') return;
  if (!llmConfigured(opts && opts.llm)) return;
  const candidates = (worldDelta.newBodies || []).filter(b =>
    b && !b.flags?.artificial && b.completeness === 'detailed'
  ).slice(0, 6);
  if (!candidates.length) return;

  const payload = candidates.map(b => ({
    id: b.id,
    type: b.type,
    subtype: b.subtype,
    name: b.name,
    desc: b.desc
  }));
  const system = [
    '你为科幻推演润色新发现天体的中文名与一句描述。',
    '输出 JSON：{"items":[{"id":"","name":"两字或三字中文名","desc":"一句中文"}]}',
    '名须典雅、不与常见地名雷同；不要解释。'
  ].join('\n');
  const user = JSON.stringify({ bodies: payload });
  const result = await llmChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    {
      baseUrl: opts.llm.baseUrl,
      apiKey: opts.llm.apiKey,
      model: opts.llm.model,
      temperature: 0.8,
      timeoutMs: Math.min(Number(opts.llm.timeoutMs) || 20000, 20000)
    }
  );
  llmMeta.llmCalls = (llmMeta.llmCalls || 0) + 1;
  llmMeta.llmMs = (llmMeta.llmMs || 0) + (result.ms || 0);
  llmMeta.logIds = llmMeta.logIds || [];

  if (!result.ok) {
    const logEntry = llmLog.record({
      runId: run.id,
      round: roundN,
      purpose: 'detail_fill',
      model: opts.llm.model,
      baseHost: llmLog.hostFromBase(opts.llm.baseUrl),
      ok: false,
      ms: result.ms,
      error: result.error,
      systemPreview: system,
      promptPreview: user,
      content: ''
    });
    llmMeta.logIds.push(logEntry.id);
    return;
  }

  const parsed = parseJsonLoose(result.content);
  const parseOk = !!(parsed && Array.isArray(parsed.items));
  if (parseOk) {
    const runBodies = run.discovered.bodies || [];
    parsed.items.forEach(item => {
      if (!item || !item.id) return;
      const name = String(item.name || '').trim().slice(0, 12);
      const desc = String(item.desc || '').trim().slice(0, 160);
      if (!name && !desc) return;
      const patch = (body) => {
        if (!body || body.id !== item.id) return;
        if (name) body.name = name;
        if (desc) body.desc = desc;
      };
      worldDelta.newBodies.forEach(patch);
      runBodies.forEach(patch);
    });
    llmMeta.detailFill = true;
  }

  const logEntry = llmLog.record({
    runId: run.id,
    round: roundN,
    purpose: 'detail_fill',
    model: opts.llm.model,
    baseHost: llmLog.hostFromBase(opts.llm.baseUrl),
    ok: true,
    ms: result.ms,
    systemPreview: system,
    promptPreview: user,
    content: result.content,
    usage: result.raw?.usage || null,
    parseOk,
    applied: parseOk ? (parsed.items || []).length : 0
  });
  llmMeta.logIds.push(logEntry.id);
}

/**
 * 主入口：推进一轮（async；rules_only 不发起网络）
 * @param {object} run
 * @param {{ force?: boolean, edict?: string, agentMode?: string, llm?: object }} opts
 */
async function deduce(run, opts) {
  opts = opts || {};
  const roundN = (run.deductionRounds?.length || 0) + 1;
  const seed = (run.seed ^ (run.revision * 2654435761) ^ (roundN * 40503)) >>> 0;
  const rnd = mulberry32(seed);
  const agentMode = resolveAgentMode(run, opts);
  // 本轮生效模式写入 run，便于后续 snapshot / health
  run.agentMode = agentMode;

  // 1) Character（规则底稿）
  let decisions = characterDecisions(run, rnd);

  // 神谕：不替代人物决策，但覆盖叙事；仍保留决策供编年挂名
  if (opts.edict) {
    // 轻量：不强制 explore/facility，除非 force
  }

  // 2) 软保底（explore / facility）—— LLM 前后都要保证无限宇宙增长
  applySoftGuarantees(run, decisions, roundN, opts);

  // 2b) C6 hybrid / full：LLM 润色；失败回落规则底稿
  let llmMeta = {
    requested: agentMode,
    used: 'rules_only',
    llmCalls: 0,
    llmMs: 0,
    fallback: agentMode === 'rules_only' ? null : 'skipped',
    error: null,
    logIds: []
  };
  let llmLenses = null;
  if (agentMode !== 'rules_only') {
    const enhanced = await enhanceWithLlm(run, decisions, opts, agentMode, roundN);
    decisions = enhanced.decisions;
    llmLenses = enhanced.lenses;
    llmMeta = enhanced.meta;
    llmMeta.logIds = llmMeta.logIds || [];
    // LLM 可能改掉 kind，再跑一遍软保底
    applySoftGuarantees(run, decisions, roundN, opts);
  }

  // 3) Lens
  let lenses = lensTemplates(decisions, opts.edict);
  if (llmLenses) {
    lenses = Object.assign({}, lenses, llmLenses);
  }

  // 4) WorldBuilder
  const worldDelta = opts.edict && !opts.force
    ? { newGalaxies: [], newSystems: [], newBodies: [], updatedBodies: [], removedBodyIds: [] }
    : worldBuilder(run, decisions, rnd);

  // 4b) DetailFiller（仅 hybrid/full，失败静默）
  if (agentMode !== 'rules_only' && llmMeta.used !== 'rules_only') {
    try {
      await detailFillBodies(run, worldDelta, opts, agentMode, llmMeta, roundN);
    } catch (err) {
      llmMeta.detailFillError = String(err && err.message || err);
    }
  }

  // 本轮 AI 调用明细（供前端日志查看）
  const llmLogs = llmLog.forRound(run.id, roundN);

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
      decision: d.decision,
      source: d.source || 'rules'
    })),
    worldDelta: {
      newGalaxies: worldDelta.newGalaxies.length,
      newSystems: worldDelta.newSystems.length,
      newBodies: worldDelta.newBodies.length
    },
    agentMeta: llmMeta
  };
  run.deduction.log = run.deduction.log || [];
  run.deduction.log.unshift(log);

  run.revision += 1;
  const roundRecord = {
    n: roundN,
    phase: 'done',
    year: run.year,
    revision: run.revision,
    agentMode: llmMeta.used || agentMode,
    agentModeRequested: agentMode,
    llm: {
      calls: llmMeta.llmCalls || 0,
      ms: llmMeta.llmMs || 0,
      fallback: llmMeta.fallback || null,
      error: llmMeta.error || null,
      logIds: llmMeta.logIds || []
    },
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
      stance: d.stance,
      source: d.source || 'rules'
    })),
    lenses,
    patchesSummary: patches,
    worldDelta,
    chronicle: [chronicleEntry],
    yearDelta,
    agentMeta: llmMeta,
    // 本轮 AI 调用次数与返回内容（日志查看）
    llmLogs: llmLogs || [],
    llmTotals: llmLog.list({ limit: 1 }).totals
  };
}

export { deduce, CAPS, LENS_KEYS, characterDecisions, validateBody, resolveAgentMode };
