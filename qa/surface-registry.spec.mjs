import { test, expect } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#boot.done');
});

test('landable bodies expose independent surfaces', async ({ page }) => {
  const report = await page.evaluate(() => {
    const landable = GE.surfaces.listLandable().map(b => b.id);
    const home = GE.surfaces.getActive();
    GE.surfaces.activate('yinhui');
    const moon = GE.surfaces.getActive();
    return {
      landable,
      home: { bodyId: home.bodyId, surfaceId: home.surfaceId, tiles: home.grid.tiles.length, key: home.state.storageKey },
      moon: { bodyId: moon.bodyId, surfaceId: moon.surfaceId, tiles: moon.grid.tiles.length, key: moon.state.storageKey },
      isolated: home.grid !== moon.grid && home.state !== moon.state
    };
  });

  expect(report.landable).toEqual(expect.arrayContaining(['gaiya', 'yinhui']));
  expect(report.home).toEqual(expect.objectContaining({ bodyId: 'gaiya', surfaceId: 'gaiya:surface', tiles: 40962 }));
  expect(report.moon).toEqual(expect.objectContaining({ bodyId: 'yinhui', surfaceId: 'yinhui:surface', tiles: 10242 }));
  expect(report.home.key).not.toBe(report.moon.key);
  expect(report.isolated).toBe(true);
});

test('universe body card can enter a non-home landable body', async ({ page }) => {
  await page.evaluate(() => GE.app.switchView('universe', { silent: true }));
  await page.evaluate(() => {
    const moon = GE.data.spaceBodies.find(b => b.id === 'yinhui');
    GE.app.showBodyCard(moon);
  });

  await expect(page.locator('#ctx-enter-planet')).toBeVisible();
  await expect(page.locator('#ctx-enter-planet')).toContainText('登陆表面');
  await page.click('#ctx-enter-planet');

  await expect.poll(() => page.evaluate(() => ({
    view: GE.app.state.view,
    bodyId: GE.app.state.activeBodyId,
    surfaceId: GE.app.state.activeSurfaceId,
    viewBodyId: GE.views.planet.getBodyId(),
    hud: document.getElementById('ws-planet-name').textContent,
    role: document.getElementById('ws-planet-role').textContent,
    tileCount: GE.worldState.tiles.length,
    stationLabel: !!document.querySelector('[data-label="station"]')
  }))).toEqual({
    view: 'planet',
    bodyId: 'yinhui',
    surfaceId: 'yinhui:surface',
    viewBodyId: 'yinhui',
    hud: '银辉',
    role: '卫星',
    tileCount: 10242,
    stationLabel: false
  });
});

test('switching back to home restores its state facade', async ({ page }) => {
  const report = await page.evaluate(() => {
    GE.app.enterPlanet('yinhui', { silent: true });
    const moonState = GE.worldState.active;
    const moonKey = moonState.storageKey;
    GE.app.enterPlanet('gaiya', { silent: true });
    return {
      bodyId: GE.app.state.activeBodyId,
      surfaceId: GE.worldState.surfaceId,
      tiles: GE.worldState.tiles.length,
      changedState: moonState !== GE.worldState.active,
      changedKey: moonKey !== GE.worldState.active.storageKey,
      hud: document.getElementById('ws-planet-name').textContent,
      stationLabel: !!document.querySelector('[data-label="station"]')
    };
  });

  expect(report).toEqual({
    bodyId: 'gaiya',
    surfaceId: 'gaiya:surface',
    tiles: 40962,
    changedState: true,
    changedKey: true,
    hud: '盖亚',
    stationLabel: true
  });
});

