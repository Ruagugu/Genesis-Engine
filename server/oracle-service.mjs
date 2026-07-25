/* ============================================================
   创世引擎 · 神谕服务（阶段 D）
   点数 / 档位 / P9 / ForcedPatch / Drain
   ============================================================ */
import { POINTS_HARD_CAP, findSeatByToken, publicSeat } from './seat-service.mjs';
import { clockPublic, nextPointYears } from './clock-service.mjs';
import {
  validateIdeologyPayload,
  applyIdeology,
  mergeCivPatches,
  ensureTechTree,
  availableResearchNodes,
  researchingNodes
} from './tech-ideology.mjs';

const ORACLE_COSTS = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
const MAX_ACTIVE_PER_PLAYER = 3;
const TEXT_LIMIT = 500;

const HARM_RE = /灭|屠|屠杀|歼灭|瘟疫|天火|沉没|国库归零|诅咒|杀死|死亡|毁灭|饥荒|大旱|洪水|疫病/;
const VICTIM_FIELD_RE = /victim|targetCiv|targetCivIds|victimCiv|harmOnly|受害|目标文明/i;

function ensureOracleState(run) {
  if (!Array.isArray(run.edicts)) run.edicts = [];
  if (!Array.isArray(run.oracleLedger)) run.oracleLedger = [];
  if (!run.flags || typeof run.flags !== 'object') run.flags = { gmFreeOracle: false };
  if (run.flags.gmFreeOracle == null) run.flags.gmFreeOracle = false;
  return run;
}

function nowIso() { return new Date().toISOString(); }

function newId(prefix, run) {
  const seq = (run.edicts?.length || 0) + (run.oracleLedger?.length || 0) + 1;
  return `${prefix}:${Math.floor(Date.now()).toString(36)}:${seq.toString(36)}`;
}

function addLedger(run, item) {
  ensureOracleState(run);
  const entry = Object.assign({
    id: newId('ledger', run),
    at: nowIso(),
    year: Math.floor(Number(run.year) || 0)
  }, item || {});
  run.oracleLedger.unshift(entry);
  if (run.oracleLedger.length > 200) run.oracleLedger.length = 200;
  return entry;
}

function civNames(run) {
  return (run.civs || []).flatMap(c => [c.id, c.name, c.short].filter(Boolean).map(x => String(x)));
}

function textOfPayload(payload) {
  return JSON.stringify(payload || {}).slice(0, TEXT_LIMIT * 2);
}

function hasVictimFields(obj) {
  const seen = [];
  function walk(v, path) {
    if (!v || typeof v !== 'object') return;
    Object.keys(v).forEach(k => {
      const p = path ? `${path}.${k}` : k;
      if (VICTIM_FIELD_RE.test(k)) seen.push(p);
      walk(v[k], p);
    });
  }
  walk(obj, '');
  return seen;
}

function p9Check(run, seat, payload) {
  const fields = hasVictimFields(payload);
  if (fields.length) {
    return { ok: false, code: 'P9_TARGETED_HARM', message: `结构化字段禁止点名受害目标：${fields[0]}` };
  }

  const text = textOfPayload(payload);
  if (!text) return { ok: true };
  // P9 禁止点名伤害「他方」；己方内部代价/危机不应被误判为定向制裁。
  const names = (run.civs || [])
    .filter(c => c && c.id !== seat.civId)
    .flatMap(c => [c.id, c.name, c.short].filter(Boolean).map(x => String(x)));
  const named = names.find(n => n && text.includes(n));
  if (named && HARM_RE.test(text)) {
    return { ok: false, code: 'P9_TARGETED_HARM', message: `神谕不得点名伤害 ${named}` };
  }

  const tier = Number(payload.tier);
  const event = payload.event || payload.payload?.event;
  if (tier >= 4 && event && event.kind === 'disaster') {
    const scope = String(event.scope || 'global');
    if (scope === 'civ' || scope === 'civ_self') {
      return { ok: false, code: 'SCOPE', message: '天灾类神谕必须为 global/system/body，不能指定文明作用域' };
    }
  }
  return { ok: true };
}

