import { test, expect } from 'playwright/test';

/* ============================================================
   阶段 F · 多人同局体验 QA
   页面 A（Alice，owner）在线，Bob 经 API 操作，
   验证 SSE 实时收敛：建文明 / 落地 / 时钟权限 / 同局席位 / 年结算。
   ============================================================ */

const RUN = 'local-seed';

function uname(prefix) {
  return `${prefix}${Date.now().toString(36).slice(-6)}`;
}

async function register(request, username, password) {
  return request.post('/api/v1/auth/register', { data: { username, password } });
}

test.describe('Phase F multiplayer live sync', () => {
  test('genesis actions of another player converge without reload', async ({ page, request }) => {
    test.setTimeout(180_000);
    await request.post(`/api/v1/runs/${RUN}/reset`);
    await request.delete('/api/v1/auth/users');

    // Alice 注册并建文明：首个入座者 → owner
    const alice = await (await register(request, uname('爱丽丝_'), 'secret66')).json();
    await request.post(`/api/v1/runs/${RUN}/civs`, {
      headers: { 'X-Player-Token': alice.token },
      data: { name: '晨风部族', temperament: '求知', color: '#e6a948' }
    });

    // Alice 页面在线（登录态 + SSE）
    await page.goto('/');
    await page.evaluate(([tok, n]) => {
      localStorage.clear();
      localStorage.setItem('ge-player-token', tok);
      localStorage.setItem('ge-player-name', n);
    }, [alice.token, alice.username]);
    await page.reload();
    await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, { timeout: 30000 });
    await page.waitForTimeout(1000); // 等 EventSource 完成握手

    // Bob 经 API 建文明 → Alice 页面无刷新出现新文明
    const bob = await (await register(request, uname('鲍勃_'), 'secret66')).json();
    const bCreated = await (await request.post(`/api/v1/runs/${RUN}/civs`, {
      headers: { 'X-Player-Token': bob.token },
      data: { name: '铁砧氏族', temperament: '重商', color: '#5dade2' }
    })).json();
    const bCivId = bCreated.civ.id;
    await page.waitForFunction(id => (GE.data.civs || []).some(c => c.id === id), bCivId, { timeout: 15000 });
    const dockCount = await page.evaluate(() => document.querySelectorAll('#civ-dock .civ-card').length);
    expect(dockCount).toBeGreaterThanOrEqual(7); // 5 个种子文明 + Alice + Bob

    // Bob 落地（Alice 页面选出合法地块坐标，经 API settle）→ Alice 无刷新收敛
    const pick = await page.evaluate(id => {
      const t = GE.worldState.tiles.find(x => !x.ownerCivId && GE.territory.terrainAllowed(id, x.terrain));
      const lat = Math.asin(Math.max(-1, Math.min(1, t.center[1]))) * 180 / Math.PI;
      const lon = Math.atan2(t.center[2], t.center[0]) * 180 / Math.PI;
      return { tileId: t.id, lat, lon };
    }, bCivId);
    const settle = await request.post(`/api/v1/runs/${RUN}/civs/${bCivId}/settle`, {
      headers: { 'X-Player-Token': bob.token },
      data: { surfaceId: 'gaiya:surface', tileId: pick.tileId, lat: pick.lat, lon: pick.lon }
    });
    expect(settle.ok()).toBeTruthy();

    await page.waitForFunction(([tid, cid]) => {
      const t = GE.worldState.getTile(tid);
      return t && t.ownerCivId === cid;
    }, [pick.tileId, bCivId], { timeout: 15000 });
    const conv = await page.evaluate(cid => ({
      seed: !!(GE.worldState.def.capitalSeeds && GE.worldState.def.capitalSeeds[cid]),
      radius: GE.worldState.def.claimRadius && GE.worldState.def.claimRadius[cid],
      capital: (GE.data.civs.find(c => c.id === cid) || {}).capital || '',
      landing: !!(GE.data.civs.find(c => c.id === cid) || {}).landing
    }), bCivId);
    expect(conv.seed).toBe(true);
    expect(conv.radius).toBe(4);
    expect(conv.capital).toContain('初火营地');
    expect(conv.landing).toBe(true);

    // 时钟权限：Bob（member）被拒，Alice（owner）成功
    const denied = await request.post(`/api/v1/runs/${RUN}/clock/pause`, {
      headers: { 'X-Player-Token': bob.token },
      data: { paused: false }
    });
    expect(denied.status()).toBe(403);
    const allowed = await request.post(`/api/v1/runs/${RUN}/clock/pause`, {
      headers: { 'X-Player-Token': alice.token },
      data: { paused: false }
    });
    expect(allowed.ok()).toBeTruthy();
    await request.post(`/api/v1/runs/${RUN}/clock/pause`, {
      headers: { 'X-Player-Token': alice.token },
      data: { paused: true }
    });

    // 账号面板「同局玩家」：两名玩家与角色可见
    await page.click('#btn-account');
    await page.waitForSelector('#acc-seats', { timeout: 15000 });
    const seatText = await page.locator('#acc-seats').textContent();
    expect(seatText).toContain(alice.username);
    expect(seatText).toContain(bob.username);
    expect(seatText).toContain('局主');
    expect(seatText).toContain('成员');
    await page.evaluate(() => GE.modal.close());
  });

  test('observer converges after another player triggers a round', async ({ page, request }) => {
    test.setTimeout(120_000);
    // 匿名观察者页面在线
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, { timeout: 30000 });
    await page.waitForTimeout(1000);

    const before = await page.evaluate(() => ({
      year: GE.data.world.年数,
      revision: Number((GE.snapshot.last && GE.snapshot.last.revision) || 0)
    }));

    const ded = await request.post(`/api/v1/runs/${RUN}/deduce`, { data: {} });
    expect(ded.ok()).toBeTruthy();
    const round = await ded.json();
    expect(Number(round.revision)).toBeGreaterThan(before.revision);

    // round.done → 观察端拉快照收敛：revision 跟上、年数/编年前进、HUD 同步
    await page.waitForFunction(rev =>
      Number((GE.snapshot.last && GE.snapshot.last.revision) || 0) >= Number(rev),
    round.revision, { timeout: 30000 });
    const after = await page.evaluate(() => ({
      year: GE.data.world.年数,
      hudYear: document.getElementById('ws-year-num').textContent,
      chronicle: (GE.data.chronicle || []).length
    }));
    expect(after.year).toBeGreaterThan(before.year);
    expect(after.hudYear.replace(/[,\s]/g, '')).toContain(String(after.year));
    expect(after.chronicle).toBeGreaterThan(0);
  });
});
