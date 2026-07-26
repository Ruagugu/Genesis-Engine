/* ============================================================
   创世引擎 · 创世之初（阶段 E）
   创建玩家文明（规则模板兜底 + 可选 LLM 补全）与盖亚落地存证。
   地块归属仍为客户端权威（territory.js 契约）；服务端存
   territorySeed / capitalSeeds，供快照与推演意图使用。
   ============================================================ */
import { chat as llmChat, parseJsonLoose, llmConfigured } from './llm-provider.mjs';
import * as llmLog from './llm-log.mjs';
import * as llmSettings from './llm-settings.mjs';
import * as seatService from './seat-service.mjs';

const CIV_LIMIT = 12;
const GAIYA_SURFACE_ID = 'gaiya:surface';

/* ---------- 确定性伪随机（同名同结果，便于测试与重建） ---------- */
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 气质模板 ---------- */
const TEMPERAMENTS = {
  尚武: {
    social: '猎团', policy: '磨石为刃', policyText: '打制更锋利的石器，操练猎队，守住猎场边界。',
    idea: '强者活到下一个日出。', trait: '争胜本能 · 体魄 · 猎场秩序',
    plan: '组建第一支常备猎队，立起部族图腾。', thought: '力量崇拜——相信搏斗与狩猎是与世界对话的方式。',
    leaderTitle: '猎团首领', stance: '扩猎备战 / 先发制人',
    stats: { 人口: 1, 军力: 8, 经济: 2, 稳定: 22, 科研: 1, 扩张: 10 },
    abilityBias: { 军事: 14, 战略: 8, 意志: 6 }
  },
  求知: {
    social: '观星者营地', policy: '记下星轨', policyText: '观察日月星辰与草木枯荣，用刻痕记录规律。',
    idea: '看懂世界的人才能走得更远。', trait: '好奇 · 观察 · 口传知识',
    plan: '建立第一处观星台，形成可传承的记事刻痕。', thought: '天象敬畏——相信星空藏着世界的答案。',
    leaderTitle: '观星者', stance: '谨慎观察 / 积累知识',
    stats: { 人口: 1, 军力: 3, 经济: 3, 稳定: 26, 科研: 5, 扩张: 5 },
    abilityBias: { 学识: 14, 创造: 8, 意志: 4 }
  },
  重商: {
    social: '行贩队', policy: '以物易物', policyText: '带着贝壳、燧石与盐沿途交换，结识更多营地。',
    idea: '交换让两个营地都过冬。', trait: '交换直觉 · 健谈 · 记账萌芽',
    plan: '踏出第一条稳定的交换路线。', thought: '往来互惠——相信陌生人也可以是明日的伙伴。',
    leaderTitle: '行商头人', stance: '广结善缘 / 互通有无',
    stats: { 人口: 1, 军力: 3, 经济: 6, 稳定: 24, 科研: 2, 扩张: 7 },
    abilityBias: { 外交: 14, 魅力: 8, 学识: 4 }
  },
  守序: {
    social: '围栏营地', policy: '立规矩', policyText: '划定营地边界，约定分食与守夜的规矩。',
    idea: '规矩立起来，营地才立得住。', trait: '纪律 · 分工 · 稳健',
    plan: '筑起第一圈围栏，定下第一批部规。', thought: '秩序信念——相信约定俗成能抵御混乱。',
    leaderTitle: '营地议首', stance: '固守营地 / 缓步扩张',
    stats: { 人口: 1, 军力: 4, 经济: 4, 稳定: 34, 科研: 2, 扩张: 4 },
    abilityBias: { 战略: 10, 意志: 10, 外交: 6 }
  },
  灵性: {
    social: '祭火氏族', policy: '守圣火', policyText: '守护部族圣火，聆听风声与梦境的启示。',
    idea: '看不见的力量决定看得见的命运。', trait: '灵能微感 · 仪式 · 内省',
    plan: '立起第一座祭坛，形成部族的共同仪式。', thought: '万灵低语——相信山川草木皆有回应。',
    leaderTitle: '祭火者', stance: '敬天守灵 / 避险内修',
    stats: { 人口: 1, 军力: 3, 经济: 2, 稳定: 28, 科研: 3, 扩张: 4 },
    abilityBias: { 意志: 12, 魅力: 8, 学识: 6 }
  },
  均衡: {
    social: '游群', policy: '安身立命', policyText: '寻找水源与庇护所，让族人先活下来。',
    idea: '先活下来，再谈明天。', trait: '适应力 · 协作萌芽 · 务实',
    plan: '找到可长期停留的营地，稳定食物来源。', thought: '生存本能——对自然保持朴素的敬畏与好奇。',
    leaderTitle: '族长', stance: '稳健求存 / 相机而动',
    stats: { 人口: 1, 军力: 4, 经济: 3, 稳定: 28, 科研: 2, 扩张: 6 },
    abilityBias: { 战略: 8, 意志: 8, 外交: 6 }
  }
};