function normalizeSubmit(run, seat, raw) {
  const payload = raw && raw.payload && typeof raw.payload === 'object'
    ? Object.assign({}, raw.payload, { tier: raw.tier ?? raw.payload.tier })
    : Object.assign({}, raw || {});
  const tier = Number(payload.tier);
  if (!ORACLE_COSTS[tier]) return { ok: false, code: 'SCHEMA', message: 'tier 必须为 1～5' };
  if (tier === 3 && !['character', 'diplomacy', 'tech'].includes(String(payload.sub || ''))) {
    return { ok: false, code: 'SCHEMA', message: '3 点档必须选择 sub: character | diplomacy | tech' };
  }
  if (payload.civId && payload.civId !== seat.civId) {
    return { ok: false, code: 'SCOPE', message: '神谕只能作用于己方文明' };
  }
  payload.civId = seat.civId;
  return { ok: true, payload, tier, cost: ORACLE_COSTS[tier] };
}

function activeCountFor(run, playerId) {
  return (run.edicts || []).filter(e =>
    e.playerId === playerId && ['paid', 'queued', 'resolving', 'active'].includes(e.status)
  ).length;
}

function oracleStatus(run, token) {
  ensureOracleState(run);
  const seat = findSeatByToken(run, token);
  if (!seat) return { ok: false, status: 404, error: 'NO_SEAT', message: '请先认领文明' };
  const y = Math.floor(Number(run.year) || 0);
  return {
    ok: true,
    seat: publicSeat(seat),
    points: Number(seat.oraclePoints) || 0,
    hardCap: POINTS_HARD_CAP,
    nextPointInYears: nextPointYears(seat, y),
    clock: clockPublic(run),
    queue: (run.edicts || [])
      .filter(e => e.playerId === seat.playerId)
      .slice(0, 20),
    recentLedger: (run.oracleLedger || [])
      .filter(e => !e.seatPlayerId || e.seatPlayerId === seat.playerId)
      .slice(0, 20)
  };
}

function submitOracle(run, token, raw) {
  ensureOracleState(run);
  const seat = findSeatByToken(run, token);
  if (!seat || seat.role === 'spectator' || !seat.civId) {
    return { ok: false, status: 403, error: 'NO_SEAT', message: '请先认领文明' };
  }
  const norm = normalizeSubmit(run, seat, raw || {});
  if (!norm.ok) return { ok: false, status: 422, error: norm.code, message: norm.message };
  const { payload, tier, cost } = norm;
  const dryRun = !!(raw && raw.dryRun);

  const p9 = p9Check(run, seat, payload);
  if (!p9.ok) {
    addLedger(run, {
      kind: 'reject',
      summary: p9.message,
      seatPlayerId: seat.playerId,
      deltaPoints: 0
    });
    return { ok: false, status: 422, error: p9.code, message: p9.message, refunded: true };
  }

  if (!run.flags?.gmFreeOracle && (Number(seat.oraclePoints) || 0) < cost) {
    return { ok: false, status: 402, error: 'FUNDS', message: '神谕点数不足' };
  }
  if (activeCountFor(run, seat.playerId) >= MAX_ACTIVE_PER_PLAYER) {
    return { ok: false, status: 429, error: 'RATE_LIMIT', message: '同时排队/生效的神谕过多' };
  }

  const preview = previewOracle(run, seat, payload);
  if (dryRun) {
    return { ok: true, dryRun: true, cost, pointsLeft: seat.oraclePoints, preview };
  }

  if (!run.flags?.gmFreeOracle) seat.oraclePoints = Math.max(0, (Number(seat.oraclePoints) || 0) - cost);
  const edict = {
    id: newId('edict', run),
    runId: run.id,
    playerId: seat.playerId,
    civId: seat.civId,
    tier,
    sub: payload.sub || null,
    cost,
    payload,
    status: 'paid',
    paidAtYear: Math.floor(Number(run.year) || 0),
    activateAtYear: Math.floor(Number(run.year) || 0),
    createdAt: nowIso(),
    preview
  };
  run.edicts.push(edict);
  addLedger(run, {
    kind: 'spend',
    summary: `提交 ${cost} 点神谕：${preview.title}`,
    seatPlayerId: seat.playerId,
    edictId: edict.id,
    deltaPoints: -cost
  });
  return { ok: true, edictId: edict.id, cost, pointsLeft: seat.oraclePoints, etaYear: edict.activateAtYear, status: edict.status, preview };
}

