import { test, expect } from 'playwright/test';

/* ============================================================
   阶段 E · 创世之初 QA
   注册/登录 → 创建文明 → 盖亚落地（服务端 API 部分）
   前端全流程用例见文件末尾 describe（依赖 UI 落地后启用）
   ============================================================ */

const RUN = 'qa-genesis';

function uname(prefix) {
  return `${prefix}${Date.now().toString(36).slice(-6)}`;
}

async function register(request, username, password) {
  return request.post('/api/v1/auth/register', { data: { username, password } });
}

test.describe('Phase E auth', () => {
  test.beforeAll(async ({ request }) => {
    await request.delete('/api/v1/auth/users');
  });

  test('register issues stable token and me returns username', async ({ request }) => {
    const name = uname('神farmer_');
    const res = await register(request, name, 'secret66');
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^ge_[0-9a-f]{48}$/);
    expect(body.username).toBe(name);

    const me = await request.get('/api/v1/auth/me', {
      headers: { 'X-Player-Token': body.token }
    });
    expect(me.ok()).toBeTruthy();
    expect((await me.json()).username).toBe(name);
  });

  test('duplicate username rejected case-insensitively', async ({ request }) => {
    const name = 'DupUser' + Date.now().toString(36).slice(-5);
    expect((await register(request, name, 'secret66')).status()).toBe(201);
    expect((await register(request, name.toLowerCase(), 'other777')).status()).toBe(409);
    const dup = await register(request, name, 'secret66');
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error).toBe('name_taken');
  });

  test('login returns same token; wrong password 401', async ({ request }) => {
    const name = uname('login_');
    const reg = await (await register(request, name, 'pw123456')).json();

    const bad = await request.post('/api/v1/auth/login', {
      data: { username: name, password: 'wrong-pass' }
    });
    expect(bad.status()).toBe(401);

    const good = await request.post('/api/v1/auth/login', {
      data: { username: name, password: 'pw123456' }
    });
    expect(good.ok()).toBeTruthy();
    expect((await good.json()).token).toBe(reg.token);
  });

  test('bad shapes rejected', async ({ request }) => {
    expect((await register(request, 'x', 'secret66')).status()).toBe(400);
    expect((await register(request, 'okname', '123')).status()).toBe(400);
    expect((await register(request, 'bad name!', 'secret66')).status()).toBe(400);
  });
});