const LEADER_NAMES = ['岩声', '洛河', '青芜', '烬羽', '苍梧', '汐岚', '砾风', '晗光', '墨潮', '星阑'];
const DIM_DEFS = [
  { k: '亲疏', a: '亲', b: '疏' },
  { k: '显隐', a: '显', b: '隐' },
  { k: '急缓', a: '急', b: '缓' },
  { k: '刚柔', a: '刚', b: '柔' },
  { k: '执逸', a: '执', b: '逸' }
];
const ABILITY_NAMES = ['战略', '军事', '外交', '学识', '意志', '魅力', '创造'];

function personalityFrom(rand) {
  const dims = DIM_DEFS.map(d => ({ ...d, v: 10 + Math.floor(rand() * 80) }));
  const 注 = dims.map(d => (d.v >= 50 ? d.b : d.a)).join(' · ');
  const code = dims.map(d => String.fromCharCode(97 + Math.floor(rand() * 26))).join('');
  const stability = rand() < 0.4 ? 'S' : rand() < 0.7 ? 'A' : 'B';
  return { code, stability, 注, dims };
}

function abilitiesFrom(rand, bias) {
  return ABILITY_NAMES
    .map(name => ({ name, base: 6 + Math.floor(rand() * 14) + (bias[name] || 0) }))
    .sort((x, y) => y.base - x.base)
    .slice(0, 5)
    .map(a => ({ name: a.name, val: Math.max(1, Math.min(40, a.base)) }));
}

/* ---------- 领袖 Agent 状态块（与 data.world.js 创世重置同构） ---------- */
function agentStateBlocks(run, civId) {
  const year = Math.max(1, Math.floor(Number(run.year) || 1));
  const postureByCiv = {};
  (run.civs || []).forEach(c => {
    if (c.id && c.id !== civId) postureByCiv[c.id] = 'neutral';
  });
  return {
    agentMemory: { version: 1, episodic: [], semantic: {}, relationMemory: {}, legacy: [], updatedYear: year },
    agentGoals: { active: [], completed: [], abandoned: [], updatedYear: year },
    agentActions: { lastAction: null, cooldowns: {}, history: [], updatedYear: year },
    agentConstraints: { reserves: {}, deficits: [], blockedActions: [], riskTolerance: 0.5 },
    agentDiplomacy: { postureByCiv, treaties: [], grievances: [] }
  };
}

function nextCivId(run) {
  let seq = 1;
  const ids = new Set((run.civs || []).map(c => c.id));
  while (ids.has('pc-' + seq)) seq += 1;
  return 'pc-' + seq;
}

