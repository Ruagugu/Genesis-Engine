/* ============================================================
   创世引擎 · 每文明独立 LLM 内容设计
   TechDesigner / IdeologyDesigner
   - rules_only：调用方不应进入本模块
   - 每文明独立一次 chat，不 seed_batch
   ============================================================ */
import { chat as llmChat, parseJsonLoose, llmConfigured } from './llm-provider.mjs';
import * as llmLog from './llm-log.mjs';
import {
  ensureTechTree,
  techTreeEmpty,
  validateTechDesignPayload,
  validateIdeologyPayload,
  applyTechNodes,
  applyIdeology,
  designQueueEnsure,
  policyFocusOf
} from './tech-ideology.mjs';

function civPack(civ) {
  const t = ensureTechTree(civ);
  const nodes = Object.entries(t.节点 || {}).map(([name, n]) => ({
    name,
    状态: n.状态,
    进度: n.进度,
    层级: n.层级,
    前置: n.前置,
    描述: String(n.描述 || '').slice(0, 40),
    tags: n.tags || []
  }));
  return {
    id: civ.id,
    name: civ.name,
    short: civ.short,
    stage: civ.stage || civ.文明阶段,
    level: t.文明等级,
    思潮: String(civ.思潮 || '').slice(0, 100),
    国民理念: String(civ.国民理念 || '').slice(0, 80),
    文明特质: String(civ.文明特质 || '').slice(0, 80),
    起源: String(civ.起源 || '').slice(0, 100),
    目前国策: civ.目前国策
      ? {
          名称: civ.目前国策.名称,
          内容: String(civ.目前国策.内容 || '').slice(0, 80),
          持续年数: civ.目前国策.持续年数,
          focus: policyFocusOf(civ)
        }
      : null,
    stats: civ.stats || null,
    tech: {
      文明等级: t.文明等级,
      下一阶段: t.下一阶段,
      nodes
    }
  };
}

function taskPrompt(task, job) {
  if (task === 'seed' || job.type === 'tech_seed') {
    return {
      task: 'seed',
      instruction:
        '为该原始/当前等级文明设计初始科技树节点（求生与认知，贴合思潮与种族气质）。' +
        '禁止聚变/曲速/轨道站/星链等越级科技。' +
        '给出 4～5 个节点：可含 0～1 个「已解锁」起点、1 个「研究中」、其余「可研究」或带前置的「锁定」。',
      maxNewNodes: 5
    };
  }
  if (task === 'successors' || job.type === 'tech_successors') {
    return {
      task: 'successors',
      instruction:
        `节点「${job.node}」刚解锁。设计 1～3 个后继节点（名称、描述、前置指向该节点或已有节点）。状态用「可研究」或「锁定」。`,
      maxNewNodes: 3,
      unlockedNode: job.node
    };
  }
  if (task === 'tier_up' || job.type === 'tech_tier_up') {
    return {
      task: 'tier_up',
      instruction:
        `文明刚升至等级 ${job.level || ''}。设计下一层 3～4 个科技节点，贴合新阶段，仍勿无端跳跃时代。`,
      maxNewNodes: 4,
      newLevel: job.level
    };
  }
  // open_research
  return {
    task: 'open_research',
    instruction:
      '当前无可研究/研究中的节点。请新增 1～2 个可研究节点，并指定 startResearch 开始研究。',
    maxNewNodes: 2
  };
}

