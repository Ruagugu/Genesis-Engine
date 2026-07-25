/* ============================================================
   创世引擎 · 真推演引擎（阶段 C / C6）
   Character 决策 → WorldBuilder 扩张/设施
   → 六棱镜世界推演（叙述+补丁写回）→ Resolver → 第三人称自传自述 → 编年
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
const AGENT_MEMORY_LIMIT = 18;
const AGENT_ACTION_HISTORY_LIMIT = 12;
const AGENT_BLOCKED_LIMIT = 10;
const AGENT_GOAL_LIMIT = 6;

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function compactList(list, limit) {
  return Array.isArray(list) ? list.slice(-limit) : [];
}

function relationKey(a, b) {
  return [a, b].filter(Boolean).sort().join('|');
}

function successionRuleFor(civ) {
  const text = String((civ && (civ.社会形态 + civ.name + civ.政体及运作)) || '');
  if (/帝|皇|王朝|世袭/.test(text)) return 'dynasty';
  if (/氏族|炉火|家族/.test(text)) return 'clan';
  if (/祭|潮母|神|灵能/.test(text)) return 'theocracy';
  if (/军|统帅/.test(text)) return 'military';
  return 'council';
}

function createAgentMemory(year) {
  return { version: 1, episodic: [], semantic: {}, relationMemory: {}, legacy: [], updatedYear: year || 1 };
}

function createAgentGoals(year) {
  return { active: [], completed: [], abandoned: [], updatedYear: year || 1 };
}

function createAgentActions(year) {
  return { lastAction: null, cooldowns: {}, history: [], updatedYear: year || 1 };
}

function createAgentConstraints() {
  return { reserves: {}, deficits: [], blockedActions: [], riskTolerance: 0.5 };
}

function createAgentDiplomacy(run, civId) {
  const postureByCiv = {};
  (run.civs || []).forEach(other => {
    if (other.id && other.id !== civId) postureByCiv[other.id] = 'neutral';
  });
  return { postureByCiv, treaties: [], grievances: [] };
}

function createSuccession(civ, leader, year) {
  return {
    rule: successionRuleFor(civ),
    leaderId: leader && leader.id,
    generation: 1,
    heirs: [],
    regency: null,
    history: [],
    startedYear: year || 1
  };
}

function ensureLeaderAgentState(run) {
  const year = Number(run.year) || 1;
  (run.civs || []).forEach(civ => {
    (civ.leaders || []).forEach(leader => {
      leader.agent = Object.assign({ enabled: true, status: 'active' }, leader.agent || {});
      if (!leader.agentMemory || typeof leader.agentMemory !== 'object') leader.agentMemory = createAgentMemory(year);
      leader.agentMemory.version = leader.agentMemory.version || 1;
      leader.agentMemory.episodic = compactList(leader.agentMemory.episodic, AGENT_MEMORY_LIMIT);
      leader.agentMemory.semantic = leader.agentMemory.semantic || {};
      leader.agentMemory.relationMemory = leader.agentMemory.relationMemory || {};
      leader.agentMemory.legacy = compactList(leader.agentMemory.legacy, 8);
      if (!leader.agentGoals || typeof leader.agentGoals !== 'object') leader.agentGoals = createAgentGoals(year);
      leader.agentGoals.active = compactList(leader.agentGoals.active, AGENT_GOAL_LIMIT);
      leader.agentGoals.completed = compactList(leader.agentGoals.completed, 12);
      leader.agentGoals.abandoned = compactList(leader.agentGoals.abandoned, 12);
      if (!leader.agentActions || typeof leader.agentActions !== 'object') leader.agentActions = createAgentActions(year);
      leader.agentActions.cooldowns = leader.agentActions.cooldowns || {};
      leader.agentActions.history = compactList(leader.agentActions.history, AGENT_ACTION_HISTORY_LIMIT);
      if (!leader.agentConstraints || typeof leader.agentConstraints !== 'object') leader.agentConstraints = createAgentConstraints();
      leader.agentConstraints.reserves = leader.agentConstraints.reserves || {};
      leader.agentConstraints.deficits = Array.isArray(leader.agentConstraints.deficits) ? leader.agentConstraints.deficits : [];
      leader.agentConstraints.blockedActions = compactList(leader.agentConstraints.blockedActions, AGENT_BLOCKED_LIMIT);
      leader.agentConstraints.riskTolerance = clamp(leader.agentConstraints.riskTolerance == null ? 0.5 : leader.agentConstraints.riskTolerance, 0.05, 0.95);
      if (!leader.agentDiplomacy || typeof leader.agentDiplomacy !== 'object') leader.agentDiplomacy = createAgentDiplomacy(run, civ.id);
      leader.agentDiplomacy.postureByCiv = leader.agentDiplomacy.postureByCiv || {};
      (run.civs || []).forEach(other => {
        if (other.id && other.id !== civ.id && !leader.agentDiplomacy.postureByCiv[other.id]) leader.agentDiplomacy.postureByCiv[other.id] = 'neutral';
      });
      leader.agentDiplomacy.treaties = Array.isArray(leader.agentDiplomacy.treaties) ? leader.agentDiplomacy.treaties : [];
      leader.agentDiplomacy.grievances = compactList(leader.agentDiplomacy.grievances, 10);
      if (!leader.succession || typeof leader.succession !== 'object') leader.succession = createSuccession(civ, leader, year);
      leader.succession.rule = leader.succession.rule || successionRuleFor(civ);
      leader.succession.leaderId = leader.succession.leaderId || leader.id;
      leader.succession.generation = Number(leader.succession.generation) || 1;
      leader.succession.heirs = Array.isArray(leader.succession.heirs) ? leader.succession.heirs : [];
      leader.succession.history = compactList(leader.succession.history, 12);
    });
  });
}

function goalKindForDecision(kind) {
  if (EXPLORE_ACTIONS.includes(kind) || kind === 'station.build' || kind === 'facility.deploy') return 'expand';
  if (kind === 'research') return 'research';
  if (kind === 'diplomacy' || kind === 'trade') return 'diplomacy';
  if (kind === 'military') return 'prepare_defense';
  if (kind === 'faith') return 'stability';
  return 'stability';
}

function actionTypeForDecision(kind) {
  if (kind === 'research') return 'boost_research';
  if (kind === 'diplomacy' || kind === 'trade') return 'improve_relation';
  if (kind === 'military') return 'annex_border';
  if (kind === 'policy') return 'expand_frontier';
  if (EXPLORE_ACTIONS.includes(kind) || kind === 'station.build' || kind === 'facility.deploy') return 'expand_softly';
  if (kind === 'faith') return 'stabilize_internal';
  return 'stabilize_internal';
}

function actionCostFor(type) {
  const costs = {
    reserve_resource: { 经济: 8, 稳定: 4 },
    boost_research: { 科研: 8, 经济: 4 },
    improve_relation: { 稳定: 5, 经济: 3 },
    threaten: { 军力: 10, 稳定: 4 },
    prepare_defense: { 军力: 8, 经济: 4 },
    annex_border: { 军力: 9, 扩张: 5 },
    expand_frontier: { 扩张: 7, 经济: 5 },
    expand_softly: { 扩张: 8, 经济: 6 },
    stabilize_internal: { 稳定: 8 },
    prepare_successor: { 稳定: 7 },
    prepare_secession: { 稳定: 6 }
  };
  return Object.assign({}, costs[type] || {});
}

function goalBias(leader, kind) {
  const targetType = goalKindForDecision(kind);
  const goals = (leader.agentGoals && leader.agentGoals.active) || [];
  const best = goals.filter(g => g.status !== 'completed' && g.type === targetType)
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))[0];
  return best ? 1 + clamp(best.priority, 0, 1) * 0.45 : 1;
}

function memoryBias(leader, kind) {
  const mem = (leader.agentMemory && leader.agentMemory.episodic) || [];
  const text = mem.slice(-6).map(m => `${m.type}:${m.subject}:${m.summary}`).join(' ');
  if ((kind === 'diplomacy' || kind === 'trade') && /外交|关系|信任|紧张|贸易/.test(text)) return 1.22;
  if ((kind === 'military') && /威胁|冲突|戒备|防御/.test(text)) return 1.2;
  if ((kind === 'research') && /科技|研究|知识|节点/.test(text)) return 1.18;
  if ((EXPLORE_ACTIONS.includes(kind) || kind === 'station.build' || kind === 'facility.deploy') && /发现|星图|设施|扩张|坐标/.test(text)) return 1.18;
  return 1;
}

function topGoalForKind(leader, kind) {
  const targetType = goalKindForDecision(kind);
  return ((leader.agentGoals && leader.agentGoals.active) || [])
    .filter(g => g.status !== 'completed' && g.type === targetType)
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))[0] || null;
}

function chooseLeaderAction(run, civ, leader, kind, rnd) {
  const type = actionTypeForDecision(kind);
  const cost = actionCostFor(type);
  const stats = civ.stats || {};
  const missing = Object.keys(cost).filter(k => (Number(stats[k]) || 0) < cost[k]);
  let result = 'applied';
  let reason = '目标与文明能力允许行动落地';
  let finalType = type;
  if (missing.length) {
    if (type === 'expand_softly' && (Number(stats.经济) || 0) >= 4) {
      finalType = 'reserve_resource';
      result = 'downgraded';
      reason = `扩张条件不足，转为积蓄资源：${missing.join('、')}`;
    } else {
      result = 'blocked';
      reason = `行动受文明能力约束：${missing.join('、')}不足`;
    }
  }
  const goal = topGoalForKind(leader, kind);
  return {
    id: `act:${civ.id}:${leader.id}:${run.year}:${kind.replace(/[^a-z.]/g, '')}`,
    civId: civ.id,
    characterId: leader.id,
    year: run.year,
    type,
    finalType,
    target: goal ? goal.target : goalKindForDecision(kind),
    cost,
    result,
    reason,
    sourceGoalId: goal && goal.id || null,
    priority: goal ? Number(goal.priority) || 0.5 : 0.45
  };
}

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
        const score = t.weight * bias * goalBias(ch, t.kind) * memoryBias(ch, t.kind) *
          (0.55 + 0.45 * rnd()) * (0.7 + 0.3 * strat + 0.2 * will);
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      });

      const action = chooseLeaderAction(run, civ, ch, best.kind, rnd);
      const urgency = bestScore > 1.1 ? '高' : bestScore > 0.8 ? '中' : '低';
      const decisionText = `${ch.name}：${best.text}（${ch.agentStance || '无明确立场'}；行动${action.result === 'applied' ? '可执行' : action.result === 'downgraded' ? '降级' : '受阻'}）`;
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
        year,
        goalId: action.sourceGoalId,
        actionType: action.type,
        actionCost: action.cost,
        actionResult: action.result,
        actionReason: action.reason,
        agentAction: action
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

function characterBodyState(age, lifespanMax) {
  const max = Number(lifespanMax);
  if (!Number.isFinite(max) || max <= 0) return '康健 · 年岁推进';
  const ratio = age / max;
  if (ratio >= 1) return '逝世 · 寿数已尽';
  if (ratio >= 0.94) return '濒危 · 生命烛火将尽';
  if (ratio >= 0.82) return '衰老 · 需族人照看';
  if (ratio >= 0.62) return '渐老 · 经验沉淀';
  if (ratio >= 0.35) return '康健 · 壮年';
  return '康健 · 青年';
}

function advanceCharacterAges(run, yearDelta) {
  const patches = [];
  const delta = Number(yearDelta) || 0;
  if (delta <= 0) return patches;
  (run.civs || []).forEach(civ => {
    (civ.leaders || []).forEach(ch => {
      const age = Number(ch.age);
      if (!Number.isFinite(age)) return;
      const nextAge = Math.round((age + delta) * 10) / 10;
      const lifespanMax = Number(ch.lifespanMax);
      ch.age = nextAge;
      ch.lastAgedYear = run.year;
      if (!Number.isFinite(ch.birthYear)) ch.birthYear = run.year - nextAge;
      if (Number.isFinite(lifespanMax) && lifespanMax > 0 && nextAge >= lifespanMax) {
        ch.bodyState = `逝世 · 寿终于${run.year}年`;
        ch.isAgent = false;
        ch.agent = Object.assign({}, ch.agent || {}, { enabled: false, status: 'deceased' });
      } else {
        ch.bodyState = characterBodyState(nextAge, lifespanMax);
        if (ch.agent && ch.agent.status === 'deceased') {
          ch.agent = Object.assign({}, ch.agent, { enabled: true, status: 'active' });
        }
      }
      patches.push({
        civId: civ.id,
        characterId: ch.id,
        age: ch.age,
        lifespanMax: Number.isFinite(lifespanMax) ? lifespanMax : null,
        bodyState: ch.bodyState,
        isAgent: ch.isAgent !== false,
        agentStatus: ch.agent && ch.agent.status || (ch.isAgent === false ? 'deceased' : 'active')
      });
    });
  });
  return patches;
}

function addBounded(list, item, limit) {
  const arr = Array.isArray(list) ? list : [];
  arr.push(item);
  while (arr.length > limit) arr.shift();
  return arr;
}

function agentStatePatch(civ, leader) {
  return {
    civId: civ.id,
    characterId: leader.id,
    agentMemory: clone(leader.agentMemory || createAgentMemory()),
    agentGoals: clone(leader.agentGoals || createAgentGoals()),
    agentActions: clone(leader.agentActions || createAgentActions()),
    agentConstraints: clone(leader.agentConstraints || createAgentConstraints()),
    agentDiplomacy: clone(leader.agentDiplomacy || createAgentDiplomacy({ civs: [] }, civ.id)),
    succession: clone(leader.succession || createSuccession(civ, leader, 1))
  };
}

function upsertAgentGoal(leader, goal) {
  leader.agentGoals = leader.agentGoals || createAgentGoals();
  const active = Array.isArray(leader.agentGoals.active) ? leader.agentGoals.active : [];
  const key = `${goal.type}:${goal.target || ''}`;
  const hit = active.find(g => `${g.type}:${g.target || ''}` === key && g.status !== 'completed');
  if (hit) {
    hit.priority = clamp(Math.max(Number(hit.priority) || 0, Number(goal.priority) || 0), 0, 1);
    hit.reason = goal.reason || hit.reason;
    hit.updatedYear = goal.updatedYear || goal.createdYear || hit.updatedYear;
  } else {
    active.push(Object.assign({ status: 'active', progress: 0 }, goal));
  }
  leader.agentGoals.active = active
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))
    .slice(0, AGENT_GOAL_LIMIT);
}

function observeLeaderTurn(run, decisions, worldDelta, patches) {
  const observations = [];
  (decisions || []).forEach(d => {
    observations.push({
      civId: d.civId,
      characterId: d.characterId,
      type: 'action',
      subject: d.actionType || d.kind,
      salience: d.actionResult === 'blocked' ? 0.88 : 0.55,
      summary: `${d.characterName}本轮选择${d.kind}，行动${d.actionResult || 'applied'}：${d.actionReason || d.decision}`,
      decisionKind: d.kind,
      actionResult: d.actionResult
    });
  });
  const bodies = (worldDelta && worldDelta.newBodies) || [];
  bodies.forEach(b => {
    if (!b) return;
    const civId = b.flags && b.flags.civId;
    observations.push({
      civId,
      characterId: b.builtByCharacterId,
      type: b.flags && b.flags.artificial ? 'world' : 'explore',
      subject: b.name || b.id,
      salience: b.flags && b.flags.artificial ? 0.8 : 0.7,
      summary: `${b.name || b.id}写入星图${b.flags && b.flags.artificial ? '，成为新的文明设施' : ''}`
    });
  });
  ((worldDelta && worldDelta.newGalaxies) || []).forEach(g => {
    const host = (decisions || []).find(d => EXPLORE_ACTIONS.includes(d.kind));
    observations.push({
      civId: host && host.civId,
      characterId: host && host.characterId,
      type: 'world',
      subject: g.name || g.id,
      salience: 0.75,
      summary: `星图扩展至${g.name || g.id}，扩张派获得新的远方证据`
    });
  });
  ((patches && patches.tech) || []).forEach(t => {
    observations.push({ civId: t.civId, type: 'tech', subject: t.node || '科技树', salience: 0.62, summary: `科技节点${t.node || '研究'}推进至${t.progress || '新'}阶段` });
  });
  ((patches && patches.relations) || []).forEach(r => {
    observations.push({ civId: r.a, targetCivId: r.b, type: 'diplomacy', subject: relationKey(r.a, r.b), salience: 0.65, summary: r.note || `与${r.b}的关系出现波动` });
    observations.push({ civId: r.b, targetCivId: r.a, type: 'diplomacy', subject: relationKey(r.a, r.b), salience: 0.65, summary: r.note || `与${r.a}的关系出现波动` });
  });
  ((patches && patches.characters) || []).forEach(p => {
    if (p.bodyState && /衰老|濒危|逝世/.test(p.bodyState)) {
      observations.push({ civId: p.civId, characterId: p.characterId, type: 'succession', subject: 'leader_age', salience: 0.9, summary: `领袖身体状态变为${p.bodyState}` });
    }
  });
  return observations.filter(o => o.civId || o.characterId);
}

function updateLeaderMemoryAndGoals(run, observations) {
  const year = Number(run.year) || 1;
  (observations || []).forEach((obs, index) => {
    const { civ, char } = findLeader(run, obs.characterId, obs.civId);
    if (!civ || !char) return;
    ensureLeaderAgentState({ civs: [civ], year });
    const memory = {
      id: `mem:${civ.id}:${char.id}:${year}:${index}`,
      year,
      round: (run.deductionRounds?.length || 0) + 1,
      type: obs.type || 'event',
      subject: obs.subject || obs.targetCivId || obs.decisionKind || 'world',
      summary: String(obs.summary || '').slice(0, 140),
      salience: clamp(obs.salience == null ? 0.5 : obs.salience, 0, 1)
    };
    char.agentMemory.episodic = addBounded(char.agentMemory.episodic, memory, AGENT_MEMORY_LIMIT);
    char.agentMemory.semantic[memory.type + ':' + memory.subject] = {
      value: memory.summary,
      confidence: memory.salience,
      updatedYear: year
    };
    if (obs.targetCivId) {
      const rm = char.agentMemory.relationMemory[obs.targetCivId] || { trust: 50, tension: 20, lastEvents: [] };
      rm.lastEvents = addBounded(rm.lastEvents, { year, summary: memory.summary }, 5);
      if (/紧张|戒备|威胁|恶化|对立/.test(memory.summary)) rm.tension = clamp((Number(rm.tension) || 20) + 4, 0, 100);
      if (/贸易|缓和|盟|信任/.test(memory.summary)) rm.trust = clamp((Number(rm.trust) || 50) + 3, 0, 100);
      char.agentMemory.relationMemory[obs.targetCivId] = rm;
    }
    if (obs.type === 'diplomacy') {
      upsertAgentGoal(char, { id: `goal:${civ.id}:diplomacy:${obs.targetCivId || year}`, type: 'diplomacy', target: obs.targetCivId || obs.subject, priority: 0.7, createdYear: year, dueYear: year + 14, reason: memory.summary });
    } else if (obs.type === 'tech') {
      upsertAgentGoal(char, { id: `goal:${civ.id}:research:${year}`, type: 'research', target: obs.subject, priority: 0.62, createdYear: year, dueYear: year + 21, reason: memory.summary });
    } else if (obs.type === 'succession') {
      upsertAgentGoal(char, { id: `goal:${civ.id}:succession:${year}`, type: 'succession', target: char.id, priority: 0.9, createdYear: year, dueYear: year + 7, reason: memory.summary });
    } else if (obs.actionResult === 'blocked') {
      upsertAgentGoal(char, { id: `goal:${civ.id}:resource:${year}`, type: 'resource_security', target: obs.subject, priority: 0.82, createdYear: year, dueYear: year + 7, reason: memory.summary });
    } else if (obs.type === 'action') {
      const type = goalKindForDecision(obs.decisionKind || 'policy');
      upsertAgentGoal(char, { id: `goal:${civ.id}:${type}:${year}`, type, target: obs.subject || type, priority: 0.52, createdYear: year, dueYear: year + 14, reason: memory.summary });
    } else if (obs.type === 'world' || obs.type === 'explore') {
      upsertAgentGoal(char, { id: `goal:${civ.id}:expand:${year}`, type: 'expand', target: obs.subject, priority: 0.58, createdYear: year, dueYear: year + 28, reason: memory.summary });
    }
    char.agentMemory.updatedYear = year;
    char.agentGoals.updatedYear = year;
  });
}

function applyLeaderActionsAndDiplomacy(run, decisions, patches) {
  const year = Number(run.year) || 1;
  (decisions || []).forEach(d => {
    const { civ, char } = findLeader(run, d.characterId, d.civId);
    if (!civ || !char) return;
    ensureLeaderAgentState({ civs: [civ], year });
    const action = d.agentAction || chooseLeaderAction(run, civ, char, d.kind, () => 0.5);
    action.year = year;
    char.agentActions.lastAction = clone(action);
    char.agentActions.history = addBounded(char.agentActions.history, clone(action), AGENT_ACTION_HISTORY_LIMIT);
    char.agentActions.updatedYear = year;
    if (action.result === 'blocked') {
      char.agentConstraints.blockedActions = addBounded(char.agentConstraints.blockedActions, {
        year,
        actionType: action.type,
        reason: action.reason
      }, AGENT_BLOCKED_LIMIT);
    }
    if (d.kind === 'diplomacy' || d.kind === 'trade' || d.kind === 'military') {
      const rel = (run.relations || []).find(r => r.a === civ.id || r.b === civ.id);
      if (rel) {
        const other = rel.a === civ.id ? rel.b : rel.a;
        const hostile = d.kind === 'military';
        rel.trust = clamp((Number(rel.trust) || 50) + (hostile ? -4 : 3), 0, 100);
        rel.tension = clamp((Number(rel.tension) || 20) + (hostile ? 6 : -2), 0, 100);
        const diplomaticAction = {
          year,
          from: civ.id,
          to: other,
          type: hostile ? 'threaten' : (d.kind === 'trade' ? 'trade_offer' : 'improve_relation'),
          summary: hostile ? `${d.characterName}提高戒备并释放威慑信号` : `${d.characterName}试图重估并缓和关系`
        };
        rel.lastDiplomaticAction = diplomaticAction;
        rel.reason = ((rel.reason || '') + ' · ' + diplomaticAction.summary).slice(0, 240);
        char.agentDiplomacy.postureByCiv[other] = rel.tension >= 65 ? 'hostile' : rel.trust >= 65 ? 'friendly' : rel.tension >= 40 ? 'wary' : 'neutral';
        patches.relations.push({ a: rel.a, b: rel.b, state: rel.state, trust: rel.trust, tension: rel.tension, lastDiplomaticAction: diplomaticAction, note: diplomaticAction.summary });
      }
    }
  });
}

const NAME_POOLS = {
  // 风格池：不绑定文明 id。玩家后续可在文明上指定 namePool / 自定义 pool。
  human: {
    id: 'human',
    label: '人族通用',
    surnames: ['林', '苏', '江', '沈', '陆', '白', '顾', '叶', '夏', '裴', '晏', '程', '萧', '慕', '卫', '桓', '楚', '谢', '贺', '尹', '祁', '封', '周', '唐', '宋', '韩', '赵', '钱', '孙', '李', '陈', '杨', '许', '吕', '姜', '纪', '闻', '凌', '温', '蓝'],
    given: ['深', '砚', '寒', '衡', '澄', '岚', '川', '昭', '远', '辰', '启', '宁', '澈', '临', '朔', '璟', '玦', '隐', '珩', '衍', '照', '弈', '凛', '序', '彻', '澜', '徵', '安', '行', '止', '知', '言', '若', '初', '清', '明', '然', '予', '怀', '远']
  },
  elf: {
    id: 'elf',
    label: '精灵/林语',
    surnames: ['伊', '瑟', '翡', '洛', '薇', '茉', '月', '叶', '岚', '森', '露', '灵', '茜', '柚', '苔', '杉', '椿', '芷', '葵', '荻'],
    given: ['瑟兰', '茉语', '翡歌', '月汀', '森谣', '薇宁', '洛涟', '露衡', '叶澄', '灵汐', '岚枝', '茉川', '茜汀', '柚歌', '苔语', '杉澄', '椿澜', '芷宁', '葵月', '荻川']
  },
  dwarf: {
    id: 'dwarf',
    label: '矮人/锻魂',
    surnames: ['巴', '杜', '戈', '石', '铁', '炉', '岩', '锤', '铜', '刚', '铸', '燧', '岗', '矿', '砧', '砾'],
    given: ['尔刚', '岩锤', '炉心', '铁脊', '铸铭', '石磊', '刚毅', '燧明', '岩峰', '锤铭', '铁山', '刚石', '岗铁', '矿心', '砧响', '砾坚']
  },
  abyssal: {
    id: 'abyssal',
    label: '深海/潮裔',
    surnames: ['涅', '汐', '潮', '渊', '澪', '溟', '澜', '涟', '波', '月', '蔚', '沧', '渚', '汀'],
    given: ['芮', '汐', '澪', '澜', '渊', '溟', '涟', '潮歌', '汐语', '渊见', '澪光', '澜心', '蔚蓝', '沧浪', '渚月', '汀澄']
  },
  default: {
    id: 'default',
    label: '通用',
    surnames: ['林', '沈', '白', '顾', '陆', '谢', '叶', '晏', '程', '夏', '周', '唐', '韩', '赵', '李', '陈'],
    given: ['衡', '澄', '远', '昭', '辰', '启', '宁', '临', '朔', '璟', '川', '岚', '安', '行', '知', '言']
  }
};

function resolveNamePool(civ) {
  // 优先级：
  // 1) civ.namePool 指定风格 id 或完整 {surnames,given}
  // 2) civ.leaders[0].namePool
  // 3) 按种族/社会形态推断
  // 4) default
  const custom = (civ && civ.namePool) || (civ && civ.leaders && civ.leaders[0] && civ.leaders[0].namePool);
  if (custom && typeof custom === 'object' && Array.isArray(custom.surnames) && Array.isArray(custom.given)) {
    return custom;
  }
  if (typeof custom === 'string' && NAME_POOLS[custom]) return NAME_POOLS[custom];

  const race = String((civ && civ.leaders && civ.leaders[0] && civ.leaders[0].race) || '');
  const text = race + ' ' + String((civ && (civ.name + civ.社会形态 + civ.思潮)) || '');
  if (/精灵|林|德鲁伊|圣林/.test(text)) return NAME_POOLS.elf;
  if (/矮人|锻|炉|铜须|石族/.test(text)) return NAME_POOLS.dwarf;
  if (/鲛|深渊|潮|海|深海/.test(text)) return NAME_POOLS.abyssal;
  if (/人|联邦|帝国|帝|邦|族/.test(text)) return NAME_POOLS.human;
  // 兼容旧 civ.id 映射，但不作为主路径
  if (civ && civ.id && NAME_POOLS[civ.id]) return NAME_POOLS[civ.id];
  return NAME_POOLS.default;
}

function pickPersonName(civ, usedNames, salt) {
  const pool = resolveNamePool(civ);
  const used = usedNames || new Set();
  const race = String((civ && civ.leaders && civ.leaders[0] && civ.leaders[0].race) || '');
  const elfLike = /精灵|鲛|潮|林/.test(race + (civ && civ.name || '')) || pool.id === 'elf' || pool.id === 'abyssal';
  const surnames = pool.surnames || NAME_POOLS.default.surnames;
  const given = pool.given || NAME_POOLS.default.given;
  for (let i = 0; i < 36; i++) {
    const sIdx = Math.abs(Math.floor((salt + i * 17) % surnames.length));
    const gIdx = Math.abs(Math.floor((salt + i * 31 + 3) % given.length));
    const surname = surnames[sIdx];
    const g = given[gIdx];
    let cleaned;
    if (elfLike || String(g).length > 1) {
      // 双字名风格：可带姓也可直接用名段
      cleaned = (i % 3 === 0) ? String(g) : (surname + String(g).replace(new RegExp('^' + surname), ''));
    } else {
      cleaned = surname + g;
    }
    if (cleaned.length < 2) cleaned = surname + g;
    if (!used.has(cleaned) && !/领袖|继任|第\d+代/.test(cleaned)) return cleaned;
  }
  return surnames[(salt || 0) % surnames.length] + given[(salt || 1) % given.length];
}

function collectUsedLeaderNames(run, extra) {
  const used = new Set();
  (run && run.civs || []).forEach(civ => {
    (civ.leaders || []).forEach(l => { if (l && l.name) used.add(l.name); });
    if (civ.succession && Array.isArray(civ.succession.history)) {
      civ.succession.history.forEach(h => { if (h && h.name) used.add(h.name); });
    }
  });
  (extra || []).forEach(n => { if (n) used.add(n); });
  return used;
}

function titleForSuccessor(civ, generation, oldTitle) {
  const rule = successionRuleFor(civ);
  if (rule === 'dynasty') return generation <= 2 ? (oldTitle || '继位者') : '新君';
  if (rule === 'clan') return '炉火继任者';
  if (rule === 'theocracy') return '潮声继任者';
  if (rule === 'military') return '统帅继任者';
  return oldTitle && !/领袖|执政/.test(oldTitle) ? oldTitle : '继任领袖';
}

function makeSuccessor(civ, leader, year, run) {
  const generation = (Number(leader.succession && leader.succession.generation) || 1) + 1;
  const heir = (leader.succession && leader.succession.heirs || []).slice().sort((a, b) => (Number(b.legitimacy) || 0) - (Number(a.legitimacy) || 0))[0];
  const used = collectUsedLeaderNames(run || { civs: [civ] }, [leader && leader.name]);
  const salt = ((year || 1) * 131 + generation * 17 + String(civ.id || '').length * 9 + String(leader.id || '').length * 5) >>> 0;
  const name = (heir && heir.name && !/领袖|继任|第\d+代/.test(heir.name))
    ? heir.name
    : pickPersonName(civ, used, salt);
  const next = clone(leader);
  next.id = heir && heir.id || `${leader.id}-g${generation}`;
  next.name = name;
  next.title = heir && heir.title || titleForSuccessor(civ, generation, leader.title);
  next.age = heir && Number(heir.age) || 28 + generation;
  next.birthYear = year - next.age;
  next.bodyState = '康健 · 新任领袖';
  next.isAgent = true;
  next.agent = Object.assign({}, next.agent || {}, { enabled: true, status: 'active' });
  next.agentModel = 'GE-Agent · 继任者人格 v1';
  next.agentStance = /扩张/.test(leader.agentStance || '') ? '谨慎继承 / 稳定扩张' : (leader.agentStance || '守成整合 / 观察局势');
  next.motive = `继承${leader.name}留下的历史，在稳定文明后延续其未竟目标。`;
  next.agentMemory = createAgentMemory(year);
  next.agentMemory.legacy = [{ leaderId: leader.id, name: leader.name, summary: `${leader.name}于${year}年退场，遗留立场「${leader.agentStance || '未明'}」。`, inheritedBias: { caution: 0.15 } }];
  next.agentGoals = createAgentGoals(year);
  next.agentActions = createAgentActions(year);
  next.agentConstraints = createAgentConstraints();
  next.agentDiplomacy = createAgentDiplomacy({ civs: [civ] }, civ.id);
  next.succession = {
    rule: successionRuleFor(civ),
    leaderId: next.id,
    generation,
    heirs: [],
    regency: null,
    history: addBounded((leader.succession && leader.succession.history) || [], {
      leaderId: leader.id,
      name: leader.name,
      startYear: leader.succession && leader.succession.startedYear || leader.birthYear || 1,
      endYear: year,
      legacySummary: `${leader.name}结束第${generation - 1}代统治，${name}继任。`
    }, 12),
    startedYear: year
  };
  return next;
}

function tickLeaderSuccession(run, patches) {
  const year = Number(run.year) || 1;
  (run.civs || []).forEach(civ => {
    const leader = (civ.leaders || [])[0];
    if (!leader) return;
    const dead = leader.isAgent === false || (leader.agent && leader.agent.status === 'deceased') || /逝世/.test(leader.bodyState || '');
    const lifespan = Number(leader.lifespanMax);
    if (!dead && Number.isFinite(lifespan) && lifespan > 0 && (Number(leader.age) || 0) / lifespan >= 0.94) {
      upsertAgentGoal(leader, { id: `goal:${civ.id}:succession:${year}`, type: 'succession', target: leader.id, priority: 0.88, createdYear: year, dueYear: year + 7, reason: '领袖寿命已进入高危区间，需要准备继承。' });
    }
    if (!dead) return;
    const next = makeSuccessor(civ, leader, year, run);
    civ.leaders = [next];
    patches.characters.push({ civId: civ.id, characterId: leader.id, replaceLeader: true, leader: clone(next), successionEvent: `${leader.name}退场，${next.name}继任。` });
  });
}

function applyAgentSystems(run, decisions, worldDelta, patches) {
  applyLeaderActionsAndDiplomacy(run, decisions, patches);
  const observations = observeLeaderTurn(run, decisions, worldDelta, patches);
  updateLeaderMemoryAndGoals(run, observations);
  tickLeaderSuccession(run, patches);
  ensureLeaderAgentState(run);
  (run.civs || []).forEach(civ => {
    (civ.leaders || []).forEach(leader => patches.characters.push(agentStatePatch(civ, leader)));
  });
}

function buildTerritoryEvents(run, decisions, patches) {
  const events = [];
  const relations = run.relations || [];
  let splitCount = 0;
  const maxExpand = 6;
  const maxAnnex = 8;

  (decisions || []).forEach(d => {
    const civ = (run.civs || []).find(c => c.id === d.civId);
    if (!civ) return;
    const stats = civ.stats || {};
    const kind = d.kind || '';
    const actionType = d.actionType || '';

    if (kind === 'policy' || kind === 'explore.body' || actionType === 'expand_frontier' || actionType === 'expand_softly') {
      const budget = Math.max(1, Math.min(maxExpand, 2 + Math.floor((Number(stats.扩张) || 5) / 18)));
      events.push({
        type: 'expand',
        civId: civ.id,
        surfaceId: 'gaiya:surface',
        budget,
        mode: 'frontier',
        reason: d.decision || '领袖推动边疆开拓',
        source: d.source || 'rules',
        characterId: d.characterId
      });
    }

    if (kind === 'military' || actionType === 'annex_border' || actionType === 'threaten' || actionType === 'prepare_defense') {
      const rel = relations.find(r =>
        (r.a === civ.id || r.b === civ.id) && r.a !== 'all' && r.b !== 'all'
      );
      if (rel) {
        const other = rel.a === civ.id ? rel.b : rel.a;
        const tension = Number(rel.tension) || (/敌|对峙|冷战|交火/.test(rel.state || '') ? 55 : 25);
        if (tension >= 40 || kind === 'military') {
          events.push({
            type: 'annex',
            attackerId: civ.id,
            defenderId: other,
            surfaceId: 'gaiya:surface',
            budget: Math.max(1, Math.min(maxAnnex, 2 + Math.floor(tension / 22))),
            intensity: tension >= 70 ? 2 : 1,
            reason: d.decision || '军事压力下的边境推进',
            source: d.source || 'rules',
            characterId: d.characterId
          });
        }
      }
    }
  });

  // 继承危机 / 低稳定：生成子文明并下发 split 意图
  (run.civs || []).slice().forEach(civ => {
    if (splitCount >= 1) return;
    const leader = (civ.leaders || [])[0];
    if (!leader) return;
    const stable = Number(civ.stats && civ.stats.稳定) || 50;
    const gen = Number(leader.succession && leader.succession.generation) || 1;
    const goals = (leader.agentGoals && leader.agentGoals.active) || [];
    const wantSplit = goals.some(g => g.type === 'secession') || (gen >= 2 && stable < 32);
    if (!wantSplit) return;
    const childId = `${civ.id}_split_g${gen}`;
    if ((run.civs || []).some(c => c.id === childId)) return;

    const child = clone(civ);
    child.id = childId;
    child.name = `${civ.short || civ.name}裂邦`;
    child.short = (civ.short || civ.name).slice(0, 2) + '裂';
    child.color = civ.color || '#8fd0e8';
    child.stage = '分裂';
    child.文明阶段 = '分裂';
    child.capital = '边境营地';
    child.stats = Object.assign({}, civ.stats || {}, {
      人口: Math.max(1, Math.round((Number(civ.stats?.人口) || 2) * 0.35)),
      军力: Math.max(1, Math.round((Number(civ.stats?.军力) || 4) * 0.4)),
      经济: Math.max(1, Math.round((Number(civ.stats?.经济) || 3) * 0.4)),
      稳定: Math.max(8, Math.round(stable * 0.7)),
      科研: Math.max(1, Math.round((Number(civ.stats?.科研) || 2) * 0.4)),
      扩张: Math.max(3, Math.round((Number(civ.stats?.扩张) || 5) * 0.8))
    });
    const childLeader = clone(leader);
    const usedNames = collectUsedLeaderNames(run, [leader.name]);
    const splitSalt = ((run.year || 1) * 97 + gen * 13 + String(civ.id).length * 7) >>> 0;
    childLeader.id = `${leader.id}_split`;
    childLeader.name = pickPersonName(child, usedNames, splitSalt);
    childLeader.title = '裂邦首领';
    childLeader.role = '领袖';
    childLeader.age = Math.max(18, Math.round((Number(leader.age) || 30) * 0.55));
    childLeader.isAgent = true;
    childLeader.agent = { enabled: true, status: 'active' };
    childLeader.agentStance = '自立门户 / 争夺生存空间';
    childLeader.motive = `从${civ.name}的裂隙中带族人自立。`;
    childLeader.agentMemory = { version: 1, episodic: [], semantic: {}, relationMemory: {}, legacy: [{ leaderId: leader.id, name: leader.name, summary: `${civ.name}分裂潮中出走` }] };
    childLeader.agentGoals = { active: [{ id: `goal:${childId}:expand`, type: 'expand', target: 'frontier', priority: 0.7, status: 'active', reason: '裂邦求存' }], completed: [], abandoned: [] };
    childLeader.agentActions = { lastAction: null, cooldowns: {}, history: [] };
    childLeader.agentConstraints = { reserves: {}, deficits: [], blockedActions: [], riskTolerance: 0.6 };
    childLeader.agentDiplomacy = { postureByCiv: {}, treaties: [], grievances: [] };
    childLeader.succession = { rule: 'council', leaderId: childLeader.id, generation: 1, heirs: [], regency: null, history: [], startedYear: run.year };
    child.leaders = [childLeader];
    child.科技树 = { 文明等级: 0, 下一阶段: 0, 节点: {} };
    run.civs.push(child);

    patches.civs = patches.civs || [];
    patches.civs.push({ op: 'spawn', civ: clone(child) });
    // 母子关系：初始高张力
    run.relations = run.relations || [];
    run.relations.push({
      a: civ.id,
      b: childId,
      state: '分裂对峙',
      reason: `${child.name}自${civ.name}裂出，边境未稳。`,
      trust: 28,
      tension: 62
    });
    patches.relations.push({
      a: civ.id,
      b: childId,
      state: '分裂对峙',
      trust: 28,
      tension: 62,
      note: '文明分裂后的边境对峙'
    });

    events.push({
      type: 'split',
      parentCivId: civ.id,
      childCivId: childId,
      surfaceId: 'gaiya:surface',
      share: 0.22,
      reason: '继承/稳定危机引发裂邦',
      source: 'rules'
    });
    splitCount += 1;
  });

  // 去重 + 上限
  const out = [];
  const seen = new Set();
  events.forEach(ev => {
    const key = ev.type === 'annex'
      ? `annex:${ev.attackerId}:${ev.defenderId}`
      : ev.type === 'split'
        ? `split:${ev.parentCivId}:${ev.childCivId}`
        : `${ev.type}:${ev.civId || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ev);
  });
  return out.slice(0, 12);
}

function applyResolver(run, decisions, lenses, edict, worldDelta) {
  const patches = {
    warehouses: 'client-surfaces-still-authoritative-for-tiles',
    relations: [],
    tiles: 'not-server-simulated-in-C',
    territory: [],
    civs: [],
    tech: [],
    characters: []
  };

  // 年岁：世界推进多少年，角色年龄 / 寿命状态同步推进多少年
  const yearDelta = edict ? 1 : 7;
  run.year += yearDelta;
  if (run.world) run.world.年数 = run.year;
  patches.characters.push(...advanceCharacterAges(run, yearDelta));

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

  applyAgentSystems(run, decisions, worldDelta, patches);
  patches.territory = buildTerritoryEvents(run, decisions, patches);

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
    kind: d.kind,
    monologue: d.monologue || '',
    source: d.source || 'rules',
    actionType: d.actionType || null,
    actionResult: d.actionResult || null,
    actionReason: d.actionReason || ''
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
    类型: edict ? '神谕' : '推演',
    事件: text,
    事件概述: text,
    人物: uniqueNames,
    文明: [...new Set(decisions.map(d => d.civName))],
    round: (run.deductionRounds?.length || 0) + 1
  };
  run.chronicle = run.chronicle || [];
  run.chronicle.unshift(entry);
  return entry;
}

function applySoftGuarantees(run, decisions, roundN, opts) {
  // 不再每轮/隔轮强制探测或建设施。
  // 新天体 / 新设施只在角色主动选择 explore.* / station.build / facility.deploy
  // 或六棱镜明确追加 worldExtras 时生成，避免星图每次推演都刷。
  // force 调试开关仍可强制塞一条弱探测。
  if (!opts.edict && opts.force && decisions.length) {
    const hasExplore = decisions.some(d => EXPLORE_ACTIONS.includes(d.kind));
    if (!hasExplore) {
      const host = decisions.slice().sort((a, b) => {
        const ca = (run.civs || []).find(c => c.id === a.civId);
        const cb = (run.civs || []).find(c => c.id === b.civId);
        const la = (ca?.leaders || []).find(l => l.id === a.characterId);
        const lb = (cb?.leaders || []).find(l => l.id === b.characterId);
        return ability(lb || {}, '战略', 0) - ability(la || {}, '战略', 0);
      })[0];
      if (host) {
        host.kind = 'galaxy.probe';
        host.decision = `${host.characterName}：批准邻域深空探针投放（force 调试扩展）`;
      }
    }
    const hasFac = decisions.some(d => d.kind === 'station.build' || d.kind === 'facility.deploy');
    if (!hasFac) {
      const builder = decisions.find(d => /工程|科研|领袖|工匠/.test(d.role || '')) || decisions[0];
      if (builder) {
        builder.kind = 'facility.deploy';
        builder.decision = `${builder.characterName}：批准部署新轨道设施（force 调试设施）`;
      }
    }
  }
  return decisions;
}

function refreshDecisionActions(run, decisions, rnd) {
  (decisions || []).forEach(d => {
    const { civ, char } = findLeader(run, d.characterId, d.civId);
    if (!civ || !char) return;
    const action = chooseLeaderAction(run, civ, char, d.kind, rnd || (() => 0.5));
    d.goalId = action.sourceGoalId;
    d.actionType = action.type;
    d.actionCost = action.cost;
    d.actionResult = action.result;
    d.actionReason = action.reason;
    d.agentAction = action;
  });
  return decisions;
}

function resolveAgentMode(run, opts) {
  const raw = (opts && opts.agentMode) || run.agentMode || 'rules_only';
  if (raw === 'hybrid' || raw === 'full') return raw;
  return 'rules_only';
}

/** 有限并发 map */
async function mapPool(items, limit, worker) {
  const list = items || [];
  const n = Math.max(1, Math.min(limit || 3, list.length || 1));
  const out = new Array(list.length);
  let cursor = 0;
  async function pump() {
    while (cursor < list.length) {
      const i = cursor++;
      out[i] = await worker(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, () => pump()));
  return out;
}

function findLeader(run, characterId, civId) {
  for (const civ of (run.civs || [])) {
    if (civId && civ.id !== civId) continue;
    const hit = (civ.leaders || []).find(l => l.id === characterId);
    if (hit) return { civ, char: hit };
  }
  return { civ: null, char: null };
}

/**
 * 规则自述：第三人称自传体，写「推演时间段内」角色视角下发生的事
 * @param {object} decision
 * @param {object|null} char
 * @param {{ yearFrom?:number, yearTo?:number, worldDelta?:object, events?:string[] }} ctx
 */
function rulesMonologue(decision, char, ctx) {
  ctx = ctx || {};
  const name = (char && char.name) || decision.characterName || '其人';
  const civ = decision.civName || '';
  const y0 = ctx.yearFrom != null ? ctx.yearFrom : null;
  const y1 = ctx.yearTo != null ? ctx.yearTo : null;
  const span = (y0 != null && y1 != null && y1 !== y0)
    ? `${y0}至${y1}年间`
    : (y1 != null ? `${y1}年前后` : '本轮推演间');
  const kind = decision.kind || 'policy';
  const deed = {
    policy: `${name}在朝堂与院署之间反复校准国策边界，最终把权力重心重新摆正`,
    diplomacy: `${name}穿梭于使节与密函之间，重估邻邦的温度与底线`,
    research: `${name}把实验室与试车台的日程强行提前，追着数据不肯放手`,
    military: `${name}抬高戒备，把巡逻与编制按战时节奏拧紧`,
    faith: `${name}在仪式与预兆之间取舍，把信仰的力量借给眼下的抉择`,
    trade: `${name}守住契约与商路，把谈判桌当成另一条战线`,
    'explore.system': `${name}批准深空探测，让空白星图第一次被写上坐标`,
    'galaxy.probe': `${name}放出探针，把未知星域的回波一点点拽回案头`,
    'explore.body': `${name}坚持近观那颗未尽勘察的天体，把遥感升成轨道级确认`,
    'station.build': `${name}拍板兴建轨道前哨，把旗帜焊进虚空`,
    'facility.deploy': `${name}部署新的轨道设施，把立场变成可触摸的金属`
  };
  let line = `${span}，${deed[kind] || `${name}推动了一项关键抉择`}。`;
  if (civ) line = line.replace(`${name}`, `${civ}的${name}`);

  const wd = ctx.worldDelta || {};
  const fac = (wd.newBodies || []).filter(b => b.flags && b.flags.artificial).map(b => b.name);
  const gals = (wd.newGalaxies || []).map(g => g.name);
  const sys = (wd.newSystems || []).map(s => s.name);
  const bits = [];
  if (fac.length && (kind === 'station.build' || kind === 'facility.deploy' || decision.civId)) {
    const own = (wd.newBodies || []).filter(b =>
      b.flags && b.flags.artificial && b.builtByCharacterId === decision.characterId
    ).map(b => b.name);
    if (own.length) bits.push(`其任上落下了${own.slice(0, 2).join('、')}`);
    else if (fac.length && /设施|站|部署|建造/.test(decision.decision || '')) {
      bits.push(`星图上多出了${fac.slice(0, 2).join('、')}`);
    }
  }
  if ((kind === 'galaxy.probe' || kind === 'explore.system' || kind === 'explore.body') && (gals.length || sys.length)) {
    bits.push(`探测回波点亮了${(gals.concat(sys)).slice(0, 2).join('、') || '新的深空方位'}`);
  }
  if (Array.isArray(ctx.events) && ctx.events.length) {
    const hit = ctx.events.find(e => e && String(e).includes(name)) || ctx.events[0];
    if (hit) bits.push(String(hit).slice(0, 40));
  }
  if (char && char.motive) {
    const short = String(char.motive).replace(/[。！？].*$/, '').slice(0, 22);
    if (short) bits.push(`其志仍在「${short}」`);
  }
  if (bits.length) line += bits.slice(0, 2).join('；') + '。';
  else line += `这一抉择在${civ || '其文明'}内部激起回响，也在编年的边缘留下名字。`;
  return line.slice(0, 200);
}

function attachRulesMonologues(run, decisions, ctx) {
  (decisions || []).forEach(d => {
    const { char } = findLeader(run, d.characterId, d.civId);
    // 始终用最新世界上下文重写规则自述（LLM 成功的会在 enrich 里覆盖）
    if (!d.monologue || d.monologueSource === 'rules' || !d.monologue) {
      d.monologue = rulesMonologue(d, char, ctx);
      d.monologueSource = d.monologueSource || 'rules';
    }
    d.source = d.source || 'rules';
  });
  return decisions;
}

function worldBriefForAgents(run, edict) {
  const bodies = run.discovered?.bodies || [];
  const fac = bodies.filter(b => b.flags && b.flags.artificial).slice(-5).map(b => b.name);
  const landable = bodies.filter(b => b.flags && b.flags.landable && !b.flags.artificial).length;
  const civBriefs = (run.civs || []).map(c => ({
    id: c.id,
    name: c.name,
    short: c.short,
    stage: c.stage || c.文明阶段,
    policy: c.目前国策 ? (c.目前国策.名称 + '：' + String(c.目前国策.内容 || '').slice(0, 60)) : '',
    techNext: c.科技树 ? c.科技树.下一阶段 : null,
    stats: c.stats || null
  }));
  const rel = (run.relations || []).slice(0, 8).map(r => ({
    a: r.a, b: r.b, state: r.state, reason: String(r.reason || '').slice(0, 40)
  }));
  return {
    year: run.year,
    era: run.era,
    bodyCount: bodies.length,
    galaxyCount: (run.discovered?.galaxies || []).length,
    landableCount: landable,
    recentFacilities: fac,
    civs: civBriefs,
    relations: rel,
    edict: edict || null,
    recentChronicle: (run.chronicle || []).slice(0, 3).map(e => e.事件)
  };
}

function buildCharacterPack(run, decision) {
  const { civ, char } = findLeader(run, decision.characterId, decision.civId);
  const abilities = {};
  ((char && char.abilities) || []).forEach(a => { abilities[a.name] = a.val; });
  return {
    characterId: decision.characterId,
    name: decision.characterName,
    title: (char && char.title) || '',
    role: decision.role || (char && char.role) || '',
    civId: decision.civId,
    civName: decision.civName || (civ && civ.name) || '',
    stance: decision.stance || (char && char.agentStance) || '',
    agentModel: (char && char.agentModel) || '',
    personality: char && char.personality
      ? { code: char.personality.code, stability: char.personality.stability, note: char.personality.注 }
      : null,
    abilities,
    motive: (char && char.motive) || '',
    background: char ? String(char.background || '').slice(0, 220) : '',
    bodyState: (char && char.bodyState) || '',
    age: char ? char.age : null,
    civPolicy: civ && civ.目前国策
      ? { name: civ.目前国策.名称, text: String(civ.目前国策.内容 || '').slice(0, 100) }
      : null,
    civIdeology: civ ? String(civ.思潮 || civ.国民理念 || '').slice(0, 100) : '',
    ruleDraft: {
      kind: decision.kind,
      decision: decision.decision,
      urgency: decision.urgency
    }
  };
}

/**
 * 单人 CharacterAgent：独立 LLM 决策
 * monologue 不在此阶段最终定稿——世界变化后再写第三人称自传体
 * 失败时保留规则底稿
 */
async function decideOneCharacter(run, decision, opts, agentMode, roundN, worldBrief, peers) {
  const llm = opts.llm;
  const pack = buildCharacterPack(run, decision);
  const kindList = [...ALLOWED_KINDS].join(', ');
  const freeRewrite = agentMode === 'full';
  const system = [
    `你是创世引擎中的独立 CharacterAgent，只决定「${pack.name}」本轮行动。`,
    '禁止扮演其他人物；禁止输出与你无关的决策。',
    '英雄史观：决策主语必须是该人物；体现动机、性格与权限边界。',
    '硬约束：',
    `- kind 必须是：${kindList}`,
    '- decision 中文，以「人名：」开头，40～90 字，含具体动作与对象',
    '- 不要输出 monologue（自述稍后由系统按推演结果生成）',
    '- publicSpeech 可选，一句对外台词，≤40 字',
    '- 不要 markdown、不要解释，只输出一个 JSON 对象',
    'JSON schema:',
    '{"kind":"","decision":"","urgency":"高|中|低","publicSpeech":"","stance":"可选短期立场"}'
  ].join('\n');

  const user = JSON.stringify({
    mode: agentMode,
    world: worldBrief,
    you: pack,
    peersThisRound: (peers || []).filter(p => p.characterId !== decision.characterId).slice(0, 10),
    note: freeRewrite
      ? '可较大幅度改写 kind 与行动，但仍须符合角色权限、动机与当前国策。'
      : '以 ruleDraft 为底：优先润色与深化，仅在明显更符合动机时改 kind。'
  }, null, 0);

  const timeoutMs = Math.max(4000, Math.min(Number(llm.timeoutMs) || 25000, 45000));
  const result = await llmChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    {
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      temperature: llm.temperature != null ? llm.temperature : (freeRewrite ? 0.88 : 0.72),
      timeoutMs
    }
  );

  const logBase = {
    runId: run.id,
    round: roundN,
    purpose: 'character_decide',
    model: llm.model,
    baseHost: llmLog.hostFromBase(llm.baseUrl),
    systemPreview: system,
    promptPreview: user,
    characterId: decision.characterId,
    characterName: decision.characterName
  };

  if (!result.ok) {
    const logEntry = llmLog.record(Object.assign({}, logBase, {
      ok: false,
      ms: result.ms,
      error: result.error || 'llm_failed',
      content: '',
      fallback: 'llm_error'
    }));
    decision.source = 'rules';
    return { ok: false, logId: logEntry.id, ms: result.ms || 0, error: result.error };
  }

  const parsed = parseJsonLoose(result.content);
  if (!parsed || typeof parsed !== 'object') {
    const logEntry = llmLog.record(Object.assign({}, logBase, {
      ok: true,
      ms: result.ms,
      content: result.content,
      usage: result.raw?.usage || null,
      parseOk: false,
      fallback: 'llm_parse_error'
    }));
    decision.source = 'rules';
    return { ok: false, logId: logEntry.id, ms: result.ms || 0, error: 'invalid_json' };
  }

  const kind = String(parsed.kind || '').trim();
  if (ALLOWED_KINDS.has(kind)) decision.kind = kind;
  const text = String(parsed.decision || '').trim();
  if (text) {
    decision.decision = text.includes(decision.characterName)
      ? text.slice(0, 180)
      : `${decision.characterName}：${text.slice(0, 160)}`;
  }
  if (parsed.urgency && /高|中|低/.test(String(parsed.urgency))) {
    decision.urgency = String(parsed.urgency);
  }
  // 兼容模型仍返回 monologue：暂存为 draft，最终仍会用推演结果重写
  if (parsed.monologue) decision._monoDraft = String(parsed.monologue).trim().slice(0, 220);
  const speech = String(parsed.publicSpeech || '').trim();
  if (speech) decision.publicSpeech = speech.slice(0, 60);
  const stance = String(parsed.stance || '').trim();
  if (stance) decision.stance = stance.slice(0, 40);
  decision.source = 'llm';

  const logEntry = llmLog.record(Object.assign({}, logBase, {
    ok: true,
    ms: result.ms,
    content: result.content,
    usage: result.raw?.usage || null,
    parseOk: true,
    applied: 1
  }));
  return { ok: true, logId: logEntry.id, ms: result.ms || 0 };
}

