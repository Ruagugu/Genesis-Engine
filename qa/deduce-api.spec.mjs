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
    expect(body.year).toBeGreaterThan(1247);
    expect(body.round).toEqual(expect.objectContaining({ n: 1, phase: 'done' }));
    expect(Array.isArray(body.decisions)).toBe(true);
    expect(body.decisions.length).toBeGreaterThanOrEqual(5);
    body.decisions.forEach(d => {
      expect(d.characterId).toBeTruthy();
      expect(d.characterName).toBeTruthy();
      expect(d.civId).toBeTruthy();
      expect(d.decision).toBeTruthy();
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

  test('multi-round deduce grows discovered set without id collisions', async ({ request }) => {
    // 独立 run，避免与并行用例争用 local-seed
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

    for (let i = 0; i < 12; i++) {
      const res = await request.post(`/api/v1/runs/${rid}/deduce`, {
        data: { agentMode: 'rules_only' }
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
    expect(lastRevision).toBeGreaterThanOrEqual(12);
  });

  test('facility deploy appears in bodies and survives re-fetch', async ({ request }) => {
    const rid = 'qa-fac-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 20260723, reset: true } });
    let facility = null;
    for (let i = 0; i < 9 && !facility; i++) {
      const res = await request.post(`/api/v1/runs/${rid}/deduce`, { data: {} });
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
      await request.post('/api/v1/runs/qa-seed-a/deduce', { data: { agentMode: 'rules_only' } });
      await request.post('/api/v1/runs/qa-seed-b/deduce', { data: { agentMode: 'rules_only' } });
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
    expect(meta.bodyCount).toBeGreaterThan(5);

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
    expect(body.year).toBeGreaterThan(1247);
  });

  test('C6 hybrid with invalid key falls back without failing the round', async ({ request }) => {
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
    expect(body.agentMeta.llmCalls).toBe(1);
    expect(body.lenses.政治).toBeTruthy();
    expect(body.round.llm.fallback).toBe('llm_error');
  });

  test('LLM settings saved from frontend API are used by hybrid deduce', async ({ request }) => {
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
    expect(body.decisions.length).toBeGreaterThanOrEqual(5);

    // 清理，避免污染其它用例
    await request.delete('/api/v1/llm-settings');
  });

  test('LLM call logs expose count and response content', async ({ request }) => {
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
    expect(body.agentMeta.llmCalls).toBe(1);
    expect(Array.isArray(body.llmLogs)).toBe(true);
    expect(body.llmLogs.length).toBeGreaterThanOrEqual(1);
    const entry = body.llmLogs[0];
    expect(entry.purpose).toBe('character_enhance');
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
    await page.evaluate(async () => GE.app.runDeduction());
    const year1 = await page.evaluate(() => GE.data.world.年数);
    expect(year1).toBe(year0 + 7);
    const summary = await page.evaluate(() => GE.data.deduction.log[0].summary);
    expect(summary).toMatch(/Mock/);
  });
});
