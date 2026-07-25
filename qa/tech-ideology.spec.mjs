/* ============================================================
   科技 / 国策机制 + design 队列 单元与 API 烟测
   ============================================================ */
import { test, expect } from 'playwright/test';
import {
  validateTechDesignPayload,
  validateIdeologyPayload,
  applyTechNodes,
  tickTechProgress,
  tickCivStats,
  tickPolicyYears,
  techTreeEmpty,
  ensureTechTree,
  ideologyBiasForKind,
  queueTechSeedsIfEmpty,
  designQueueEnsure,
  enqueueDesign
} from '../server/tech-ideology.mjs';

test.describe('tech-ideology unit', () => {
  test('validateTechDesignPayload accepts era-fitting nodes', () => {
    const civ = {
      id: 'dawn',
      level: 0,
      科技树: { 文明等级: 0, 下一阶段: 0, 节点: {} }
    };
    const payload = {
      nodes: [
        {
          name: '潮汐观星',
          层级: 0,
          描述: '在退潮夜记下星位',
          前置: '无',
          状态: '研究中',
          tags: ['sky', 'memory'],
          unlockEffects: [{ type: 'capability', key: 'sky_lore' }]
        },
        {
          name: '长火营地',
          层级: 0,
          描述: '保存火种过夜',
          前置: '无',
          状态: '可研究',
          tags: ['fire', 'camp']
        }
      ],
      startResearch: '潮汐观星'
    };
    const v = validateTechDesignPayload(payload, civ, { task: 'seed', maxNewNodes: 5 });
    expect(v.ok).toBe(true);
    expect(v.nodes.length).toBe(2);
    const applied = applyTechNodes(civ, v.nodes, { startResearch: v.startResearch });
    expect(applied.length).toBe(2);
    expect(civ.科技树.节点['潮汐观星'].状态).toBe('研究中');
    expect(techTreeEmpty(civ)).toBe(false);
  });

  test('validate rejects era blacklist and short names', () => {
    const civ = { id: 'x', 科技树: { 文明等级: 0, 下一阶段: 0, 节点: {} } };
    const bad = validateTechDesignPayload({
      nodes: [
        { name: '曲速引擎', 层级: 0, 描述: '压缩时空的聚变驱动', 前置: '无', 状态: '可研究' }
      ]
    }, civ, { task: 'seed' });
    expect(bad.ok).toBe(false);

    const short = validateTechDesignPayload({
      nodes: [{ name: '火', 层级: 0, 描述: '短', 前置: '无' }]
    }, civ, { task: 'seed' });
    expect(short.ok).toBe(false);
  });

  test('tickTechProgress advances researching node', () => {
    const civ = {
      id: 'dawn',
      stats: { 科研: 10, 经济: 5, 稳定: 30, 军力: 4, 人口: 1, 扩张: 8 },
      leaders: [{ id: 'l1', abilities: [{ name: '学识', val: 70 }] }],
      科技树: {
        文明等级: 0,
        下一阶段: 0,
        节点: {
          潮汐观星: {
            层级: 0,
            描述: '观星',
            前置: '无',
            状态: '研究中',
            进度: 20,
            tags: ['sky'],
            unlockEffects: [{ type: 'capability', key: 'sky_lore' }]
          }
        }
      }
    };
    const run = { civs: [civ], year: 10 };
    const decisions = [{ civId: 'dawn', kind: 'research', actionResult: 'applied' }];
    const { patches, unlockedEvents } = tickTechProgress(run, decisions, 7, []);
    expect(patches.tech.length).toBeGreaterThanOrEqual(1);
    expect(civ.科技树.节点['潮汐观星'].进度).toBeGreaterThan(20);
  });

  test('higher 人口/科研 speeds research more than sparse tribe', () => {
    function makeCiv(id, stats) {
      return {
        id,
        stats: { ...stats },
        leaders: [{ id: id + '-l', abilities: [{ name: '学识', val: 50 }] }],
        科技树: {
          文明等级: 0,
          下一阶段: 0,
          节点: {
            火种: {
              层级: 0, 描述: '火', 前置: '无', 状态: '研究中', 进度: 10, tags: ['fire']
            }
          }
        }
      };
    }
    const sparse = makeCiv('sparse', { 科研: 2, 经济: 3, 稳定: 28, 军力: 4, 人口: 1, 扩张: 5 });
    const dense = makeCiv('dense', { 科研: 12, 经济: 20, 稳定: 50, 军力: 20, 人口: 40, 扩张: 30 });
    const decisions = [
      { civId: 'sparse', kind: 'research', actionResult: 'applied' },
      { civId: 'dense', kind: 'research', actionResult: 'applied' }
    ];
    tickTechProgress({ civs: [sparse, dense], year: 10 }, decisions, 7, []);
    expect(dense.科技树.节点['火种'].进度).toBeGreaterThan(sparse.科技树.节点['火种'].进度);
  });

  test('tickCivStats grows 科研 on research and 军力 on military', () => {
    const civ = {
      id: 'dawn',
      stats: { 人口: 2, 军力: 4, 经济: 5, 稳定: 30, 科研: 3, 扩张: 6 },
      目前国策: { 名称: '学', 内容: '记星', focus: 'research', 持续年数: 7 }
    };
    const before = { ...civ.stats };
    const p = tickCivStats(
      { civs: [civ] },
      [{ civId: 'dawn', kind: 'research', actionResult: 'applied' }],
      7
    );
    expect(civ.stats.科研).toBeGreaterThan(before.科研);
    expect(p.civs[0].stats).toBeTruthy();
    expect(p.civs[0].statsDelta?.科研 || 0).toBeGreaterThan(0);

    const mil = {
      id: 'aurel',
      stats: { 人口: 3, 军力: 7, 经济: 4, 稳定: 22, 科研: 1, 扩张: 10 },
      目前国策: { 名称: '猎', 内容: '争水', focus: 'military', 持续年数: 7 }
    };
    const milBefore = mil.stats.军力;
    tickCivStats(
      { civs: [mil] },
      [{ civId: 'aurel', kind: 'military', actionResult: 'applied' }],
      7
    );
    expect(mil.stats.军力).toBeGreaterThan(milBefore);
  });

  test('low 稳定 drains 人口; healthy tribe can grow', () => {
    const crisis = {
      id: 'x',
      stats: { 人口: 5, 军力: 4, 经济: 2, 稳定: 10, 科研: 2, 扩张: 4 },
      目前国策: { 名称: '乱', 内容: '失序', focus: 'stabilize', 持续年数: 3 }
    };
    tickCivStats({ civs: [crisis] }, [], 7);
    expect(crisis.stats.人口).toBeLessThan(5);

    const healthy = {
      id: 'y',
      stats: { 人口: 2, 军力: 4, 经济: 6, 稳定: 34, 科研: 2, 扩张: 5 },
      目前国策: { 名称: '安', 内容: '生息', focus: 'stabilize', 持续年数: 3 }
    };
    tickCivStats({ civs: [healthy] }, [], 7);
    expect(healthy.stats.人口).toBeGreaterThanOrEqual(2);
  });

  test('tickPolicyYears increments duration', () => {
    const run = {
      civs: [{
        id: 'dawn',
        目前国策: { 名称: '寻找长火', 内容: '保存火种', 持续年数: 0 }
      }]
    };
    const p = tickPolicyYears(run, 7, []);
    expect(run.civs[0].目前国策.持续年数).toBe(7);
    expect(p.civs[0].policy.持续年数).toBe(7);
    expect(run.civs[0].目前国策.focus).toBeTruthy();
  });

  test('ideologyBias favors explore for sky-ish civ', () => {
    const civ = {
      思潮: '逐光本能——对太阳与远方有敬畏',
      国民理念: '等太阳升起',
      文明特质: '仰望曦阳',
      目前国策: { 名称: '观星', 内容: '记录深空与潮汐', 持续年数: 3, focus: 'explore' },
      科技树: { 文明等级: 0, 下一阶段: 0, 节点: {} }
    };
    const explore = ideologyBiasForKind(civ, 'explore.system');
    const military = ideologyBiasForKind(civ, 'military');
    expect(explore).toBeGreaterThan(military);
  });

  test('queueTechSeedsIfEmpty enqueues per civ', () => {
    const run = {
      civs: [
        { id: 'a', 科技树: { 文明等级: 0, 下一阶段: 0, 节点: {} } },
        { id: 'b', 科技树: { 文明等级: 0, 下一阶段: 0, 节点: { 火: { 状态: '可研究', 进度: 0, 前置: '无', 描述: '火', 层级: 0 } } } }
      ],
      designQueue: []
    };
    queueTechSeedsIfEmpty(run);
    queueTechSeedsIfEmpty(run);
    const q = designQueueEnsure(run);
    expect(q.filter(j => j.civId === 'a' && j.type === 'tech_seed')).toHaveLength(1);
    expect(q.some(j => j.civId === 'b')).toBe(false);
  });

  test('enqueueDesign collapses duplicate seed retries by civ', () => {
    const run = { designQueue: [] };
    expect(enqueueDesign(run, { type: 'tech_seed', civId: 'abyss' })).toBe(true);
    expect(enqueueDesign(run, { type: 'tech_seed', civId: 'abyss', attempts: 2 })).toBe(false);
    expect(designQueueEnsure(run)).toEqual([{ type: 'tech_seed', civId: 'abyss' }]);
  });

  test('validateIdeologyPayload policy ok / hostile reject', () => {
    const ok = validateIdeologyPayload({
      policy: { 名称: '守住长火', 内容: '沿海岸保存火种与水源', focus: 'stabilize' }
    });
    expect(ok.ok).toBe(true);
    expect(ok.policy.focus).toBe('stabilize');

    const bad = validateIdeologyPayload({
      policy: { 名称: '灭族', 内容: '专砸邻邦屠尽其众', focus: 'military' }
    });
    expect(bad.ok).toBe(false);
  });

  test('ensureTechTree creates empty shell', () => {
    const civ = { id: 'z' };
    const t = ensureTechTree(civ);
    expect(t.节点).toEqual({});
    expect(techTreeEmpty(civ)).toBe(true);
  });
});