/**
 * hybrid/full：每人一次独立 LLM 决策（并发有限）；失败者保留规则底稿
 * 自述不在此阶段生成——等 WorldBuilder / 六棱镜写回世界后再写第三人称自传
 */
async function enhanceWithLlm(run, decisions, opts, agentMode, roundN) {
  const meta = {
    requested: agentMode,
    used: 'rules_only',
    llmCalls: 0,
    llmMs: 0,
    fallback: null,
    error: null,
    logIds: [],
    perCharacter: true,
    applied: 0,
    failed: 0
  };
  const llm = opts && opts.llm;
  if (!llmConfigured(llm)) {
    meta.fallback = 'llm_not_configured';
    return { decisions, meta };
  }

  const worldBrief = worldBriefForAgents(run, opts && opts.edict);
  const peers = decisions.map(d => ({
    characterId: d.characterId,
    characterName: d.characterName,
    civName: d.civName,
    role: d.role,
    stance: d.stance,
    ruleKind: d.kind
  }));

  // hybrid：最多 8 人；full：全部启用人物（已在 characterDecisions 过滤）
  const queue = agentMode === 'hybrid' ? decisions.slice(0, 8) : decisions.slice();
  const concurrency = agentMode === 'full' ? 4 : 3;
  const results = await mapPool(queue, concurrency, (d) =>
    decideOneCharacter(run, d, opts, agentMode, roundN, worldBrief, peers)
  );

  results.forEach(r => {
    if (!r) return;
    meta.llmCalls += 1;
    meta.llmMs += r.ms || 0;
    if (r.logId) meta.logIds.push(r.logId);
    if (r.ok) meta.applied += 1;
    else meta.failed += 1;
  });

  decisions.forEach(d => {
    if (!d.source) d.source = 'rules';
  });

  if (meta.applied === 0) {
    meta.fallback = meta.failed ? 'llm_error' : 'llm_no_match';
    meta.error = meta.failed ? 'all_characters_failed' : 'no_character_applied';
    meta.used = 'rules_only';
    return { decisions, meta };
  }

  meta.used = agentMode;
  if (meta.failed > 0) meta.partial = true;
  return { decisions, meta };
}

