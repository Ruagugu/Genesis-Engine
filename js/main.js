/* ============================================================
   创世引擎 · main.js — 应用核心
   启动 / 单渲染器视图路由 / 外壳交互 / 上下文面板 / 前端推演演示
   ============================================================ */
window.GE = window.GE || {};

GE.app = (function () {
  'use strict';

  const canvas = document.getElementById('gl');
  const labelHost = document.getElementById('map-labels');
  const hoverCard = document.getElementById('hover-card');
  const ctxPanel = document.getElementById('ctx-panel');
  const ctxInner = document.getElementById('ctx-inner');

  const state = {
    view: 'planet',
    activeBodyId: 'gaiya',
    activeSurfaceId: null,
    selectedCiv: null,
    playing: true,
    speedIndex: 2,
    speeds: [0, 0.25, 1, 4, 16],
    layer: { labels: true, grid: true, regions: true, ownership: true, assets: true, orbit: true, coverage: true, atmo: true },
    initialized: Object.create(null),
    started: false,
    deductionRound: (GE.data.deduction.log[0] && GE.data.deduction.log[0].round) || 0,
    simulatedYear: GE.data.world.年数
  };

  const settings = {
    quality: 0.85,
    qualityPreset: 'high',
    autoRotate: true,
    cityLights: true,
    autoDeduce: false,
    autoDeduceIntervalSec: 30,
    reduced: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };

  let autoDeduceTimer = null;
  let autoDeduceBusy = false;
  let autoDeduceAccum = 0;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setClearColor(0x04060c, 1);

  const labels = new GE.Labels(labelHost);
  const env = {
    renderer,
    dom: canvas,
    labels,
    width: innerWidth,
    height: innerHeight,
    labelsVisible: true
  };

  let last = performance.now();
  let elapsed = 0;
  let raf = 0;
  let resizeTimer = 0;

  /* ============ 启动 ============ */
  async function boot() {
    decorateIcons();
    const bootStatus = document.getElementById('boot-status');
    const bootFill = document.getElementById('boot-fill');
    try {
      if (bootStatus) bootStatus.textContent = '载入世界快照 …';
      if (bootFill) bootFill.style.width = '12%';
      if (GE.snapshot && GE.snapshot.hydrate) {
        await GE.snapshot.hydrate();
      }
      state.deductionRound = (GE.data.deduction.log[0] && GE.data.deduction.log[0].round) || 0;
      state.simulatedYear = GE.data.world.年数 || 0;
    } catch (err) {
      console.error('[创世引擎] 快照水合失败', err);
      if (bootStatus) {
        bootStatus.textContent = '快照载入失败，回退本地种子';
        bootStatus.style.color = 'var(--amber, #d8b76a)';
      }
      // http 失败时保留 data.world.js 种子，继续启动
      if (GE.snapshot) {
        try {
          GE.snapshot.mode = 'local';
          GE.snapshot.last = GE.snapshot.buildFromData(GE.data, { runId: 'local-fallback' });
        } catch (_) { /* ignore */ }
      }
    }

    if (GE.surfaces) GE.surfaces.init();
    hydrateWorldStrip();
    renderCivDock();
    restoreDeductionConsole();
    syncFavoritesFromLeaders();
    try {
      const dockCount = document.getElementById('dock-count');
      if (dockCount) dockCount.textContent = (GE.data.civs || []).length;
    } catch (_) { /* ignore */ }
    bindShell();
    GE.notify.bind();

    const stages = [
      ['校验创世契约 …', 18],
      ['构筑多星球表面注册表 …', 42],
      ['部署星链轨道壳 …', 68],
      ['唤醒文明 Agent …', 86],
      ['世界开始运转', 100]
    ];
    let i = 0;
    function next() {
      const st = stages[i];
      document.getElementById('boot-status').textContent = st[0];
      document.getElementById('boot-fill').style.width = st[1] + '%';
      i++;
      if (i < stages.length) setTimeout(next, settings.reduced ? 20 : 165);
      else setTimeout(finishBoot, settings.reduced ? 30 : 360);
    }

    try {
      initView('planet');
      applyLayers();
      refreshPlanetHud();
      next();
    } catch (err) {
      console.error('[创世引擎] 初始化失败', err);
      document.getElementById('boot-status').textContent = '图形引擎初始化失败';
      document.getElementById('boot-status').style.color = 'var(--red)';
      setTimeout(finishBoot, 500);
    }
  }

  function finishBoot() {
    const bootEl = document.getElementById('boot');
    bootEl.classList.add('done');
    state.started = true;
    loadAutoDeduceSettings();
    pushInitialNotifications();
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function decorateIcons(root) {
    (root || document).querySelectorAll('[data-ic]').forEach(el => {
      el.innerHTML = GE.icons.icon(el.dataset.ic, Number(el.dataset.icSize) || 18);
    });
    document.getElementById('brand-mark').innerHTML = GE.icons.icon('logo', 36);
    document.getElementById('boot-mark').innerHTML = GE.icons.icon('logo', 84);
  }

  function hydrateWorldStrip() {
    const w = GE.data.world;
    document.getElementById('ws-era-name').textContent = w.纪元.纪元;
    document.getElementById('ws-era-num').textContent = w.纪元.纪年;
    document.getElementById('ws-year-num').textContent = GE.fmt.num(w.年数);
    document.getElementById('ws-energy-num').textContent = w.能级;
    document.getElementById('ws-energy-tier').textContent = w.能级档位;
    document.querySelector('#ws-energy-meter i').style.width = Math.min(100, w.能级 / 3.2) + '%';
    document.getElementById('ws-civ-num').textContent = GE.data.civs.length;
    document.getElementById('dock-count').textContent = GE.data.civs.length;
    refreshPlanetHud();
  }

  function activeBody() {
    const id = state.activeBodyId || (GE.surfaces && GE.surfaces.activeBodyId) || 'gaiya';
    return (GE.data.spaceBodies || []).find(b => b.id === id) || null;
  }

  function refreshPlanetHud() {
    const body = activeBody();
    const nameEl = document.getElementById('ws-planet-name');
    const roleEl = document.getElementById('ws-planet-role');
    if (!nameEl) return;
    if (body) {
      nameEl.textContent = body.name;
      const home = GE.surfaces ? GE.surfaces.isPlayerHome(body) : !!body.home;
      if (roleEl) roleEl.textContent = home ? '母星' : (body.type || '星球');
      const tip = document.getElementById('ws-planet');
      if (tip) tip.dataset.tip = home ? '母星 · 点击定位' : (body.name + ' · 点击定位');
    } else {
      nameEl.textContent = GE.data.world.母星名;
      if (roleEl) roleEl.textContent = '母星';
    }
  }

  /**
   * 进入任意 landable 天体的星球视图。
   * @param {string} bodyId
   * @param {{ silent?: boolean, unloadPrevious?: boolean }} opts
   */
  async function enterPlanet(bodyId, opts) {
    opts = opts || {};
    const body = (GE.data.spaceBodies || []).find(b => b.id === bodyId);
    if (!body) {
      GE.toast.warn('未知天体', bodyId);
      return;
    }
    if (GE.surfaces && !GE.surfaces.isLandable(body)) {
      GE.toast.info('不可登陆', body.name + ' 暂无星球地图（气态体 / 恒星 / 站等）。');
      return;
    }
    try {
      // C5：缺 surface def 时远程 ensure / 本地合成
      if (GE.surfaces && GE.surfaces.ensureRemote) {
        await GE.surfaces.ensureRemote(bodyId, { force: !!opts.forceEnsure });
      }
      if (state.initialized.planet && GE.views.planet.loadSurface) {
        GE.views.planet.loadSurface(bodyId, { silent: opts.silent, unloadPrevious: opts.unloadPrevious });
      } else if (GE.surfaces) {
        GE.surfaces.activate(bodyId);
      }
      state.activeBodyId = bodyId;
      state.activeSurfaceId = GE.surfaces ? GE.surfaces.activeSurfaceId : null;
      switchView('planet', { silent: opts.silent });
      refreshPlanetHud();
      if (!opts.silent) {
        const home = GE.surfaces && GE.surfaces.isPlayerHome(body);
        GE.toast.show({
          type: 'info', icon: 'globe',
          title: home ? '抵达母星 · ' + body.name : '登陆 · ' + body.name,
          msg: home ? '战略网格与文明疆域已就绪。' : '已载入独立表面网格；仓储与盖亚互不串写。'
        });
      }
    } catch (err) {
      console.error('[创世引擎] enterPlanet', err);
      GE.toast.critical('登陆失败', err.message || String(err));
    }
  }

  function renderCivDock() {
    const host = document.getElementById('civ-list');
    if (!host) return;
    host.innerHTML = (GE.data.civs || []).map((c, i) => {
      const leader = (c.leaders && c.leaders[0]) || null;
      const leaderLine = leader
        ? `${GE.esc(leader.title || '领袖')} · ${GE.esc(leader.name || '未名')}`
        : '暂无领袖';
      const progress = (c.科技树 && Number(c.科技树.下一阶段)) || 0;
      return `
      <article class="civ-card" id="civ-card-${c.id}" data-civ="${c.id}" style="--civ:${c.color};animation-delay:${i * 0.06}s" tabindex="0" role="button" aria-label="查看${GE.esc(c.name)}">
        <div class="civ-swatch">${GE.icons.icon(c.id === 'bronze' ? 'gem' : c.id === 'abyss' ? 'water' : c.id === 'sylva' ? 'tree' : 'flag', 21)}</div>
        <div class="civ-info">
          <div class="civ-name-row"><span class="civ-name">${GE.esc(c.name)}</span><span class="civ-lv">CIV ${c.level}</span></div>
          <div class="civ-leader">${leaderLine}</div>
          <div class="civ-bars"><span class="civ-lvbar"><i style="width:${progress}%"></i></span><span class="civ-lvnum">${progress}%</span></div>
        </div>
      </article>`;
    }).join('');

    host.querySelectorAll('.civ-card').forEach(card => {
      const activate = () => {
        selectCiv(card.dataset.civ);
        showCivContext(card.dataset.civ);
        if (state.view === 'planet' && GE.views.planet._built) GE.views.planet.focusCapital(card.dataset.civ);
      };
      card.addEventListener('click', activate);
      card.addEventListener('dblclick', () => GE.panels.openCiv(card.dataset.civ));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
    });
    if (state.selectedCiv) {
      host.querySelectorAll('.civ-card').forEach(c => c.classList.toggle('on', c.dataset.civ === state.selectedCiv));
    }
  }

  function syncFavoritesFromLeaders() {
    GE.data.favorites = Array.isArray(GE.data.favorites) ? GE.data.favorites : [];
    const byId = new Map(GE.data.favorites.map(f => [f.id, f]));
    (GE.data.civs || []).forEach(civ => {
      const L = (civ.leaders || [])[0];
      if (!L || !L.id) return;
      const entry = {
        id: L.id,
        name: L.name,
        civ: civ.id,
        civId: civ.id,
        种族与身份: `${L.race || '未知'} · ${civ.name}${L.title ? ' · ' + L.title : ''}`,
        超凡能力: (L.abilities || []).slice(0, 2).map(a => `${a.name}${a.val != null ? ' ' + a.val : ''}`).join(' · ') || '未显化',
        寿命与年龄: `${L.age != null ? L.age : '?'}岁 / 预期${L.lifespanMax != null ? L.lifespanMax : '?'}岁`,
        性格与动机: L.motive || L.background || '尚在形成中',
        近况: L.bodyState || L.agentStance || '近况未知',
        age: L.age,
        race: L.race,
        title: L.title
      };
      if (byId.has(L.id)) Object.assign(byId.get(L.id), entry);
      else {
        GE.data.favorites.unshift(entry);
        byId.set(L.id, entry);
      }
    });
    // 去掉已不存在的旧领袖条目（保留手动收藏时也可用 id 匹配）
    const live = new Set((GE.data.civs || []).flatMap(c => (c.leaders || []).map(l => l.id)));
    GE.data.favorites = GE.data.favorites.filter(f => !f.civId || live.has(f.id) || !/^.*-g\d+$/.test(String(f.id || '')));
  }

  const DEDUCE_PERSIST_KEY = 'ge-deduction-console-v1';
  function persistDeductionConsole() {
    try {
      const d = GE.data.deduction || {};
      const payload = {
        version: 1,
        savedAt: Date.now(),
        year: state.simulatedYear,
        deductionRound: state.deductionRound,
        log: Array.isArray(d.log) ? d.log.slice(0, 40) : [],
        pendingDecisions: Array.isArray(d.pendingDecisions) ? d.pendingDecisions.slice(0, 40) : [],
        lastMonologueReel: Array.isArray(d.lastMonologueReel) ? d.lastMonologueReel.slice(0, 20) : [],
        lenses: Array.isArray(d.lenses) ? d.lenses : ['政治', '军事', '经济', '科技', '思潮', '个人']
      };
      localStorage.setItem(DEDUCE_PERSIST_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('[创世引擎] persist deduction console', err);
    }
  }

  function restoreDeductionConsole() {
    try {
      const raw = localStorage.getItem(DEDUCE_PERSIST_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.log)) return false;
      GE.data.deduction = GE.data.deduction || { lenses: [], rounds: 0, pendingDecisions: [], log: [] };
      // 仅当当前 log 为空（如创世重置后）才用本地缓存恢复，避免覆盖更新的服务端状态
      if (!GE.data.deduction.log || !GE.data.deduction.log.length) {
        GE.data.deduction.log = saved.log;
        GE.data.deduction.pendingDecisions = saved.pendingDecisions || [];
        GE.data.deduction.lastMonologueReel = saved.lastMonologueReel || [];
        if (Array.isArray(saved.lenses) && saved.lenses.length) GE.data.deduction.lenses = saved.lenses;
        if (Number.isFinite(Number(saved.deductionRound))) state.deductionRound = Number(saved.deductionRound);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[创世引擎] restore deduction console', err);
      return false;
    }
  }

  function pushInitialNotifications() {
    const initial = [
      { type: 'critical', icon: 'skull', title: '暗线异动', msg: '深渊低语中反复出现「收割」一词，来源未知。' },
      { type: 'warn', icon: 'flask', title: '亚光速引擎点火在即', msg: '苏砚提交提前试车申请，星枢院尚未裁决。' },
      { type: 'agent', icon: 'chip', title: '文明 Agent 已上线', msg: '5 个文明、7 名关键人物已接入决策队列。' }
    ];
    initial.slice().reverse().forEach(n => GE.notify.push({ ...n, time: Date.now() }));
    setTimeout(() => GE.toast.show(initial[1]), 700);
  }

  /* ============ 视图生命周期 ============ */
  function initView(id) {
    const v = GE.views[id];
    if (!v) throw new Error('未知视图: ' + id);
    if (!state.initialized[id]) {
      v.init(env);
      state.initialized[id] = true;
    }
    return v;
  }

  function switchView(id, opts) {
    opts = opts || {};
    if (id === state.view && state.initialized[id]) return;
    const old = GE.views[state.view];
    if (old && state.initialized[state.view] && old.deactivate) old.deactivate();

    let next;
    try {
      next = initView(id);
    } catch (err) {
      console.error('[创世引擎] 视图初始化失败', id, err);
      GE.toast.critical('视图载入失败', '图形着色器未能完成编译，请切换渲染质量后重试。');
      return;
    }

    state.view = id;
    document.querySelectorAll('.vs-btn').forEach(b => b.classList.toggle('on', b.dataset.view === id));
    document.body.dataset.view = id;
    updateLayerToolbar(id);
    applyLayers();
    filterLabels();
    if (next.activate) next.activate();

    clearSelection();
    updateViewHUD(id);
    if (!opts.silent) {
      const names = { planet: '星球地图', universe: '曦阳星系', blackhole: '深渊之瞳' };
      GE.toast.show({ type: 'info', icon: id === 'planet' ? 'globe' : id === 'universe' ? 'universe' : 'blackhole', title: names[id], msg: id === 'blackhole' ? '实时求解史瓦西时空中的零测地线。' : '视图已切换。' });
    }
  }

  function updateViewHUD(id) {
    let scaleEl = document.getElementById('universe-scale');
    if (id === 'universe' && !scaleEl) {
      scaleEl = GE.h('<div id="universe-scale" class="glass"><span class="mono">1 图距单位</span> ≈ 100 万公里 · 星轨按开普勒周期自动运行</div>');
      document.body.appendChild(scaleEl);
    }
    if (scaleEl) scaleEl.hidden = id !== 'universe';
    document.getElementById('vignette').style.opacity = id === 'blackhole' ? '0' : '1';
  }

  function updateLayerToolbar(id) {
    const config = {
      planet: { labels: ['地名标注', 'message'], grid: ['战略网格', 'hex'], regions: ['地区色彩与边界', 'globe'], ownership: ['国家归属', 'flag'], assets: ['建筑与资源', 'gem'], orbit: ['轨道与卫星', 'orbit'], coverage: ['星链覆盖圈', 'radar'], atmo: ['大气层', 'layers'] },
      universe: { labels: ['天体标注', 'message'], grid: ['小行星带', 'grid'], regions: ['地区', 'globe'], ownership: ['归属', 'flag'], assets: ['资产', 'gem'], orbit: ['星轨与宜居带', 'orbit'], coverage: ['深空网格', 'radar'], atmo: ['天体辉光', 'layers'] },
      blackhole: { labels: ['观测标注', 'message'], grid: ['参考网格', 'grid'], regions: ['地区', 'globe'], ownership: ['归属', 'flag'], assets: ['资产', 'gem'], orbit: ['吸积盘', 'orbit'], coverage: ['光子环增强', 'radar'], atmo: ['HDR Bloom', 'sparkle'] }
    }[id];
    Object.entries(config).forEach(([k, cfg]) => {
      const b = document.getElementById('lb-' + k);
      b.dataset.tip = cfg[0];
      b.innerHTML = GE.icons.icon(cfg[1], 16);
      const unavailable = (id !== 'planet' && (k === 'regions' || k === 'ownership' || k === 'assets')) ||
        (id === 'universe' && k === 'coverage') || (id === 'blackhole' && (k === 'labels' || k === 'grid' || k === 'coverage'));
      b.disabled = unavailable;
      b.style.display = unavailable ? 'none' : '';
    });
  }

  function applyLayers() {
    const v = GE.views[state.view];
    if (!v || !state.initialized[state.view] || !v.setLayer) return;
    Object.entries(state.layer).forEach(([k, on]) => v.setLayer(k, on));
    filterLabels();
  }

  function filterLabels() {
    const visible = state.layer.labels;
    labelHost.style.display = visible ? '' : 'none';
    labelHost.querySelectorAll('.map-label').forEach(el => {
      const id = el.dataset.label || '';
      const belongs = state.view === 'planet'
        ? (id.startsWith('cap-') || id.startsWith('region-') || id.startsWith('fac-') || id === 'station')
        : state.view === 'universe' ? id.startsWith('u-') : false;
      el.style.visibility = belongs ? 'visible' : 'hidden';
    });
  }

  /* ============ 主循环 ============ */
  function frame(now) {
    const rawDt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    const simScale = state.playing ? state.speeds[state.speedIndex] : 0;
    const dt = rawDt * simScale;
    elapsed += rawDt;

    // 到时自动推演：按墙钟秒计，暂停时间时不触发
    if (settings.autoDeduce && state.playing && state.started) {
      autoDeduceAccum += rawDt;
      const interval = Math.max(5, Number(settings.autoDeduceIntervalSec) || 30);
      if (autoDeduceAccum >= interval && !autoDeduceBusy) {
        autoDeduceAccum = 0;
        triggerAutoDeduce();
      }
    } else {
      autoDeduceAccum = 0;
    }

    const v = GE.views[state.view];
    if (v && state.initialized[state.view]) {
      if (v.update) v.update(dt, rawDt, elapsed);
      if (state.view !== 'blackhole') {
        labels.update(v.camera, innerWidth, innerHeight, state.view === 'planet' ? new THREE.Vector3() : null);
        filterLabels();
      }
      renderer.setRenderTarget(null);
      if (v.render) v.render(renderer);
    }
    raf = requestAnimationFrame(frame);
  }

  async function triggerAutoDeduce() {
    if (autoDeduceBusy || !settings.autoDeduce) return;
    autoDeduceBusy = true;
    try {
      await runDeduction({ silent: true, auto: true });
    } catch (err) {
      console.warn('[创世引擎] auto deduce', err);
    } finally {
      autoDeduceBusy = false;
    }
  }

  function setAutoDeduce(enabled, intervalSec) {
    settings.autoDeduce = !!enabled;
    if (intervalSec != null && Number.isFinite(Number(intervalSec))) {
      settings.autoDeduceIntervalSec = Math.max(5, Math.min(600, Number(intervalSec)));
    }
    try {
      localStorage.setItem('ge-auto-deduce', settings.autoDeduce ? '1' : '0');
      localStorage.setItem('ge-auto-deduce-interval', String(settings.autoDeduceIntervalSec));
    } catch (_) { /* ignore */ }
    autoDeduceAccum = 0;
    return {
      enabled: settings.autoDeduce,
      intervalSec: settings.autoDeduceIntervalSec
    };
  }

  function loadAutoDeduceSettings() {
    try {
      const on = localStorage.getItem('ge-auto-deduce');
      if (on === '1') settings.autoDeduce = true;
      if (on === '0') settings.autoDeduce = false;
      const sec = Number(localStorage.getItem('ge-auto-deduce-interval'));
      if (Number.isFinite(sec) && sec >= 5) settings.autoDeduceIntervalSec = Math.min(600, sec);
    } catch (_) { /* ignore */ }
  }

  /* ============ 外壳事件 ============ */
  function bindShell() {
    window.addEventListener('resize', onResize, { passive: true });

    document.querySelectorAll('.vs-btn').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    document.querySelectorAll('.lb-btn').forEach(btn => btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const key = btn.id.replace('lb-', '');
      state.layer[key] = !state.layer[key];
      btn.classList.toggle('on', state.layer[key]);
      btn.classList.toggle('off', !state.layer[key]);
      const v = GE.views[state.view];
      if (v && v.setLayer) v.setLayer(key, state.layer[key]);
      filterLabels();
    }));

    document.getElementById('tb-play').addEventListener('click', togglePlay);
    document.getElementById('tb-slower').addEventListener('click', () => changeSpeed(-1));
    document.getElementById('tb-faster').addEventListener('click', () => changeSpeed(1));
    document.getElementById('tb-advance').addEventListener('click', () => GE.panels.openDeduction());

    document.getElementById('btn-edict').addEventListener('click', () => GE.panels.openEdict());
    document.getElementById('btn-deduce').addEventListener('click', () => GE.panels.openDeduction());
    document.getElementById('btn-settings').addEventListener('click', () => GE.panels.openSettings());
    document.getElementById('btn-codex').addEventListener('click', () => GE.panels.openCodex());
    document.getElementById('btn-chronicle').addEventListener('click', () => GE.panels.openChronicle());
    document.getElementById('btn-favorites').addEventListener('click', () => GE.panels.openFavorites());
    document.getElementById('ws-era').addEventListener('click', () => GE.panels.openWorld());
    document.getElementById('ws-year').addEventListener('click', () => GE.panels.openDeduction());
    document.getElementById('ws-energy').addEventListener('click', () => GE.panels.openCodex('scale'));
    document.getElementById('ws-civs').addEventListener('click', () => GE.panels.openWorld());
    document.getElementById('ws-planet').addEventListener('click', () => {
      enterPlanet(state.activeBodyId || 'gaiya', { silent: true });
      if (GE.views.planet._built) GE.views.planet.focusHome();
    });

    const notifyBtn = document.getElementById('btn-notify');
    const notifyPanel = document.getElementById('notify-panel');
    notifyBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = notifyPanel.hidden;
      notifyPanel.hidden = !open;
      notifyBtn.setAttribute('aria-expanded', String(open));
      if (open) GE.notify.markRead();
    });
    document.getElementById('notify-clear').addEventListener('click', e => { e.stopPropagation(); GE.notify.clear(); });
    document.addEventListener('click', e => {
      if (!e.target.closest('#notify-wrap')) { notifyPanel.hidden = true; notifyBtn.setAttribute('aria-expanded', 'false'); }
    });

    document.addEventListener('keydown', e => {
      if (GE.modal.isOpen() || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === '1') switchView('planet');
      else if (e.key === '2') switchView('universe');
      else if (e.key === '3') switchView('blackhole');
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key.toLowerCase() === 'c') GE.panels.openChronicle();
      else if (e.key.toLowerCase() === 'a') GE.panels.openDeduction();
    });
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      env.width = innerWidth; env.height = innerHeight;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.qualityPreset === 'low' ? 1 : settings.qualityPreset === 'mid' ? 1.35 : 1.7));
      renderer.setSize(innerWidth, innerHeight, false);
      Object.entries(GE.views).forEach(([id, v]) => {
        if (state.initialized[id] && v.resize) v.resize(innerWidth, innerHeight);
      });
    }, 80);
  }

  function togglePlay() {
    state.playing = !state.playing;
    const b = document.getElementById('tb-play');
    b.setAttribute('aria-pressed', String(state.playing));
    b.innerHTML = GE.icons.icon(state.playing ? 'pause' : 'play', 16);
    b.dataset.tip = state.playing ? '暂停时间' : '继续时间';
    GE.toast.show({ type: 'info', icon: state.playing ? 'play' : 'pause', title: state.playing ? '时间继续流逝' : '世界已暂停', msg: state.playing ? `当前流速 ${state.speeds[state.speedIndex].toFixed(2).replace(/\.00$/, '')}×` : '星轨与世界推演时间已冻结。' });
  }

  function changeSpeed(delta) {
    state.speedIndex = THREE.MathUtils.clamp(state.speedIndex + delta, 0, state.speeds.length - 1);
    if (state.speedIndex === 0) state.playing = false;
    else state.playing = true;
    const speed = state.speeds[state.speedIndex];
    document.getElementById('tb-speed').textContent = speed === 0 ? '暂停' : speed.toFixed(speed < 1 ? 2 : 1) + '×';
    document.getElementById('tb-play').innerHTML = GE.icons.icon(state.playing ? 'pause' : 'play', 16);
    GE.toast.info('时间流速已调整', speed === 0 ? '世界推演暂停。' : `当前时间流速 ${speed}×。`);
  }

  /* ============ 选择与右侧上下文 ============ */
  function selectCiv(id) {
    state.selectedCiv = id || null;
    document.querySelectorAll('.civ-card').forEach(c => c.classList.toggle('on', c.dataset.civ === id));
  }

  function clearSelection() {
    selectCiv(null);
    ctxPanel.hidden = true;
    ctxInner.innerHTML = '';
  }

  function showCivContext(id) {
    const c = GE.data.civs.find(x => x.id === id); if (!c) return;
    const leader = c.leaders[0];
    ctxInner.innerHTML = `
      <header class="ctx-head" style="--ctx-c:${c.color}">
        <button class="ctx-close" id="ctx-close-civ" aria-label="关闭详情">${GE.icons.icon('x', 14)}</button>
        <div class="ctx-kicker">${GE.icons.icon('flag', 12)}文明 · ${GE.esc(c.社会形态)}</div>
        <div class="ctx-title">${GE.esc(c.name)}</div>
        <div class="ctx-sub">${GE.esc(c.capital)} · ${GE.esc(c.文明阶段)} · ${c.level} 级「${GE.esc(GE.data.civLevels[c.level].name)}」</div>
      </header>
      <div class="ctx-body">
        <div class="ctx-stats">
          <div class="ctx-stat"><div class="cs-num">${c.stats.人口}</div><div class="cs-label">百万人口</div></div>
          <div class="ctx-stat"><div class="cs-num">${c.stats.军力}</div><div class="cs-label">军事</div></div>
          <div class="ctx-stat"><div class="cs-num">${c.stats.科研}</div><div class="cs-label">科研</div></div>
        </div>
        <div class="civ-color-strip"><i style="width:${c.stats.经济}%;background:${c.color}"></i><i style="flex:1;background:rgba(255,255,255,.07)"></i></div>
        <div class="sec-head"><span class="sec-ic">${GE.icons.icon('target', 14)}</span><span>目前国策</span><span class="sec-line"></span></div>
        <div class="panel" style="border-left:2px solid ${c.color}"><div style="font-weight:700;color:${c.color}">${GE.esc(c.目前国策.名称)}</div><p class="prose" style="font-size:11.5px;margin-top:5px">${GE.esc(c.目前国策.内容)}</p></div>
        <div class="sec-head"><span class="sec-ic">${GE.icons.icon('crown', 14)}</span><span>文明领袖</span><span class="sec-line"></span></div>
        <button class="panel" id="ctx-leader" style="display:flex;gap:10px;align-items:center;text-align:left;cursor:pointer">
          <span style="width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:${c.color}22;color:${c.color};font-family:var(--f-serif);font-weight:900">${GE.esc(leader.name[0])}</span>
          <span style="flex:1"><b style="display:block;font-size:13px">${GE.esc(leader.name)}</b><i style="display:block;font-style:normal;font-size:10.5px;color:var(--tx-2)">${GE.esc(leader.title)} · ${leader.age} 岁</i></span>
          ${GE.icons.icon('chevR', 14)}
        </button>
        <div class="sec-head"><span class="sec-ic">${GE.icons.icon('compass', 14)}</span><span>思潮</span><span class="sec-line"></span></div>
        <p class="prose" style="font-size:11.5px">${GE.esc(c.思潮)}</p>
      </div>
      <div class="ctx-actions">
        <button class="btn btn-gold" id="ctx-open-civ">${GE.icons.icon('eye', 14)}完整档案</button>
        <button class="btn" id="ctx-tech">${GE.icons.icon('network', 14)}科技树</button>
      </div>`;
    ctxPanel.hidden = false;
    ctxInner.querySelector('#ctx-close-civ').addEventListener('click', clearSelection);
    ctxInner.querySelector('#ctx-open-civ').addEventListener('click', () => GE.panels.openCiv(id));
    ctxInner.querySelector('#ctx-leader').addEventListener('click', () => GE.panels.openLeader(id, leader.id));
    ctxInner.querySelector('#ctx-tech').addEventListener('click', () => {
      GE.panels.openCiv(id);
      requestAnimationFrame(() => { const t = document.querySelector('.modal-tab[data-tab="tech"]'); if (t) t.click(); });
    });
  }

  function showTileContext(tileId) {
    const tile = GE.worldState.getTile(tileId); if (!tile) return;
    const map = GE.worldState.def || GE.data.strategicMap;
    const terrain = (map.terrainCatalog || GE.data.terrainCatalog)[tile.terrain] || { name: tile.terrain };
    const region = GE.worldState.getRegion(tile.regionId);
    const civ = tile.ownerCivId && GE.data.civs.find(c => c.id === tile.ownerCivId);
    const resCat = map.resourceCatalog || GE.data.resourceCatalog;
    const rows = tile.resources.map(r => `${(resCat[r.resourceId] || {}).name || r.resourceId} · 丰度 ${r.richness}`).join('<br>') || '无显著产出';
    const regionColor = region ? region.color : '#8aa';
    const regionName = region ? region.name : '未知';
    ctxInner.innerHTML = `<header class="ctx-head" style="--ctx-c:${regionColor}"><button class="ctx-close" id="ctx-close-tile" aria-label="关闭详情">${GE.icons.icon('x',14)}</button><div class="ctx-kicker">${GE.icons.icon('hex',12)}战略地块 · ${tile.kind === 'pentagon' ? '五边' : '六边'}</div><div class="ctx-title">${terrain.name}</div><div class="ctx-sub">${tile.id} · 约 ${map.topology.nominalTileWidthKm} km</div></header><div class="ctx-body"><div class="ctx-stats"><div class="ctx-stat"><div class="cs-num">${tile.neighbors.length}</div><div class="cs-label">相邻地块</div></div><div class="ctx-stat"><div class="cs-num">${tile.buildings.length}</div><div class="cs-label">建筑</div></div><div class="ctx-stat"><div class="cs-num">${tile.resources.length}</div><div class="cs-label">资源</div></div></div><div class="panel"><div class="kv"><span class="k">地区</span><span class="v" style="color:${regionColor}">${regionName}</span></div><div class="kv"><span class="k">归属</span><span class="v">${civ ? civ.name : '无主'}</span></div><div class="kv"><span class="k">状态</span><span class="v">${tile.status}</span></div><div class="kv"><span class="k">产出</span><span class="v">${rows}</span></div></div></div><div class="ctx-actions"><button class="btn" id="ctx-region">地区</button>${civ ? `<button class="btn btn-gold" id="ctx-warehouse">国家仓储</button>` : ''}</div>`;
    ctxPanel.hidden=false; ctxInner.querySelector('#ctx-close-tile').addEventListener('click',clearSelection);
    ctxInner.querySelector('#ctx-region').addEventListener('click',()=>{ if (region) GE.panels.openRegion(region.id); });
    const wh=ctxInner.querySelector('#ctx-warehouse'); if(wh) wh.addEventListener('click',()=>GE.panels.openWarehouse(civ.id));
  }

  function showBodyCard(body) {
    const typeIcon = body.type === '恒星' ? 'sun' : body.type === '卫星' ? 'moon' : body.type === '空间站' ? 'station' : body.type === '黑洞' ? 'blackhole' : 'globe';
    const orbit = body.orbit;
    const landable = GE.surfaces ? GE.surfaces.isLandable(body) : !!body.home;
    const home = GE.surfaces ? GE.surfaces.isPlayerHome(body) : !!body.home;
    const survey = (body.flags && body.flags.surveyed) || 'none';
    const roleLabel = home ? '文明母星' : landable ? ('可登陆 · 勘察 ' + survey) : '自动星轨运行中';
    const enterLabel = home ? '进入星球' : (survey === 'surface' || survey === 'orbital' ? '登陆表面' : '勘察登陆');
    ctxInner.innerHTML = `
      <header class="ctx-head" style="--ctx-c:${body.color || '#d8b76a'}">
        <button class="ctx-close" id="ctx-close-body" aria-label="关闭详情">${GE.icons.icon('x', 14)}</button>
        <div class="ctx-kicker">${GE.icons.icon(typeIcon, 12)}${GE.esc(body.type)} · ${GE.esc(body.subtype || '')}</div>
        <div class="ctx-title">${GE.esc(body.name)}</div>
        <div class="ctx-sub">曦阳星系 · ${GE.esc(roleLabel)}</div>
      </header>
      <div class="ctx-body">
        <div class="panel"><p class="prose">${GE.esc(body.desc || '暂无天体资料。')}</p></div>
        ${orbit ? `<div class="sec-head"><span class="sec-ic">${GE.icons.icon('orbit', 14)}</span><span>轨道参数</span><span class="sec-line"></span></div>
        <div class="panel">
          <div class="kv"><span class="k">半长轴</span><span class="v mono">${orbit.a}</span></div>
          <div class="kv"><span class="k">偏心率</span><span class="v mono">${orbit.e.toFixed(2)}</span></div>
          <div class="kv"><span class="k">轨道倾角</span><span class="v mono">${orbit.inc}°</span></div>
          <div class="kv"><span class="k">公转周期</span><span class="v mono">${GE.fmt.num(orbit.period)} 日</span></div>
        </div>` : ''}
      </div>
      <div class="ctx-actions">
        ${landable ? `<button class="btn btn-cyan" id="ctx-enter-planet">${GE.icons.icon('globe', 14)}${GE.esc(enterLabel)}</button>` : ''}
        ${body.type === '黑洞' ? `<button class="btn btn-gold" id="ctx-enter-bh">${GE.icons.icon('blackhole', 14)}观测黑洞</button>` : ''}
        <button class="btn" id="ctx-focus-body">${GE.icons.icon('target', 14)}锁定</button>
      </div>`;
    ctxPanel.hidden = false;
    ctxInner.querySelector('#ctx-close-body').addEventListener('click', clearSelection);
    const ep = ctxInner.querySelector('#ctx-enter-planet');
    if (ep) ep.addEventListener('click', () => enterPlanet(body.id));
    const eb = ctxInner.querySelector('#ctx-enter-bh');
    if (eb) eb.addEventListener('click', () => switchView('blackhole'));
    ctxInner.querySelector('#ctx-focus-body').addEventListener('click', () => GE.views.universe.focusBody(body.id));
  }

  function showHoverCard(e, data) {
    hoverCard.innerHTML = `<div class="hc-title">${GE.esc(data.title || '')}</div>${data.sub ? `<div class="hc-sub">${GE.esc(data.sub)}</div>` : ''}${(data.rows || []).map(r => `<div class="hc-row"><span>${GE.esc(r[0])}</span><b>${GE.esc(r[1])}</b></div>`).join('')}`;
    hoverCard.hidden = false;
    const x = THREE.MathUtils.clamp(e.clientX, 145, innerWidth - 145);
    const y = Math.max(115, e.clientY);
    hoverCard.style.left = x + 'px';
    hoverCard.style.top = y + 'px';
  }

  function hideHoverCard() { hoverCard.hidden = true; }

  /* ============ 真推演（阶段 C · rules_only 默认；C6 hybrid/full 经 llmConfig） ============ */
  function mockDeductionEnabled() {
    try {
      const q = new URLSearchParams(location.search || '');
      if (q.get('mockDeduce') === '1' || q.get('mock') === 'deduce') return true;
      if (window.GE_MOCK_DEDUCE === true) return true;
      if (localStorage.getItem('ge-mock-deduce') === '1') return true;
    } catch (_) { /* ignore */ }
    return false;
  }

  function runId() {
    try {
      if (GE.llmConfig && typeof GE.llmConfig.runId === 'function') {
        const r = GE.llmConfig.runId();
        if (r) return r;
      }
      const q = new URLSearchParams(location.search || '');
      return q.get('run') || (GE.snapshot && GE.snapshot.last && GE.snapshot.last.runId) || 'local-seed';
    } catch (_) {
      return 'local-seed';
    }
  }

  function apiRoot() {
    if (GE.llmConfig && typeof GE.llmConfig.worldBase === 'function') {
      const w = GE.llmConfig.worldBase();
      if (w) return w;
    }
    if (GE.snapshot && typeof GE.snapshot.apiBase === 'function') {
      const b = GE.snapshot.apiBase();
      if (b) return b;
    }
    return '';
  }

  function applyWorldDelta(delta) {
    if (!delta) return { added: 0, updated: 0, removed: 0, shouldRefresh: false };
    GE.data.spaceBodies = GE.data.spaceBodies || [];
    const byId = new Map(GE.data.spaceBodies.map(b => [b.id, b]));
    let added = 0;
    let updated = 0;
    let removed = 0;
    (delta.newBodies || []).forEach(b => {
      if (!byId.has(b.id)) {
        GE.data.spaceBodies.push(b);
        byId.set(b.id, b);
        added += 1;
      }
    });
    (delta.updatedBodies || []).forEach(b => {
      const i = GE.data.spaceBodies.findIndex(x => x.id === b.id);
      if (i >= 0) {
        GE.data.spaceBodies[i] = b;
        updated += 1;
      } else {
        GE.data.spaceBodies.push(b);
        added += 1;
      }
    });
    (delta.removedBodyIds || []).forEach(id => {
      const i = GE.data.spaceBodies.findIndex(x => x.id === id);
      if (i >= 0) {
        GE.data.spaceBodies.splice(i, 1);
        removed += 1;
      }
    });
    // 仅当文明成功探索到新天体 / 设施，或有实质更新时，才刷宇宙视图
    const shouldRefresh = added > 0 || removed > 0 || updated > 0
      || !!(delta.newGalaxies && delta.newGalaxies.length)
      || !!(delta.newSystems && delta.newSystems.length);
    if (shouldRefresh) {
      const uv = GE.views && GE.views.universe;
      if (uv && state.initialized.universe && typeof uv.reloadBodies === 'function') {
        try { uv.reloadBodies(); } catch (err) { console.warn('[创世引擎] universe reloadBodies', err); }
      }
    }
    return { added, updated, removed, shouldRefresh };
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function deepMerge(target, patch) {
    if (!isPlainObject(patch)) return target;
    Object.keys(patch).forEach(k => {
      const val = patch[k];
      if (isPlainObject(val) && isPlainObject(target[k])) deepMerge(target[k], val);
      else if (isPlainObject(val)) target[k] = deepMerge({}, val);
      else if (Array.isArray(val)) target[k] = val.slice();
      else if (val !== undefined) target[k] = val;
    });
    return target;
  }

  function applyDeduceResult(result, opts) {
    opts = opts || {};
    // 服务端 round.n 是当前 Run 内序号（reset 后从 1 计）。
    // 本地种子 log 可能已有演示轮次，UI 轮次不得回退。
    const serverRound = result.round && result.round.n;
    if (serverRound != null) {
      if (state.deductionRound > 0 && serverRound < state.deductionRound) {
        state.deductionRound = state.deductionRound + 1;
      } else {
        state.deductionRound = serverRound;
      }
    } else {
      state.deductionRound = state.deductionRound + 1;
    }
    state.simulatedYear = result.year != null ? result.year : state.simulatedYear;
    GE.data.world.年数 = state.simulatedYear;
    if (result.revision != null) {
      state.revision = result.revision;
      if (GE.snapshot && GE.snapshot.last) GE.snapshot.last.revision = result.revision;
    }
    const yearEl = document.getElementById('ws-year-num');
    if (yearEl) yearEl.textContent = GE.fmt.num(state.simulatedYear);

    const monologueReel = Array.isArray(result.monologueReel) && result.monologueReel.length
      ? result.monologueReel
      : (result.decisions || []).map(d => ({
          characterId: d.characterId,
          characterName: d.characterName,
          civId: d.civId,
          civName: d.civName,
          role: d.role,
          kind: d.kind,
          monologue: d.monologue || '',
          publicSpeech: d.publicSpeech || '',
          decision: d.decision,
          source: d.source || 'rules'
        })).filter(x => x.monologue || x.decision);

    const log = {
      round: state.deductionRound,
      serverRound: serverRound != null ? serverRound : null,
      revision: result.revision != null ? result.revision : null,
      year: `${(GE.data.world.纪元 && GE.data.world.纪元.纪年) || '第4纪元'} · ${state.simulatedYear}年`,
      summary: (result.chronicle && result.chronicle[0] && result.chronicle[0].事件)
        || (result.decisions && result.decisions[0] && result.decisions[0].decision)
        || '推演已收敛',
      lenses: result.lenses || {},
      decisions: result.decisions || [],
      monologueReel,
      worldDelta: result.worldDelta || null,
      agentMode: (result.round && result.round.agentMode) || 'rules_only',
      agentMeta: result.agentMeta || null,
      territory: null,
      // AI 调用日志（次数 + 返回内容）
      llmLogs: Array.isArray(result.llmLogs) ? result.llmLogs : [],
      llmTotals: result.llmTotals || null
    };
    GE.data.deduction = GE.data.deduction || { lenses: [], rounds: 0, pendingDecisions: [], log: [] };
    GE.data.deduction.log.unshift(log);
    // 全局累计 LLM 日志（最近 80 条）
    GE.data.llmLogs = GE.data.llmLogs || [];
    if (Array.isArray(result.llmLogs) && result.llmLogs.length) {
      result.llmLogs.forEach(e => {
        if (!GE.data.llmLogs.some(x => x.id === e.id)) GE.data.llmLogs.unshift(e);
      });
      if (GE.data.llmLogs.length > 80) GE.data.llmLogs.length = 80;
    }
    if (result.llmTotals) GE.data.llmTotals = result.llmTotals;
    if (result.decisions) {
      GE.data.deduction.pendingDecisions = result.decisions.map(d => ({
        civ: d.civId,
        leader: d.characterName,
        characterId: d.characterId,
        decision: d.decision,
        urgency: d.urgency,
        stance: d.stance,
        kind: d.kind,
        monologue: d.monologue || '',
        publicSpeech: d.publicSpeech || '',
        source: d.source || 'rules'
      }));
    }
    GE.data.deduction.lastMonologueReel = monologueReel;
    if (result.chronicle && result.chronicle.length) {
      GE.data.chronicle = GE.data.chronicle || [];
      result.chronicle.forEach(entry => {
        // 服务端已 unshift 过；前端按事件文本去重
        if (!GE.data.chronicle.some(c => c.事件 === entry.事件 && c.年份 === entry.年份)) {
          GE.data.chronicle.unshift(entry);
        }
      });
    }

    applyWorldDelta(result.worldDelta);

    if (!opts.edict) {
      try {
        // 先合文明 spawn（分裂子邦），再执行领土意图
        const civPatches = result.patchesSummary && result.patchesSummary.civs;
        if (Array.isArray(civPatches)) {
          civPatches.forEach(p => {
            if (!p || !p.op) return;
            if (p.op === 'spawn' && p.civ && p.civ.id) {
              if (!(GE.data.civs || []).some(c => c.id === p.civ.id)) {
                GE.data.civs.push(p.civ);
              }
            } else if (p.op === 'absorb' && p.civId) {
              const idx = (GE.data.civs || []).findIndex(c => c.id === p.civId);
              if (idx >= 0) GE.data.civs.splice(idx, 1);
            } else if (p.op === 'stats' && p.civId && p.delta) {
              const civ = (GE.data.civs || []).find(c => c.id === p.civId);
              if (civ) {
                civ.stats = civ.stats || {};
                Object.keys(p.delta).forEach(k => {
                  civ.stats[k] = Math.max(0, (Number(civ.stats[k]) || 0) + (Number(p.delta[k]) || 0));
                });
              }
            }
          });
        }

        let territoryEvents = result.patchesSummary && result.patchesSummary.territory;
        if ((!Array.isArray(territoryEvents) || !territoryEvents.length) && GE.territory && GE.territory.deriveEventsFromTurn) {
          territoryEvents = GE.territory.deriveEventsFromTurn({
            decisions: result.decisions || []
          });
        }
        if (GE.territory && Array.isArray(territoryEvents) && territoryEvents.length) {
          const report = GE.territory.applyEvents(territoryEvents, { decisions: result.decisions || [] });
          log.territory = report;
          if (report && report.changedTiles > 0) {
            log.summary = (log.summary || '') + ` · 疆域变动 ${report.changedTiles} 格`;
            try {
              if (GE.toast && GE.toast.show) {
                GE.toast.show({
                  type: 'info',
                  icon: 'hex',
                  title: '疆域变动',
                  msg: `本轮易主 ${report.changedTiles} 格` +
                    (report.expand ? ` · 扩张 ${report.expand}` : '') +
                    (report.annex ? ` · 吞并 ${report.annex}` : '') +
                    (report.split ? ` · 分裂 ${report.split}` : '')
                });
              }
            } catch (_) { /* ignore */ }
          }
        }
      } catch (err) {
        console.warn('[创世引擎] territory apply', err);
      }

      if (GE.surfaces && GE.surfaces.advanceAllSurfaceTurns) GE.surfaces.advanceAllSurfaceTurns();
      else if (GE.worldState && GE.worldState.advanceTurn) GE.worldState.advanceTurn();
      // 服务端 patches：科技 / 关系 / 立场
      try {
        const techPatches = result.patchesSummary && result.patchesSummary.tech;
        if (Array.isArray(techPatches)) {
          techPatches.forEach(p => {
            const civ = (GE.data.civs || []).find(c => c.id === p.civId);
            if (!civ || !civ.科技树) return;
            if (p.node && civ.科技树.节点 && civ.科技树.节点[p.node]) {
              civ.科技树.节点[p.node].进度 = p.progress;
            }
          });
        }
        const relPatches = result.patchesSummary && result.patchesSummary.relations;
        if (Array.isArray(relPatches)) {
          GE.data.relations = Array.isArray(GE.data.relations) ? GE.data.relations : [];
          relPatches.forEach(p => {
            if (!p || !p.a || !p.b) return;
            let rel = GE.data.relations.find(r =>
              (r.a === p.a && r.b === p.b) || (r.a === p.b && r.b === p.a)
            );
            if (!rel) {
              rel = { a: p.a, b: p.b, state: p.state || '警惕观望', reason: p.note || p.reason || '' };
              GE.data.relations.push(rel);
            }
            if (p.state) rel.state = p.state;
            if (p.note) rel.reason = ((rel.reason || '') + ' · ' + p.note).slice(0, 240);
            else if (p.reason) rel.reason = String(p.reason).slice(0, 240);
            ['trust', 'tension', 'lastDiplomaticAction', 'treaties', 'grievances'].forEach(k => {
              if (p[k] !== undefined) rel[k] = Array.isArray(p[k]) ? p[k].slice() : (isPlainObject(p[k]) ? deepMerge({}, p[k]) : p[k]);
            });
          });
        }
        const charPatches = result.patchesSummary && result.patchesSummary.characters;
        if (Array.isArray(charPatches)) {
          charPatches.forEach(p => {
            const civ = (GE.data.civs || []).find(c => c.id === p.civId || (c.leaders || []).some(l => l.id === p.characterId));
            if (!civ) return;
            if (p.replaceLeader && p.leader) {
              civ.leaders = [p.leader];
              return;
            }
            const L = (civ.leaders || []).find(l => l.id === p.characterId);
            if (!L) return;
            if (p.stance) L.agentStance = p.stance;
            if (Number.isFinite(Number(p.age))) L.age = Number(p.age);
            if (Number.isFinite(Number(p.lifespanMax))) L.lifespanMax = Number(p.lifespanMax);
            if (p.bodyState) L.bodyState = String(p.bodyState);
            if (p.isAgent === false) L.isAgent = false;
            else if (p.isAgent === true) L.isAgent = true;
            if (p.agentStatus) {
              L.agent = Object.assign({}, L.agent || {}, {
                status: p.agentStatus,
                enabled: p.agentStatus !== 'deceased'
              });
            }
            ['agentMemory', 'agentGoals', 'agentActions', 'agentConstraints', 'agentDiplomacy', 'succession'].forEach(k => {
              if (p[k] !== undefined) {
                if (isPlainObject(p[k])) L[k] = deepMerge(isPlainObject(L[k]) ? L[k] : {}, p[k]);
                else if (Array.isArray(p[k])) L[k] = p[k].slice();
                else L[k] = p[k];
              }
            });
          });
        }
      } catch (_) { /* ignore */ }
      // 领袖可能继承/替换：刷新右侧文明列表与收藏夹
      try {
        syncFavoritesFromLeaders();
        renderCivDock();
        const dockCount = document.getElementById('dock-count');
        if (dockCount) dockCount.textContent = (GE.data.civs || []).length;
      } catch (err) {
        console.warn('[创世引擎] refresh civ dock', err);
      }
      const dawn = GE.data.civs && GE.data.civs.find(c => c.id === 'dawn');
      if (dawn && dawn.科技树) {
        const cardBar = document.querySelector('#civ-card-dawn .civ-lvbar i');
        const cardNum = document.querySelector('#civ-card-dawn .civ-lvnum');
        if (cardBar) cardBar.style.width = (dawn.科技树.下一阶段 || 0) + '%';
        if (cardNum) cardNum.textContent = (dawn.科技树.下一阶段 || 0) + '%';
      }
    }

    persistDeductionConsole();
    return log;
  }

  function localBodyStateForAge(age, lifespanMax) {
    const max = Number(lifespanMax);
    if (!Number.isFinite(max) || max <= 0) return '康健 · 年岁推进';
    const ratio = age / max;
    if (ratio >= 1) return '逝世 · 寿数已尽';
    if (ratio >= 0.94) return '濒危 · 生命烛火将尽';
    if (ratio >= 0.82) return '衰老 · 需族人照看';
    if (ratio >= 0.62) return '渐老 · 经验沉淀';
    if (ratio >= 0.35) return '康健 · 壮年';
    return '康健 · 青年';
  }

  function advanceLocalCharacterAges(yearDelta) {
    const patches = [];
    const delta = Number(yearDelta) || 0;
    if (delta <= 0) return patches;
    (GE.data.civs || []).forEach(civ => {
      (civ.leaders || []).forEach(ch => {
        const age = Number(ch.age);
        if (!Number.isFinite(age)) return;
        const nextAge = Math.round((age + delta) * 10) / 10;
        const lifespanMax = Number(ch.lifespanMax);
        ch.age = nextAge;
        ch.lastAgedYear = state.simulatedYear;
        if (!Number.isFinite(ch.birthYear)) ch.birthYear = state.simulatedYear - nextAge;
        if (Number.isFinite(lifespanMax) && lifespanMax > 0 && nextAge >= lifespanMax) {
          ch.bodyState = `逝世 · 寿终于${state.simulatedYear}年`;
          ch.isAgent = false;
          ch.agent = Object.assign({}, ch.agent || {}, { enabled: false, status: 'deceased' });
        } else {
          ch.bodyState = localBodyStateForAge(nextAge, lifespanMax);
        }
        patches.push({ civId: civ.id, characterId: ch.id, age: ch.age, lifespanMax, bodyState: ch.bodyState });
      });
    });
    return patches;
  }

  function advanceLocalAgentStates(yearDelta) {
    const year = state.simulatedYear;
    (GE.data.civs || []).forEach(civ => {
      (civ.leaders || []).forEach(ch => {
        ch.agentMemory = ch.agentMemory || { version: 1, episodic: [], semantic: {}, relationMemory: {}, legacy: [] };
        ch.agentGoals = ch.agentGoals || { active: [], completed: [], abandoned: [] };
        ch.agentActions = ch.agentActions || { lastAction: null, cooldowns: {}, history: [] };
        ch.agentConstraints = ch.agentConstraints || { reserves: {}, deficits: [], blockedActions: [], riskTolerance: 0.5 };
        ch.agentDiplomacy = ch.agentDiplomacy || { postureByCiv: {}, treaties: [], grievances: [] };
        ch.succession = ch.succession || { rule: 'council', leaderId: ch.id, generation: 1, heirs: [], regency: null, history: [] };
        const kind = optsEdictSafeKind(ch);
        const mem = {
          id: `mock-mem:${civ.id}:${ch.id}:${year}`,
          year,
          type: 'action',
          subject: kind,
          summary: `${ch.name}在 Mock 推演中继续推动${kind}`,
          salience: 0.5
        };
        ch.agentMemory.episodic = (ch.agentMemory.episodic || []).concat([mem]).slice(-18);
        if (!(ch.agentGoals.active || []).length) {
          ch.agentGoals.active = [{
            id: `mock-goal:${civ.id}:${kind}`,
            type: kind === 'research' ? 'research' : kind === 'military' ? 'prepare_defense' : 'stability',
            target: kind,
            priority: 0.55,
            progress: 0.1,
            status: 'active',
            createdYear: year,
            reason: 'Mock 推演生成的短期目标'
          }];
        }
        ch.agentActions.lastAction = {
          id: `mock-act:${civ.id}:${year}`,
          type: kind,
          finalType: kind,
          result: 'applied',
          reason: 'Mock 规则路径落地',
          year
        };
        ch.agentActions.history = (ch.agentActions.history || []).concat([ch.agentActions.lastAction]).slice(-12);
        if (Number.isFinite(Number(ch.lifespanMax)) && Number(ch.age) >= Number(ch.lifespanMax)) {
          const nextGen = (Number(ch.succession.generation) || 1) + 1;
          const used = new Set();
          (GE.data.civs || []).forEach(c => (c.leaders || []).forEach(l => { if (l && l.name) used.add(l.name); }));
          const pools = {
            human: { s: ['林', '苏', '江', '沈', '陆', '白', '顾', '叶', '夏', '裴', '周', '唐'], g: ['深', '砚', '寒', '衡', '澄', '岚', '川', '昭', '远', '辰', '启', '宁'] },
            elf: { s: ['伊', '瑟', '翡', '洛', '薇', '茉', '月', '叶'], g: ['瑟兰', '茉语', '翡歌', '月汀', '森谣', '薇宁', '洛涟', '露衡'] },
            dwarf: { s: ['巴', '杜', '戈', '石', '铁', '炉'], g: ['尔刚', '岩锤', '炉心', '铁脊', '铸铭', '石磊'] },
            abyssal: { s: ['涅', '汐', '潮', '渊', '澪', '溟'], g: ['芮', '汐', '澪', '澜', '渊', '溟', '涟'] }
          };
          const race = String(ch.race || civ.社会形态 || '');
          const poolKey = /精灵|林/.test(race) ? 'elf' : /矮人|锻|石/.test(race) ? 'dwarf' : /鲛|深渊|潮|海/.test(race) ? 'abyssal' : 'human';
          const pool = pools[poolKey] || pools.human;
          let name = pool.s[0] + pool.g[0];
          for (let i = 0; i < 16; i++) {
            const cand = pool.s[(year + nextGen + i) % pool.s.length] + pool.g[(year + nextGen * 3 + i) % pool.g.length];
            if (!used.has(cand) && cand !== ch.name) { name = cand; break; }
          }
          const next = Object.assign({}, ch, {
            id: `${ch.id}-g${nextGen}`,
            name,
            title: ch.title && !/领袖/.test(ch.title) ? ch.title : '继任领袖',
            age: 28 + nextGen,
            bodyState: '康健 · 新任领袖',
            isAgent: true,
            agent: { enabled: true, status: 'active' },
            agentStance: ch.agentStance || '守成整合 / 观察局势',
            motive: `继承${ch.name}的未竟事业。`,
            agentMemory: { version: 1, episodic: [], semantic: {}, relationMemory: {}, legacy: [{ leaderId: ch.id, name: ch.name, summary: `${ch.name}于${year}年退场` }] },
            agentGoals: { active: [{ id: `goal:${civ.id}:stability`, type: 'stability', target: civ.id, priority: 0.7, status: 'active', createdYear: year, reason: '继承期优先稳定' }], completed: [], abandoned: [] },
            agentActions: { lastAction: null, cooldowns: {}, history: [] },
            agentConstraints: { reserves: {}, deficits: [], blockedActions: [], riskTolerance: 0.5 },
            agentDiplomacy: { postureByCiv: {}, treaties: [], grievances: [] },
            succession: {
              rule: ch.succession.rule || 'council',
              leaderId: `${ch.id}-g${nextGen}`,
              generation: nextGen,
              heirs: [],
              regency: null,
              history: (ch.succession.history || []).concat([{ leaderId: ch.id, name: ch.name, endYear: year }]).slice(-12),
              startedYear: year
            }
          });
          civ.leaders = [next];
        }
      });
    });
  }

  function optsEdictSafeKind(ch) {
    if (/科研|学识/.test(JSON.stringify(ch.abilities || []))) return 'research';
    if (/军|战略/.test(JSON.stringify(ch.abilities || []))) return 'military';
    return 'policy';
  }

  function runMockDeduction(opts) {
    opts = opts || {};
    const yearDelta = opts.edict ? 1 : 7;
    state.deductionRound += 1;
    state.simulatedYear += yearDelta;
    const characterAging = advanceLocalCharacterAges(yearDelta);
    advanceLocalAgentStates(yearDelta);
    GE.data.world.年数 = state.simulatedYear;
    document.getElementById('ws-year-num').textContent = GE.fmt.num(state.simulatedYear);
    const result = opts.edict
      ? `神谕「${opts.edict}」开始生效（本地 Mock）。`
      : '（Mock）五文明决策完成交叉推演。';
    const pending = (GE.data.civs || []).map(civ => {
      const L = (civ.leaders || [])[0];
      if (!L) return null;
      const kind = optsEdictSafeKind(L);
      return {
        civ: civ.id,
        civId: civ.id,
        leader: L.name,
        characterId: L.id,
        decision: `${L.name}：Mock ${kind}`,
        kind,
        actionType: kind === 'military' ? 'annex_border' : kind === 'research' ? 'boost_research' : 'expand_frontier',
        source: 'mock'
      };
    }).filter(Boolean);
    GE.data.deduction = GE.data.deduction || { lenses: [], rounds: 0, pendingDecisions: [], log: [] };
    GE.data.deduction.pendingDecisions = pending;

    let territory = null;
    if (!opts.edict && GE.territory) {
      try {
        const events = GE.territory.deriveEventsFromTurn({ decisions: pending });
        territory = GE.territory.applyEvents(events, { decisions: pending });
      } catch (err) {
        console.warn('[创世引擎] mock territory', err);
      }
    }

    const log = {
      round: state.deductionRound,
      year: `${GE.data.world.纪元.纪年} · ${state.simulatedYear}年`,
      summary: result + (territory && territory.changedTiles ? ` · 疆域变动 ${territory.changedTiles} 格` : ''),
      lenses: {
        政治: opts.edict ? '神谕重塑权力预期' : '陆轨对立继续升温',
        军事: opts.edict ? '各方进入最高戒备' : '轨道舰队提高戒备',
        经济: opts.edict ? '市场出现避险潮' : '航天预算继续扩张',
        科技: opts.edict ? '异常现象等待解析' : '受限点火获批',
        思潮: opts.edict ? '神迹引发信仰震荡' : '星空信仰加速分化',
        个人: opts.edict ? '领袖动机被重新校准' : '关键角色随推演时间自然衰长'
      },
      characterAging,
      territory,
      decisions: pending
    };
    GE.data.deduction.log.unshift(log);
    if (!opts.edict) {
      if (GE.surfaces && GE.surfaces.advanceAllSurfaceTurns) GE.surfaces.advanceAllSurfaceTurns();
      else GE.worldState.advanceTurn();
    }
    try {
      syncFavoritesFromLeaders();
      renderCivDock();
    } catch (_) { /* ignore */ }
    persistDeductionConsole();
    return log;
  }

  function buildDeducePayload(opts) {
    opts = opts || {};
    const payload = {
      force: !!opts.force,
      edict: opts.edict || null
    };
    // C6：agentMode 告知偏好；LLM 凭证由服务端已存设置读取（前端「保存到后端」）
    // 仅当显式 opts.llm 时才随请求临时覆盖（调试用）
    let cfg = null;
    try {
      cfg = GE.llmConfig && typeof GE.llmConfig.get === 'function' ? GE.llmConfig.get() : null;
    } catch (_) { cfg = null; }
    const mode = (opts.agentMode || (cfg && cfg.agentMode) || 'rules_only');
    payload.agentMode = mode;
    if (opts.llm && typeof opts.llm === 'object') {
      payload.llm = opts.llm;
    }
    return payload;
  }

  async function runDeduction(opts) {
    opts = opts || {};
    let log;
    let agentMeta = null;
    if (mockDeductionEnabled()) {
      log = runMockDeduction(opts);
    } else {
      const rid = runId();
      const url = `${apiRoot()}/api/v1/runs/${encodeURIComponent(rid)}/deduce`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(buildDeducePayload(opts)),
          cache: 'no-store'
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`deduce ${res.status}${text ? ': ' + text.slice(0, 160) : ''}`);
        }
        const result = await res.json();
        agentMeta = result.agentMeta || (result.round && result.round.llm) || null;
        log = applyDeduceResult(result, opts);
        if (log && result.agentMeta) log.agentMeta = result.agentMeta;
      } catch (err) {
        console.error('[创世引擎] 推演失败', err);
        if (!opts.silent && !opts.auto) {
          GE.toast.show({
            type: 'warn',
            icon: 'info',
            title: '推演请求失败',
            msg: String(err && err.message || err) + ' · 可加 ?mockDeduce=1 使用本地调试'
          });
        }
        return null;
      }
    }

    if (!opts.silent && !opts.auto) GE.modal.close();
    // Agent 自述镜头：推演结果揭晓前播放（可跳过）
    let skipMono = !!opts.skipMonologue || !!opts.silent || !!opts.auto;
    let autoSkip = false;
    try {
      autoSkip = !!(navigator.webdriver)
        || /(?:\?|&)(?:qa|mockDeduce)=/.test(location.search || '')
        || localStorage.getItem('ge-skip-mono') === '1';
    } catch (_) { /* ignore */ }
    if (!skipMono && !autoSkip && log && Array.isArray(log.monologueReel) && log.monologueReel.length) {
      try {
        if (GE.panels && typeof GE.panels.playMonologueReel === 'function') {
          await GE.panels.playMonologueReel(log.monologueReel, {
            round: state.deductionRound,
            year: state.simulatedYear
          });
        }
      } catch (err) {
        console.warn('[创世引擎] monologue reel', err);
      }
    }
    const msg = log && log.summary ? log.summary : '推演已收敛';
    let title = `第 ${state.deductionRound} 轮推演已收敛`;
    if (agentMeta && agentMeta.used && agentMeta.used !== 'rules_only') {
      title += ` · ${agentMeta.used}`;
      if (agentMeta.llmCalls) title += ` · AI×${agentMeta.llmCalls}`;
      if (agentMeta.applied) title += ` · ${agentMeta.applied}人`;
    } else if (agentMeta && agentMeta.fallback) {
      title += ' · 规则回落';
    }
    if (opts.auto) title = '自动推演 · ' + title;
    if (!opts.silent) {
      GE.toast.show({ type: 'ok', icon: 'brain', title, msg });
    }
    return log;
  }

  /* ============ 设置 ============ */
  function setQuality(preset) {
    const map = { low: 0.62, mid: 0.78, high: 0.92 };
    settings.qualityPreset = preset;
    settings.quality = map[preset] || 0.78;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset === 'low' ? 1 : preset === 'mid' ? 1.35 : 1.7));
    renderer.setSize(innerWidth, innerHeight, false);
    GE.toast.success('渲染质量已切换', preset === 'low' ? '流畅模式' : preset === 'mid' ? '均衡模式' : '极致模式');
  }

  function setSetting(key, value) {
    settings[key] = value;
    if (key === 'reduced') document.documentElement.classList.toggle('reduce-motion', value);
    if (key === 'autoRotate') {
      Object.entries(GE.views).forEach(([id, v]) => {
        if (state.initialized[id] && v.rig) v.rig.autoRotate = value ? (id === 'planet' ? 0.03 : id === 'universe' ? 0.012 : 0.05) : 0;
      });
    }
    if (key === 'cityLights') {
      // 城市夜光已并入战略资产层；保留设置项以兼容现有 UI。
      if (state.layer.assets !== value) {
        state.layer.assets = value;
        const btn = document.getElementById('lb-assets');
        if (btn) { btn.classList.toggle('on', value); btn.classList.toggle('off', !value); }
        const v = GE.views[state.view];
        if (v && v.setLayer) v.setLayer('assets', value);
      }
    }
    if (key === 'autoDeduce') {
      setAutoDeduce(!!value, settings.autoDeduceIntervalSec);
      GE.toast.info('自动推演', value
        ? `已开启 · 每隔 ${settings.autoDeduceIntervalSec} 秒（世界时间运行中）自动推进一轮`
        : '已关闭');
      return;
    }
    if (key === 'autoDeduceIntervalSec') {
      setAutoDeduce(settings.autoDeduce, value);
      GE.toast.info('自动推演间隔', `已设为 ${settings.autoDeduceIntervalSec} 秒`);
      return;
    }
    GE.toast.info('设置已更新', value ? '该表现选项已启用。' : '该表现选项已关闭。');
  }

  return {
    boot,
    switchView,
    enterPlanet,
    refreshPlanetHud,
    selectCiv,
    clearSelection,
    showCivContext,
    showTileContext,
    showBodyCard,
    showHoverCard,
    hideHoverCard,
    runDeduction,
    setQuality,
    setSetting,
    setAutoDeduce,
    settings,
    state,
    renderer
  };
})();

// DOM 已在脚本前完成解析，直接启动。
GE.app.boot();