async function designTechForCiv(run, civ, job, opts, agentMode, roundN, llmMeta) {
  const llm = opts && opts.llm;
  if (!llmConfigured(llm)) {
    return { ok: false, reason: 'llm_not_configured', patches: { tech: [] } };
  }
  const tp = taskPrompt(job.task || job.type, job);
  const system = [
    '你是创世引擎的 TechDesigner（科技内容设计器）。',
    '只为【一个】文明设计科技树节点文案与结构，不要设计其他文明。',
    '程序负责进度数字；你负责：名称、描述、前置、状态、tags、unlockEffects。',
    '硬约束：',
    '- 只输出一个 JSON，不要 markdown',
    '- name 2～12 汉字/词，描述 4～40 字',
    '- tags 只能从: sky,land,spirit,craft,war,order,memory,tools,fire,camp,water,orbit_craft,farm,metal,writing,energy,shield,drive',
    '- unlockEffects 例: {"type":"stat","key":"科研","delta":1} 或 {"type":"capability","key":"sky_lore"}',
    '- capability key 建议: sky_lore,tools,fire,camp,memory,water,orbit_craft,metal,writing',
    '- 前置必须是「无」或已有/本批节点名',
    '- 原始/低等级禁止: 聚变、曲速、轨道站、星链、等离子、超光速',
    'JSON schema:',
    '{"nodes":[{"name":"","层级":0,"描述":"","前置":"无","状态":"可研究","进度":0,"tags":[],"unlockEffects":[]}],',
    '"startResearch":"可选节点名","flavor":"一句编年旁白"}'
  ].join('\n');

  const user = JSON.stringify({
    mode: agentMode,
    year: run.year,
    era: run.era,
    design: tp,
    civ: civPack(civ)
  }, null, 0);

  // TechDesigner 生成 4～5 节点 JSON；pro 模型常 >25s，单独放宽
  const baseTo = Number(llm.timeoutMs) || 25000;
  const timeoutMs = Math.max(20000, Math.min(Math.max(baseTo, 60000), 90000));
  const result = await llmChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    {
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      temperature: llm.temperature != null ? llm.temperature : 0.75,
      timeoutMs
    }
  );

  if (llmMeta) {
    llmMeta.llmCalls = (llmMeta.llmCalls || 0) + 1;
    llmMeta.llmMs = (llmMeta.llmMs || 0) + (result.ms || 0);
  }

  const logEntry = llmLog.record({
    runId: run.id,
    round: roundN,
    purpose: 'tech_design',
    model: llm.model,
    characterId: null,
    characterName: civ.name,
    ok: !!result.ok,
    ms: result.ms,
    error: result.error || null,
    promptPreview: user.slice(0, 500),
    systemPreview: system.slice(0, 400),
    content: result.content || null
  });
  if (llmMeta && llmMeta.logIds) llmMeta.logIds.push(logEntry.id);

  if (!result.ok) {
    return { ok: false, reason: result.error || 'llm_fail', patches: { tech: [] } };
  }

  const parsed = parseJsonLoose(result.content);
  const validated = validateTechDesignPayload(parsed, civ, {
    task: tp.task,
    maxNewNodes: tp.maxNewNodes
  });
  if (!validated.ok) {
    return {
      ok: false,
      reason: validated.reason || 'validate_fail',
      rejected: validated.rejected,
      patches: { tech: [] }
    };
  }

  const techPatches = applyTechNodes(civ, validated.nodes, {
    startResearch: validated.startResearch
  });
  if (validated.flavor) {
    techPatches.forEach(p => { p.flavor = validated.flavor; });
  }
  logEntry.parseOk = true;
  logEntry.applied = techPatches.length;
  return {
    ok: true,
    reason: null,
    flavor: validated.flavor,
    patches: { tech: techPatches },
    rejected: validated.rejected
  };
}

