/* ============================================================
   创世引擎 · 科技树 / 思潮·国策 机制层（阶段 C）
   - 内容（节点名、描述、国策文案、思潮句子）由 LLM 设计
   - 本模块只做：schema 校验、进度结算、能力门槛、决策权重读取
   - rules_only：不调用 LLM；树空则空，仅推进已有「研究中」节点
   ============================================================ */

const TECH_STATUSES = new Set(['锁定', '可研究', '研究中', '已解锁']);
const POLICY_FOCUS = new Set([
  'research', 'explore', 'expand', 'stabilize', 'military', 'faith', 'trade'
]);
const TAG_WHITELIST = new Set([
  'sky', 'land', 'spirit', 'craft', 'war', 'order',
  'memory', 'tools', 'fire', 'camp', 'water', 'orbit_craft',
  'farm', 'metal', 'writing', 'energy', 'shield', 'drive'
]);
const CAPABILITY_KEYS = new Set([
  'sky_lore', 'tools', 'fire', 'camp', 'memory', 'water',
  'orbit_craft', 'metal', 'writing', 'energy', 'shield', 'drive'
]);

/** 原始纪元禁止直接设计的词（seed / lv0-1） */
const ERA_BLACKLIST_RE = /聚变|曲速|虫洞|戴森|星链|等离子|轨道站|亚光速|超光速|量子|纳米机|戴森球/;

const STAGE_BY_LEVEL = {
  0: '原始',
  1: '部落',
  2: '初星际',
  3: '星际文明',
  4: '跨星系',
  5: '星系帝国'
};

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function ensureTechTree(civ) {
  if (!civ) return null;
  if (!civ.科技树 || typeof civ.科技树 !== 'object') {
    civ.科技树 = { 文明等级: Number(civ.level) || 0, 下一阶段: 0, 节点: {} };
  }
  const t = civ.科技树;
  if (t.文明等级 == null) t.文明等级 = Number(civ.level) || 0;
  if (t.下一阶段 == null) t.下一阶段 = 0;
  if (!t.节点 || typeof t.节点 !== 'object') t.节点 = {};
  if (!Array.isArray(civ.capabilities)) {
    // 从已解锁节点重建（不经 nodeEntries，避免与 ensure 递归）
    civ.capabilities = collectCapabilitiesFromNodes(t.节点);
  }
  return t;
}

function nodeEntries(civ) {
  const t = ensureTechTree(civ);
  return Object.entries(t.节点 || {});
}

function collectCapabilitiesFromNodes(nodes) {
  const caps = new Set();
  Object.values(nodes || {}).forEach(n => {
    if (!n || n.状态 !== '已解锁') return;
    (n.tags || []).forEach(tag => {
      if (CAPABILITY_KEYS.has(tag)) caps.add(tag);
    });
    (n.unlockEffects || []).forEach(e => {
      if (e && e.type === 'capability' && e.key) caps.add(String(e.key));
    });
  });
  return Array.from(caps);
}

function collectCapabilities(civ) {
  const t = ensureTechTree(civ);
  return collectCapabilitiesFromNodes(t && t.节点);
}

function civHasCapability(civ, key) {
  ensureTechTree(civ);
  const caps = civ.capabilities || collectCapabilities(civ);
  return caps.includes(key);
}

function unlockedTags(civ) {
  const tags = new Set();
  nodeEntries(civ).forEach(([, n]) => {
    if (n && n.状态 === '已解锁') (n.tags || []).forEach(t => tags.add(t));
  });
  return tags;
}

function researchingNodes(civ) {
  return nodeEntries(civ).filter(([, n]) => n && n.状态 === '研究中');
}

function availableResearchNodes(civ) {
  return nodeEntries(civ).filter(([, n]) => n && n.状态 === '可研究');
}

function techTreeEmpty(civ) {
  const t = ensureTechTree(civ);
  return !t.节点 || Object.keys(t.节点).length === 0;
}

/** 从现有文案粗提取 focus（机制用，不生成文案） */
function policyFocusOf(civ) {
  const p = civ && civ.目前国策;
  if (p && p.focus && POLICY_FOCUS.has(p.focus)) return p.focus;
  const text = p
    ? `${p.名称 || ''} ${p.内容 || ''}`
    : '';
  if (/探测|星|远方|深空|观星/.test(text)) return 'explore';
  if (/科研|研究|知识|试车|技术/.test(text)) return 'research';
  if (/扩张|迁徙|营地|拓|领地/.test(text)) return 'expand';
  if (/军|戒备|猎|战|矛/.test(text)) return 'military';
  if (/祭|潮|灵|预兆|神/.test(text)) return 'faith';
  if (/贸|换|商/.test(text)) return 'trade';
  if (/守|稳|火|保存|根基|巩固/.test(text)) return 'stabilize';
  return 'stabilize';
}