function previewOracle(run, seat, payload) {
  const tier = Number(payload.tier);
  const title = payload.title || payload.oracleText || payload.note || payload.narrative || payload.seed || `第 ${tier} 档神谕`;
  return {
    title: String(title).slice(0, 80),
    tier,
    sub: payload.sub || null,
    civId: seat.civId,
    summary: `将以 ${seat.civId} 为作用域进入推演 Drain`
  };
}

function refundEdict(run, seat, edict, reason) {
  if (edict.refunded) return;
  seat.oraclePoints = Math.min(POINTS_HARD_CAP, (Number(seat.oraclePoints) || 0) + Number(edict.cost || 0));
  edict.refunded = true;
  addLedger(run, {
    kind: 'refund',
    summary: reason || '神谕退点',
    seatPlayerId: seat.playerId,
    edictId: edict.id,
    deltaPoints: Number(edict.cost || 0)
  });
}

function cancelOracle(run, token, eid) {
  ensureOracleState(run);
  const seat = findSeatByToken(run, token);
  if (!seat) return { ok: false, status: 404, error: 'NO_SEAT' };
  const edict = (run.edicts || []).find(e => e.id === eid);
  if (!edict) return { ok: false, status: 404, error: 'not_found' };
  if (edict.playerId !== seat.playerId && seat.role !== 'owner') {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  if (!['paid', 'queued'].includes(edict.status)) {
    return { ok: false, status: 409, error: 'already_resolving' };
  }
  edict.status = 'cancelled';
  refundEdict(run, seat, edict, '取消未生效神谕');
  addLedger(run, { kind: 'cancel', summary: '取消神谕', seatPlayerId: seat.playerId, edictId: edict.id });
  return { ok: true, cancelled: true, points: seat.oraclePoints };
}

function ledger(run, token) {
  ensureOracleState(run);
  const seat = token ? findSeatByToken(run, token) : null;
  const items = seat && seat.role !== 'owner'
    ? (run.oracleLedger || []).filter(e => !e.seatPlayerId || e.seatPlayerId === seat.playerId)
    : (run.oracleLedger || []);
  return { ok: true, items: items.slice(0, 100) };
}

function findCiv(run, civId) {
  return (run.civs || []).find(c => c.id === civId) || null;
}

function findLeader(civ, characterId) {
  if (!civ) return null;
  if (!characterId) return (civ.leaders || [])[0] || null;
  return (civ.leaders || []).find(l => l.id === characterId) || null;
}

function applyTierPatch(run, edict, patches, events) {
  const payload = edict.payload || {};
  const civ = findCiv(run, edict.civId);
  if (!civ) return { ok: false, reason: 'civ_missing' };
  const tier = Number(edict.tier);
  const title = payload.title || payload.oracleText || payload.narrative || payload.note || `第${tier}档神谕`;
  const summary = String(title).slice(0, 120);

  if (tier === 1) {
    const policyName = payload.policy?.名称 || payload.policyName || payload.policy || summary;
    const policyText = payload.policy?.内容 || payload.policyText || payload.ideology || payload.note || summary;
    const focus = payload.focus || payload.policy?.focus || 'stabilize';
    const v = validateIdeologyPayload({
      policy: { 名称: String(policyName).slice(0, 12), 内容: String(policyText).slice(0, 80), focus },
      思潮: payload.ideology || payload.思潮 || null,
      reason: 'oracle_tier_1'
    });
    if (!v.ok) return { ok: false, reason: v.reason || 'ideology_validate' };
    const cp = applyIdeology(civ, v);
    if (cp) patches.civs = mergeCivPatches(patches.civs || [], [Object.assign(cp, { oracleId: edict.id })]);
    events.push(`神谕改写${civ.name || civ.id}的国策：${cp?.policy?.名称 || policyName}`);
    return { ok: true, summary: `国策/思潮神谕：${summary}` };
  }

  if (tier === 2) {
    const relic = payload.relic || {};
    const name = String(relic.name || payload.name || summary || '无名神物').slice(0, 24);
    civ.relics = Array.isArray(civ.relics) ? civ.relics : [];
    civ.relics.push({
      id: `relic:${edict.id}`,
      name,
      nature: String(relic.nature || payload.nature || '神谕赐物').slice(0, 80),
      mechanicalTags: Array.isArray(relic.mechanicalTags) ? relic.mechanicalTags.slice(0, 5) : [],
      bindTo: relic.bindTo || 'empire',
      createdYear: run.year,
      oracleId: edict.id
    });
    civ.stats = civ.stats || {};
    civ.stats.稳定 = Math.min(99, (Number(civ.stats.稳定) || 30) + 1);
    patches.civs = mergeCivPatches(patches.civs || [], [{ civId: civ.id, relics: civ.relics.slice(), stats: { ...civ.stats }, oracleId: edict.id }]);
    events.push(`神谕赐予${civ.name || civ.id}神物「${name}」`);
    return { ok: true, summary: `神物：${name}` };
  }

  if (tier === 3 && payload.sub === 'character') {
    const leader = findLeader(civ, payload.characterId);
    if (!leader) return { ok: false, reason: 'character_missing' };
    const ops = Array.isArray(payload.ops) ? payload.ops : [];
    ops.forEach(op => {
      if (!op || !op.op) return;
      if (op.op === 'stance') leader.agentStance = String(op.value || '').slice(0, 60);
      if (op.op === 'motive') leader.motive = String(op.value || '').slice(0, 120);
      if (op.op === 'title') leader.title = String(op.value || '').slice(0, 24);
      if (op.op === 'status') {
        leader.agent = leader.agent || { enabled: true };
        leader.agent.status = String(op.value || 'active').slice(0, 20);
      }
      if (op.op === 'ability_nudge' && op.name) {
        leader.abilities = Array.isArray(leader.abilities) ? leader.abilities : [];
        let a = leader.abilities.find(x => x.name === op.name);
        if (!a) { a = { name: String(op.name).slice(0, 12), val: 40 }; leader.abilities.push(a); }
        a.val = Math.max(0, Math.min(99, (Number(a.val) || 40) + Math.max(-8, Math.min(8, Number(op.delta) || 0))));
      }
    });
    patches.characters = patches.characters || [];
    patches.characters.push({ civId: civ.id, characterId: leader.id, leader: { ...leader }, oracleId: edict.id });
    events.push(`神谕拨动${leader.name || leader.id}的命途`);
    return { ok: true, summary: `人物神谕：${leader.name || leader.id}` };
  }

  if (tier === 3 && payload.sub === 'diplomacy') {
    civ.oracleDiplomacy = civ.oracleDiplomacy || [];
    civ.oracleDiplomacy.push({
      intent: payload.stance?.intent || payload.intent || 'custom',
      toward: payload.stance?.toward || payload.toward || 'all',
      publicReason: String(payload.stance?.publicReason || payload.publicReason || summary).slice(0, 120),
      year: run.year,
      oracleId: edict.id
    });
    patches.civs = mergeCivPatches(patches.civs || [], [{ civId: civ.id, oracleDiplomacy: civ.oracleDiplomacy.slice(), oracleId: edict.id }]);
    events.push(`神谕改变${civ.name || civ.id}的外交姿态`);
    return { ok: true, summary: `外交姿态：${summary}` };
  }

  if (tier === 3 && payload.sub === 'tech') {
    const t = ensureTechTree(civ);
    const nodeName = payload.tech?.trackId || payload.trackId || (researchingNodes(civ)[0] && researchingNodes(civ)[0][0]) || (availableResearchNodes(civ)[0] && availableResearchNodes(civ)[0][0]);
    civ.oracleTechFocus = {
      node: nodeName || null,
      mode: payload.tech?.mode || payload.mode || 'accelerate',
      years: Math.max(5, Math.min(50, Number(payload.tech?.years || payload.years) || 10)),
      strength: payload.tech?.strength || payload.strength || '中',
      createdYear: run.year,
      oracleId: edict.id
    };
    if (nodeName && t.节点[nodeName]) {
      t.节点[nodeName].进度 = Math.min(100, (Number(t.节点[nodeName].进度) || 0) + 18);
      if (t.节点[nodeName].状态 === '可研究') t.节点[nodeName].状态 = '研究中';
      patches.tech = patches.tech || [];
      patches.tech.push({ civId: civ.id, node: nodeName, progress: t.节点[nodeName].进度, status: t.节点[nodeName].状态, source: 'oracle_tech', oracleId: edict.id });
    }
    patches.civs = mergeCivPatches(patches.civs || [], [{ civId: civ.id, oracleTechFocus: civ.oracleTechFocus, oracleId: edict.id }]);
    events.push(`神谕偏转${civ.name || civ.id}的科技路线`);
    return { ok: true, summary: `科技神谕：${nodeName || '新研究方向'}` };
  }

  if (tier === 4) {
    const event = payload.event || {};
    const kind = event.kind || payload.kind || 'omen';
    const intensity = event.intensity || payload.intensity || '中';
    const title = event.title || payload.title || summary;
    const global = kind === 'disaster' || event.scope === 'global';
    if (global) {
      (run.civs || []).forEach(c => {
        c.stats = c.stats || {};
        const stable = Number(c.stats.稳定) || 30;
        const hit = stable < 35 || intensity === '高';
        if (hit) c.stats.稳定 = Math.max(0, stable - (intensity === '高' ? 3 : 1));
        patches.civs = mergeCivPatches(patches.civs || [], [{ civId: c.id, stats: { ...c.stats }, oracleEvent: title, oracleId: edict.id }]);
      });
      events.push(`全域神谕事件「${String(title).slice(0, 60)}」波及诸文明`);
    } else {
      civ.oracleEvents = civ.oracleEvents || [];
      civ.oracleEvents.push({ title, kind, intensity, year: run.year, oracleId: edict.id });
      patches.civs = mergeCivPatches(patches.civs || [], [{ civId: civ.id, oracleEvents: civ.oracleEvents.slice(), oracleId: edict.id }]);
      events.push(`神谕事件「${String(title).slice(0, 60)}」降临${civ.name || civ.id}`);
    }
    return { ok: true, summary: `事件神谕：${title}` };
  }

  if (tier === 5) {
    civ.oracleMandates = civ.oracleMandates || [];
    civ.oracleMandates.push({
      text: String(payload.oracleText || payload.narrative || summary).slice(0, 240),
      goals: Array.isArray(payload.structuredIntent?.goals) ? payload.structuredIntent.goals.slice(0, 5) : [],
      immediate: !!payload.structuredIntent?.immediate,
      year: run.year,
      oracleId: edict.id
    });
    civ.stats = civ.stats || {};
    civ.stats.稳定 = Math.min(99, (Number(civ.stats.稳定) || 30) + 2);
    patches.civs = mergeCivPatches(patches.civs || [], [{ civId: civ.id, oracleMandates: civ.oracleMandates.slice(), stats: { ...civ.stats }, oracleId: edict.id }]);
    events.push(`命运级神谕降临${civ.name || civ.id}：${summary}`);
    return { ok: true, summary: `命运神谕：${summary}` };
  }

  return { ok: false, reason: 'unsupported_tier' };
}

/**
 * Drain 已支付神谕，应用 ForcedPatch。deduce 开头调用。
 */
function drainEdicts(run) {
  ensureOracleState(run);
  const patches = { civs: [], characters: [], tech: [], relations: [], oracle: [] };
  const events = [];
  const due = (run.edicts || []).filter(e => ['paid', 'queued'].includes(e.status) && Number(e.activateAtYear || 0) <= Number(run.year || 0));
  due.forEach(edict => {
    edict.status = 'resolving';
    const r = applyTierPatch(run, edict, patches, events);
    if (!r.ok) {
      edict.status = 'rejected';
      edict.rejectCode = r.reason || 'APPLY_FAILED';
      const seat = (run.seats || []).find(s => s.playerId === edict.playerId);
      if (seat) refundEdict(run, seat, edict, `神谕生效失败：${edict.rejectCode}`);
      addLedger(run, { kind: 'reject', summary: edict.rejectCode, seatPlayerId: edict.playerId, edictId: edict.id });
      return;
    }
    edict.status = 'completed';
    edict.completeAtYear = run.year;
    edict.resultSummary = r.summary;
    patches.oracle.push({ edictId: edict.id, civId: edict.civId, tier: edict.tier, summary: r.summary });
    addLedger(run, { kind: 'apply', summary: r.summary, seatPlayerId: edict.playerId, edictId: edict.id });
  });
  return { patches, events };
}

export {
  ORACLE_COSTS,
  MAX_ACTIVE_PER_PLAYER,
  ensureOracleState,
  oracleStatus,
  submitOracle,
  cancelOracle,
  ledger,
  p9Check,
  drainEdicts
};