async function designIdeologyForCiv(run, civ, job, opts, agentMode, roundN, llmMeta) {
  const llm = opts && opts.llm;
  if (!llmConfigured(llm)) {
    return { ok: false, reason: 'llm_not_configured', patches: { civs: [] } };
  }
  const { char } = (() => {
    if (!job.characterId) return { char: (civ.leaders || [])[0] };
    const hit = (civ.leaders || []).find(l => l.id === job.characterId);
    return { char: hit || (civ.leaders || [])[0] };
  })();

  const system = [
    '你是创世引擎的 IdeologyDesigner（国策/思潮设计器）。',
    '只改写【一个】文明的国策（必要时微调思潮）。不要输出其他文明。',
    '国民理念默认不要改（深层价值）；除非文明经历断裂级事件。',
    '硬约束：',
    '- 只输出一个 JSON',
    '- policy.名称 2～12 字，内容 10～80 字',
    '- focus 必须是: research|explore|expand|stabilize|military|faith|trade',
    '- 禁止以消灭/专砸其他文明为目标的措辞',
    'JSON schema:',
    '{"policy":{"名称":"","内容":"","focus":"stabilize"},"思潮":null,"国民理念":null,"reason":""}'
  ].join('\n');

  const user = JSON.stringify({
    mode: agentMode,
    year: run.year,
    era: run.era,
    civ: civPack(civ),
    leader: char
      ? { name: char.name, role: char.role, title: char.title, stance: char.agentStance }
      : null,
    note: '根据领袖本轮 policy 意图与当前世界阶段，给出新的国策题面。'
  }, null, 0);

  const baseTo = Number(llm.timeoutMs) || 25000;
  const timeoutMs = Math.max(15000, Math.min(Math.max(baseTo, 45000), 90000));
  const result = await llmChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    {
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      temperature: llm.temperature != null ? llm.temperature : 0.7,
      timeoutMs
    }
  );

  if (llmMeta) {
    llmMeta.llmCalls = (llmMeta.llmCalls || 0) + 1;
    llmMeta.llmMs = (llmMeta.llmMs || 0) + (result.ms || 0);
  }

  const logEntry = llmLog.record({
    runId: run.id,
    round: roundN,
    purpose: 'ideology_design',
    model: llm.model,
    characterId: job.characterId || null,
    characterName: (char && char.name) || civ.name,
    ok: !!result.ok,
    ms: result.ms,
    error: result.error || null,
    promptPreview: user.slice(0, 500),
    systemPreview: system.slice(0, 400),
    content: result.content || null
  });
  if (llmMeta && llmMeta.logIds) llmMeta.logIds.push(logEntry.id);

  if (!result.ok) {
    return { ok: false, reason: result.error || 'llm_fail', patches: { civs: [] } };
  }

  const parsed = parseJsonLoose(result.content);
  const validated = validateIdeologyPayload(parsed);
  if (!validated.ok) {
    return { ok: false, reason: validated.reason, patches: { civs: [] } };
  }
  const civPatch = applyIdeology(civ, validated);
  return {
    ok: !!civPatch,
    patches: { civs: civPatch ? [civPatch] : [] },
    reason: validated.reason
  };
}

/**
 * 消费 designQueue：每文明独立调用
 * - tech_seed：串行（pro 模型慢 + 避免并发挤占超时），失败带 attempts 重入队
 * - 其它 job：有限并发
 */
