import { test, expect } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#boot.done');
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
  await expect(page.locator('.warehouse-row')).toHaveCount(8);
});

test('strategic layer controls are independent', async ({ page }) => {
  for (const id of ['lb-grid', 'lb-regions', 'lb-ownership', 'lb-assets']) await expect(page.locator('#' + id)).toBeVisible();
  await page.click('#lb-regions');
  await expect(page.locator('#lb-regions')).not.toHaveClass(/on/);
  await expect(page.locator('#lb-ownership')).toHaveClass(/on/);
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
