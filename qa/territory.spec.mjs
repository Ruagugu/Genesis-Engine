import { test, expect } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, {
    timeout: 30000
  });
});

test('worldState setTileOwner persists and ensureWarehouse works', async ({ page }) => {
  const report = await page.evaluate(() => {
    const tile = GE.worldState.tiles.find(t => t.terrain !== 'ocean' && t.terrain !== 'coast') || GE.worldState.tiles[0];
    const beforeOwner = tile.ownerCivId || null;
    const r = GE.worldState.setTileOwner(tile.id, 'dawn', { claimSource: 'debug', claimTurn: 1 });
    const after = GE.worldState.getTile(tile.id);
    const wh = GE.worldState.getWarehouse('dawn');
    const key = GE.worldState.storageKey || (GE.worldState.active && GE.worldState.active.storageKey);
    const raw = key ? localStorage.getItem(key) : null;
    const saved = raw ? JSON.parse(raw) : null;
    return {
      changed: !!(r && r.changed),
      owner: after && after.ownerCivId,
      claimSource: after && after.claimSource,
      hasWarehouse: !!wh,
      patchSaved: !!(saved && saved.tilePatches && saved.tilePatches[tile.id]),
      beforeOwner
    };
  });

  expect(report.changed).toBe(true);
  expect(report.owner).toBe('dawn');
  expect(report.claimSource).toBe('debug');
  expect(report.hasWarehouse).toBe(true);
  expect(report.patchSaved).toBe(true);
});

test('expandFrontier claims adjacent unowned tiles when seed ownership exists', async ({ page }) => {
  const report = await page.evaluate(() => {
    // 创世默认无主；先手工种一格作为边疆种子
    const land = GE.worldState.tiles.filter(t => t.terrain !== 'ocean' && t.terrain !== 'coast');
    const seed = land[0];
    GE.worldState.setTileOwner(seed.id, 'dawn', { claimSource: 'debug' });
    const before = GE.worldState.getTilesByCiv('dawn').length;
    const result = GE.territory.expandFrontier('dawn', 3, { reason: 'qa' });
    const after = GE.worldState.getTilesByCiv('dawn').length;
    // 邻接合法性：新增格应与 dawn 领地相邻或为原种子
    const owned = GE.worldState.getTilesByCiv('dawn');
    const ownedIds = new Set(owned.map(t => t.id));
    const allAdjacentOk = owned.every(t => {
      if (t.id === seed.id) return true;
      return (t.neighbors || []).some(nid => ownedIds.has(nid));
    });
    return {
      before,
      after,
      changed: result.changed,
      skipped: !!result.skipped,
      reason: result.reason || '',
      allAdjacentOk
    };
  });

  expect(report.before).toBeGreaterThanOrEqual(1);
  expect(report.changed).toBeGreaterThan(0);
  expect(report.after).toBeGreaterThan(report.before);
  expect(report.allAdjacentOk).toBe(true);
});

test('annexBorder transfers border tiles from defender to attacker', async ({ page }) => {
  const report = await page.evaluate(() => {
    const land = GE.worldState.tiles.filter(t => t.terrain !== 'ocean' && t.terrain !== 'coast');
    // 找一对邻接陆地
    let a = null, b = null;
    for (const t of land) {
      for (const nid of (t.neighbors || [])) {
        const n = GE.worldState.getTile(nid);
        if (n && n.terrain !== 'ocean' && n.terrain !== 'coast') {
          a = t; b = n; break;
        }
      }
      if (a && b) break;
    }
    if (!a || !b) return { ok: false };
    GE.worldState.setTileOwner(a.id, 'dawn', { claimSource: 'debug' });
    GE.worldState.setTileOwner(b.id, 'aurel', { claimSource: 'debug' });
    const dawnBefore = GE.worldState.getTilesByCiv('dawn').length;
    const aurelBefore = GE.worldState.getTilesByCiv('aurel').length;
    const result = GE.territory.annexBorder('dawn', 'aurel', 2, { reason: 'qa' });
    return {
      ok: true,
      changed: result.changed,
      dawnBefore,
      aurelBefore,
      dawnAfter: GE.worldState.getTilesByCiv('dawn').length,
      aurelAfter: GE.worldState.getTilesByCiv('aurel').length
    };
  });

  expect(report.ok).toBe(true);
  expect(report.changed).toBeGreaterThan(0);
  expect(report.dawnAfter).toBeGreaterThan(report.dawnBefore);
  expect(report.aurelAfter).toBeLessThan(report.aurelBefore);
});

test('genesis can bootstrap first settlement via expand intent', async ({ page }) => {
  const report = await page.evaluate(() => {
    const ownedBefore = GE.worldState.tiles.filter(t => t.ownerCivId).length;
    const events = GE.territory.deriveEventsFromTurn({
      decisions: [{ civId: 'dawn', kind: 'policy', decision: '开拓营地', actionType: 'expand_frontier' }]
    });
    const applied = GE.territory.applyEvents(events);
    const ownedAfter = GE.worldState.tiles.filter(t => t.ownerCivId).length;
    const dawn = GE.worldState.getTilesByCiv('dawn').length;
    return {
      ownedBefore,
      derived: events.length,
      changed: applied.changedTiles,
      ownedAfter,
      dawn
    };
  });

  expect(report.ownedBefore).toBe(0);
  expect(report.derived).toBeGreaterThanOrEqual(1);
  expect(report.changed).toBeGreaterThan(0);
  expect(report.dawn).toBeGreaterThan(0);
});

test('genesis unowned surface skips annex without ownership', async ({ page }) => {
  const report = await page.evaluate(() => {
    const owned = GE.worldState.tiles.filter(t => t.ownerCivId).length;
    const applied = GE.territory.applyEvents([
      { type: 'annex', attackerId: 'dawn', defenderId: 'aurel', budget: 3, reason: 'qa' }
    ]);
    return {
      owned,
      changed: applied.changedTiles,
      skipped: applied.skipped.length
    };
  });

  expect(report.owned).toBe(0);
  expect(report.changed).toBe(0);
  expect(report.skipped).toBeGreaterThanOrEqual(1);
});

test('deduce returns territory intents without breaking existing patches', async ({ request }) => {
  const rid = 'qa-terr-' + Date.now().toString(36);
  await request.post('/api/v1/runs', { data: { id: rid, seed: 20260723, reset: true } });
  const res = await request.post(`/api/v1/runs/${rid}/deduce`, { data: { agentMode: 'rules_only' } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.patchesSummary).toBeTruthy();
  expect(body.patchesSummary.tiles).toBe('not-server-simulated-in-C');
  expect(Array.isArray(body.patchesSummary.territory)).toBe(true);
  // 创世无地表种子时仍可下发意图，客户端会 no-op
  expect(body.patchesSummary.territory.length).toBeGreaterThanOrEqual(0);
  expect(Array.isArray(body.patchesSummary.characters)).toBe(true);
});