/**
 * 决策 kind 权重：读国策 focus + 已解锁 tags（内容仍是 LLM 写的，这里只读结构）
 * @returns {number} 0.5 ~ 1.5
 */
function ideologyBiasForKind(civ, kind) {
  const focus = policyFocusOf(civ);
  const tags = unlockedTags(civ);
  // 无树时用思潮原文关键词作弱信号（不写回）
  const blob = `${civ?.思潮 || ''} ${civ?.国民理念 || ''} ${civ?.文明特质 || ''}`;
  const soft = {
    sky: /星|光|远方|深空|逐光|潮汐天/.test(blob),
    land: /大地|平原|水源|守土|林|山/.test(blob),
    spirit: /灵|有灵|潮|预兆|神/.test(blob),
    craft: /石|火|锤|工|熔|技/.test(blob),
    war: /争|兽|武|矛|戒备|猎/.test(blob)
  };

  let score = 1;
  const k = String(kind || '');
  const isExplore = /^explore\.|galaxy\.probe/.test(k);
  const isStation = k === 'station.build' || k === 'facility.deploy';

  if (focus === 'research' && k === 'research') score *= 1.32;
  if (focus === 'explore' && isExplore) score *= 1.35;
  if (focus === 'expand' && (k === 'policy' || isExplore)) score *= 1.2;
  if (focus === 'military' && k === 'military') score *= 1.35;
  if (focus === 'stabilize' && (k === 'policy' || k === 'faith')) score *= 1.2;
  if (focus === 'faith' && k === 'faith') score *= 1.35;
  if (focus === 'trade' && k === 'trade') score *= 1.3;
  if (focus === 'land' /* noop */) { /* */ }

  if (tags.has('sky') || soft.sky) {
    if (isExplore) score *= 1.22;
    if (k === 'research') score *= 1.08;
    if (isStation) score *= 1.1;
  }
  if (tags.has('land') || soft.land) {
    // 略压远距，不抹掉邻域 explore.system
    if (k === 'galaxy.probe') score *= 0.8;
    else if (isExplore) score *= 0.92;
    if (k === 'policy' || k === 'military') score *= 1.12;
  }
  if (tags.has('spirit') || soft.spirit) {
    if (k === 'faith') score *= 1.28;
    if (isExplore) score *= 1.1;
  }
  if (tags.has('craft') || soft.craft) {
    if (k === 'research') score *= 1.2;
    if (k === 'trade') score *= 1.08;
  }
  if (tags.has('war') || soft.war) {
    if (k === 'military') score *= 1.28;
  }

  return clamp(score, 0.5, 1.55);
}

/** 无对应能力时压低 / 后续 action 层再 block */
function techReadinessForKind(civ, kind) {
  const k = String(kind || '');
  const level = Number(ensureTechTree(civ).文明等级) || 0;
  // 建站/设施：原始时代硬门槛（action 层也会 block）
  if (k === 'station.build' || k === 'facility.deploy') {
    if (level < 1 && !civHasCapability(civ, 'orbit_craft')) return 0.12;
    if (!civHasCapability(civ, 'orbit_craft') && level < 2) return 0.35;
  }
  // 探测：蒙昧期压低远距扩图权重（worldBuilder 也会把 local 降为本系勘察）
  // 有 sky_lore / 等级≥1 后才鼓励邻域 explore.system
  if (k === 'galaxy.probe' && level < 1 && !civHasCapability(civ, 'sky_lore')) {
    return 0.35;
  }
  if (k === 'explore.system' && level < 1 && !civHasCapability(civ, 'sky_lore')) {
    return 0.55;
  }
  if (k === 'explore.body' && level < 1) {
    return 1.05;
  }
  if (k === 'research' && techTreeEmpty(civ)) {
    // 空树：仍允许 research 意图，但无节点可推进（等 hybrid design）
    return 0.9;
  }
  return 1;
}

function abilityOf(char, name, fallback) {
  const a = (char?.abilities || []).find(x => x.name === name);
  return a ? Number(a.val) || fallback : fallback;
}

function sanitizeNodeName(name) {
  return String(name || '').trim().replace(/\s+/g, '').slice(0, 12);
}

