/**
 * 手动试运行：LLM 设置表单 + Agent 推演一轮
 * 用法: node qa/_manual-llm-agent-trial.mjs
 * 依赖: 本机 http://127.0.0.1:8124 已启动
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.GE_BASE || 'http://127.0.0.1:8124';
const OUT_DIR = path.resolve('qa/shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  console: [],
  pageErrors: [],
  requestFailed: [],
  steps: [],
  bugs: [],
  ok: true
};

function note(step, data) {
  report.steps.push({ step, at: new Date().toISOString(), ...data });
  console.log('·', step, data && data.summary != null ? data.summary : '');
}

function bug(title, detail) {
  report.bugs.push({ title, detail });
  report.ok = false;
  console.error('✗ BUG:', title, detail || '');
}

async function main() {
  // 重置默认 run
  const resetRes = await fetch(`${BASE}/api/v1/runs/local-seed/reset`, { method: 'POST' });
  note('api.reset', { status: resetRes.status, body: await resetRes.json().catch(() => null) });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => {
    const entry = { type: msg.type(), text: msg.text() };
    report.console.push(entry);
    if (['error', 'warning'].includes(msg.type())) {
      console.log(`  [console.${msg.type()}]`, msg.text().slice(0, 200));
    }
  });
  page.on('pageerror', err => {
    report.pageErrors.push(String(err));
    console.error('  [pageerror]', String(err).slice(0, 300));
  });
  page.on('requestfailed', req => {
    report.requestFailed.push({ url: req.url(), failure: req.failure()?.errorText });
  });

  // ---- 1. 打开首页 ----
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.GE && GE.app && GE.app.state && GE.app.state.started,
    null,
    { timeout: 45000 }
  );
  const boot = await page.evaluate(() => ({
    year: GE.data.world.年数,
    bodies: (GE.data.spaceBodies || []).length,
    civs: (GE.data.civs || []).length,
    mode: GE.snapshot && GE.snapshot.mode,
    llm: GE.llmConfig ? GE.llmConfig.get() : null,
    agents: (GE.data.civs || []).flatMap(c => (c.leaders || []).filter(l => l.isAgent !== false).map(l => ({
      civ: c.id, name: l.name, role: l.role, stance: l.agentStance
    })))
  }));
  note('boot', { summary: `year=${boot.year} bodies=${boot.bodies} civs=${boot.civs} agents=${boot.agents.length}`, boot });
  await page.screenshot({ path: path.join(OUT_DIR, 'trial-01-boot.png'), fullPage: false });

  if (boot.agents.length < 5) bug('启用 Agent 人物偏少', `only ${boot.agents.length}`);
  if (!boot.llm) bug('GE.llmConfig 未加载', null);

  // ---- 2. 设置面板 · LLM 表单 ----
  await page.click('#btn-settings');
  await page.waitForSelector('#set-llm-base', { timeout: 8000 });
  await page.screenshot({ path: path.join(OUT_DIR, 'trial-02-settings.png'), fullPage: false });

  // 空 key 拉模型 —— 应友好报错
  await page.fill('#set-llm-base', 'https://api.openai.com/v1');
  await page.fill('#set-llm-key', '');
  await page.click('#btn-llm-fetch');
  await page.waitForTimeout(600);
  const statusEmptyKey = await page.locator('#llm-status').textContent();
  note('llm.fetch.emptyKey', { summary: statusEmptyKey });
  if (!/API Key|填写|密钥/i.test(statusEmptyKey || '')) {
    bug('空 Key 拉取未给出明确错误', statusEmptyKey);
  }

  // 假 key + 公网 OpenAI —— 预期 401 或网络失败，表单不得崩溃
  // 自定义 switch 把原生 checkbox 藏了，force/JS 设置
  await page.fill('#set-llm-key', 'sk-trial-invalid-for-ui-test');
  await page.fill('#set-llm-model', 'gpt-4o-mini');
  const switchVis = await page.evaluate(() => {
    const inp = document.querySelector('#set-llm-enabled');
    if (!inp) return { found: false };
    const cs = getComputedStyle(inp);
    const label = inp.closest('label.switch');
    // 点自定义 switch 标签
    if (label) label.click();
    else { inp.checked = true; inp.dispatchEvent(new Event('change', { bubbles: true })); }
    return {
      found: true,
      checked: inp.checked,
      visibility: cs.visibility,
      opacity: cs.opacity,
      width: cs.width,
      display: cs.display,
      labelFound: !!label
    };
  });
  note('llm.enabled.switch', { switchVis });
  if (!switchVis.found) bug('启用 LLM 开关 DOM 缺失', null);
  if (switchVis.found && (switchVis.visibility === 'hidden' || switchVis.width === '0px' || switchVis.display === 'none')) {
    // 这是自定义 switch 的常见做法；确认 label 可点即可
    if (!switchVis.labelFound) bug('启用 LLM 开关不可见且无 label 可点', switchVis);
  }
  if (!switchVis.checked) bug('点击 switch 后 enabled 未勾选', switchVis);

  await page.selectOption('#set-agent-mode', 'hybrid');
  // 设置面板可能很长，先滚到按钮可见
  await page.evaluate(() => {
    document.querySelector('#btn-llm-save')?.scrollIntoView({ block: 'center' });
  });
  await page.click('#btn-llm-save');
  await page.waitForTimeout(400);
  const statusSaved = await page.locator('#llm-status').textContent();
  note('llm.save', { summary: statusSaved });

  await page.click('#btn-llm-test');
  // 等待试调用结束（可能超时/401）
  await page.waitForFunction(
    () => {
      const t = document.querySelector('#llm-status')?.textContent || '';
      return t && !/试调用中/.test(t);
    },
    null,
    { timeout: 50000 }
  ).catch(() => {});
  const statusTest = await page.locator('#llm-status').textContent();
  note('llm.test.invalidKey', { summary: statusTest });
  if (!statusTest || /试调用中/.test(statusTest)) {
    bug('试调用无终态', statusTest);
  }

  // 校验 localStorage 持久化
  const stored = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('ge-llm-config-v1')); } catch { return null; }
  });
  note('llm.localStorage', { stored: { ...stored, apiKey: stored?.apiKey ? '[set]' : '' } });
  if (!stored || stored.agentMode !== 'hybrid' || !stored.enabled) {
    bug('LLM 配置未正确持久化', stored);
  }

  // 切回 rules_only 做真推演（当前服务端只支持 rules_only）
  await page.selectOption('#set-agent-mode', 'rules_only');
  await page.evaluate(() => {
    const inp = document.querySelector('#set-llm-enabled');
    if (inp && inp.checked) {
      const label = inp.closest('label.switch');
      if (label) label.click();
      else { inp.checked = false; inp.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  });
  await page.click('#btn-llm-save');
  await page.waitForTimeout(300);

  // 关闭设置（点遮罩或 ESC）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---- 3. 打开推演控制台并推进一轮 ----
  const before = await page.evaluate(() => ({
    year: GE.data.world.年数,
    bodies: (GE.data.spaceBodies || []).length,
    logLen: (GE.data.deduction.log || []).length,
    round: GE.app.state.deductionRound
  }));
  note('deduce.before', { before });

  // 优先点顶栏推演按钮
  const deduceBtn = page.locator('#btn-deduce, [data-action="deduce"], button:has-text("推演")').first();
  if (await deduceBtn.count()) {
    await deduceBtn.click();
  } else {
    // 退回直接调面板
    await page.evaluate(() => GE.panels.openDeduction());
  }
  await page.waitForSelector('#btn-run-deduce, #deduce-root', { timeout: 10000 });
  await page.screenshot({ path: path.join(OUT_DIR, 'trial-03-deduce-console.png'), fullPage: false });

  // 点推进
  await page.click('#btn-run-deduce');
  // 等待按钮恢复 + 年数变化或 toast
  await page.waitForFunction(
    (y0) => {
      const btn = document.querySelector('#btn-run-deduce');
      const year = GE.data.world.年数;
      const done = btn && !btn.disabled && year > y0;
      return done;
    },
    before.year,
    { timeout: 60000 }
  ).catch(async () => {
    const snap = await page.evaluate(() => ({
      year: GE.data.world.年数,
      btn: document.querySelector('#btn-run-deduce')?.textContent,
      disabled: document.querySelector('#btn-run-deduce')?.disabled,
      toast: [...document.querySelectorAll('.toast, .toasts .item')].map(e => e.textContent).slice(0, 5)
    }));
    bug('推演按钮未在超时内完成', snap);
  });

  const after = await page.evaluate(() => {
    const log0 = (GE.data.deduction.log || [])[0] || {};
    const pending = GE.data.deduction.pendingDecisions || [];
    return {
      year: GE.data.world.年数,
      bodies: (GE.data.spaceBodies || []).length,
      logLen: (GE.data.deduction.log || []).length,
      round: GE.app.state.deductionRound,
      summary: log0.summary,
      lenses: log0.lenses,
      decisions: pending.length,
      decisionSample: pending.slice(0, 4).map(p => ({
        leader: p.leader, civ: p.civ, kind: p.kind, urgency: p.urgency,
        decision: String(p.decision || '').slice(0, 60)
      })),
      newFacilities: (GE.data.spaceBodies || []).filter(b => b.flags && b.flags.artificial).map(b => ({
        id: b.id, name: b.name, parent: b.parent, kind: b.flags.facilityKind
      })),
      chronicle0: (GE.data.chronicle || [])[0],
      hudYear: document.getElementById('ws-year-num')?.textContent,
      pageErrorsHint: null
    };
  });
  note('deduce.after', { after });
  await page.screenshot({ path: path.join(OUT_DIR, 'trial-04-after-deduce.png'), fullPage: false });

  // ---- 断言 / bug 检查 ----
  if (!(after.year > before.year)) {
    bug('年数未推进', { before: before.year, after: after.year });
  } else if (after.year !== before.year + 7) {
    // edict 是 +1，普通推演应 +7
    bug('年数增量异常（期望 +7）', { before: before.year, after: after.year, delta: after.year - before.year });
  }

  if (after.decisions < 5) {
    bug('Agent 决策条数不足', after.decisions);
  }

  if (!after.lenses || !after.lenses.政治) {
    bug('六棱镜结果缺失', after.lenses);
  }

  if (!after.summary) {
    bug('推演 summary 为空', after);
  }

  // HUD 年数是否与数据一致
  const hudDigits = String(after.hudYear || '').replace(/[,\s]/g, '');
  if (hudDigits && !hudDigits.includes(String(after.year))) {
    bug('HUD 年数与 GE.data.world.年数 不一致', { hud: after.hudYear, data: after.year });
  }

  // 再直接调一次 API 对齐检查
  const apiMeta = await (await fetch(`${BASE}/api/v1/runs/local-seed`)).json();
  note('api.meta.after', { apiMeta });
  if (apiMeta.year !== after.year) {
    bug('前端年数与服务端 Run 不一致', { front: after.year, server: apiMeta.year });
  }
  if (!(apiMeta.revision >= 1)) {
    bug('服务端 revision 未增长', apiMeta);
  }

  // 宇宙视图：切过去看是否炸
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const uniOk = await page.evaluate(async () => {
    try {
      GE.app.switchView('universe', { silent: true });
      return {
        view: GE.app.state.view,
        bodies: (GE.data.spaceBodies || []).length,
        hasReload: !!(GE.views.universe && GE.views.universe.reloadBodies)
      };
    } catch (e) {
      return { error: String(e) };
    }
  });
  note('universe.switch', { uniOk });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT_DIR, 'trial-05-universe.png'), fullPage: false });
  if (uniOk.error) bug('切换宇宙视图异常', uniOk.error);

  // 控制台错误过滤（忽略字体/第三方噪音 / 故意用假 key 打 OpenAI 的失败）
  const realErrors = report.console.filter(c =>
    c.type === 'error'
    && !/fonts\.g|favicon|ResizeObserver|api\.openai\.com|Failed to load resource: net::ERR_/i.test(c.text)
  );
  const realPageErr = report.pageErrors.filter(e => !/ResizeObserver/i.test(e));
  if (realErrors.length) bug('控制台 error', realErrors.slice(0, 8));
  if (realPageErr.length) bug('未捕获 pageerror', realPageErr.slice(0, 5));
  if (report.requestFailed.length) {
    const critical = report.requestFailed.filter(r =>
      /\/api\//.test(r.url) && !/api\.openai\.com/.test(r.url)
    );
    if (critical.length) bug('API 请求失败', critical);
  }

  // LLM 表单再开一次确认 hybrid 文案 / rules 默认说明还在
  await page.click('#btn-settings');
  await page.waitForSelector('#set-agent-mode');
  const modeVal = await page.inputValue('#set-agent-mode');
  note('settings.reopen.mode', { modeVal });
  // 我们刚保存的是 rules_only
  if (modeVal !== 'rules_only') {
    bug('重新打开设置后 agentMode 未保留', modeVal);
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'trial-06-settings-again.png'), fullPage: false });

  report.finishedAt = new Date().toISOString();
  report.summary = {
    bugs: report.bugs.length,
    yearBefore: before.year,
    yearAfter: after.year,
    decisions: after.decisions,
    bodiesAfter: after.bodies,
    facilities: after.newFacilities?.length || 0,
    consoleErrors: realErrors.length,
    pageErrors: realPageErr.length
  };

  const outPath = path.resolve('qa/shots/trial-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n======== TRIAL REPORT ========');
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.bugs.length) {
    console.log('BUGS:');
    report.bugs.forEach(b => console.log(' -', b.title, b.detail ? JSON.stringify(b.detail).slice(0, 200) : ''));
  } else {
    console.log('No bugs found in this trial.');
  }
  console.log('report →', outPath);

  await browser.close();
  process.exit(report.bugs.length ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL', err);
  process.exit(2);
});
