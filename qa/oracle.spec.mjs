/* ============================================================
   阶段 D · 神谕 / 席位 / 时钟 烟测
   ============================================================ */
import { test, expect } from 'playwright/test';

function token(tag) {
  return `ge_qa_${tag}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

test.describe('Phase D seats + clock + oracle', () => {
  const RUN = 'qa-oracle-' + Date.now().toString(36);

  test.beforeAll(async ({ request }) => {
    await request.post('/api/v1/runs', { data: { id: RUN, seed: 20260725, reset: true } });
  });

  test('health reports phase D', async ({ request }) => {
    const h = await (await request.get('/api/v1/health')).json();
    expect(h.phase).toBe('D');
    expect(h.dOracle).toBe(true);
    expect(h.clock).toBeTruthy();
  });

  test('claim seat grants 3 points; second civ independent', async ({ request }) => {
    const t1 = token('a');
    const t2 = token('b');
    const c1 = await request.post(`/api/v1/runs/${RUN}/seats/claim`, {
      data: { playerToken: t1, civId: 'dawn', displayName: '甲' }
    });
    expect([200, 201]).toContain(c1.status());
    const s1 = await c1.json();
    expect(s1.ok).toBe(true);
    expect(s1.seat.oraclePoints).toBe(3);
    expect(s1.seat.civId).toBe('dawn');
    expect(s1.seat.role).toBe('owner');

    const c2 = await request.post(`/api/v1/runs/${RUN}/seats/claim`, {
      data: { playerToken: t2, civId: 'aurel', displayName: '乙' }
    });
    expect([200, 201]).toContain(c2.status());
    const s2 = await c2.json();
    expect(s2.seat.oraclePoints).toBe(3);
    expect(s2.seat.civId).toBe('aurel');
    expect(s2.seat.role).toBe('member');

    // 同文明被占
    const c3 = await request.post(`/api/v1/runs/${RUN}/seats/claim`, {
      data: { playerToken: token('x'), civId: 'dawn' }
    });
    expect(c3.status()).toBe(409);

    const me = await (await request.get(`/api/v1/runs/${RUN}/me?playerToken=${t1}`)).json();
    expect(me.ok).toBe(true);
    expect(me.seat.oraclePoints).toBe(3);
  });

  test('clock advance grants points every 50 years', async ({ request }) => {
    const t = token('clock');
    await request.post('/api/v1/runs', { data: { id: RUN + '-clk', seed: 7, reset: true } });
    await request.post(`/api/v1/runs/${RUN}-clk/seats/claim`, {
      data: { playerToken: t, civId: 'dawn' }
    });
    const before = await (await request.get(`/api/v1/runs/${RUN}-clk/me?playerToken=${t}`)).json();
    expect(before.seat.oraclePoints).toBe(3);

    const adv = await request.post(`/api/v1/runs/${RUN}-clk/clock/advance`, {
      data: { years: 50, playerToken: t }
    });
    expect(adv.ok()).toBeTruthy();
    const body = await adv.json();
    expect(body.yearDelta).toBe(50);
    expect((body.granted || []).some(g => g.playerId === t && g.granted >= 1)).toBe(true);

    const after = await (await request.get(`/api/v1/runs/${RUN}-clk/me?playerToken=${t}`)).json();
    expect(after.seat.oraclePoints).toBeGreaterThanOrEqual(4);
  });

  test('owner can resume/pause WorldClock; member cannot', async ({ request }) => {
    const owner = token('owner');
    const member = token('member');
    const rid = RUN + '-pause';
    await request.post('/api/v1/runs', { data: { id: rid, seed: 9, reset: true } });
    await request.post(`/api/v1/runs/${rid}/seats/claim`, { data: { playerToken: owner, civId: 'dawn' } });
    await request.post(`/api/v1/runs/${rid}/seats/claim`, { data: { playerToken: member, civId: 'aurel' } });

    const denied = await request.post(`/api/v1/runs/${rid}/clock/pause`, {
      headers: { 'X-Player-Token': member },
      data: { paused: false }
    });
    expect(denied.status()).toBe(403);
    const deniedBody = await denied.json();
    expect(deniedBody.needOwner).toBe(true);

    const resume = await request.post(`/api/v1/runs/${rid}/clock/pause`, {
      headers: { 'X-Player-Token': owner },
      data: { paused: false }
    });
    expect(resume.ok()).toBeTruthy();
    const rj = await resume.json();
    expect(rj.clock.paused).toBe(false);

    const pause = await request.post(`/api/v1/runs/${rid}/clock/pause`, {
      headers: { 'X-Player-Token': owner },
      data: { paused: true }
    });
    expect(pause.ok()).toBeTruthy();
    const pj = await pause.json();
    expect(pj.clock.paused).toBe(true);
  });

  test('P9 rejects targeted harm and refunds', async ({ request }) => {
    const t = token('p9');
    const rid = RUN + '-p9';
    await request.post('/api/v1/runs', { data: { id: rid, seed: 11, reset: true } });
    await request.post(`/api/v1/runs/${rid}/seats/claim`, { data: { playerToken: t, civId: 'dawn' } });

    const bad = await request.post(`/api/v1/runs/${rid}/oracle`, {
      headers: { 'X-Player-Token': t },
      data: {
        tier: 4,
        event: {
          title: '天灾',
          seed: '给奥瑞利安降下瘟疫',
          kind: 'disaster',
          scope: 'global',
          intensity: '高'
        }
      }
    });
    expect(bad.status()).toBe(422);
    const bj = await bad.json();
    expect(bj.error).toBe('P9_TARGETED_HARM');

    const me = await (await request.get(`/api/v1/runs/${rid}/me?playerToken=${t}`)).json();
    expect(me.seat.oraclePoints).toBe(3); // 拒收不扣 / 或退点后仍为 3
  });

  test('tier1 policy oracle spends point and drains on deduce', async ({ request }) => {
    const t = token('t1');
    const rid = RUN + '-t1';
    await request.post('/api/v1/runs', { data: { id: rid, seed: 13, reset: true } });
    await request.post(`/api/v1/runs/${rid}/seats/claim`, { data: { playerToken: t, civId: 'dawn' } });

    const sub = await request.post(`/api/v1/runs/${rid}/oracle`, {
      headers: { 'X-Player-Token': t },
      data: {
        tier: 1,
        policyName: '守火长夜',
        policyText: '沿海岸保存火种与水源，勿与邻邦开战。',
        focus: 'stabilize'
      }
    });
    expect(sub.ok()).toBeTruthy();
    const sj = await sub.json();
    expect(sj.ok).toBe(true);
    expect(sj.cost).toBe(1);
    expect(sj.pointsLeft).toBe(2);
    expect(sj.edictId).toBeTruthy();

    const ded = await request.post(`/api/v1/runs/${rid}/deduce`, {
      data: { agentMode: 'rules_only' }
    });
    expect(ded.ok()).toBeTruthy();
    const dj = await ded.json();
    expect(Array.isArray(dj.patchesSummary?.oracle)).toBe(true);
    expect((dj.patchesSummary.oracle || []).length).toBeGreaterThanOrEqual(1);
    expect(String(dj.chronicle?.[0]?.事件 || '')).toMatch(/神谕|国策/);

    const snap = await (await request.get(`/api/v1/runs/${rid}/snapshot`)).json();
    const dawn = (snap.civs || []).find(c => c.id === 'dawn');
    expect(dawn?.目前国策?.名称).toBeTruthy();

    // 队列应已 completed
    const st = await (await request.get(`/api/v1/runs/${rid}/oracle?playerToken=${t}`)).json();
    expect(st.ok).toBe(true);
    expect(st.points).toBe(2);
    const ed = (st.queue || []).find(e => e.id === sj.edictId);
    expect(ed?.status).toBe('completed');
  });

  test('cancel unpaid/queued oracle refunds', async ({ request }) => {
    const t = token('cx');
    const rid = RUN + '-cx';
    await request.post('/api/v1/runs', { data: { id: rid, seed: 17, reset: true } });
    await request.post(`/api/v1/runs/${rid}/seats/claim`, { data: { playerToken: t, civId: 'sylva' } });

    const sub = await (await request.post(`/api/v1/runs/${rid}/oracle`, {
      headers: { 'X-Player-Token': t },
      data: {
        tier: 1,
        policyName: '林间静守',
        policyText: '守住林冠营地，记录可食植物与水源。',
        focus: 'stabilize'
      }
    })).json();
    expect(sub.edictId).toBeTruthy();
    expect(sub.pointsLeft).toBe(2);

    const can = await request.post(`/api/v1/runs/${rid}/oracle/${sub.edictId}/cancel`, {
      headers: { 'X-Player-Token': t },
      data: {}
    });
    expect(can.ok()).toBeTruthy();
    const cj = await can.json();
    expect(cj.cancelled).toBe(true);
    expect(cj.points).toBe(3);
  });

  test('tier3 tech accelerate and global disaster without naming', async ({ request }) => {
    const t = token('mix');
    const rid = RUN + '-mix';
    await request.post('/api/v1/runs', { data: { id: rid, seed: 19, reset: true } });
    await request.post(`/api/v1/runs/${rid}/seats/claim`, { data: { playerToken: t, civId: 'dawn' } });

    // 先 seed 一点科技树（rules 下空树也行，3C 只写 focus）
    const tech = await request.post(`/api/v1/runs/${rid}/oracle`, {
      headers: { 'X-Player-Token': t },
      data: {
        tier: 3,
        sub: 'tech',
        tech: { mode: 'accelerate', years: 10, strength: '中' },
        narrative: '愿求知之心被点燃'
      }
    });
    expect(tech.ok()).toBeTruthy();

    const dis = await request.post(`/api/v1/runs/${rid}/oracle`, {
      headers: { 'X-Player-Token': t },
      data: {
        tier: 4,
        event: {
          title: '世界流行烈症',
          seed: '无点名的时疫在诸族间传播',
          kind: 'disaster',
          scope: 'global',
          intensity: '中'
        }
      }
    });
    // 开局 3 点：花 3 后剩 0，4 点档应 FUNDS
    expect([200, 402]).toContain(dis.status());
    if (dis.status() === 402) {
      // 加点后再试
      await request.post(`/api/v1/runs/${rid}/clock/advance`, { data: { years: 200, playerToken: t } });
      const dis2 = await request.post(`/api/v1/runs/${rid}/oracle`, {
        headers: { 'X-Player-Token': t },
        data: {
          tier: 4,
          event: {
            title: '世界流行烈症',
            seed: '无点名的时疫在诸族间传播',
            kind: 'disaster',
            scope: 'global',
            intensity: '中'
          }
        }
      });
      expect(dis2.ok()).toBeTruthy();
    }

    const ded = await request.post(`/api/v1/runs/${rid}/deduce`, { data: { agentMode: 'rules_only' } });
    expect(ded.ok()).toBeTruthy();
    const body = await ded.json();
    expect((body.patchesSummary?.oracle || []).length).toBeGreaterThanOrEqual(1);
  });

  test('tier2, tier3A/3B and tier5 all apply owned forced patches', async ({ request }) => {
    const t = token('tiers');
    const rid = RUN + '-tiers';
    await request.post('/api/v1/runs', { data: { id: rid, seed: 23, reset: true } });
    await request.post(`/api/v1/runs/${rid}/seats/claim`, { data: { playerToken: t, civId: 'dawn' } });
    // 快进单次封顶 200 年，分批推进至 500 年以取得 10 点。
    for (const years of [200, 200, 100]) {
      await request.post(`/api/v1/runs/${rid}/clock/advance`, { data: { years, playerToken: t } });
    }

    const requests = [
      {
        tier: 2,
        relic: { name: '长夜火种', nature: '维系营地的温暖器物', mechanicalTags: ['camp'] }
      },
      {
        tier: 3,
        sub: 'character',
        ops: [{ op: 'stance', value: '谨慎守望 / 记录天象' }],
        narrative: '愿首领看清远方'
      },
      {
        tier: 3,
        sub: 'diplomacy',
        stance: { intent: 'open_trade', publicReason: '以交换维系和平' }
      }
    ];
    for (const data of requests) {
      const res = await request.post(`/api/v1/runs/${rid}/oracle`, {
        headers: { 'X-Player-Token': t }, data
      });
      expect(res.ok()).toBeTruthy();
    }

    // 队列硬上限为 3，先 Drain 再提交命运级神谕。
    const firstDed = await request.post(`/api/v1/runs/${rid}/deduce`, { data: { agentMode: 'rules_only' } });
    expect(firstDed.ok()).toBeTruthy();
    const fifth = await request.post(`/api/v1/runs/${rid}/oracle`, {
      headers: { 'X-Player-Token': t },
      data: { tier: 5, oracleText: '愿晨曦族人在长夜中保存火种，并以耐心等待下一次日出。' }
    });
    expect(fifth.ok()).toBeTruthy();

    const ded = await request.post(`/api/v1/runs/${rid}/deduce`, { data: { agentMode: 'rules_only' } });
    expect(ded.ok()).toBeTruthy();
    const body = await ded.json();
    expect((body.patchesSummary?.oracle || []).length).toBe(1);

    const snap = await (await request.get(`/api/v1/runs/${rid}/snapshot`)).json();
    const dawn = (snap.civs || []).find(c => c.id === 'dawn');
    expect(dawn.relics?.some(r => r.name === '长夜火种')).toBe(true);
    expect(dawn.oracleDiplomacy?.some(x => x.intent === 'open_trade')).toBe(true);
    expect(dawn.oracleMandates?.length).toBeGreaterThanOrEqual(1);
  });

  test('self-directed internal danger is not treated as P9 targeted harm', async ({ request }) => {
    const t = token('self');
    const rid = RUN + '-self';
    await request.post('/api/v1/runs', { data: { id: rid, seed: 29, reset: true } });
    await request.post(`/api/v1/runs/${rid}/seats/claim`, { data: { playerToken: t, civId: 'dawn' } });
    await request.post(`/api/v1/runs/${rid}/clock/advance`, { data: { years: 50, playerToken: t } });
    const res = await request.post(`/api/v1/runs/${rid}/oracle`, {
      headers: { 'X-Player-Token': t },
      data: {
        tier: 4,
        event: {
          title: '晨曦联邦的净火试炼',
          seed: '晨曦联邦内部必须承受一次净火试炼。',
          kind: 'internal',
          scope: 'civ_self',
          intensity: '低'
        }
      }
    });
    expect(res.ok()).toBeTruthy();
  });
});

test.describe('Phase D oracle frontend', () => {
  test('opens structured oracle wizard with P9 guidance and can start clock', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.GE && GE.app && GE.app.state && GE.app.state.started, null, { timeout: 30_000 });
    await page.locator('#btn-edict').click();
    await expect(page.locator('#oracle-hud')).toBeVisible();
    await expect(page.locator('.modal-sub').filter({ hasText: '点数购档' })).toBeVisible();
    await expect(page.locator('.modal-sub').filter({ hasText: '禁止点名伤害他方文明' })).toBeVisible();
    await expect(page.locator('.oracle-tier')).toHaveCount(5);
    await expect(page.getByText('命运神谕')).toBeVisible();

    await page.locator('#oracle-claim').click();
    await expect(page.locator('#oracle-hud')).toContainText(/点数|文明/, { timeout: 10_000 });
    await page.locator('#oracle-clock').click();
    await expect(page.locator('#oracle-hud')).toContainText('走时中', { timeout: 10_000 });
  });
});
