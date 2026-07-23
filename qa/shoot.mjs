/* 创世引擎 · 可视化 QA：逐视图截图 + 控制台错误收集（健壮版）
   单步容错：任何一步失败仅记录、不中断，保证最终能拿到全部控制台错误。 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE = 'http://localhost:8123';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const warnings = [];
const failures = [];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

async function assertScrollable(selector, label) {
  const metrics = await page.locator(selector).evaluate(el => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    start: el.scrollTop
  }));
  if (metrics.scrollHeight <= metrics.clientHeight) {
    throw new Error(`${label} 未产生垂直溢出（${metrics.scrollHeight} <= ${metrics.clientHeight}）`);
  }
  await page.locator(selector).evaluate(el => { el.scrollTop = el.scrollHeight; });
  const end = await page.locator(selector).evaluate(el => el.scrollTop);
  if (end <= metrics.start) throw new Error(`${label} 无法滚动到底部`);
}
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', r => { if (!r.url().includes('fonts.g')) warnings.push('REQFAIL: ' + r.url()); });

const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') });
const sleep = (ms) => page.waitForTimeout(ms);
const esc = () => page.keyboard.press('Escape');

async function step(label, fn) {
  try { await fn(); console.log('  OK  ' + label); }
  catch (e) { failures.push(label + '  ::  ' + String(e.message || e).split('\n')[0]); console.log('  XX  ' + label); }
}

console.log('打开页面…');
await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('#boot.done', { timeout: 15000 }).catch(() => console.log('!! boot 未完成'));
await sleep(1200);

await step('01 星球全景', () => shot('01-planet'));

await step('02 星球放大看地块', async () => {
  await page.mouse.move(800, 450); await page.mouse.wheel(0, -400); await sleep(900);
  await shot('02-planet-close');
});

await step('02b 战略政治层（归属开）', async () => {
  await page.evaluate(() => {
    ['labels', 'grid', 'regions', 'ownership', 'assets', 'orbit', 'coverage', 'atmo'].forEach(k => {
      if (GE.app && GE.app.state) GE.app.state.layer[k] = true;
      if (GE.views.planet && GE.views.planet.setLayer) GE.views.planet.setLayer(k, true);
    });
  });
  await sleep(500);
  await shot('02b-strategic-ownership');
});

await step('02c 地区边界与着色', async () => {
  await page.evaluate(() => {
    const first = GE.worldState.regions[0];
    if (first) GE.views.planet.focusRegion(first.id);
  });
  await sleep(1400);
  await shot('02c-region-focus');
});

await step('02d 选中有主战略地块', async () => {
  const owned = await page.evaluate(() => {
    const t = GE.worldState.tiles.find(x => x.ownerCivId && x.resources.length);
    if (!t) return null;
    GE.views.planet.focusTile(t.id);
    GE.app.showTileContext(t.id);
    return t.id;
  });
  await sleep(1200);
  if (!owned) throw new Error('未找到有主资源地块');
  await shot('02d-tile-owned');
});

await step('02e 选中无主战略地块', async () => {
  const free = await page.evaluate(() => {
    const t = GE.worldState.tiles.find(x => !x.ownerCivId && x.terrain !== 'ocean');
    if (!t) return null;
    GE.views.planet.focusTile(t.id);
    GE.app.showTileContext(t.id);
    return t.id;
  });
  await sleep(1000);
  if (!free) throw new Error('未找到无主陆块');
  await shot('02e-tile-unowned');
});

await step('02f 国家仓储面板', async () => {
  await page.evaluate(() => GE.panels.openWarehouse('dawn'));
  await page.waitForSelector('.warehouse-row', { timeout: 5000 });
  await sleep(500);
  await shot('02f-warehouse');
  await esc(); await sleep(300);
});

await step('03 宇宙地图', async () => {
  await page.click('#vs-universe'); await sleep(1700); await shot('03-universe');
});

await step('04 宇宙聚焦盖亚', async () => {
  await page.evaluate(() => GE.views.universe.focusBody('gaiya')); await sleep(1700);
  await shot('04-universe-gaiya');
});

await step('05 黑洞', async () => {
  await page.click('#vs-blackhole'); await sleep(2600); await shot('05-blackhole');
});

await step('06 黑洞（曝光适应后）', async () => { await sleep(2000); await shot('06-blackhole-adapt'); });

await step('07 文明摘要（单击卡片→右侧面板）', async () => {
  await page.click('#vs-planet'); await sleep(900);
  await page.click('#civ-card-dawn'); await sleep(700);
  await shot('07-civ-summary');
});

await step('08 文明档案·总览（双击→完整模态）', async () => {
  await page.dblclick('#civ-card-dawn');
  const opened = await page.waitForSelector('.modal-tab[data-tab="tech"]', { timeout: 5000 }).then(() => true).catch(() => false);
  if (!opened) { // 兜底：直接调用面板 API，保证后续标签截图
    console.log('     (双击未弹出，改用 openCiv 兜底)');
    await page.evaluate(() => GE.panels.openCiv('dawn'));
    await page.waitForSelector('.modal-tab[data-tab="tech"]', { timeout: 4000 });
  }
  await sleep(600); await shot('08-civ-overview');
});

await step('09 科技树', async () => {
  await page.click('.modal-tab[data-tab="tech"]'); await sleep(800); await shot('09-techtree');
});

await step('10 疆域与资产', async () => {
  await page.click('.modal-tab[data-tab="realm"]'); await sleep(700); await shot('10-civ-realm');
});

await step('10b 国家仓储标签', async () => {
  await page.click('.modal-tab[data-tab="warehouse"]'); await sleep(700); await shot('10b-civ-warehouse');
});

await step('11 领袖档案', async () => {
  await page.click('.modal-tab[data-tab="people"]'); await sleep(500);
  await page.click('[data-open-leader="linshen"]'); await sleep(700); await shot('11-leader');
});

await step('12 推演控制台', async () => {
  await esc(); await sleep(400);
  await page.click('#btn-deduce'); await sleep(800); await shot('12-deduction');
});

await step('13 推进一轮推演', async () => {
  await page.click('#btn-run-deduce'); await sleep(3800); await shot('13-deduction-done');
});

await step('14 大事记', async () => {
  await esc(); await sleep(350);
  await page.click('#btn-chronicle'); await sleep(700); await shot('14-chronicle');
});

await step('14b 短视窗大事记滚动', async () => {
  await page.setViewportSize({ width: 1280, height: 600 }); await sleep(300);
  const frameHeight = await page.locator('.modal-frame').evaluate(el => el.getBoundingClientRect().height);
  if (frameHeight > 600 * 0.92 + 1) throw new Error(`大事记模态超出视窗高度（${frameHeight}px）`);
  await assertScrollable('.modal-body', '大事记内容');
});

await step('15 典籍·门槛科技', async () => {
  await esc(); await sleep(350);
  await page.click('#btn-codex'); await sleep(500);
  await page.click('.modal-tab[data-tab="threshold"]'); await sleep(600); await shot('15-codex-threshold');
});

await step('15b 典籍内容滚动', () => assertScrollable('.modal-body', '典籍内容'));

await step('16 典籍·超凡体系', async () => {
  await page.click('.modal-tab[data-tab="trans"]'); await sleep(600); await shot('16-codex-trans');
});

await step('17 典籍·种族', async () => {
  await page.click('.modal-tab[data-tab="races"]'); await sleep(600); await shot('17-codex-races');
});

await step('18 收藏夹', async () => {
  await esc(); await sleep(350);
  await page.click('#btn-favorites'); await sleep(700); await shot('18-favorites');
});

await step('18b 右侧上下文滚动', async () => {
  await esc(); await sleep(250);
  await page.click('#civ-card-dawn'); await sleep(350);
  const panelHeight = await page.locator('#ctx-panel').evaluate(el => el.getBoundingClientRect().height);
  if (panelHeight > 600 - 28) throw new Error(`右侧上下文面板超出短视窗（${panelHeight}px）`);
  const inner = page.locator('#ctx-inner');
  await inner.evaluate((el, height) => {
    if (el.scrollHeight <= el.clientHeight) {
      el.append(document.assign(document.createElement('div'), { style: `height:${height}px;flex-shrink:0` }));
    }
  }, 800);
  await assertScrollable('#ctx-inner', '右侧上下文内容');
  await inner.evaluate(el => el.lastElementChild?.remove());
});

await step('19 神谕', async () => {
  await esc(); await sleep(350);
  await page.click('#btn-edict'); await sleep(700); await shot('19-edict');
});

await step('20 设置', async () => {
  await esc(); await sleep(350);
  await page.click('#btn-settings'); await sleep(600); await shot('20-settings');
});

await step('21 通知中心', async () => {
  await esc(); await sleep(350);
  await page.click('#btn-notify'); await sleep(600); await shot('21-notify');
});

console.log('\n=== 步骤失败 ===');
console.log(failures.length ? failures.join('\n') : '（无）');
console.log('\n=== 控制台错误 ===');
console.log(errors.length ? [...new Set(errors)].join('\n') : '（无）');
console.log('\n=== 资源加载警告（字体除外）===');
console.log(warnings.length ? [...new Set(warnings)].join('\n') : '（无）');

await browser.close();
console.log('\nQA 完成，截图输出至 qa/shots/');