test.describe('Phase E civ creation + settle', () => {
  test.beforeAll(async ({ request }) => {
    await request.delete('/api/v1/auth/users');
    await request.post('/api/v1/runs', { data: { id: RUN, seed: 42, reset: true } });
  });

  test('unregistered token cannot create civ', async ({ request }) => {
    const res = await request.post(`/api/v1/runs/${RUN}/civs`, {
      headers: { 'X-Player-Token': 'ge_not_registered_token_000' },
      data: { name: '无名者' }
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('not_registered');
  });

  test('create civ: genesis-shaped, seat auto-bound, then settle on gaiya', async ({ request }) => {
    const name = uname('创主_');
    const { token, username } = await (await register(request, name, 'secret66')).json();
    const headers = { 'X-Player-Token': token };

    const res = await request.post(`/api/v1/runs/${RUN}/civs`, {
      headers,
      data: {
        name: '苍岚部族',
        race: '风裔',
        temperament: '求知',
        origin: '自高原冷风中醒来的观星族群。',
        leaderName: '阿岚',
        color: '#22ccaa'
      }
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    const civ = body.civ;

    // 创世态同构
    expect(civ.id).toMatch(/^pc-\d+$/);
    expect(civ.level).toBe(0);
    expect(civ.stage).toBe('原始');
    expect(civ.文明阶段).toBe('原始');
    expect(civ.capital).toBe('未定居');
    expect(civ.科技树.文明等级).toBe(0);
    expect(Object.keys(civ.科技树.节点)).toHaveLength(0);
    expect(civ.territorySeed).toBeNull();
    expect(civ.stats.科研).toBeGreaterThanOrEqual(1);
    expect(civ.playerCreated).toBe(true);

    // 领袖完整且为 Agent
    const leader = civ.leaders[0];
    expect(leader.name).toBe('阿岚');
    expect(leader.race).toBe('风裔');
    expect(leader.agent.enabled).toBe(true);
    expect(leader.personality.dims).toHaveLength(5);
    expect(leader.abilities.length).toBeGreaterThanOrEqual(3);
    leader.abilities.forEach(a => expect(a.val).toBeLessThanOrEqual(40));
    expect(leader.agentMemory).toBeTruthy();
    expect(leader.succession.leaderId).toBe(leader.id);

    // 席位自动绑定，displayName = 用户名
    expect(body.seat.civId).toBe(civ.id);
    expect(body.seat.displayName).toBe(username);
    expect(body.seat.oraclePoints).toBe(3);

    // 快照包含新文明
    const snap = await (await request.get(`/api/v1/runs/${RUN}/snapshot`)).json();
    const inSnap = (snap.civs || []).find(c => c.id === civ.id);
    expect(inSnap).toBeTruthy();
    expect(snap.seatsPublic.some(s => s.civId === civ.id)).toBe(true);

    // 同一用户二次创建 → already_bound
    const again = await request.post(`/api/v1/runs/${RUN}/civs`, {
      headers, data: { name: '第二文明' }
    });
    expect(again.status()).toBe(409);
    expect((await again.json()).error).toBe('already_bound');

    // 非盖亚落地 → 422
    const wrongSurface = await request.post(`/api/v1/runs/${RUN}/civs/${civ.id}/settle`, {
      headers,
      data: { surfaceId: 'yinhui:surface', tileId: 'g32-v00001', lat: 10, lon: 20 }
    });
    expect(wrongSurface.status()).toBe(422);

    // 盖亚落地
    const settle = await request.post(`/api/v1/runs/${RUN}/civs/${civ.id}/settle`, {
      headers,
      data: { surfaceId: 'gaiya:surface', tileId: 'g64-v01234', lat: 12.5, lon: 33.8 }
    });
    expect(settle.ok()).toBeTruthy();
    const settled = await settle.json();
    expect(settled.capital).toContain('初火营地');

    // 落地后快照：territorySeed / capitalSeeds / 编年
    const snap2 = await (await request.get(`/api/v1/runs/${RUN}/snapshot`)).json();
    const civ2 = snap2.civs.find(c => c.id === civ.id);
    expect(civ2.territorySeed.lat).toBeCloseTo(12.5);
    expect(civ2.capital).toBe(settled.capital);
    const gaiyaDef = snap2.bodySurfaces['gaiya:surface'];
    expect(gaiyaDef.capitalSeeds[civ.id]).toBeTruthy();
    expect(gaiyaDef.claimRadius[civ.id]).toBeGreaterThan(0);
    const landedEntry = (snap2.chronicle || []).find(e => e.类型 === '落地');
    expect(landedEntry).toBeTruthy();
    expect(landedEntry.事件).toContain('阿岚');

    // 重复落地 → 409
    const resettle = await request.post(`/api/v1/runs/${RUN}/civs/${civ.id}/settle`, {
      headers,
      data: { surfaceId: 'gaiya:surface', tileId: 'g64-v09999', lat: -5, lon: 60 }
    });
    expect(resettle.status()).toBe(409);
    expect((await resettle.json()).error).toBe('already_settled');
  });

  test('settle requires own seat', async ({ request }) => {
    const { token } = await (await register(request, uname('outsider_'), 'secret66')).json();
    const res = await request.post(`/api/v1/runs/${RUN}/civs/dawn/settle`, {
      headers: { 'X-Player-Token': token },
      data: { surfaceId: 'gaiya:surface', tileId: 'g64-v00001', lat: 0, lon: 0 }
    });
    expect(res.status()).toBe(403);
  });

  test('duplicate civ name rejected; run civ limit enforced', async ({ request }) => {
    test.setTimeout(60_000);
    const rid = 'qa-genesis-limit';
    await request.post('/api/v1/runs', { data: { id: rid, seed: 7, reset: true } });

    const { token } = await (await register(request, uname('n_'), 'secret66')).json();
    const dup = await request.post(`/api/v1/runs/${rid}/civs`, {
      headers: { 'X-Player-Token': token },
      data: { name: '晨曦部族' }
    });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error).toBe('name_taken');

    // 种子 5 文明 + 7 个玩家文明 = 12 上限；第 8 个玩家拒绝
    for (let i = 0; i < 7; i++) {
      const u = await (await register(request, uname(`u${i}_`), 'secret66')).json();
      const r = await request.post(`/api/v1/runs/${rid}/civs`, {
        headers: { 'X-Player-Token': u.token },
        data: { name: `试炼氏族${i}` }
      });
      expect(r.status()).toBe(201);
    }
    const over = await (await register(request, uname('over_'), 'secret66')).json();
    const blocked = await request.post(`/api/v1/runs/${rid}/civs`, {
      headers: { 'X-Player-Token': over.token },
      data: { name: '超限氏族' }
    });
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error).toBe('civ_limit');
  });

  test('frontend full flow: token session, landing mode picks tile and settles', async ({ page, request }) => {
    test.setTimeout(120_000);
    await request.post('/api/v1/runs/local-seed/reset');
    const name = uname('玩家_');
    const { token, username } = await (await register(request, name, 'secret66')).json();
    const created = await (await request.post('/api/v1/runs/local-seed/civs', {
      headers: { 'X-Player-Token': token },
      data: { name: '雾谷部族', temperament: '守序', color: '#5dade2' }
    })).json();
    const civId = created.civ.id;

    await page.goto('/');
    await page.evaluate(([tok, uname2]) => {
      localStorage.clear();
      localStorage.setItem('ge-player-token', tok);
      localStorage.setItem('ge-player-name', uname2);
    }, [token, username]);
    await page.reload();
    await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, { timeout: 30000 });

    // 账号 HUD 显示用户名（F6/F7：token 与用户名统一）
    await page.evaluate(() => GE.app.refreshAccountHud());
    expect(await page.locator('#account-label').textContent()).toBe(username);
    // 新文明已随快照进入文明坞
    const inDock = await page.evaluate(id => (GE.data.civs || []).some(c => c.id === id), civId);
    expect(inDock).toBe(true);

    // 进入落地模式，选一块合法无主地块
    await page.evaluate(id => GE.app.startLandingMode(id), civId);
    await page.waitForFunction(() => GE.app.state.landingCivId, null, { timeout: 15000 });
    const tileId = await page.evaluate(id => {
      const t = GE.worldState.tiles.find(x => !x.ownerCivId && GE.territory.terrainAllowed(id, x.terrain));
      GE.app.showTileContext(t.id);
      return t.id;
    }, civId);
    await page.click('#ctx-landing-confirm');

    // 确认后：地块归属 + 首都种子 + 行星仓 + focusCapital 可用（F1）
    await page.waitForFunction(([tid, cid]) => {
      const t = GE.worldState.getTile(tid);
      return t && t.ownerCivId === cid;
    }, [tileId, civId], { timeout: 15000 });
    const checks = await page.evaluate(cid => ({
      seed: !!(GE.worldState.def.capitalSeeds && GE.worldState.def.capitalSeeds[cid]),
      warehouse: !!GE.worldState.getWarehouse(cid),
      capitalAnchor: (GE.views.planet._capitals || []).some(c => c.id === cid),
      landingOff: !GE.app.state.landingCivId,
      capital: (GE.data.civs.find(c => c.id === cid) || {}).capital
    }), civId);
    expect(checks.seed).toBe(true);
    expect(checks.warehouse).toBe(true);
    expect(checks.capitalAnchor).toBe(true);
    expect(checks.landingOff).toBe(true);
    expect(checks.capital).toContain('初火营地');

    // 服务端存证
    const snap = await (await request.get('/api/v1/runs/local-seed/snapshot')).json();
    const civ = snap.civs.find(c => c.id === civId);
    expect(civ.territorySeed).toBeTruthy();
    expect(civ.landing.tileId).toBe(tileId);
  });

  test('created civ participates in deduce (decisions + coverage)', async ({ request }) => {
    test.setTimeout(90_000);
    const rid = 'qa-genesis-deduce';
    await request.post('/api/v1/runs', { data: { id: rid, seed: 9, reset: true } });
    const u = await (await register(request, uname('ded_'), 'secret66')).json();
    const created = await (await request.post(`/api/v1/runs/${rid}/civs`, {
      headers: { 'X-Player-Token': u.token },
      data: { name: '推演氏族', temperament: '尚武' }
    })).json();
    await request.post(`/api/v1/runs/${rid}/civs/${created.civ.id}/settle`, {
      headers: { 'X-Player-Token': u.token },
      data: { surfaceId: 'gaiya:surface', tileId: 'g64-v02222', lat: 20, lon: -40 }
    });

    const res = await request.post(`/api/v1/runs/${rid}/deduce`, { data: {} });
    expect(res.ok()).toBeTruthy();
    const round = await res.json();
    const mine = round.decisions.filter(d => d.civId === created.civ.id);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0].characterName).toBeTruthy();
  });
});
