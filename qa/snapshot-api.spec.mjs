import { test, expect } from 'playwright/test';

test.describe('Phase B read-only snapshot API', () => {
  test('health reports phase B read-only', async ({ request }) => {
    const res = await request.get('/api/v1/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      apiVersion: 'v1',
      schemaVersion: 1,
      phase: 'B',
      writeOps: false
    }));
  });

  test('snapshot contract has world, bodies, surfaces, catalogs', async ({ request }) => {
    const res = await request.get('/api/v1/snapshot');
    expect(res.ok()).toBeTruthy();
    const snap = await res.json();

    expect(snap.schemaVersion).toBe(1);
    expect(snap.apiVersion).toBe('v1');
    expect(snap.runId).toBeTruthy();
    expect(snap.world).toEqual(expect.objectContaining({
      母星名: '盖亚',
      年数: expect.any(Number),
      能级: expect.any(Number)
    }));
    expect(snap.clock).toEqual(expect.objectContaining({
      year: snap.world.年数,
      paused: true,
      realtimeMinutesPerYear: 10
    }));
    expect(Array.isArray(snap.civs)).toBe(true);
    expect(snap.civs.length).toBeGreaterThanOrEqual(5);
    expect(snap.civs[0]).toEqual(expect.objectContaining({ id: 'dawn', name: expect.any(String) }));

    expect(Array.isArray(snap.spaceBodies)).toBe(true);
    const gaiya = snap.spaceBodies.find(b => b.id === 'gaiya');
    expect(gaiya).toEqual(expect.objectContaining({
      name: '盖亚',
      flags: expect.objectContaining({ landable: true, isPlayerHome: true }),
      surfaceId: 'gaiya:surface'
    }));
    expect(snap.landableBodyIds).toEqual(expect.arrayContaining(['gaiya', 'yinhui', 'yanhe', 'youxing']));

    expect(snap.bodySurfaces['gaiya:surface']).toEqual(expect.objectContaining({
      bodyId: 'gaiya',
      biomeKind: 'terrestrial',
      topology: expect.objectContaining({ frequency: 64, seed: 20260723 })
    }));
    expect(snap.bodySurfaces['gaiya:surface'].tiles).toBeUndefined();
    expect(snap.notes.tiles).toBe('not-included');
    expect(snap.notes.writeOps).toBe('none');

    expect(Object.keys(snap.catalogs.resource)).toHaveLength(12);
    expect(Object.keys(snap.catalogs.terrain).length).toBeGreaterThan(10);
    expect(Object.keys(snap.catalogs.building).length).toBeGreaterThan(5);
  });

  test('bodies and surfaces endpoints resolve ids', async ({ request }) => {
    const list = await (await request.get('/api/v1/bodies')).json();
    expect(list.items.length).toBeGreaterThan(5);
    expect(list.landableBodyIds).toContain('yinhui');

    const moon = await (await request.get('/api/v1/bodies/yinhui')).json();
    expect(moon).toEqual(expect.objectContaining({
      id: 'yinhui',
      name: '银辉',
      flags: expect.objectContaining({ landable: true })
    }));

    const surface = await (await request.get('/api/v1/surfaces/yinhui')).json();
    expect(surface).toEqual(expect.objectContaining({
      id: 'yinhui:surface',
      bodyId: 'yinhui',
      biomeKind: 'airless_moon'
    }));
    expect(surface.tiles).toBeUndefined();

    const missing = await request.get('/api/v1/bodies/no-such-body');
    expect(missing.status()).toBe(404);
  });

  test('write methods are rejected', async ({ request }) => {
    const res = await request.post('/api/v1/snapshot', { data: { x: 1 } });
    expect(res.status()).toBe(405);
    const body = await res.json();
    expect(body.error).toBe('method_not_allowed');
  });
});

test.describe('Snapshot providers in browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('local provider hydrates without changing active facade defaults', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot.done');

    const report = await page.evaluate(() => ({
      mode: GE.snapshot.mode,
      schema: GE.snapshot.last && GE.snapshot.last.schemaVersion,
      worldYear: GE.data.world.年数,
      landable: GE.snapshot.last.landableBodyIds,
      bodyId: GE.app.state.activeBodyId,
      surfaceId: GE.worldState.surfaceId,
      tiles: GE.worldState.tiles.length,
      resourceKeys: Object.keys(GE.data.resourceCatalog).length
    }));

    expect(report.mode).toBe('local');
    expect(report.schema).toBe(1);
    expect(report.worldYear).toBe(1247);
    expect(report.landable).toEqual(expect.arrayContaining(['gaiya', 'yinhui']));
    expect(report.bodyId).toBe('gaiya');
    expect(report.surfaceId).toBe('gaiya:surface');
    expect(report.tiles).toBe(40962);
    expect(report.resourceKeys).toBe(12);
  });

  test('http provider applies snapshot and keeps UI playable', async ({ page }) => {
    await page.goto('/?data=http');
    await page.waitForSelector('#boot.done');

    const report = await page.evaluate(() => {
      const snap = GE.snapshot.last;
      const empire = GE.surfaces.getEmpireWarehouse('dawn');
      return {
        mode: GE.snapshot.mode,
        runId: snap.runId,
        civCount: GE.data.civs.length,
        gaiyaSurface: !!GE.data.bodySurfaces['gaiya:surface'],
        yinhuiBiome: GE.data.bodySurfaces['yinhui:surface'].biomeKind,
        hud: document.getElementById('ws-planet-name').textContent,
        year: document.getElementById('ws-year-num').textContent,
        dock: document.querySelectorAll('#civ-dock .civ-card').length,
        empireKeys: Object.keys(empire.stock).length,
        finite: Object.values(empire.stock).every(Number.isFinite)
      };
    });

    expect(report.mode).toBe('http');
    expect(report.runId).toBeTruthy();
    expect(report.civCount).toBeGreaterThanOrEqual(5);
    expect(report.gaiyaSurface).toBe(true);
    expect(report.yinhuiBiome).toBe('airless_moon');
    expect(report.hud).toBe('盖亚');
    expect(report.year).toMatch(/1[,.]?247|1247/);
    expect(report.dock).toBeGreaterThanOrEqual(5);
    expect(report.empireKeys).toBe(12);
    expect(report.finite).toBe(true);
  });

  test('local and http snapshots agree on core identity fields', async ({ page, request }) => {
    const httpSnap = await (await request.get('/api/v1/snapshot')).json();

    await page.goto('/');
    await page.waitForSelector('#boot.done');
    const localSnap = await page.evaluate(() => GE.snapshot.buildFromData(GE.data, { runId: 'local-seed' }));

    expect(localSnap.schemaVersion).toBe(httpSnap.schemaVersion);
    expect(localSnap.world.母星名).toBe(httpSnap.world.母星名);
    expect(localSnap.world.年数).toBe(httpSnap.world.年数);
    expect(localSnap.civs.map(c => c.id)).toEqual(httpSnap.civs.map(c => c.id));
    expect(localSnap.landableBodyIds.sort()).toEqual(httpSnap.landableBodyIds.sort());
    expect(Object.keys(localSnap.bodySurfaces).sort()).toEqual(Object.keys(httpSnap.bodySurfaces).sort());
    expect(Object.keys(localSnap.catalogs.resource).sort()).toEqual(Object.keys(httpSnap.catalogs.resource).sort());
    expect(localSnap.bodySurfaces['gaiya:surface'].topology.seed)
      .toBe(httpSnap.bodySurfaces['gaiya:surface'].topology.seed);
  });
});