/**
 * 根据本轮世界变化生成六棱镜叙述（规则路径）
 * 六棱镜 = 世界扩张 / 变化 / 建筑 / 事件的六面叙事，不是空批评
 */
function lensesFromWorld(run, decisions, worldDelta, edict) {
  const base = lensTemplates(decisions, edict);
  const fac = (worldDelta.newBodies || []).filter(b => b.flags && b.flags.artificial);
  const gals = worldDelta.newGalaxies || [];
  const sys = worldDelta.newSystems || [];
  const updated = worldDelta.updatedBodies || [];
  const explorers = decisions.filter(d => EXPLORE_ACTIONS.includes(d.kind)).map(d => d.characterName);
  const builders = decisions.filter(d => d.kind === 'station.build' || d.kind === 'facility.deploy').map(d => d.characterName);
  const mil = decisions.filter(d => d.kind === 'military').map(d => d.characterName);
  const res = decisions.filter(d => d.kind === 'research').map(d => d.characterName);

  if (gals.length || sys.length) {
    base.政治 = `${explorers[0] || '探测派'}推动的星图扩张迫使议会重新分配授权与预算；${gals.map(g => g.name).concat(sys.map(s => s.name)).slice(0, 2).join('、') || '新坐标'}进入公共议程。`;
    base.科技 = `深空回波与轨道数据回流，关键科研节点获得新样本；观测窗口因探测而延长。`;
    base.思潮 = `新坐标点燃星空信仰与怀疑论的对撞，陆权叙事短暂失焦。`;
  }
  if (fac.length) {
    base.军事 = `${builders[0] || '工程派'}任上部署的${fac.map(f => f.name).slice(0, 2).join('、')}抬升了轨道存在感，戒备与补给线同步前移。`;
    base.经济 = `航天与基建预算继续挤压民生科目；${fac.length} 处新设施意味着长期运维成本写入国库。`;
  } else if (mil.length) {
    base.军事 = `${mil[0]}抬高戒备，轨道与陆权同时绷紧，威慑姿态压过谈判桌。`;
  }
  if (res.length) {
    base.科技 = base.科技.includes('新样本')
      ? base.科技
      : `${res[0]}强行推进试验窗口，实验室节奏被改写。`;
  }
  if (updated.length) {
    base.科技 = (base.科技 || '') + ` 勘察等级提升：${updated.map(b => b.name).slice(0, 2).join('、')}。`;
  }
  base.个人 = decisions[0]
    ? `${decisions[0].characterName}的抉择牵动同僚；本轮世界增量（星系${gals.length}/系${sys.length}/体${(worldDelta.newBodies || []).length}）将记入其名下。`
    : base.个人;
  // 截断
  LENS_KEYS.forEach(k => {
    if (base[k]) base[k] = String(base[k]).trim().slice(0, 220);
  });
  return base;
}

