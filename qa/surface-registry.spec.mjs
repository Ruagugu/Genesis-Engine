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