function validateTechNode(raw, civ, batchNames, opts) {
  opts = opts || {};
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not_object' };
  const name = sanitizeNodeName(raw.name);
  if (name.length < 2) return { ok: false, reason: 'name_short' };
  if (name.length > 12) return { ok: false, reason: 'name_long' };
  const existing = ensureTechTree(civ).节点 || {};
  if (existing[name] && !opts.allowUpdate) return { ok: false, reason: 'name_dup_existing' };
  if (batchNames.has(name)) return { ok: false, reason: 'name_dup_batch' };

  const level = Number(ensureTechTree(civ).文明等级) || 0;
  let 层级 = Number(raw.层级);
  if (!Number.isFinite(层级)) 层级 = Math.min(level, 3);
  层级 = clamp(层级, 0, 3);
  if (层级 > level + 1) return { ok: false, reason: 'tier_too_high' };

  const 描述 = String(raw.描述 || raw.desc || '').trim().slice(0, 48);
  if (描述.length < 4) return { ok: false, reason: 'desc_short' };

  if (level <= 1 || opts.eraStrict) {
    if (ERA_BLACKLIST_RE.test(name) || ERA_BLACKLIST_RE.test(描述)) {
      return { ok: false, reason: 'era_blacklist' };
    }
  }

  let 前置 = raw.前置 == null || raw.前置 === '' ? '无' : String(raw.前置).trim();
  if (前置 !== '无') {
    前置 = sanitizeNodeName(前置);
    const preOk = existing[前置] || batchNames.has(前置);
    if (!preOk) return { ok: false, reason: 'prereq_missing' };
  }

  let 状态 = String(raw.状态 || '可研究').trim();
  if (!TECH_STATUSES.has(状态)) 状态 = '可研究';
  // 禁止 LLM 直接批量已解锁（seed 仅允许最多 bornUnlocked 个）
  if (状态 === '已解锁' && !opts.allowUnlocked) {
    状态 = '可研究';
  }
  if (状态 === '研究中' && !opts.allowResearching) {
    // seed 时允许 1 个研究中
    if (!opts.allowOneResearching) 状态 = '可研究';
  }

  let 进度 = Number(raw.进度);
  if (!Number.isFinite(进度)) 进度 = 状态 === '已解锁' ? 100 : 0;
  进度 = clamp(进度, 0, 100);
  if (状态 === '已解锁') 进度 = 100;
  if (状态 === '锁定' || 状态 === '可研究') 进度 = Math.min(进度, 0);

  const tags = [];
  (Array.isArray(raw.tags) ? raw.tags : []).forEach(t => {
    const key = String(t || '').trim().toLowerCase();
    if (TAG_WHITELIST.has(key) && !tags.includes(key)) tags.push(key);
  });

  const unlockEffects = [];
  (Array.isArray(raw.unlockEffects) ? raw.unlockEffects : []).forEach(e => {
    if (!e || typeof e !== 'object') return;
    if (e.type === 'stat' && e.key) {
      const key = String(e.key);
      const allowedStats = ['人口', '军力', '经济', '稳定', '科研', '扩张'];
      if (!allowedStats.includes(key)) return;
      unlockEffects.push({
        type: 'stat',
        key,
        delta: clamp(e.delta, -5, 8)
      });
    } else if (e.type === 'capability' && e.key) {
      const key = String(e.key).trim();
      if (CAPABILITY_KEYS.has(key) || TAG_WHITELIST.has(key)) {
        unlockEffects.push({ type: 'capability', key });
      }
    } else if (e.type === 'rename_capital' && e.value) {
      unlockEffects.push({
        type: 'rename_capital',
        value: String(e.value).trim().slice(0, 16)
      });
    }
  });

  return {
    ok: true,
    node: {
      name,
      层级,
      描述,
      前置,
      状态,
      进度,
      迭代: String(raw.迭代 || '').slice(0, 16) || undefined,
      tags,
      unlockEffects,
      source: opts.source || 'llm'
    }
  };
}

/**
 * 校验 LLM 科技设计包并返回可写入节点
 * @param {object} payload
 * @param {object} civ
 * @param {{ task?: string, maxNewNodes?: number }} opts
 */
