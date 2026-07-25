import { test, expect } from 'playwright/test';

const RUN = 'local-seed';

test.describe('Phase C deduce API', () => {
  test.beforeAll(async ({ request }) => {
    // 每套测试开始时重置默认 run，避免跨文件污染
    await request.post(`/api/v1/runs/${RUN}/reset`);
    // 清空前端写入的 LLM 设置，避免 hybrid 残留拖慢 / 改写 rules 路径
    await request.delete('/api/v1/llm-settings');
    await request.delete('/api/v1/llm-logs');
  });

  test.beforeEach(async ({ request }) => {
    await request.delete('/api/v1/llm-settings');
  });

  test('POST deduce returns decisions, lenses, chronicle, worldDelta', async ({ request }) => {
    await request.post(`/api/v1/runs/${RUN}/reset`);
    const res = await request.post(`/api/v1/runs/${RUN}/deduce`, {
      data: {}
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.runId).toBe(RUN);
    expect(body.revision).toBeGreaterThanOrEqual(1);
    expect(body.year).toBeGreaterThan(1);
    expect(body.round).toEqual(expect.objectContaining({ n: 1, phase: 'done' }));
    expect(Array.isArray(body.decisions)).toBe(true);
    expect(body.decisions.length).toBeGreaterThanOrEqual(5);
    body.decisions.forEach(d => {
      expect(d.characterId).toBeTruthy();
      expect(d.characterName).toBeTruthy();
      expect(d.civId).toBeTruthy();
      expect(d.decision).toBeTruthy();
      expect(d.monologue).toBeTruthy();
    });
    expect(Array.isArray(body.monologueReel)).toBe(true);
    expect(body.monologueReel.length).toBe(body.decisions.length);
    body.monologueReel.forEach(m => {
      expect(m.characterId).toBeTruthy();
      expect(m.monologue).toBeTruthy();
    });
    expect(body.lenses).toEqual(expect.objectContaining({
      政治: expect.any(String),
      军事: expect.any(String),
      经济: expect.any(String),
      科技: expect.any(String),
      思潮: expect.any(String),
      个人: expect.any(String)
    }));
    expect(body.worldDelta).toEqual(expect.objectContaining({
      newGalaxies: expect.any(Array),
      newSystems: expect.any(Array),
      newBodies: expect.any(Array)
    }));
    expect(Array.isArray(body.chronicle)).toBe(true);
    expect(body.chronicle[0].人物?.length || body.chronicle[0].事件).toBeTruthy();
  });

  test('deduce advances key character ages by simulated year delta', async ({ request }) => {
    const rid = 'qa-age-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 20260723, reset: true } });
    const beforeSnap = await (await request.get(`/api/v1/runs/${rid}/snapshot`)).json();
    const beforeAges = new Map();
    beforeSnap.civs.forEach(civ => {
      (civ.leaders || []).forEach(ch => beforeAges.set(ch.id, ch.age));
    });

    const res = await request.post(`/api/v1/runs/${rid}/deduce`, { data: { agentMode: 'rules_only' } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.yearDelta).toBe(7);

    const agePatches = (body.patchesSummary.characters || []).filter(p => p.age != null);
    expect(agePatches.length).toBeGreaterThanOrEqual(5);
    agePatches.forEach(p => {
      expect(p.bodyState).toBeTruthy();
      expect(p.age).toBeCloseTo((beforeAges.get(p.characterId) || 0) + body.yearDelta, 5);
    });
  });

  test('deduce updates leader Agent memory, goals and action state', async ({ request }) => {
    const rid = 'qa-agent-state-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 20260723, reset: true } });

    const res = await request.post(`/api/v1/runs/${rid}/deduce`, { data: { agentMode: 'rules_only' } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const agentPatches = (body.patchesSummary.characters || []).filter(p => p.agentMemory && p.agentGoals && p.agentActions);

    expect(agentPatches.length).toBeGreaterThanOrEqual(5);
    agentPatches.forEach(p => {
      expect(Array.isArray(p.agentMemory.episodic)).toBe(true);
      expect(p.agentMemory.episodic.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(p.agentGoals.active)).toBe(true);
      expect(p.agentActions.lastAction).toBeTruthy();
      expect(['applied', 'blocked', 'downgraded']).toContain(p.agentActions.lastAction.result);
      expect(p.agentConstraints).toBeTruthy();
      expect(p.agentDiplomacy).toBeTruthy();
      expect(p.succession).toBeTruthy();
    });
    expect(agentPatches.some(p => (p.agentGoals.active || []).length > 0)).toBe(true);
  });

  test('deduce ticks civ stats and territory budgets use 人口/军力/扩张', async ({ request }) => {
    const rid = 'qa-stats-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 20260725, reset: true } });
    const before = await (await request.get(`/api/v1/runs/${rid}/snapshot`)).json();
    const dawn0 = (before.civs || []).find(c => c.id === 'dawn');
    expect(dawn0?.stats?.科研).toBeTruthy();

    const res = await request.post(`/api/v1/runs/${rid}/deduce`, { data: { agentMode: 'rules_only' } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    const civPatches = body.patchesSummary?.civs || [];
    expect(civPatches.length).toBeGreaterThanOrEqual(1);
    const withStats = civPatches.filter(p => p.stats && typeof p.stats === 'object');
    expect(withStats.length).toBeGreaterThanOrEqual(1);
    withStats.forEach(p => {
      expect(p.stats.人口).toBeGreaterThanOrEqual(0);
      expect(p.stats.军力).toBeGreaterThanOrEqual(0);
      expect(p.stats.科研).toBeGreaterThanOrEqual(0);
    });

    // 至少有一份 statsDelta 或与开局不同（自然漂移/决策）
    const after = await (await request.get(`/api/v1/runs/${rid}/snapshot`)).json();
    const dawn1 = (after.civs || []).find(c => c.id === 'dawn');
    expect(dawn1.stats).toBeTruthy();
    const changed = ['人口', '军力', '经济', '稳定', '科研', '扩张'].some(
      k => Number(dawn1.stats[k]) !== Number(dawn0.stats[k])
    );
    expect(changed || withStats.some(p => p.statsDelta && Object.keys(p.statsDelta).length)).toBe(true);

    // 疆域事件若有 expand，budget 应受 扩张/人口 影响且 ≥1
    const terr = body.patchesSummary?.territory || [];
    terr.filter(e => e.type === 'expand').forEach(e => {
      expect(e.budget).toBeGreaterThanOrEqual(1);
      expect(e.budget).toBeLessThanOrEqual(6);
    });
    terr.filter(e => e.type === 'annex').forEach(e => {
      expect(e.budget).toBeGreaterThanOrEqual(1);
      expect(e.powerRatio == null || e.powerRatio > 0).toBe(true);
    });
  });

  test('leader succession replaces deceased agent and keeps one active leader', async ({ request }) => {
    const rid = 'qa-succession-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 20260723, reset: true } });
    const before = await (await request.get(`/api/v1/runs/${rid}/snapshot`)).json();
    const beforeIds = Object.fromEntries(before.civs.map(c => [c.id, c.leaders[0] && c.leaders[0].id]));

    // 普通推演 yearDelta=7；人类领袖约 11 轮即可触达寿命上限并触发继承
    let sawReplace = false;
    for (let i = 0; i < 14; i++) {
      const res = await request.post(`/api/v1/runs/${rid}/deduce`, { data: { agentMode: 'rules_only' } });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      if ((body.patchesSummary.characters || []).some(p => p.replaceLeader && p.leader)) sawReplace = true;
    }

    const after = await (await request.get(`/api/v1/runs/${rid}/snapshot`)).json();
    after.civs.forEach(civ => {
      expect(civ.leaders.length).toBe(1);
      const L = civ.leaders[0];
      expect(L.agentMemory && L.agentGoals && L.agentActions && L.agentConstraints && L.agentDiplomacy && L.succession).toBeTruthy();
      expect(L.isAgent !== false).toBe(true);
      expect(L.agent && L.agent.status !== 'deceased').toBe(true);
    });
    expect(sawReplace || after.civs.some(c => (c.leaders[0].succession.generation || 1) > 1 || c.leaders[0].id !== beforeIds[c.id])).toBe(true);
  });

  test('primitive rules_only does not invent remote galaxies', async ({ request }) => {
    // 蒙昧期无 sky_lore：只本系勘察，不得每轮刷新星系
    const rid = 'qa-grow-local-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 20260723, reset: true } });
    const start = await (await request.get(`/api/v1/runs/${rid}`)).json();
    const g0 = start.discovered.galaxyCount;
    for (let i = 0; i < 6; i++) {
      const res = await request.post(`/api/v1/runs/${rid}/deduce`, {
        data: { agentMode: 'rules_only' }
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect((body.worldDelta.newGalaxies || []).length).toBe(0);
      expect((body.worldDelta.newSystems || []).length).toBe(0);
    }
    const end = await (await request.get(`/api/v1/runs/${rid}`)).json();
    expect(end.discovered.galaxyCount).toBe(g0);
  });

  test('multi-round deduce grows discovered set without id collisions', async ({ request }) => {
    // force 绕过时代门控，验证无限骨架扩图与 id 稳定
    const rid = 'qa-grow-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 20260723, reset: true } });
    const start = await (await request.get(`/api/v1/runs/${rid}`)).json();
    const startBodies = start.discovered.bodyCount;

    const seenBodyIds = new Set();
    const base = await (await request.get(`/api/v1/runs/${rid}/bodies`)).json();
    base.items.forEach(b => seenBodyIds.add(b.id));

    let lastRevision = start.revision;
    let maxBodies = startBodies;
    let grew = false;

    for (let i = 0; i < 8; i++) {
      const res = await request.post(`/api/v1/runs/${rid}/deduce`, {
        data: { agentMode: 'rules_only', force: true }
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.revision).toBeGreaterThan(lastRevision);
      lastRevision = body.revision;

      (body.worldDelta.newBodies || []).forEach(b => {
        expect(seenBodyIds.has(b.id)).toBe(false);
        seenBodyIds.add(b.id);
      });
      (body.worldDelta.newGalaxies || []).forEach(g => {
        expect(g.id).toMatch(/^g:/);
      });

      const meta = await (await request.get(`/api/v1/runs/${rid}`)).json();
      if (meta.discovered.bodyCount > maxBodies) {
        grew = true;
        maxBodies = meta.discovered.bodyCount;
      }
    }

    expect(grew).toBe(true);
    expect(maxBodies).toBeGreaterThan(startBodies);
    expect(lastRevision).toBeGreaterThanOrEqual(8);
  });

  test('facility deploy appears in bodies and survives re-fetch', async ({ request }) => {
    const rid = 'qa-fac-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 20260723, reset: true } });
    let facility = null;
    for (let i = 0; i < 3 && !facility; i++) {
      const res = await request.post(`/api/v1/runs/${rid}/deduce`, { data: { force: true } });
      const body = await res.json();
      facility = (body.worldDelta.newBodies || []).find(b => b.flags && b.flags.artificial);
    }
    expect(facility).toBeTruthy();
    expect(facility.id).toMatch(/^fac:/);
    expect(facility.flags.landable).toBe(false);
    expect(facility.builtByCharacterId).toBeTruthy();

    const list = await (await request.get(`/api/v1/runs/${rid}/bodies`)).json();
    const found = list.items.find(b => b.id === facility.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe(facility.name);

    const snap = await (await request.get(`/api/v1/runs/${rid}/snapshot`)).json();
    expect(snap.spaceBodies.some(b => b.id === facility.id)).toBe(true);
  });

  test('same seed+coord yields stable skeleton ids', async ({ request }) => {
    // 两个独立 run，同 seed，多轮探测后比较程序 id 形态
    await request.post('/api/v1/runs', {
      data: { id: 'qa-seed-a', seed: 424242, reset: true }
    });
    await request.post('/api/v1/runs', {
      data: { id: 'qa-seed-b', seed: 424242, reset: true }
    });
    for (let i = 0; i < 6; i++) {
      await request.post('/api/v1/runs/qa-seed-a/deduce', { data: { agentMode: 'rules_only', force: true } });
      await request.post('/api/v1/runs/qa-seed-b/deduce', { data: { agentMode: 'rules_only', force: true } });
    }
    const a = await (await request.get('/api/v1/runs/qa-seed-a/bodies')).json();
    const b = await (await request.get('/api/v1/runs/qa-seed-b/bodies')).json();
    const aGal = a.galaxies.filter(g => g.id !== 'g:0:0:0').map(g => g.id).sort();
    const bGal = b.galaxies.filter(g => g.id !== 'g:0:0:0').map(g => g.id).sort();
    // 同 seed 同轮序 → 相同 frontier 展开
    expect(aGal).toEqual(bGal);
    const aProg = a.items.filter(x => String(x.id).startsWith('b:')).map(x => x.id).sort();
    const bProg = b.items.filter(x => String(x.id).startsWith('b:')).map(x => x.id).sort();
    expect(aProg).toEqual(bProg);
  });

  test('edict path advances year lightly without requiring force growth', async ({ request }) => {
    const rid = 'qa-edict-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 7, reset: true } });
    const before = await (await request.get(`/api/v1/runs/${rid}`)).json();
    const res = await request.post(`/api/v1/runs/${rid}/deduce`, {
      data: { edict: '愿星海见证理性' }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.year).toBe(before.year + 1);
    expect(body.chronicle[0].事件).toContain('神谕');
  });

  test('GET run and POST create work', async ({ request }) => {
    const created = await request.post('/api/v1/runs', {
      data: { id: 'qa-ephemeral', seed: 7, reset: true }
    });
    expect(created.status()).toBe(201);
    const meta = await created.json();
    expect(meta.id).toBe('qa-ephemeral');
    expect(meta.bodyCount).toBeGreaterThanOrEqual(5);

    const get = await request.get('/api/v1/runs/qa-ephemeral');
    expect(get.ok()).toBeTruthy();
    const g = await get.json();
    expect(g.revision).toBe(0);
  });

  test('C6 hybrid without llm config falls back to rules_only', async ({ request }) => {
    await request.delete('/api/v1/llm-settings');
    const rid = 'qa-hybrid-fb-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 99, reset: true } });
    const res = await request.post(`/api/v1/runs/${rid}/deduce`, {
      data: { agentMode: 'hybrid' }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.decisions.length).toBeGreaterThanOrEqual(5);
    expect(body.agentMeta.requested).toBe('hybrid');
    expect(body.agentMeta.used).toBe('rules_only');
    // 无请求体 llm 且后端无已存配置
    expect(['llm_not_configured', 'server_disabled', 'incomplete']).toContain(
      body.agentMeta.fallback
    );
    expect(body.agentMeta.llmCalls || 0).toBe(0);
    expect(body.round.agentMode).toBe('rules_only');
    expect(body.year).toBeGreaterThan(1);
  });

  test('C6 hybrid with invalid key falls back without failing the round', async ({ request }) => {
    test.setTimeout(120_000);
    const rid = 'qa-hybrid-badkey-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 101, reset: true } });
    const res = await request.post(`/api/v1/runs/${rid}/deduce`, {
      data: {
        agentMode: 'hybrid',
        llm: {
          baseUrl: 'http://127.0.0.1:9',
          apiKey: 'sk-invalid-qa',
          model: 'gpt-4o-mini',
          timeoutMs: 2500
        }
      }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.decisions.length).toBeGreaterThanOrEqual(5);
    expect(body.agentMeta.requested).toBe('hybrid');
    expect(body.agentMeta.used).toBe('rules_only');
    expect(body.agentMeta.fallback).toBe('llm_error');
    // 每人独立调用，全部失败时仍 ≥1，且带 perCharacter
    expect(body.agentMeta.llmCalls).toBeGreaterThanOrEqual(1);
    expect(body.agentMeta.perCharacter).toBe(true);
    expect(body.decisions.every(d => d.monologue)).toBe(true);
    expect(body.monologueReel.length).toBeGreaterThanOrEqual(5);
    expect(body.lenses.政治).toBeTruthy();
    expect(body.round.llm.fallback).toBe('llm_error');
  });

  test('LLM settings saved from frontend API are used by hybrid deduce', async ({ request }) => {
    test.setTimeout(120_000);
    // 清空再写入（模拟前端表单保存）
    await request.delete('/api/v1/llm-settings');
    const put = await request.put('/api/v1/llm-settings', {
      data: {
        enabled: true,
        agentMode: 'hybrid',
        baseUrl: 'http://127.0.0.1:9',
        apiKey: 'sk-from-frontend-form',
        model: 'test-model',
        temperature: 0.5,
        timeoutMs: 2500
      }
    });
    expect(put.ok()).toBeTruthy();
    const saved = await put.json();
    expect(saved.ok).toBe(true);
    expect(saved.apiKeySet).toBe(true);
    expect(saved.agentMode).toBe('hybrid');

    const get = await request.get('/api/v1/llm-settings');
    expect(get.ok()).toBeTruthy();
    const cfg = await get.json();
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe('sk-from-frontend-form');
    expect(cfg.model).toBe('test-model');

    const rid = 'qa-llm-store-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 77, reset: true } });
    // 不带 llm 体，仅 agentMode；服务端应用已存设置
    const res = await request.post(`/api/v1/runs/${rid}/deduce`, {
      data: { agentMode: 'hybrid' }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.agentMeta.requested).toBe('hybrid');
    expect(body.agentMeta.configSource).toBe('server_store');
    // 假地址应回落
    expect(body.agentMeta.used).toBe('rules_only');
    expect(body.agentMeta.fallback).toBe('llm_error');
    expect(body.agentMeta.llmCalls).toBeGreaterThanOrEqual(1);
    expect(body.decisions.length).toBeGreaterThanOrEqual(5);
    expect(body.monologueReel.length).toBeGreaterThanOrEqual(5);

    // 清理，避免污染其它用例
    await request.delete('/api/v1/llm-settings');
  });

  test('LLM call logs expose count and response content', async ({ request }) => {
    test.setTimeout(120_000);
    await request.delete('/api/v1/llm-logs');
    const rid = 'qa-llm-log-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 55, reset: true } });
    const res = await request.post(`/api/v1/runs/${rid}/deduce`, {
      data: {
        agentMode: 'hybrid',
        llm: {
          baseUrl: 'http://127.0.0.1:9',
          apiKey: 'sk-log-test',
          model: 'log-model',
          timeoutMs: 2000
        }
      }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // hybrid 先 tech_design seed，再 character_decide；坏端点均失败，不下发 lens
    expect(body.agentMeta.llmCalls).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.llmLogs)).toBe(true);
    expect(body.llmLogs.length).toBeGreaterThanOrEqual(1);
    const purposes = new Set(body.llmLogs.map(e => e.purpose));
    expect(
      purposes.has('tech_design') || purposes.has('character_decide')
    ).toBe(true);
    const entry = body.llmLogs.find(e => e.purpose === 'character_decide')
      || body.llmLogs.find(e => e.purpose === 'tech_design')
      || body.llmLogs[0];
    expect(entry.model).toBe('log-model');
    expect(entry.ok).toBe(false);
    expect(entry.error).toBeTruthy();
    expect(body.llmTotals.calls).toBeGreaterThanOrEqual(1);

    const list = await (await request.get('/api/v1/llm-logs?limit=10')).json();
    expect(list.totals.calls).toBeGreaterThanOrEqual(1);
    expect(list.items.some(i => i.id === entry.id)).toBe(true);
    expect(list.items[0].purpose).toBeTruthy();
  });
});

test.describe('Phase C frontend deduce wiring', () => {
  test.beforeEach(async ({ page, request }) => {
    await request.post(`/api/v1/runs/${RUN}/reset`);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('runDeduction hits API and merges new bodies', async ({ page, request }) => {
    test.setTimeout(90_000);
    await request.post(`/api/v1/runs/${RUN}/reset`);
    await page.goto('/');
    await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, { timeout: 30000 });

    const before = await page.evaluate(() => (GE.data.spaceBodies || []).length);
    const beforeYear = await page.evaluate(() => GE.data.world.年数);

    const log = await page.evaluate(async () => GE.app.runDeduction());
    expect(log).toBeTruthy();
    expect(log.round).toBeGreaterThan(0);

    const afterYear = await page.evaluate(() => GE.data.world.年数);
    expect(afterYear).toBeGreaterThan(beforeYear);

    // 再推 2 轮即可验证接线（表面 advance 较重）
    await page.evaluate(async () => {
      await GE.app.runDeduction();
      await GE.app.runDeduction();
    });
    const after = await page.evaluate(() => (GE.data.spaceBodies || []).length);
    const logLen = await page.evaluate(() => GE.data.deduction.log.length);
    expect(logLen).toBeGreaterThanOrEqual(3);
    expect(after).toBeGreaterThanOrEqual(before);

    const meta = await (await request.get(`/api/v1/runs/${RUN}`)).json();
    expect(meta.revision).toBeGreaterThanOrEqual(1);
  });

  test('mockDeduce=1 keeps offline path', async ({ page }) => {
    await page.goto('/?mockDeduce=1');
    await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, { timeout: 20000 });
    const year0 = await page.evaluate(() => GE.data.world.年数);
    const age0 = await page.evaluate(() => GE.data.civs.find(c => c.id === 'dawn').leaders[0].age);
    await page.evaluate(async () => GE.app.runDeduction());
    const year1 = await page.evaluate(() => GE.data.world.年数);
    const age1 = await page.evaluate(() => GE.data.civs.find(c => c.id === 'dawn').leaders[0].age);
    expect(year1).toBe(year0 + 7);
    expect(age1).toBe(age0 + 7);
    const summary = await page.evaluate(() => GE.data.deduction.log[0].summary);
    expect(summary).toMatch(/Mock/);
  });
});
