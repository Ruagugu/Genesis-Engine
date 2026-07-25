import { test, expect } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, {
    timeout: 30000
  });
});

test('strategic grid topology and tile data are complete', async ({ page }) => {
  const report = await page.evaluate(() => {
    const topology = GE.worldGrid.validate();
    const tiles = GE.worldState.tiles;
    return {
      topology,
      incomplete: tiles.filter(t => !t.id || !t.regionId || !t.terrain || !Array.isArray(t.resources) || !Array.isArray(t.buildings)).length,
      wrongNeighbors: tiles.filter(t => ![5, 6].includes(t.neighbors.length)).length,
      regions: new Set(tiles.map(t => t.regionId)).size
    };
  });
  expect(report.topology).toEqual({ tiles: 40962, pentagons: 12, bad: 0 });
  expect(report.incomplete).toBe(0);
  expect(report.wrongNeighbors).toBe(0);
  expect(report.regions).toBe(8);
});

test('genesis tile details show undeveloped land and no warehouse', async ({ page }) => {
  const sample = await page.evaluate(() => GE.worldState.tiles.find(t => !t.ownerCivId && t.resources.length)?.id);
  await page.evaluate(id => GE.app.showTileContext(id), sample);
  await expect(page.locator('#ctx-panel')).toBeVisible();
  await expect(page.locator('#ctx-inner')).toContainText(sample);
  await expect(page.locator('#ctx-warehouse')).toHaveCount(0);
});

test('strategic layer controls are independent', async ({ page }) => {
  for (const id of ['lb-grid', 'lb-regions', 'lb-ownership', 'lb-assets']) await expect(page.locator('#' + id)).toBeVisible();
  await page.click('#lb-regions');
  await expect(page.locator('#lb-regions')).not.toHaveClass(/on/);
  await expect(page.locator('#lb-ownership')).toHaveClass(/on/);
});

test('genesis warehouse panel reports no established warehouse', async ({ page }) => {
  await page.evaluate(async () => {
    await GE.app.enterPlanet('yinhui', { silent: true });
    GE.panels.openWarehouse('dawn');
  });
  await expect(page.locator('.modal-title')).toContainText('国家仓储');
  await expect(page.locator('.panel')).toContainText('尚未在任何可登陆天体建立行星仓');
  await expect(page.locator('.warehouse-row')).toHaveCount(0);
});

test('genesis surface advance has no warehouse side effects', async ({ page }) => {
  const result = await page.evaluate(() => {
    const before = GE.worldState.revision;
    GE.worldState.advanceTurn();
    return {
      before,
      after: GE.worldState.revision,
      warehouse: GE.worldState.getWarehouse('dawn'),
      owned: GE.worldState.tiles.filter(t => t.ownerCivId).length,
      buildings: GE.worldState.tiles.reduce((n, t) => n + t.buildings.length, 0)
    };
  });
  expect(result.after).toBe(result.before + 1);
  expect(result.warehouse).toBeNull();
  expect(result.owned).toBe(0);
  expect(result.buildings).toBe(0);
});

test('genesis empire warehouse totals are empty without switching surfaces', async ({ page }) => {
  const result = await page.evaluate(() => {
    const active = GE.surfaces.getActive();
    const moon = GE.surfaces.ensure('yinhui').state;
    const empire = GE.surfaces.getEmpireWarehouse('dawn');
    return {
      activeBodyId: GE.surfaces.activeBodyId,
      sameState: GE.worldState.active === active.state,
      moonWarehouse: moon.getWarehouse('dawn'),
      surfaceIds: empire.surfaces.map(s => s.surfaceId),
      resourceKeys: Object.keys(empire.stock),
      finite: Object.values(empire.capacity).every(Number.isFinite) && Object.values(empire.stock).every(Number.isFinite),
      empty: Object.values(empire.stock).every(v => v === 0) && Object.values(empire.capacity).every(v => v === 0)
    };
  });

  expect(result.activeBodyId).toBe('gaiya');
  expect(result.sameState).toBe(true);
  expect(result.moonWarehouse).toBeNull();
  expect(result.surfaceIds).toEqual([]);
  expect(result.resourceKeys).toHaveLength(12);
  expect(result.finite).toBe(true);
  expect(result.empty).toBe(true);
});

test('genesis surface revision survives reload without warehouses', async ({ page }) => {
  const before = await page.evaluate(() => {
    GE.worldState.advanceTurn();
    return { revision: GE.worldState.revision, warehouse: GE.worldState.getWarehouse('dawn'), key: GE.worldState.active.storageKey };
  });
  await page.reload();
  await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, { timeout: 30000 });
  const after = await page.evaluate(() => ({
    revision: GE.worldState.revision,
    warehouse: GE.worldState.getWarehouse('dawn')
  }));
  expect(after.revision).toBe(before.revision);
  expect(after.warehouse).toBeNull();
});