function validateTechDesignPayload(payload, civ, opts) {
  opts = opts || {};
  const maxNew = Math.max(1, Math.min(Number(opts.maxNewNodes) || 5, 8));
  const task = opts.task || 'seed';
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'empty_payload', nodes: [], rejected: [] };
  }
  const list = Array.isArray(payload.nodes) ? payload.nodes : [];
  if (!list.length) {
    return { ok: false, reason: 'no_nodes', nodes: [], rejected: [] };
  }

  const batchNames = new Set();
  const accepted = [];
  const rejected = [];
  let researchingGranted = 0;
  let unlockedGranted = 0;

  for (const raw of list.slice(0, maxNew + 2)) {
    const allowOneResearching = task === 'seed' && researchingGranted < 1;
    const allowUnlocked = task === 'seed' && unlockedGranted < 1; // seed 最多 1 个先天解锁
    const v = validateTechNode(raw, civ, batchNames, {
      allowOneResearching,
      allowResearching: allowOneResearching || task === 'open_research',
      allowUnlocked,
      eraStrict: (Number(ensureTechTree(civ).文明等级) || 0) <= 1,
      source: 'llm'
    });
    if (!v.ok) {
      rejected.push({ name: raw && raw.name, reason: v.reason });
      continue;
    }
    if (v.node.状态 === '研究中') researchingGranted += 1;
    if (v.node.状态 === '已解锁') unlockedGranted += 1;
    batchNames.add(v.node.name);
    accepted.push(v.node);
    if (accepted.length >= maxNew) break;
  }

  // 前置二次校验（批内顺序）
  const existing = { ...(ensureTechTree(civ).节点 || {}) };
  const final = [];
  const finalNames = new Set(Object.keys(existing));
  accepted.forEach(n => {
    if (n.前置 !== '无' && !finalNames.has(n.前置) && !existing[n.前置]) {
      // 批内前序
      if (!final.some(x => x.name === n.前置)) {
        rejected.push({ name: n.name, reason: 'prereq_order' });
        return;
      }
    }
    final.push(n);
    finalNames.add(n.name);
  });

  let startResearch = payload.startResearch ? sanitizeNodeName(payload.startResearch) : null;
  if (startResearch && !final.some(n => n.name === startResearch) && !existing[startResearch]) {
    startResearch = null;
  }

  return {
    ok: final.length > 0,
    reason: final.length ? null : 'all_rejected',
    nodes: final,
    startResearch,
    flavor: payload.flavor ? String(payload.flavor).slice(0, 120) : '',
    rejected
  };
}

function applyUnlockEffects(civ, effects, patches) {
  (effects || []).forEach(e => {
    if (!e) return;
    if (e.type === 'stat' && e.key) {
      civ.stats = civ.stats || {};
      const cur = Number(civ.stats[e.key]) || 0;
      civ.stats[e.key] = clamp(cur + Number(e.delta || 0), 0, 999);
      patches.civs = patches.civs || [];
    } else if (e.type === 'capability' && e.key) {
      civ.capabilities = civ.capabilities || [];
      if (!civ.capabilities.includes(e.key)) civ.capabilities.push(e.key);
    } else if (e.type === 'rename_capital' && e.value) {
      if (!civ.capital || civ.capital === '未定居' || /营地|洞|树|潮/.test(civ.capital)) {
        civ.capital = e.value;
      }
    }
  });
}

/**
 * 写入校验后的节点
 */
function applyTechNodes(civ, nodes, opts) {
  opts = opts || {};
  const t = ensureTechTree(civ);
  const applied = [];
  (nodes || []).forEach(n => {
    if (!n || !n.name) return;
    const prev = t.节点[n.name];
    t.节点[n.name] = {
      层级: n.层级,
      描述: n.描述,
      前置: n.前置 || '无',
      状态: n.状态 || '可研究',
      进度: n.进度 != null ? n.进度 : 0,
      迭代: n.迭代 || prev?.迭代 || '',
      tags: Array.isArray(n.tags) ? n.tags.slice() : [],
      unlockEffects: Array.isArray(n.unlockEffects) ? n.unlockEffects.slice() : [],
      source: n.source || 'llm'
    };
    applied.push({
      civId: civ.id,
      node: n.name,
      progress: t.节点[n.name].进度,
      status: t.节点[n.name].状态,
      source: 'design',
      desc: t.节点[n.name].描述
    });
  });

  if (opts.startResearch && t.节点[opts.startResearch]) {
    const target = t.节点[opts.startResearch];
    if (target.状态 === '可研究' || target.状态 === '锁定') {
      // 同时只保留一个研究中
      Object.values(t.节点).forEach(x => {
        if (x && x.状态 === '研究中') x.状态 = '可研究';
      });
      target.状态 = '研究中';
      if (!(target.进度 > 0)) target.进度 = 0;
    }
  }

  civ.capabilities = collectCapabilities(civ);
  return applied;
}

function openPrereqDependents(civ, unlockedName) {
  const t = ensureTechTree(civ);
  const opened = [];
  Object.entries(t.节点).forEach(([name, n]) => {
    if (!n) return;
    if (n.前置 === unlockedName && n.状态 === '锁定') {
      n.状态 = '可研究';
      opened.push(name);
    }
  });
  return opened;
}

/**
 * 纯程序：推进研究进度 / 解锁 / 跃迁条
 * lensTechDelta: [{ civId, amount }]
 */