test.describe('Phase C tech/ideo via deduce API', () => {
  const RUN = 'qa-tech-' + Date.now().toString(36);

  test.beforeAll(async ({ request }) => {
    await request.post('/api/v1/runs', { data: { id: RUN, seed: 20260725, reset: true } });
    await request.delete('/api/v1/llm-settings');
  });

  test('rules_only does not invent tech nodes but advances policy years', async ({ request }) => {
    const before = await (await request.get(`/api/v1/runs/${RUN}/snapshot`)).json();
    const dawnBefore = (before.civs || []).find(c => c.id === 'dawn');
    const years0 = Number(dawnBefore?.目前国策?.持续年数) || 0;
    const nodes0 = Object.keys(dawnBefore?.科技树?.节点 || {}).length;

    const res = await request.post(`/api/v1/runs/${RUN}/deduce`, {
      data: { agentMode: 'rules_only' }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.yearDelta).toBe(7);
    // design 不应出现在 rules 成功路径的强制生成里
    const design = body.patchesSummary?.design;
    expect(!design || design.length === 0 || design.every(d => !d.ok || d.reason === 'already_seeded')).toBeTruthy();

    const after = await (await request.get(`/api/v1/runs/${RUN}/snapshot`)).json();
    const dawn = (after.civs || []).find(c => c.id === 'dawn');
    expect(Number(dawn.目前国策.持续年数)).toBe(years0 + 7);
    // rules_only 不 LLM 设计 → 节点数不增加
    expect(Object.keys(dawn.科技树?.节点 || {}).length).toBe(nodes0);

    const policyPatch = (body.patchesSummary?.civs || []).find(p => p.civId === 'dawn');
    expect(policyPatch?.policy?.持续年数).toBe(years0 + 7);
  });

  test('rules_only still returns full deduce shape', async ({ request }) => {
    const res = await request.post(`/api/v1/runs/${RUN}/deduce`, {
      data: { agentMode: 'rules_only' }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.decisions.length).toBeGreaterThanOrEqual(5);
    expect(body.lenses.科技).toBeTruthy();
    expect(Array.isArray(body.patchesSummary.tech)).toBe(true);
    expect(Array.isArray(body.patchesSummary.civs)).toBe(true);
  });
});
