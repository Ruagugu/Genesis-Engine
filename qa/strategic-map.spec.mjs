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

test('tile details and warehouse are accessible', async ({ page }) => {
  const owned = await page.evaluate(() => GE.worldState.tiles.find(t => t.ownerCivId && t.resources.length)?.id);
  await page.evaluate(id => GE.app.showTileContext(id), owned);
  await expect(page.locator('#ctx-panel')).toBeVisible();
  await expect(page.locator('#ctx-inner')).toContainText(owned);
  await expect(page.locator('#ctx-warehouse')).toBeVisible();
  await page.click('#ctx-warehouse');
  await expect(page.locator('.modal-title')).toContainText('国家仓储');
  await expect(page.locator('.warehouse-row')).toHaveCount(12);
  await expect(page.locator('.warehouse-scope')).toContainText('帝国总仓');
  await expect(page.locator('.warehouse-scope')).toContainText('当前表面');
  await expect(page.locator('.warehouse-breakdown').first()).toContainText('帝国');
  await expect(page.locator('.warehouse-breakdown').first()).toContainText('盖亚');
});

test('strategic layer controls are independent', async ({ page }) => {
  for (const id of ['lb-grid', 'lb-regions', 'lb-ownership', 'lb-assets']) await expect(page.locator('#' + id)).toBeVisible();
  await page.click('#lb-regions');
  await expect(page.locator('#lb-regions')).not.toHaveClass(/on/);
  await expect(page.locator('#lb-ownership')).toHaveClass(/on/);
});

test('merged warehouse marks a current surface without a warehouse', async ({ page }) => {
  await page.evaluate(async () => {
    await GE.app.enterPlanet('yinhui', { silent: true });
    GE.panels.openWarehouse('dawn');
  });
  await expect(page.locator('.warehouse-scope')).toContainText('帝国总仓');
  await expect(page.locator('.warehouse-scope')).toContainText('银辉 · 未设仓');
  await expect(page.locator('.warehouse-row')).toHaveCount(12);
});

test('warehouse advances and remains bounded', async ({ page }) => {
  const result = await page.evaluate(() => {
    const before = GE.worldState.revision;
    GE.worldState.advanceTurn();
    const w = GE.worldState.getWarehouse('dawn');
    return { before, after:GE.worldState.revision, valid:Object.keys(w.stock).every(id => w.stock[id] >= 0 && w.stock[id] <= w.capacity[id]), hasFlow:Object.values(w.lastTurn.net).some(v => v !== 0) };
  });
  expect(result.after).toBe(result.before + 1);
  expect(result.valid).toBe(true);
  expect(result.hasFlow).toBe(true);
});

test('merged warehouse uses empire totals without switching surfaces', async ({ page }) => {
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
      finite: Object.values(empire.capacity).every(Number.isFinite) && Object.values(empire.stock).every(Number.isFinite)
    };
  });

  expect(result.activeBodyId).toBe('gaiya');
  expect(result.sameState).toBe(true);
  expect(result.moonWarehouse).toBeNull();
  expect(result.surfaceIds).toEqual(['gaiya:surface']);
  expect(result.resourceKeys).toHaveLength(12);
  expect(result.finite).toBe(true);
});

test('sparse warehouse state survives reload', async ({ page }) => {
  const before = await page.evaluate(() => {
    GE.worldState.advanceTurn();
    const w = GE.worldState.getWarehouse('dawn');
    return { revision: GE.worldState.revision, food: w.stock.food, key: GE.worldState.active.storageKey };
  });
  await page.reload();
  await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, { timeout: 30000 });
  const after = await page.evaluate(() => {
    const w = GE.worldState.getWarehouse('dawn');
    return { revision: GE.worldState.revision, food: w.stock.food };
  });
  expect(after.revision).toBe(before.revision);
  expect(after.food).toBe(before.food);
});