function tickTechProgress(run, decisions, yearDelta, lensTechDelta) {
  const patches = { tech: [], civs: [] };
  const unlockedEvents = []; // { civId, node } 供后继 design 队列
  const yd = Math.max(1, Number(yearDelta) || 7);
  const researchCivs = new Set(
    (decisions || []).filter(d => d.kind === 'research' && d.actionResult !== 'blocked').map(d => d.civId)
  );
  const lensBonus = Object.create(null);
  (lensTechDelta || []).forEach(t => {
    if (t && t.civId) lensBonus[t.civId] = (lensBonus[t.civId] || 0) + clamp(t.amount, -5, 20);
  });

  (run.civs || []).forEach(civ => {
    const t = ensureTechTree(civ);
    if (techTreeEmpty(civ)) return;

    const active = researchingNodes(civ);
    if (!active.length) {
      // 有 research 决策且有可研究：自动开题（不经 LLM 命名）
      if (researchCivs.has(civ.id)) {
        const avail = availableResearchNodes(civ);
        if (avail.length) {
          // 选 tags 贴合国策的
          const focus = policyFocusOf(civ);
          avail.sort((a, b) => {
            const ta = (a[1].tags || []).join(' ');
            const tb = (b[1].tags || []).join(' ');
            const sa = focus === 'explore' && /sky/.test(ta) ? 1 : 0;
            const sb = focus === 'explore' && /sky/.test(tb) ? 1 : 0;
            return sb - sa;
          });
          const [name, node] = avail[0];
          node.状态 = '研究中';
          node.进度 = Number(node.进度) || 0;
          patches.tech.push({
            civId: civ.id, node: name, progress: node.进度, status: '研究中', source: 'auto_open'
          });
          active.push([name, node]);
        }
      }
    }

    const leaders = civ.leaders || [];
    const scholar = leaders.reduce((best, L) => {
      const v = abilityOf(L, '学识', 40);
      return v > best ? v : best;
    }, 40);

    active.forEach(([name, node]) => {
      const tier = Number(node.层级) || 0;
      const researchStat = Number(civ.stats?.科研) || 2;
      const pop = Math.max(0.2, Number(civ.stats?.人口) || 1);
      const econ = Number(civ.stats?.经济) || 2;
      // 人口提供研究产能软加成（log 防晚期爆炸）；经济小幅补贴试验条件
      const popBonus = Math.min(6, Math.log2(1 + pop) * 1.15);
      const econBonus = Math.min(3, econ * 0.08);
      // 基础：年距 * 科研/学识/人口；无 research 决策时极慢
      let delta = (yd * 0.9) + (researchStat * 0.45) + (scholar / 25) + popBonus * 0.55 + econBonus - tier * 1.2;
      if (researchCivs.has(civ.id)) delta += 6 + yd * 0.4;
      else delta *= 0.22; // 闲时摸索
      if (lensBonus[civ.id]) delta += lensBonus[civ.id] * 0.6;
      delta = clamp(Math.round(delta), researchCivs.has(civ.id) ? 3 : 0, 32);

      if (delta <= 0) return;
      node.进度 = clamp((Number(node.进度) || 0) + delta, 0, 100);
      let status = node.状态;
      if (node.进度 >= 100) {
        node.进度 = 100;
        node.状态 = '已解锁';
        status = '已解锁';
        applyUnlockEffects(civ, node.unlockEffects, patches);
        const opened = openPrereqDependents(civ, name);
        // 跃迁条
        const weight = tier <= 0 ? 28 : tier === 1 ? 22 : 16;
        t.下一阶段 = clamp((Number(t.下一阶段) || 0) + weight, 0, 100);
        unlockedEvents.push({ civId: civ.id, node: name, opened });
        patches.tech.push({
          civId: civ.id,
          node: name,
          progress: 100,
          status: '已解锁',
          unlocked: true,
          nextStage: t.下一阶段,
          source: 'unlock',
          opened
        });
      } else {
        patches.tech.push({
          civId: civ.id,
          node: name,
          progress: node.进度,
          status,
          source: 'progress'
        });
      }
    });

    // 等级跃迁（程序）：下一阶段满 + 至少 2 个本层已解锁
    maybeLevelUp(civ, patches, unlockedEvents);

    civ.capabilities = collectCapabilities(civ);
    // stats 同步轻量 civ patch
    if (civ.stats) {
      patches.civs.push({
        civId: civ.id,
        level: t.文明等级,
        nextStage: t.下一阶段,
        stage: civ.stage || civ.文明阶段,
        stats: { ...civ.stats },
        capabilities: (civ.capabilities || []).slice(),
        capital: civ.capital
      });
    }
  });

  return { patches, unlockedEvents };
}

