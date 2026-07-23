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
    deductionRound: GE.data.deduction.log[0].round,
    simulatedYear: GE.data.world.年数
  };

  const settings = {
    quality: 0.85,
    qualityPreset: 'high',
    autoRotate: true,
    cityLights: true,
    reduced: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };

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
  function boot() {
    decorateIcons();
    if (GE.surfaces) GE.surfaces.init();
    hydrateWorldStrip();
    renderCivDock();
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
   * @param {{ silent?: boolean }} opts
   */
  function enterPlanet(bodyId, opts) {
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
      if (GE.surfaces) GE.surfaces.activate(bodyId);
      state.activeBodyId = bodyId;
      state.activeSurfaceId = GE.surfaces ? GE.surfaces.activeSurfaceId : null;
      if (state.initialized.planet && GE.views.planet.loadSurface) {
        GE.views.planet.loadSurface(bodyId, { silent: opts.silent });
      }
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
    host.innerHTML = GE.data.civs.map((c, i) => `
      <article class="civ-card" id="civ-card-${c.id}" data-civ="${c.id}" style="--civ:${c.color};animation-delay:${i * 0.06}s" tabindex="0" role="button" aria-label="查看${GE.esc(c.name)}">
        <div class="civ-swatch">${GE.icons.icon(c.id === 'bronze' ? 'gem' : c.id === 'abyss' ? 'water' : c.id === 'sylva' ? 'tree' : 'flag', 21)}</div>
        <div class="civ-info">
          <div class="civ-name-row"><span class="civ-name">${GE.esc(c.name)}</span><span class="civ-lv">CIV ${c.level}</span></div>
          <div class="civ-leader">${GE.esc(c.leaders[0].title)} · ${GE.esc(c.leaders[0].name)}</div>
          <div class="civ-bars"><span class="civ-lvbar"><i style="width:${c.科技树.下一阶段}%"></i></span><span class="civ-lvnum">${c.科技树.下一阶段}%</span></div>
        </div>
      </article>`).join('');

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
      const belongs = state.view === 'planet' ? (id.startsWith('cap-') || id.startsWith('region-') || id === 'station') :
                      state.view === 'universe' ? id.startsWith('u-') : false;
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

  /* ============ 前端推演演示 ============ */
  function runDeduction(opts) {
    opts = opts || {};
    state.deductionRound += 1;
    state.simulatedYear += opts.edict ? 1 : 7;
    GE.data.world.年数 = state.simulatedYear;
    document.getElementById('ws-year-num').textContent = GE.fmt.num(state.simulatedYear);

    const result = opts.edict
      ? `神谕「${opts.edict}」开始生效。各文明 Agent 已进入连锁反应评估，世界状态将在下一轮收敛。`
      : '五个文明的决策完成四轮交叉推演：晨曦联邦批准受限点火，奥瑞利安加速发射台，希尔瓦娜使者已抵达熔心堡，深渊祭祀继续下潜。';

    const log = {
      round: state.deductionRound,
      year: `${GE.data.world.纪元.纪年} · ${state.simulatedYear}年`,
      summary: result,
      lenses: {
        政治: opts.edict ? '神谕重塑权力预期' : '陆轨对立继续升温',
        军事: opts.edict ? '各方进入最高戒备' : '轨道舰队提高戒备',
        经济: opts.edict ? '市场出现避险潮' : '航天预算继续扩张',
        科技: opts.edict ? '异常现象等待解析' : '受限点火获批',
        思潮: opts.edict ? '神迹引发信仰震荡' : '星空信仰加速分化',
        个人: opts.edict ? '领袖动机被重新校准' : '苏砚与林深暂时和解'
      }
    };
    GE.data.deduction.log.unshift(log);

    if (!opts.edict) {
      const strategicRevision = GE.worldState.advanceTurn();
      const tech = GE.data.civs[0].科技树.节点['亚光速引擎'];
      tech.进度 = Math.min(100, tech.进度 + 7);
      GE.data.civs[0].科技树.下一阶段 = Math.min(100, GE.data.civs[0].科技树.下一阶段 + 3);
      const cardBar = document.querySelector('#civ-card-dawn .civ-lvbar i');
      const cardNum = document.querySelector('#civ-card-dawn .civ-lvnum');
      if (cardBar) cardBar.style.width = GE.data.civs[0].科技树.下一阶段 + '%';
      if (cardNum) cardNum.textContent = GE.data.civs[0].科技树.下一阶段 + '%';
    }

    GE.modal.close();
    GE.toast.show({ type: 'success', icon: 'checkC', title: `第 ${state.deductionRound} 轮推演已收敛`, msg: result });
    setTimeout(() => GE.toast.show({ type: 'warn', icon: 'history', title: '世界变量已改写', msg: `世界推进至 ${state.simulatedYear} 年。新因果已载入大事记，暗线继续积累。` }), 650);
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
    settings,
    state,
    renderer
  };
})();

// DOM 已在脚本前完成解析，直接启动。
GE.app.boot();