function normalizeColor(color, rand) {
  const c = String(color || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  const palette = ['#e35d6a', '#5dade2', '#58d68d', '#f4d03f', '#af7ac5', '#e59866', '#48c9b0', '#ec7063'];
  return palette[Math.floor(rand() * palette.length)];
}

/**
 * 创建玩家文明（规则模板；LLM 补全由 enrichCivWithLlm 异步跟进）
 * @returns {{ ok, status?, error?, message?, civ?, seat? }}
 */
function createCiv(run, user, body) {
  body = body || {};
  const name = String(body.name || '').trim();
  if (!name || name.length > 24) {
    return { ok: false, status: 400, error: 'invalid_name', message: '文明名称须 1～24 字' };
  }
  if ((run.civs || []).some(c => c.name === name || c.short === name)) {
    return { ok: false, status: 409, error: 'name_taken', message: '该文明名已存在' };
  }
  if ((run.civs || []).length >= CIV_LIMIT) {
    return { ok: false, status: 409, error: 'civ_limit', message: `本局文明数已达上限 ${CIV_LIMIT}` };
  }
  const existing = seatService.findSeatByToken(run, user.token);
  if (existing && existing.civId) {
    return { ok: false, status: 409, error: 'already_bound', message: '你已绑定文明，本局不可再创建' };
  }

  const rand = mulberry(hashSeed(run.id + '|' + name));
  const tKey = TEMPERAMENTS[body.temperament] ? body.temperament : '均衡';
  const t = TEMPERAMENTS[tKey];
  const short = String(body.short || '').trim().slice(0, 4) || name.slice(0, 2);
  const race = String(body.race || '').trim().slice(0, 12) || '人族';
  const origin = String(body.origin || '').trim().slice(0, 120)
    || `创世初年在盖亚醒来的${race}族群，以${t.social}形态维系生存。`;
  const leaderName = String(body.leaderName || '').trim().slice(0, 12)
    || LEADER_NAMES[Math.floor(rand() * LEADER_NAMES.length)];

  const civId = nextCivId(run);
  const year = Math.max(1, Math.floor(Number(run.year) || 1));
  const leaderAge = 18 + Math.floor(rand() * 25);
  const leader = {
    id: civId + '-l1',
    name: leaderName,
    title: t.leaderTitle,
    role: '领袖',
    gender: rand() < 0.5 ? '女' : '男',
    race,
    age: leaderAge,
    lifespanMax: 70 + Math.floor(rand() * 30),
    birthYear: year - leaderAge,
    lastAgedYear: year,
    bodyState: '康健 · 创世初年',
    personality: personalityFrom(rand),
    abilities: abilitiesFrom(rand, t.abilityBias),
    background: origin,
    motive: t.plan,
    isAgent: true,
    agent: { enabled: true, status: 'active' },
    agentModel: 'GE-Agent · 创世种子 v1',
    agentStance: t.stance,
    succession: {
      rule: 'council', leaderId: civId + '-l1', generation: 1,
      heirs: [], regency: null, history: [], startedYear: year
    },
    ...agentStateBlocks(run, civId)
  };

  const civ = {
    id: civId,
    name,
    short,
    color: normalizeColor(body.color, rand),
    level: 0,
    stage: '原始',
    capital: '未定居',
    文明阶段: '原始',
    社会形态: t.social,
    起源: origin,
    政体及运作: `无成文制度，由${t.leaderTitle}与族中长者临时共议。`,
    思潮: t.thought,
    领袖及性格: `${leaderName} · ${t.leaderTitle}，${leader.personality.注}。`,
    目前国策: { 名称: t.policy, 内容: t.policyText, 持续年数: 0 },
    国民理念: t.idea,
    军事与人口: '人口不足千，仅有简陋石器与守夜之火。',
    文明特质: t.trait,
    发展计划: t.plan,
    科技树: { 文明等级: 0, 下一阶段: 0, 节点: {} },
    stats: { ...t.stats },
    leaders: [leader],
    territorySeed: null,
    orbital: { satellites: 0, station: null, ships: 0 },
    playerCreated: true,
    createdBy: user.username,
    createdAtYear: year
  };

  run.civs.push(civ);

  // 门槛表补该文明（与创世重置的 status 结构一致）
  (run.thresholds || []).forEach((th, index) => {
    if (th && th.status && typeof th.status === 'object') {
      th.status[civId] = index === 0 ? 'open' : 'locked';
    }
  });

  // 创世收藏夹：注视新领袖
  if (Array.isArray(run.favorites)) {
    run.favorites.push({
      id: leader.id,
      name: leader.name,
      civ: civId,
      civId,
      种族与身份: `${race} · ${name} · ${leader.title}`,
      超凡能力: leader.abilities.slice(0, 2).map(a => `${a.name} ${a.val}`).join(' · ') || '未显化',
      寿命与年龄: `${leader.age}岁 / 预期${leader.lifespanMax}岁`,
      性格与动机: leader.motive,
      近况: '创世初年，命运未启',
      age: leader.age,
      race,
      title: leader.title
    });
  }

  // 自动认领席位（displayName = 用户名）
  const claim = seatService.claimSeat(run, {
    playerToken: user.token,
    civId,
    displayName: user.username
  });
  if (!claim.ok) {
    // 席位失败则回滚文明，避免出现无主可绑文明
    run.civs = run.civs.filter(c => c.id !== civId);
    return { ok: false, status: claim.status || 500, error: claim.error || 'seat_failed', message: claim.message };
  }

  run.revision = (Number(run.revision) || 0) + 1;
  return { ok: true, status: 201, civ, seat: claim.seat, temperament: tKey };
}

/* ---------- LLM 补全（失败静默保留规则模板） ---------- */
const ENRICH_FIELDS = ['思潮', '国民理念', '文明特质', '起源', '政体及运作', '发展计划', '军事与人口'];

async function enrichCivWithLlm(run, civ) {
  const s = llmSettings.get();
  if (!s.enabled || !llmConfigured(s)) return { ok: false, reason: 'llm_not_configured' };
  const leader = (civ.leaders || [])[0];
  const system = [
    '你是创世引擎的文明设计师。玩家刚创建了一个原始时代（等级0）文明，请润色其文案。',
    '硬约束：',
    '- 只输出一个 JSON，不要 markdown',
    '- 保持原始时代口径：无国家、无金属冶炼、无文字成体系；禁止出现帝国/科技/舰队等越级词',
    '- 各字段 12～60 字；leaderBackground/leaderMotive 20～80 字',
    '- 不得更改文明名称、种族、领袖姓名',
    'JSON schema:',
    `{${ENRICH_FIELDS.map(f => `"${f}":""`).join(',')},"leaderBackground":"","leaderMotive":""}`
  ].join('\n');
  const user = JSON.stringify({
    civ: {
      name: civ.name, race: leader?.race, 气质: civ.文明特质,
      起源: civ.起源, 思潮: civ.思潮, 国民理念: civ.国民理念,
      发展计划: civ.发展计划
    },
    leader: leader ? { name: leader.name, title: leader.title, 性格: leader.personality?.注 } : null
  });

  const result = await llmChat(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, temperature: 0.8, timeoutMs: s.timeoutMs }
  );
  llmLog.record({
    runId: run.id,
    round: null,
    purpose: 'civ_genesis',
    model: s.model,
    characterId: leader?.id || null,
    characterName: civ.name,
    ok: !!result.ok,
    ms: result.ms,
    error: result.error || null,
    promptPreview: user.slice(0, 500),
    systemPreview: system.slice(0, 400),
    content: result.content || null
  });
  if (!result.ok) return { ok: false, reason: result.error };

  const parsed = parseJsonLoose(result.content);
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'parse_fail' };

  let applied = 0;
  const fields = {};
  const leaderFields = {};
  ENRICH_FIELDS.forEach(f => {
    const v = String(parsed[f] || '').trim();
    if (v && v.length >= 6 && v.length <= 120) { civ[f] = v; fields[f] = v; applied += 1; }
  });
  if (leader) {
    const bg = String(parsed.leaderBackground || '').trim();
    const mv = String(parsed.leaderMotive || '').trim();
    if (bg && bg.length >= 10 && bg.length <= 160) { leader.background = bg; leaderFields.background = bg; applied += 1; }
    if (mv && mv.length >= 6 && mv.length <= 120) { leader.motive = mv; leaderFields.motive = mv; applied += 1; }
  }
  if (applied > 0) run.revision = (Number(run.revision) || 0) + 1;
  return { ok: true, applied, fields, leaderFields };
}