async function flushDesignQueue(run, opts, agentMode, roundN, llmMeta) {
  const empty = { tech: [], civs: [], design: [] };
  if (agentMode === 'rules_only') return empty;
  if (!llmConfigured(opts && opts.llm)) return empty;

  const q = designQueueEnsure(run);
  // 兼容旧存档 / 意外并发遗留的重复 job；同类同文明只保留一个。
  const seenJobs = new Set();
  const uniqueQueue = q.filter(job => {
    const key = `${job.type}:${job.civId}:${job.node || ''}`;
    if (seenJobs.has(key)) return false;
    seenJobs.add(key);
    return true;
  });
  if (uniqueQueue.length !== q.length) run.designQueue = uniqueQueue;
  const activeQueue = run.designQueue;
  if (!activeQueue.length) return empty;

  // 优先级：seed > open > successors > tier_up > ideology
  const rank = {
    tech_seed: 0,
    tech_open: 1,
    tech_successors: 2,
    tech_tier_up: 3,
    ideology_policy: 4
  };
  activeQueue.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));

  // 开局 seed：一轮内尽量给每个缺树文明各一次；其它 job 限流
  const seedJobs = activeQueue.filter(j => j.type === 'tech_seed');
  const otherJobs = activeQueue.filter(j => j.type !== 'tech_seed');
  // hybrid 每轮 seed 最多 3 个，避免单轮卡死过久；其余留待下轮
  const maxSeeds = agentMode === 'full' ? seedJobs.length : Math.min(3, seedJobs.length);
  const maxOther = agentMode === 'full' ? 4 : (seedJobs.length ? 1 : 2);
  const batch = seedJobs.slice(0, maxSeeds).concat(otherJobs.slice(0, maxOther));

  // 先移出本批；失败 seed 再用唯一 key 重新排队
  const batchKeys = new Set(batch.map(j => `${j.type}:${j.civId}:${j.node || ''}`));
  run.designQueue = activeQueue.filter(j => !batchKeys.has(`${j.type}:${j.civId}:${j.node || ''}`));

  const patches = { tech: [], civs: [], design: [] };

  function requeueFailedSeed(job, reason) {
    const attempts = (Number(job.attempts) || 0) + 1;
    if (attempts >= 6 || !techTreeEmpty((run.civs || []).find(c => c.id === job.civId))) return;
    const queue = designQueueEnsure(run);
    const key = `tech_seed:${job.civId}:`;
    const existing = queue.find(j => `${j.type}:${j.civId}:${j.node || ''}` === key);
    if (existing) {
      existing.attempts = Math.max(Number(existing.attempts) || 0, attempts);
      existing.lastError = reason;
      return;
    }
    queue.push({ type: 'tech_seed', civId: job.civId, attempts, lastError: reason });
  }

  async function runOne(job) {
    const civ = (run.civs || []).find(c => c.id === job.civId);
    if (!civ) {
      patches.design.push({ ...job, ok: false, reason: 'civ_missing' });
      return;
    }
    try {
      if (job.type === 'ideology_policy') {
        const r = await designIdeologyForCiv(run, civ, job, opts, agentMode, roundN, llmMeta);
        if (r.patches && r.patches.civs) patches.civs.push(...r.patches.civs);
        patches.design.push({ type: job.type, civId: job.civId, ok: r.ok, reason: r.reason || null });
        return;
      }
      if (job.type === 'tech_seed' && !techTreeEmpty(civ)) {
        patches.design.push({ type: job.type, civId: job.civId, ok: true, reason: 'already_seeded' });
        return;
      }
      const r = await designTechForCiv(run, civ, job, opts, agentMode, roundN, llmMeta);
      if (r.patches && r.patches.tech) patches.tech.push(...r.patches.tech);
      patches.design.push({
        type: job.type,
        civId: job.civId,
        ok: r.ok,
        reason: r.reason || null,
        node: job.node || null
      });
      // seed 失败：有限次重入队，按 type+civ 去重
      if (!r.ok && job.type === 'tech_seed') {
        requeueFailedSeed(job, r.reason || 'fail');
      }
    } catch (err) {
      patches.design.push({
        type: job.type,
        civId: job.civId,
        ok: false,
        reason: String(err && err.message || err)
      });
      if (job.type === 'tech_seed') {
        requeueFailedSeed(job, String(err && err.message || err));
      }
    }
  }

  // seed 串行；其它可并行
  const seeds = batch.filter(j => j.type === 'tech_seed');
  const others = batch.filter(j => j.type !== 'tech_seed');
  for (const job of seeds) {
    await runOne(job);
  }
  const concurrency = agentMode === 'full' ? 3 : 2;
  let cursor = 0;
  async function pump() {
    while (cursor < others.length) {
      const i = cursor++;
      await runOne(others[i]);
    }
  }
  if (others.length) {
    await Promise.all(Array.from({ length: Math.min(concurrency, others.length) }, () => pump()));
  }

  if (llmMeta) {
    llmMeta.design = {
      jobs: patches.design.length,
      ok: patches.design.filter(d => d.ok).length,
      fail: patches.design.filter(d => !d.ok).length,
      pendingSeeds: designQueueEnsure(run).filter(j => j.type === 'tech_seed').length
    };
    if (patches.design.some(d => d.ok)) {
      llmMeta.used = agentMode;
      llmMeta.fallback = null;
    }
  }
  return patches;
}

export {
  designTechForCiv,
  designIdeologyForCiv,
  flushDesignQueue,
  civPack
};