/**
 * 六棱镜世界推演：输出叙述 + 可应用的世界补丁（扩张/变化/建筑意图/事件）
 * 失败时回落 lensesFromWorld + 空补丁
 */
async function simulateLensesWithLlm(run, decisions, worldDelta, baseLenses, opts, agentMode, roundN, llmMeta) {
  const llm = opts && opts.llm;
  if (!llmConfigured(llm)) {
    return { lenses: baseLenses, lensPatches: emptyLensPatches(), events: [] };
  }

  const system = [
    '你是创世引擎的六棱镜世界推演器（Lens World Simulator）。',
    '任务：根据本轮人物决策与已发生的世界增量，从政治/军事/经济/科技/思潮/个人六面',
    '描述「世界如何扩张、变化、添建、生变」，并给出可落地的结构化补丁。',
    '不是空泛批评，要写清发生了什么、世界状态因此怎样改变。',
    '硬约束：',
    '- lenses 六键皆填，每键 2～3 句中文，点名人物/文明/设施/星系',
    '- events 0～5 条短事件，供编年与自述引用',
    '- patches 只能使用下列字段；无法判断则给空数组',
    '- 不要 markdown，只输出一个 JSON',
    'JSON schema:',
    '{"lenses":{"政治":"","军事":"","经济":"","科技":"","思潮":"","个人":""},',
    '"events":["..."],',
    '"patches":{',
    '  "techDelta":[{"civId":"","amount":1}],',
    '  "relationShifts":[{"a":"","b":"","delta":-1,"note":""}],',
    '  "stanceUpdates":[{"characterId":"","stance":""}],',
    '  "extraExplore":false,',
    '  "extraFacility":false,',
    '  "forceSurvey":false',
    '}}'
  ].join('\n');

  const civIds = (run.civs || []).map(c => c.id);
  const charIds = decisions.map(d => d.characterId);
  const user = JSON.stringify({
    mode: agentMode,
    year: run.year,
    era: run.era,
    knownCivIds: civIds,
    knownCharacterIds: charIds,
    baseLenses,
    worldDelta: {
      newGalaxies: (worldDelta.newGalaxies || []).map(g => ({ id: g.id, name: g.name })),
      newSystems: (worldDelta.newSystems || []).map(s => ({ id: s.id, name: s.name })),
      newBodies: (worldDelta.newBodies || []).map(b => ({
        id: b.id, name: b.name, artificial: !!(b.flags && b.flags.artificial),
        builtBy: b.builtByCharacterId || null
      })),
      updatedBodies: (worldDelta.updatedBodies || []).map(b => ({ id: b.id, name: b.name, surveyed: b.flags?.surveyed }))
    },
    decisions: decisions.map(d => ({
      characterId: d.characterId,
      name: d.characterName,
      civId: d.civId,
      civ: d.civName,
      kind: d.kind,
      decision: d.decision,
      urgency: d.urgency
    })),
    recentChronicle: (run.chronicle || []).slice(0, 2).map(e => e.事件)
  }, null, 0);

  const timeoutMs = Math.max(4000, Math.min(Number(llm.timeoutMs) || 25000, 45000));
  const result = await llmChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    {
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      temperature: llm.temperature != null ? Number(llm.temperature) * 0.85 : 0.55,
      timeoutMs
    }
  );

  llmMeta.llmCalls = (llmMeta.llmCalls || 0) + 1;
  llmMeta.llmMs = (llmMeta.llmMs || 0) + (result.ms || 0);
  llmMeta.logIds = llmMeta.logIds || [];

  if (!result.ok) {
    const logEntry = llmLog.record({
      runId: run.id,
      round: roundN,
      purpose: 'lens_world',
      model: llm.model,
      baseHost: llmLog.hostFromBase(llm.baseUrl),
      ok: false,
      ms: result.ms,
      error: result.error,
      systemPreview: system,
      promptPreview: user,
      content: ''
    });
    llmMeta.logIds.push(logEntry.id);
    return { lenses: baseLenses, lensPatches: emptyLensPatches(), events: [] };
  }

  const parsed = parseJsonLoose(result.content);
  const lenses = Object.assign({}, baseLenses);
  let hit = 0;
  const events = [];
  let lensPatches = emptyLensPatches();

  if (parsed && typeof parsed === 'object') {
    const L = parsed.lenses && typeof parsed.lenses === 'object' ? parsed.lenses : parsed;
    LENS_KEYS.forEach(k => {
      const v = L[k];
      if (v != null && String(v).trim()) {
        lenses[k] = String(v).trim().slice(0, 220);
        hit++;
      }
    });
    if (Array.isArray(parsed.events)) {
      parsed.events.forEach(e => {
        const t = String(e || '').trim();
        if (t) events.push(t.slice(0, 120));
      });
    }
    if (parsed.patches && typeof parsed.patches === 'object') {
      lensPatches = normalizeLensPatches(parsed.patches, run, decisions);
    }
  }

  const logEntry = llmLog.record({
    runId: run.id,
    round: roundN,
    purpose: 'lens_world',
    model: llm.model,
    baseHost: llmLog.hostFromBase(llm.baseUrl),
    ok: true,
    ms: result.ms,
    systemPreview: system,
    promptPreview: user,
    content: result.content,
    usage: result.raw?.usage || null,
    parseOk: hit > 0,
    applied: hit
  });
  llmMeta.logIds.push(logEntry.id);
  if (hit > 0) llmMeta.lensWorld = true;
  return { lenses, lensPatches, events: events.slice(0, 5) };
}