/**
 * 盖亚落地存证：写 territorySeed / capitalSeeds / 编年
 * @returns {{ ok, status?, error?, civId?, capital?, revision? }}
 */
function settleCiv(run, user, civId, body) {
  body = body || {};
  const seat = seatService.findSeatByToken(run, user.token);
  if (!seat || seat.civId !== civId) {
    return { ok: false, status: 403, error: 'not_your_civ', message: '只能为自己绑定的文明落地' };
  }
  const civ = (run.civs || []).find(c => c.id === civId);
  if (!civ) return { ok: false, status: 404, error: 'civ_not_found' };
  if (civ.territorySeed && Number.isFinite(Number(civ.territorySeed.lat))) {
    return { ok: false, status: 409, error: 'already_settled', message: '该文明已经落地，不可迁移（MVP）' };
  }
  const surfaceId = String(body.surfaceId || '').trim();
  if (surfaceId !== GAIYA_SURFACE_ID) {
    return { ok: false, status: 422, error: 'surface_not_allowed', message: '阶段 E 仅支持盖亚落地' };
  }
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { ok: false, status: 400, error: 'invalid_latlon' };
  }
  const tileId = String(body.tileId || '').trim().slice(0, 32) || null;

  const year = Math.max(1, Math.floor(Number(run.year) || 1));
  civ.territorySeed = { lat, lon, weight: 1 };
  const capital = `${civ.short || civ.name}·初火营地`;
  civ.capital = capital;
  civ.landing = { surfaceId, tileId, lat, lon, year };

  // capitalSeeds / claimRadius：写 strategicMap 与 gaiya 表面（run 内为两份克隆）
  [run.strategicMap, run.bodySurfaces && run.bodySurfaces[GAIYA_SURFACE_ID]].forEach(def => {
    if (!def || typeof def !== 'object') return;
    if (!def.capitalSeeds || typeof def.capitalSeeds !== 'object') def.capitalSeeds = {};
    if (!def.claimRadius || typeof def.claimRadius !== 'object') def.claimRadius = {};
    def.capitalSeeds[civ.id] = { lat, lon };
    def.claimRadius[civ.id] = 4;
  });

  const leader = (civ.leaders || [])[0];
  if (Array.isArray(run.chronicle)) {
    run.chronicle.unshift({
      年份: `第1纪元 · ${year}年`,
      纪元: (run.era && run.era.纪元) || '奇迹纪元',
      类型: '落地',
      事件: `${leader ? leader.name : civ.name}率${civ.name}先民落地建居，立${capital}。`,
      事件概述: `${civ.name}于盖亚选定落地之地，${capital}燃起第一堆火。`
    });
  }

  run.revision = (Number(run.revision) || 0) + 1;
  return { ok: true, status: 200, civId, capital, tileId, landing: civ.landing, revision: run.revision };
}

export {
  CIV_LIMIT,
  GAIYA_SURFACE_ID,
  TEMPERAMENTS,
  createCiv,
  enrichCivWithLlm,
  settleCiv
};