function maybeLevelUp(civ, patches, unlockedEvents) {
  const t = ensureTechTree(civ);
  const level = Number(t.文明等级) || 0;
  if ((Number(t.下一阶段) || 0) < 100) return;
  const unlockedAtTier = nodeEntries(civ).filter(([, n]) =>
    n && n.状态 === '已解锁' && (Number(n.层级) || 0) <= level
  ).length;
  if (unlockedAtTier < 2) return;

  t.文明等级 = level + 1;
  t.下一阶段 = 0;
  civ.level = t.文明等级;
  const stageName = STAGE_BY_LEVEL[t.文明等级] || `等级${t.文明等级}`;
  civ.stage = stageName;
  civ.文明阶段 = stageName;
  // 结构小幅提升
  civ.stats = civ.stats || {};
  civ.stats.科研 = clamp((Number(civ.stats.科研) || 2) + 3, 0, 99);
  civ.stats.经济 = clamp((Number(civ.stats.经济) || 2) + 2, 0, 99);

  unlockedEvents.push({ civId: civ.id, node: null, levelUp: t.文明等级 });
  patches.tech.push({
    civId: civ.id,
    node: null,
    level: t.文明等级,
    nextStage: 0,
    status: 'level_up',
    source: 'level_up'
  });
  patches.civs.push({
    civId: civ.id,
    level: t.文明等级,
    stage: stageName,
    nextStage: 0,
    stats: { ...civ.stats }
  });
}

const STAT_KEYS = ['人口', '军力', '经济', '稳定', '科研', '扩张'];
const STAT_DEFAULTS = { 人口: 1, 军力: 4, 经济: 3, 稳定: 28, 科研: 2, 扩张: 5 };

function ensureCivStats(civ) {
  if (!civ) return STAT_DEFAULTS;
  civ.stats = civ.stats && typeof civ.stats === 'object' ? civ.stats : {};
  STAT_KEYS.forEach(k => {
    const n = Number(civ.stats[k]);
    if (!Number.isFinite(n)) civ.stats[k] = STAT_DEFAULTS[k];
  });
  return civ.stats;
}

/**
 * 程序结算文明六维：决策驱动 + 自然漂移。
 * 人口/军力/科研/经济/稳定/扩张均会变化，供下一轮门槛与预算读取。
 */
function tickCivStats(run, decisions, yearDelta) {
  const patches = { civs: [] };
  const yd = Math.max(1, Number(yearDelta) || 7);
  const unit = yd / 7;

  const byCiv = new Map();
  (decisions || []).forEach(d => {
    if (!d || !d.civId) return;
    const list = byCiv.get(d.civId) || [];
    list.push(d);
    byCiv.set(d.civId, list);
  });

  (run.civs || []).forEach(civ => {
    const s = ensureCivStats(civ);
    const delta = { 人口: 0, 军力: 0, 经济: 0, 稳定: 0, 科研: 0, 扩张: 0 };
    const decs = byCiv.get(civ.id) || [];
    const live = decs.filter(d => d.actionResult !== 'blocked');
    const kinds = new Set(live.map(d => d.kind));
    const focus = policyFocusOf(civ);

    // —— 决策驱动 ——
    if (kinds.has('research')) {
      delta.科研 += Math.max(1, Math.round(unit));
      delta.经济 -= 1;
    }
    if (kinds.has('military')) {
      delta.军力 += Math.max(1, Math.round(unit));
      delta.稳定 -= 1;
      delta.经济 -= 1;
    }
    if (
      kinds.has('policy')
      || kinds.has('explore.body')
      || kinds.has('explore.system')
      || kinds.has('galaxy.probe')
      || kinds.has('station.build')
      || kinds.has('facility.deploy')
    ) {
      delta.扩张 += Math.max(1, Math.round(0.8 * unit));
      if (kinds.has('galaxy.probe') || kinds.has('explore.system')) delta.科研 += 1;
    }
    if (kinds.has('faith')) {
      delta.稳定 += Math.max(1, Math.round(unit));
    }
    if (kinds.has('diplomacy') || kinds.has('trade')) {
      delta.稳定 += 1;
      if (kinds.has('trade')) delta.经济 += Math.max(1, Math.round(unit));
    }

    // 国策 focus 轻推
    if (focus === 'research') delta.科研 += 1;
    else if (focus === 'military') delta.军力 += 1;
    else if (focus === 'expand' || focus === 'explore') delta.扩张 += 1;
    else if (focus === 'stabilize' || focus === 'faith') delta.稳定 += 1;
    else if (focus === 'trade') delta.经济 += 1;

    // —— 自然漂移 ——
    // 人口：稳定+经济 deterministically 缓慢增长；动荡则流失
    const popPressure = (Number(s.稳定) - 18) * 0.03 * unit + Number(s.经济) * 0.015 * unit;
    if (Number(s.稳定) < 16) {
      delta.人口 -= 1;
      delta.军力 -= 1;
    } else if (popPressure >= 0.45 || (Number(s.人口) < 6 && Number(s.稳定) >= 24)) {
      // 原始部落：约每轮有机会 +1；大型文明按比例
      delta.人口 += Number(s.人口) < 12
        ? 1
        : Math.max(1, Math.round(Number(s.人口) * 0.008 * unit));
    }

    // 经济随人口底座与扩张回馈
    if (Number(s.人口) >= 3 && !kinds.has('military')) {
      delta.经济 += Number(s.人口) >= 20 ? 2 : 1;
    }
    if (Number(s.扩张) >= 12 && kinds.has('policy')) delta.经济 += 1;

    // 稳定向「35 + min(20, 经济)」均值回归
    const stabTarget = 35 + Math.min(20, Number(s.经济) || 0);
    if (Number(s.稳定) < stabTarget - 6) delta.稳定 += 1;
    else if (Number(s.稳定) > stabTarget + 18) delta.稳定 -= 1;

    // 军力：人口是软上限锚
    const armyCap = Math.max(4, Math.round(6 + Number(s.人口) * 0.15 + Number(s.经济) * 0.2));
    if (Number(s.军力) > armyCap + 4 && !kinds.has('military')) delta.军力 -= 1;
    if (Number(s.军力) < Math.min(armyCap, 4) && Number(s.稳定) >= 22) delta.军力 += 1;

    // 科研闲置微衰（避免无研究决策时虚高）
    if (!kinds.has('research') && Number(s.科研) > 8 && unit >= 1) {
      delta.科研 -= 1;
    }

    const appliedDelta = {};
    STAT_KEYS.forEach(k => {
      const d0 = delta[k] || 0;
      if (!d0) return;
      const max = k === '人口' ? 999 : 99;
      const next = clamp(Math.round((Number(s[k]) || 0) + d0), 0, max);
      if (next !== s[k]) {
        appliedDelta[k] = next - Number(s[k]);
        s[k] = next;
      }
    });

    if (Object.keys(appliedDelta).length) {
      patches.civs.push({
        civId: civ.id,
        stats: { ...s },
        statsDelta: appliedDelta,
        source: 'stats_tick'
      });
    } else {
      // 仍同步一份，方便前端对齐
      patches.civs.push({
        civId: civ.id,
        stats: { ...s },
        source: 'stats_tick'
      });
    }
  });

  return patches;
}