function emptyLensPatches() {
  return {
    techDelta: [],
    relationShifts: [],
    stanceUpdates: [],
    extraExplore: false,
    extraFacility: false,
    forceSurvey: false
  };
}

function normalizeLensPatches(raw, run, decisions) {
  const out = emptyLensPatches();
  const civIds = new Set((run.civs || []).map(c => c.id));
  const charIds = new Set(decisions.map(d => d.characterId));
  if (Array.isArray(raw.techDelta)) {
    raw.techDelta.forEach(t => {
      if (!t || !civIds.has(t.civId)) return;
      const amount = Math.max(-5, Math.min(8, Number(t.amount) || 0));
      if (amount) out.techDelta.push({ civId: t.civId, amount });
    });
  }
  if (Array.isArray(raw.relationShifts)) {
    raw.relationShifts.forEach(r => {
      if (!r || !civIds.has(r.a) || !civIds.has(r.b) || r.a === r.b) return;
      out.relationShifts.push({
        a: r.a,
        b: r.b,
        delta: Math.max(-2, Math.min(2, Number(r.delta) || 0)),
        note: String(r.note || '').slice(0, 60)
      });
    });
  }
  if (Array.isArray(raw.stanceUpdates)) {
    raw.stanceUpdates.forEach(s => {
      if (!s || !charIds.has(s.characterId)) return;
      const st = String(s.stance || '').trim().slice(0, 40);
      if (st) out.stanceUpdates.push({ characterId: s.characterId, stance: st });
    });
  }
  out.extraExplore = !!raw.extraExplore;
  out.extraFacility = !!raw.extraFacility;
  out.forceSurvey = !!raw.forceSurvey;
  return out;
}