test('optional switch unload evicts aliases and rebuilds persisted state', async ({ page }) => {
  const report = await page.evaluate(() => {
    const home = GE.surfaces.get('gaiya');
    const sample = home.state.tiles[123];
    home.state.advanceTurn();
    const revision = home.state.revision;
    const stock = home.state.getWarehouse('dawn').stock.food;

    GE.app.enterPlanet('yinhui', { silent: true, unloadPrevious: true });
    const evicted = !GE.surfaces.get('gaiya') && !GE.surfaces.get('gaiya:surface');
    const moonActive = GE.worldState.bodyId === 'yinhui' && GE.worldGrid.active === GE.surfaces.get('yinhui').grid;

    GE.app.enterPlanet('gaiya', { silent: true, unloadPrevious: true });
    const rebuilt = GE.surfaces.get('gaiya');
    const sameSample = rebuilt.state.getTile(sample.id);
    return {
      evicted,
      moonActive,
      moonEvicted: !GE.surfaces.get('yinhui') && !GE.surfaces.get('yinhui:surface'),
      homeActive: GE.worldState.active === rebuilt.state && GE.worldGrid.active === rebuilt.grid,
      revision: rebuilt.state.revision,
      stock: rebuilt.state.getWarehouse('dawn').stock.food,
      deterministic: sameSample.terrain === sample.terrain && sameSample.regionId === sample.regionId &&
        JSON.stringify(sameSample.resources) === JSON.stringify(sample.resources)
    };
  });

  expect(report).toEqual(expect.objectContaining({
    evicted: true,
    moonActive: true,
    moonEvicted: true,
    homeActive: true,
    deterministic: true
  }));
  expect(report.revision).toBe(1);
  expect(report.stock).toBeGreaterThanOrEqual(0);
});

test('empire turn advances established surfaces only and preserves active facade', async ({ page }) => {
  const report = await page.evaluate(() => {
    const active = GE.surfaces.getActive();
    const before = active.state.revision;
    const revisions = GE.surfaces.advanceAllSurfaceTurns();
    return {
      bodyId: GE.surfaces.activeBodyId,
      sameState: GE.worldState.active === active.state,
      revisions,
      homeRevision: active.state.revision,
      moonWarehouse: GE.surfaces.ensure('yinhui').state.getWarehouse('dawn')
    };
  });

  expect(report.bodyId).toBe('gaiya');
  expect(report.sameState).toBe(true);
  expect(report.revisions).toEqual([{ bodyId: 'gaiya', surfaceId: 'gaiya:surface', revision: 1 }]);
  expect(report.homeRevision).toBe(1);
  expect(report.moonWarehouse).toBeNull();
});

test('tile biomes match body type (no earth terrain on moon/rock)', async ({ page }) => {
  const report = await page.evaluate(() => {
    function sample(bodyId) {
      GE.surfaces.activate(bodyId);
      const tiles = GE.worldState.tiles;
      return {
        biomeKind: GE.worldState.def.biomeKind,
        earthTerrain: tiles.some(t => ['ocean', 'forest', 'plains', 'coast'].includes(t.terrain)),
        hasFood: tiles.some(t => t.resources.some(r => r.resourceId === 'food')),
        hasIce: tiles.some(t => t.resources.some(r => r.resourceId === 'iceWater')),
        hasGlass: tiles.some(t => t.terrain === 'glass_plain' || t.terrain === 'rift'),
        hasMare: tiles.some(t => t.terrain === 'mare' || t.terrain === 'psr'),
        hasFrost: tiles.some(t => t.terrain === 'frost_plain' || t.terrain === 'dark_ice' || t.terrain === 'essence_vein')
      };
    }
    return {
      gaiya: sample('gaiya'),
      yinhui: sample('yinhui'),
      yanhe: sample('yanhe'),
      youxing: sample('youxing')
    };
  });

  expect(report.gaiya.biomeKind).toBe('terrestrial');
  expect(report.gaiya.earthTerrain).toBe(true);
  expect(report.gaiya.hasFood).toBe(true);

  expect(report.yinhui.biomeKind).toBe('airless_moon');
  expect(report.yinhui.earthTerrain).toBe(false);
  expect(report.yinhui.hasFood).toBe(false);
  expect(report.yinhui.hasMare).toBe(true);
  expect(report.yinhui.hasIce).toBe(true);

  expect(report.yanhe.biomeKind).toBe('arid_rock');
  expect(report.yanhe.earthTerrain).toBe(false);
  expect(report.yanhe.hasFood).toBe(false);
  expect(report.yanhe.hasGlass).toBe(true);

  expect(report.youxing.biomeKind).toBe('cold_dwarf');
  expect(report.youxing.earthTerrain).toBe(false);
  expect(report.youxing.hasFood).toBe(false);
  expect(report.youxing.hasFrost).toBe(true);
});