/** 国策年数推进；不改写文案 */
function tickPolicyYears(run, yearDelta, decisions) {
  const patches = { civs: [] };
  const yd = Math.max(1, Number(yearDelta) || 7);
  const policyCivs = new Set(
    (decisions || []).filter(d => d.kind === 'policy' && d.actionResult !== 'blocked').map(d => d.civId)
  );
  (run.civs || []).forEach(civ => {
    if (!civ.目前国策 || typeof civ.目前国策 !== 'object') {
      civ.目前国策 = { 名称: '求存', 内容: '在长夜中活下去。', 持续年数: 0 };
    }
    civ.目前国策.持续年数 = (Number(civ.目前国策.持续年数) || 0) + yd;
    if (!civ.目前国策.focus) civ.目前国策.focus = policyFocusOf(civ);
    patches.civs.push({
      civId: civ.id,
      policy: {
        名称: civ.目前国策.名称,
        内容: civ.目前国策.内容,
        持续年数: civ.目前国策.持续年数,
        focus: civ.目前国策.focus
      },
      policyTouched: policyCivs.has(civ.id)
    });
  });
  return patches;
}

function validateIdeologyPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'empty' };
  const out = { ok: true, policy: null, 思潮: null, 国民理念: null, reason: '' };
  if (payload.policy && typeof payload.policy === 'object') {
    const 名称 = String(payload.policy.名称 || '').trim().slice(0, 12);
    const 内容 = String(payload.policy.内容 || '').trim().slice(0, 80);
    let focus = String(payload.policy.focus || '').trim();
    if (!POLICY_FOCUS.has(focus)) focus = 'stabilize';
    if (名称.length < 2 || 内容.length < 6) {
      return { ok: false, reason: 'policy_short' };
    }
    if (/灭|屠|屠杀|歼灭|专砸|只针对/.test(名称 + 内容)) {
      return { ok: false, reason: 'hostile_wording' };
    }
    out.policy = { 名称, 内容, focus, 持续年数: 0 };
  }
  if (payload.思潮 != null && payload.思潮 !== '') {
    const s = String(payload.思潮).trim().slice(0, 80);
    if (s.length >= 6) out.思潮 = s;
  }
  if (payload.国民理念 != null && payload.国民理念 !== '') {
    // 默认不鼓励改；若给了则短校验
    const s = String(payload.国民理念).trim().slice(0, 60);
    if (s.length >= 4) out.国民理念 = s;
  }
  if (!out.policy && !out.思潮 && !out.国民理念) return { ok: false, reason: 'nothing_to_apply' };
  out.reason = payload.reason ? String(payload.reason).slice(0, 80) : '';
  return out;
}