/**
 * 把六棱镜补丁写入 run + 可能追加 worldDelta（额外探测/设施/勘察）
 */
function applyLensPatches(run, decisions, worldDelta, lensPatches, rnd) {
  const patches = {
    tech: [],
    relations: [],
    characters: [],
    worldExtras: []
  };
  if (!lensPatches) return patches;

  (lensPatches.techDelta || []).forEach(t => {
    const civ = (run.civs || []).find(c => c.id === t.civId);
    if (!civ || !civ.科技树) return;
    civ.科技树.下一阶段 = Math.min(100, Math.max(0, (Number(civ.科技树.下一阶段) || 0) + t.amount));
    const nodes = civ.科技树.节点 || {};
    Object.keys(nodes).forEach(k => {
      const n = nodes[k];
      if (n && n.状态 === '研究中' && typeof n.进度 === 'number' && t.amount > 0) {
        n.进度 = Math.min(100, n.进度 + t.amount);
        patches.tech.push({ civId: civ.id, node: k, progress: n.进度, source: 'lens' });
      }
    });
  });

  (lensPatches.relationShifts || []).forEach(r => {
    const rel = (run.relations || []).find(x =>
      (x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)
    );
    if (rel) {
      if (r.note) rel.reason = ((rel.reason || '') + ' · ' + r.note).slice(0, 200);
      if (r.delta < 0 && !/热战|交火/.test(rel.state || '')) {
        // 仅加重叙述，不在 C 阶段硬切热战
      }
      patches.relations.push({ a: rel.a, b: rel.b, state: rel.state, note: r.note, delta: r.delta });
    }
  });

  (lensPatches.stanceUpdates || []).forEach(s => {
    const { char } = findLeader(run, s.characterId, null);
    if (char) {
      char.agentStance = s.stance;
      patches.characters.push({ characterId: s.characterId, stance: s.stance });
    }
    const dec = decisions.find(d => d.characterId === s.characterId);
    if (dec) dec.stance = s.stance;
  });

  // 额外世界扩张：仅当本轮还没触及帽
  if (lensPatches.extraExplore) {
    const hasExplore = decisions.some(d => EXPLORE_ACTIONS.includes(d.kind));
    if (!hasExplore && decisions.length) {
      const host = decisions[0];
      host.kind = 'galaxy.probe';
      host.decision = `${host.characterName}：六棱镜局势倒逼邻域探针投放`;
      const extra = worldBuilder(run, [host], rnd);
      (extra.newGalaxies || []).forEach(g => worldDelta.newGalaxies.push(g));
      (extra.newSystems || []).forEach(s => worldDelta.newSystems.push(s));
      (extra.newBodies || []).forEach(b => worldDelta.newBodies.push(b));
      (extra.updatedBodies || []).forEach(b => worldDelta.updatedBodies.push(b));
      patches.worldExtras.push({ type: 'extraExplore', host: host.characterId });
    }
  }
  if (lensPatches.extraFacility) {
    const hasFac = decisions.some(d => d.kind === 'station.build' || d.kind === 'facility.deploy')
      || (worldDelta.newBodies || []).some(b => b.flags && b.flags.artificial);
    if (!hasFac && decisions.length) {
      const host = decisions.find(d => /设计|科研|工程师|军/.test(d.role || '')) || decisions[0];
      const facDec = Object.assign({}, host, {
        kind: 'facility.deploy',
        decision: `${host.characterName}：六棱镜收敛后紧急部署轨道节点`
      });
      const extra = worldBuilder(run, [facDec], rnd);
      (extra.newBodies || []).forEach(b => worldDelta.newBodies.push(b));
      patches.worldExtras.push({ type: 'extraFacility', host: host.characterId });
    }
  }
  if (lensPatches.forceSurvey) {
    const cand = (run.discovered.bodies || []).find(
      b => b.flags && b.flags.landable && b.flags.surveyed === 'remote' && !b.flags.artificial
    );
    if (cand) {
      cand.flags.surveyed = 'orbital';
      worldDelta.updatedBodies = worldDelta.updatedBodies || [];
      if (!worldDelta.updatedBodies.some(b => b.id === cand.id)) {
        worldDelta.updatedBodies.push(clone(cand));
      }
      patches.worldExtras.push({ type: 'forceSurvey', bodyId: cand.id });
    }
  }

  return patches;
}

