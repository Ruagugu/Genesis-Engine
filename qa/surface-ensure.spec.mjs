import { test, expect } from 'playwright/test';

const RUN = 'local-seed';

test.describe('Phase C5 surface ensure', () => {
  test('POST surface/ensure is idempotent for seed landable', async ({ request }) => {
    // 默认 run 上 ensure 幂等（不 reset，避免与并行 deduce 竞态；seed 表面本就存在）
    const r1 = await request.post('/api/v1/bodies/yinhui/surface/ensure', { data: {} });
    expect([200, 201]).toContain(r1.status());
    const b1 = await r1.json();
    expect(b1.ok).toBe(true);
    expect(b1.surface).toEqual(expect.objectContaining({
      id: 'yinhui:surface',
      bodyId: 'yinhui',
      biomeKind: 'airless_moon'
    }));
    expect(b1.surface.tiles).toBeUndefined();
    expect(b1.surface.topology).toEqual(expect.objectContaining({
      kind: 'icosahedron-dual',
      frequency: expect.any(Number),
      seed: expect.any(Number)
    }));

    const r2 = await request.post('/api/v1/bodies/yinhui/surface/ensure', { data: {} });
    expect(r2.status()).toBe(200);
    const b2 = await r2.json();
    expect(b2.created).toBe(false);
    expect(b2.surface.id).toBe(b1.surface.id);
    expect(b2.surface.topology.seed).toBe(b1.surface.topology.seed);
  });

  test('ensure rejects non-landable and unknown bodies', async ({ request }) => {
    const star = await request.post('/api/v1/bodies/xiyang/surface/ensure', { data: {} });
    expect(star.status()).toBe(400);
    const miss = await request.post('/api/v1/bodies/no-such-body/surface/ensure', { data: {} });
    expect(miss.status()).toBe(404);
  });

  test('new discovered landable can be ensured after deduce', async ({ request }) => {
    const rid = 'qa-ensure-land-' + Date.now().toString(36);
    await request.post('/api/v1/runs', { data: { id: rid, seed: 20260723, reset: true } });
    let landable = null;
    for (let i = 0; i < 16 && !landable; i++) {
      const res = await request.post(`/api/v1/runs/${rid}/deduce`, { data: {} });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      landable = (body.worldDelta.newBodies || []).find(
        b => b.flags && b.flags.landable && String(b.id).startsWith('b:')
      );
    }
    if (!landable) {
      const list = await (await request.get(`/api/v1/runs/${rid}/bodies`)).json();
      landable = list.items.find(b => b.flags && b.flags.landable && String(b.id).startsWith('b:'));
    }
    expect(landable).toBeTruthy();

    const ens = await request.post(
      `/api/v1/runs/${rid}/bodies/${encodeURIComponent(landable.id)}/surface/ensure`,
      { data: {} }
    );
    expect([200, 201]).toContain(ens.status());
    const out = await ens.json();
    expect(out.ok).toBe(true);
    expect(out.surface.bodyId).toBe(landable.id);
    expect(out.surface.topology.seed).toEqual(expect.any(Number));
    expect(out.surface.regions.length).toBeGreaterThan(0);

    const snap = await (await request.get(`/api/v1/runs/${rid}/snapshot`)).json();
    expect(snap.bodySurfaces[out.surface.id]).toBeTruthy();
    expect(snap.bodySurfaces[out.surface.id].tiles).toBeUndefined();
  });

  test('named-run ensure path works', async ({ request }) => {
    await request.post('/api/v1/runs', { data: { id: 'qa-surface-run', seed: 99, reset: true } });
    const res = await request.post('/api/v1/runs/qa-surface-run/bodies/gaiya/surface/ensure', {
      data: {}
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body.surface.id).toBe('gaiya:surface');
  });
});

test.describe('Phase C5 client surface synth + settings UI', () => {
  test('client synthesizes def for synthetic landable without remote', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, {
      timeout: 20000
    });

    const report = await page.evaluate(() => {
      // 注入一个无 bodySurfaces 的 landable
      const id = 'qa-synth-body';
      GE.data.spaceBodies.push({
        id,
        name: '试作岩',
        type: '岩质行星',
        subtype: '干旱型',
        color: '#c98452',
        radius: 5,
        flags: { landable: true, surveyed: 'remote' },
        surfaceSeed: 4242,
        climateProfile: { hydrosphere: 0.05, meanTemp: 'hot', energyAffinity: 0.1 }
      });
      const def = GE.surfaces.ensureDef(id);
      const entry = GE.surfaces.ensure(id);
      return {
        defId: def.id,
        biome: def.biomeKind,
        freq: def.topology.frequency,
        seed: def.topology.seed,
        tileCount: entry.grid.tiles.length,
        warehouseCivs: entry.state.warehouseCivIds.length
      };
    });

    expect(report.defId).toBe('qa-synth-body:surface');
    expect(report.biome).toBe('arid_rock');
    expect(report.seed).toBe(4242);
    expect(report.tileCount).toBeGreaterThan(10);
    // 无 capitalSeeds → 不应给各文明乱建仓
    expect(report.warehouseCivs).toBe(0);
  });

  test('settings panel exposes LLM form and persists config', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, {
      timeout: 20000
    });
    await page.evaluate(() => localStorage.removeItem('ge-llm-config-v1'));

    await page.click('#btn-settings');
    await page.waitForSelector('#set-llm-base', { timeout: 5000 });
    await page.fill('#set-llm-base', 'https://example.com/v1');
    await page.fill('#set-llm-key', 'sk-test-key');
    await page.fill('#set-llm-model', 'demo-model');
    await page.fill('#set-world-api', 'http://127.0.0.1:8124');
    await page.click('#btn-llm-save');

    const saved = await page.evaluate(() => {
      const raw = localStorage.getItem('ge-llm-config-v1');
      return raw ? JSON.parse(raw) : null;
    });
    expect(saved).toEqual(expect.objectContaining({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test-key',
      model: 'demo-model',
      worldApiBase: 'http://127.0.0.1:8124'
    }));

    // GE.llmConfig 可读
    const cfg = await page.evaluate(() => GE.llmConfig.get());
    expect(cfg.model).toBe('demo-model');
    expect(cfg.worldApiBase).toBe('http://127.0.0.1:8124');
  });
});