function applyIdeology(civ, validated) {
  if (!civ || !validated || !validated.ok) return null;
  const patch = { civId: civ.id };
  if (validated.policy) {
    civ.目前国策 = {
      名称: validated.policy.名称,
      内容: validated.policy.内容,
      持续年数: 0,
      focus: validated.policy.focus
    };
    patch.policy = { ...civ.目前国策 };
  }
  if (validated.思潮) {
    civ.思潮 = validated.思潮;
    patch.思潮 = validated.思潮;
  }
  if (validated.国民理念) {
    civ.国民理念 = validated.国民理念;
    patch.国民理念 = validated.国民理念;
  }
  return patch;
}

function mergeCivPatches(targetList, extraList) {
  const map = new Map();
  (targetList || []).forEach(p => {
    if (p && p.civId) map.set(p.civId, { ...p });
  });
  (extraList || []).forEach(p => {
    if (!p || !p.civId) return;
    const prev = map.get(p.civId) || { civId: p.civId };
    const mergedStats = p.stats || prev.stats
      ? Object.assign({}, prev.stats || {}, p.stats || {})
      : undefined;
    const mergedDelta = p.statsDelta || prev.statsDelta
      ? Object.assign({}, prev.statsDelta || {}, p.statsDelta || {})
      : undefined;
    map.set(p.civId, Object.assign({}, prev, p, {
      stats: mergedStats,
      statsDelta: mergedDelta,
      policy: p.policy || prev.policy
    }));
  });
  return Array.from(map.values());
}

function designQueueEnsure(run) {
  if (!Array.isArray(run.designQueue)) run.designQueue = [];
  return run.designQueue;
}

function enqueueDesign(run, job) {
  const q = designQueueEnsure(run);
  const key = `${job.type}:${job.civId}:${job.node || ''}`;
  if (q.some(j => `${j.type}:${j.civId}:${j.node || ''}` === key)) return false;
  q.push(job);
  return true;
}

/** 预决策：空树文明排队 seed（仅 hybrid/full 消费） */
function queueTechSeedsIfEmpty(run) {
  (run.civs || []).forEach(civ => {
    if (techTreeEmpty(civ)) {
      enqueueDesign(run, { type: 'tech_seed', civId: civ.id });
    }
  });
}

function queueAfterUnlocks(run, unlockedEvents) {
  (unlockedEvents || []).forEach(ev => {
    if (!ev || !ev.civId) return;
    if (ev.levelUp) {
      enqueueDesign(run, { type: 'tech_tier_up', civId: ev.civId, level: ev.levelUp });
    } else if (ev.node) {
      enqueueDesign(run, { type: 'tech_successors', civId: ev.civId, node: ev.node });
    }
  });
}

function queueOpenResearch(run, decisions) {
  (decisions || []).forEach(d => {
    if (d.kind !== 'research' || d.actionResult === 'blocked') return;
    const civ = (run.civs || []).find(c => c.id === d.civId);
    if (!civ) return;
    if (techTreeEmpty(civ)) {
      enqueueDesign(run, { type: 'tech_seed', civId: civ.id });
      return;
    }
    if (!researchingNodes(civ).length && !availableResearchNodes(civ).length) {
      enqueueDesign(run, { type: 'tech_open', civId: civ.id, characterId: d.characterId });
    }
  });
}

function queueIdeologyJobs(run, decisions, yearDelta) {
  (decisions || []).forEach(d => {
    if (d.kind !== 'policy' || d.actionResult === 'blocked') return;
    const civ = (run.civs || []).find(c => c.id === d.civId);
    if (!civ || !civ.目前国策) return;
    const years = Number(civ.目前国策.持续年数) || 0;
    // 新国策或执行较久才请 LLM 改写
    if (years >= 20 || years <= yearDelta) {
      enqueueDesign(run, {
        type: 'ideology_policy',
        civId: civ.id,
        characterId: d.characterId
      });
    }
  });
}

export {
  TAG_WHITELIST,
  CAPABILITY_KEYS,
  POLICY_FOCUS,
  ERA_BLACKLIST_RE,
  STAT_KEYS,
  STAT_DEFAULTS,
  ensureTechTree,
  ensureCivStats,
  techTreeEmpty,
  civHasCapability,
  collectCapabilities,
  unlockedTags,
  ideologyBiasForKind,
  techReadinessForKind,
  policyFocusOf,
  validateTechDesignPayload,
  validateIdeologyPayload,
  applyTechNodes,
  applyIdeology,
  tickTechProgress,
  tickCivStats,
  tickPolicyYears,
  mergeCivPatches,
  queueTechSeedsIfEmpty,
  queueAfterUnlocks,
  queueOpenResearch,
  queueIdeologyJobs,
  designQueueEnsure,
  enqueueDesign,
  researchingNodes,
  availableResearchNodes
};