/**
 * 世界变化后的第三人称自传体自述（LLM 可选，失败用规则）
 */
async function writeMonologues(run, decisions, worldDelta, events, yearFrom, yearTo, opts, agentMode, roundN, llmMeta) {
  const ctxBase = { yearFrom, yearTo, worldDelta, events };
  // 先铺规则底稿，保证必有返回
  decisions.forEach(d => {
    const { char } = findLeader(run, d.characterId, d.civId);
    d.monologue = rulesMonologue(d, char, ctxBase);
    d.monologueSource = 'rules';
  });

  const llm = opts && opts.llm;
  if (agentMode === 'rules_only' || !llmConfigured(llm) || !llmMeta || llmMeta.used === 'rules_only') {
    return;
  }

  // hybrid：优先 LLM 写前 6 人；full：最多 8 人
  const queue = decisions
    .filter(d => d.source === 'llm' || agentMode === 'full')
    .slice(0, agentMode === 'full' ? 8 : 6);
  if (!queue.length) return;

  const system = [
    '你为创世引擎写「角色自述镜头」：第三人称自传体。',
    '以该角色的视角与处境，叙述推演时间段内真实发生的事（决策后果、世界扩张、建筑、事件）。',
    '禁止第一人称「我」；用「他/她/其名」；80～160 字；可含细节与余波。',
    '不要复述 decision 原文；不要 markdown。',
    '只输出 JSON：{"items":[{"characterId":"","monologue":""}]}',
    'characterId 必须来自输入；每人一条。'
  ].join('\n');

  const user = JSON.stringify({
    yearFrom,
    yearTo,
    spanNote: `${yearFrom}至${yearTo}年`,
    worldDelta: {
      facilities: (worldDelta.newBodies || []).filter(b => b.flags && b.flags.artificial).map(b => ({
        id: b.id, name: b.name, by: b.builtByCharacterId
      })),
      galaxies: (worldDelta.newGalaxies || []).map(g => g.name),
      systems: (worldDelta.newSystems || []).map(s => s.name),
      surveyed: (worldDelta.updatedBodies || []).map(b => b.name)
    },
    events: events || [],
    characters: queue.map(d => {
      const { char } = findLeader(run, d.characterId, d.civId);
      return {
        characterId: d.characterId,
        name: d.characterName,
        civ: d.civName,
        role: d.role,
        kind: d.kind,
        decision: d.decision,
        motive: char ? String(char.motive || '').slice(0, 60) : '',
        stance: d.stance
      };
    })
  }, null, 0);

  const timeoutMs = Math.max(4000, Math.min(Number(llm.timeoutMs) || 25000, 40000));
  const result = await llmChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    {
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      temperature: 0.75,
      timeoutMs
    }
  );

  llmMeta.llmCalls = (llmMeta.llmCalls || 0) + 1;
  llmMeta.llmMs = (llmMeta.llmMs || 0) + (result.ms || 0);
  llmMeta.logIds = llmMeta.logIds || [];

  if (!result.ok) {
    const logEntry = llmLog.record({
      runId: run.id,
      round: roundN,
      purpose: 'monologue_bio',
      model: llm.model,
      baseHost: llmLog.hostFromBase(llm.baseUrl),
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
  let applied = 0;
  if (parsed && Array.isArray(parsed.items)) {
    const byId = new Map(decisions.map(d => [d.characterId, d]));
    parsed.items.forEach(item => {
      if (!item || !item.characterId) return;
      const d = byId.get(item.characterId);
      if (!d) return;
      let text = String(item.monologue || '').trim();
      if (!text) return;
      // 粗滤第一人称
      if (/^我[是，、]/.test(text) || text.startsWith('我')) {
        text = text.replace(/^我/, d.characterName);
      }
      d.monologue = text.slice(0, 220);
      d.monologueSource = 'llm';
      applied++;
    });
  }

  const logEntry = llmLog.record({
    runId: run.id,
    round: roundN,
    purpose: 'monologue_bio',
    model: llm.model,
    baseHost: llmLog.hostFromBase(llm.baseUrl),
    ok: true,
    ms: result.ms,
    systemPreview: system,
    promptPreview: user,
    content: result.content,
    usage: result.raw?.usage || null,
    parseOk: applied > 0,
    applied
  });
  llmMeta.logIds.push(logEntry.id);
  if (applied > 0) llmMeta.monologues = applied;
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

function serializeDecision(d) {
  return {
    characterId: d.characterId,
    characterName: d.characterName,
    civId: d.civId,
    civName: d.civName,
    role: d.role,
    kind: d.kind,
    decision: d.decision,
    urgency: d.urgency,
    stance: d.stance,
    source: d.source || 'rules',
    monologue: d.monologue || '',
    monologueSource: d.monologueSource || (d.monologue ? 'rules' : ''),
    publicSpeech: d.publicSpeech || '',
    goalId: d.goalId || null,
    actionType: d.actionType || null,
    actionResult: d.actionResult || null,
    actionReason: d.actionReason || '',
    actionCost: d.actionCost || null
  };
}

/**
 * 主入口：推进一轮（async；rules_only 不发起网络）
 * 流程：规则底稿 →（可选）每人 LLM 决策 → 软保底
 *      → WorldBuilder 世界扩张/设施
 *      → 六棱镜世界推演（叙述 + 补丁写回）
 *      → Resolver 年份/科技
 *      → 第三人称自传自述（必有）
 *      → 编年
 */
async function deduce(run, opts) {
  opts = opts || {};
  const roundN = (run.deductionRounds?.length || 0) + 1;
  const seed = (run.seed ^ (run.revision * 2654435761) ^ (roundN * 40503)) >>> 0;
  const rnd = mulberry32(seed);
  const agentMode = resolveAgentMode(run, opts);
  run.agentMode = agentMode;
  ensureLeaderAgentState(run);

  const yearFrom = run.year;

  // 1) Character 规则底稿
  let decisions = characterDecisions(run, rnd);

  // 2) 软保底（explore / facility）
  applySoftGuarantees(run, decisions, roundN, opts);
  refreshDecisionActions(run, decisions, rnd);

  // 2b) hybrid / full：每人独立 LLM 决策（自述稍后生成）
  let llmMeta = {
    requested: agentMode,
    used: 'rules_only',
    llmCalls: 0,
    llmMs: 0,
    fallback: agentMode === 'rules_only' ? null : 'skipped',
    error: null,
    logIds: [],
    perCharacter: false
  };
  if (agentMode !== 'rules_only') {
    const enhanced = await enhanceWithLlm(run, decisions, opts, agentMode, roundN);
    decisions = enhanced.decisions;
    llmMeta = enhanced.meta;
    llmMeta.logIds = llmMeta.logIds || [];
    applySoftGuarantees(run, decisions, roundN, opts);
    refreshDecisionActions(run, decisions, rnd);
  }

  // 3) WorldBuilder：决策驱动的扩张 / 建筑
  const worldDelta = opts.edict && !opts.force
    ? { newGalaxies: [], newSystems: [], newBodies: [], updatedBodies: [], removedBodyIds: [] }
    : worldBuilder(run, decisions, rnd);

  // 3b) 新天体细节润色（可选）
  if (agentMode !== 'rules_only' && llmMeta.used !== 'rules_only') {
    try {
      await detailFillBodies(run, worldDelta, opts, agentMode, llmMeta, roundN);
    } catch (err) {
      llmMeta.detailFillError = String(err && err.message || err);
    }
  }

  // 4) 六棱镜：世界变化叙述 + 可写回补丁（非空批评）
  let lenses = lensesFromWorld(run, decisions, worldDelta, opts.edict);
  let lensEvents = [];
  let lensPatchResult = emptyLensPatches();
  if (agentMode !== 'rules_only' && llmMeta.used !== 'rules_only' && llmConfigured(opts.llm)) {
    try {
      const sim = await simulateLensesWithLlm(
        run, decisions, worldDelta, lenses, opts, agentMode, roundN, llmMeta
      );
      lenses = sim.lenses || lenses;
      lensEvents = sim.events || [];
      lensPatchResult = sim.lensPatches || emptyLensPatches();
    } catch (err) {
      llmMeta.lensError = String(err && err.message || err);
    }
  }
  // 把六棱镜补丁应用到世界状态（科技/关系/立场/额外扩张）
  const lensApplied = applyLensPatches(run, decisions, worldDelta, lensPatchResult, rnd);

  // 5) Resolver：年份推进 + 决策驱动科技/关系 + Agent 记忆/目标/行动/继承
  const { yearDelta, patches } = applyResolver(run, decisions, lenses, opts.edict, worldDelta);
  // 合并六棱镜补丁摘要
  if (lensApplied.tech && lensApplied.tech.length) {
    patches.tech = (patches.tech || []).concat(lensApplied.tech);
  }
  if (lensApplied.relations && lensApplied.relations.length) {
    patches.relations = (patches.relations || []).concat(lensApplied.relations);
  }
  if (lensApplied.characters && lensApplied.characters.length) {
    patches.characters = (patches.characters || []).concat(lensApplied.characters);
  }
  if (lensApplied.worldExtras && lensApplied.worldExtras.length) {
    patches.worldExtras = lensApplied.worldExtras;
  }
  patches.lensEvents = lensEvents;
  // Agent 系统与领土意图已在 applyResolver 内处理

  const yearTo = run.year;

  // 6) 自述：推演时间段内、角色视角、第三人称自传体（规则必有；hybrid 可 LLM 润色）
  try {
    await writeMonologues(
      run, decisions, worldDelta, lensEvents,
      yearFrom, yearTo, opts, agentMode, roundN, llmMeta
    );
  } catch (err) {
    // 硬兜底：绝不让自述缺失
    attachRulesMonologues(run, decisions, { yearFrom, yearTo, worldDelta, events: lensEvents });
    llmMeta.monologueError = String(err && err.message || err);
  }
  // 再扫一遍空自述
  decisions.forEach(d => {
    if (!d.monologue) {
      const { char } = findLeader(run, d.characterId, d.civId);
      d.monologue = rulesMonologue(d, char, { yearFrom, yearTo, worldDelta, events: lensEvents });
      d.monologueSource = 'rules';
    }
  });

  // 7) Chronicle
  const chronicleEntry = buildChronicle(run, decisions, worldDelta, lenses, opts.edict);
  if (lensEvents.length) {
    chronicleEntry.事件 = (chronicleEntry.事件 + ' ' + lensEvents.slice(0, 2).join(' ')).slice(0, 400);
  }

  // 镜头卷
  const monologueReel = decisions
    .slice()
    .sort((a, b) => {
      const u = { 高: 0, 中: 1, 低: 2 };
      const du = (u[a.urgency] ?? 3) - (u[b.urgency] ?? 3);
      if (du !== 0) return du;
      if ((a.source === 'llm') !== (b.source === 'llm')) return a.source === 'llm' ? -1 : 1;
      return 0;
    })
    .map(d => ({
      characterId: d.characterId,
      characterName: d.characterName,
      civId: d.civId,
      civName: d.civName,
      role: d.role,
      kind: d.kind,
      monologue: d.monologue || '',
      monologueSource: d.monologueSource || 'rules',
      publicSpeech: d.publicSpeech || '',
      decision: d.decision,
      source: d.source || 'rules',
      actionType: d.actionType || null,
      actionResult: d.actionResult || null,
      actionReason: d.actionReason || ''
    }));

  // 刷新 pending（含自述）
  run.deduction = run.deduction || { lenses: LENS_KEYS, rounds: 4, pendingDecisions: [], log: [] };
  run.deduction.pendingDecisions = decisions.map(d => ({
    civ: d.civId,
    leader: d.characterName,
    characterId: d.characterId,
    decision: d.decision,
    urgency: d.urgency,
    stance: d.stance,
    kind: d.kind,
    monologue: d.monologue || '',
    source: d.source || 'rules',
    actionType: d.actionType || null,
    actionResult: d.actionResult || null,
    actionReason: d.actionReason || ''
  }));

  const llmLogs = llmLog.forRound(run.id, roundN);

  const summary = chronicleEntry.事件;
  const log = {
    round: roundN,
    year: `${run.era?.纪年 || '第4纪元'} · ${run.year}年`,
    summary,
    lenses,
    decisions: decisions.map(serializeDecision),
    monologueReel,
    lensEvents,
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
      logIds: llmMeta.logIds || [],
      perCharacter: !!llmMeta.perCharacter,
      applied: llmMeta.applied || 0,
      failed: llmMeta.failed || 0,
      lensWorld: !!llmMeta.lensWorld,
      monologues: llmMeta.monologues || 0
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
    yearFrom,
    yearTo,
    round: roundRecord,
    decisions: decisions.map(serializeDecision),
    monologueReel,
    lenses,
    lensEvents,
    patchesSummary: patches,
    worldDelta,
    chronicle: [chronicleEntry],
    yearDelta,
    agentMeta: llmMeta,
    llmLogs: llmLogs || [],
    llmTotals: llmLog.list({ limit: 1 }).totals
  };
}

export { deduce, CAPS, LENS_KEYS, characterDecisions, validateBody, resolveAgentMode };
