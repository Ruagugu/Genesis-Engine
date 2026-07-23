/* ============================================================
   创世引擎 · panels.js — 信息面板与模态框
   文明 / 领袖 / 科技树 / 大事记 / 典籍 / 收藏夹 / 推演控制台 / 神谕
   ============================================================ */
window.GE = window.GE || {};
GE.panels = (function () {
  const D = () => GE.data;
  const ic = (n, s) => GE.icons.icon(n, s);
  const esc = GE.esc;

  /* ============ 通用构件 ============ */
  function secHead(icon, title, tag) {
    return `<div class="sec-head"><span class="sec-ic">${ic(icon, 14)}</span><span>${esc(title)}</span><span class="sec-line"></span>${tag ? `<span class="sec-tag">${esc(tag)}</span>` : ''}</div>`;
  }
  function kv(k, v, mono) {
    return `<div class="kv"><span class="k">${esc(k)}</span><span class="v ${mono ? 'mono' : ''}">${v}</span></div>`;
  }
  function meterRow(label, val, color, max) {
    const pct = Math.min(100, (val / (max || 100)) * 100);
    return `<div class="meter-row"><span class="ml">${esc(label)}</span><div class="meter"><i style="--m-color:${color};width:${pct}%"></i></div><span class="mv">${Math.round(val)}</span></div>`;
  }
  function badge(text, type, icon) {
    return `<span class="badge badge-${type}">${icon ? ic(icon, 11) : ''}${esc(text)}</span>`;
  }
  // 程序化纹章头像
  function sigil(text, color, size, glyphSize) {
    const g = (glyphSize || size * 0.44);
    return `<div class="avatar" style="width:${size}px;height:${size}px;--c:${color};
      background:
        radial-gradient(120% 120% at 20% 15%, ${color}55, transparent 55%),
        radial-gradient(120% 120% at 85% 90%, ${color}33, transparent 50%),
        linear-gradient(150deg,#1a2338,#0b1120)">
      <span class="av-glyph" style="font-size:${g}px">${esc(text)}</span>
      <span class="av-ring"></span></div>`;
  }
  function civById(id) { return D().civs.find(c => c.id === id); }
  function civColor(id) { const c = civById(id); return c ? c.color : '#888'; }
  function civLevelName(lv) { const l = D().civLevels.find(x => x.lv === lv); return l ? l.name : lv; }

  /* ============================================================
     文明详情
     ============================================================ */
  function openCiv(civId) {
    const c = civById(civId); if (!c) return;
    GE.app.selectCiv(civId);
    GE.modal.open({
      id: 'civ-' + civId,
      title: c.name,
      subtitle: `${c.社会形态} · ${c.文明阶段} · 文明等级 ${c.level}「${civLevelName(c.level)}」`,
      icon: 'flag', accent: c.color, size: 'xl',
      headExtra: `<span class="badge" style="border-color:${c.color}55;color:${c.color}">${ic('crown', 11)}${esc(c.capital)}</span>`,
      tabs: [
        { id: 'overview', label: '总览', icon: 'globe', render: (el) => renderCivOverview(el, c) },
        { id: 'tech', label: '科技树', icon: 'network', render: (el) => renderTechTree(el, c) },
        { id: 'people', label: '领袖与人物', icon: 'users', render: (el) => renderCivPeople(el, c) },
        { id: 'realm', label: '疆域与资产', icon: 'hex', render: (el) => renderCivRealm(el, c) }
      ]
    });
  }

  function renderCivOverview(el, c) {
    const t = c.科技树;
    el.innerHTML = `
      <div class="stagger">
      <div class="card-grid cols-2" style="align-items:stretch">
        <div class="panel panel-hi">
          ${secHead('target', '目前国策', '已执行 ' + c.目前国策.持续年数 + ' 年')}
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span class="badge badge-gold" style="font-size:13px;padding:5px 13px">${ic('scroll', 13)}${esc(c.目前国策.名称)}</span>
          </div>
          <p class="prose">${esc(c.目前国策.内容)}</p>
          <div style="margin-top:12px">${meterRow('执行度', Math.min(100, c.目前国策.持续年数 * 2), c.color)}</div>
        </div>
        <div class="panel">
          ${secHead('compass', '思潮与理念')}
          <div class="prose" style="margin-bottom:10px"><strong style="color:${c.color}">${esc(c.思潮)}</strong></div>
          <div class="panel" style="background:rgba(0,0,0,.2);font-style:italic;color:var(--tx-1);font-size:12.5px;border-left:2px solid ${c.color}">
            「${esc(c.国民理念)}」</div>
          <div style="margin-top:12px">${kv('文明特质', esc(c.文明特质))}</div>
        </div>
      </div>

      ${secHead('pulses', '国力概览', 'CIV-' + c.level)}
      <div class="card-grid cols-3">
        ${bigstat(GE.fmt.compact(c.stats.人口 * 1e6), '人口', 'users', c.color)}
        ${bigstat(c.stats.军力, '军事力量', 'sword', c.color)}
        ${bigstat(c.stats.科研, '科研实力', 'flask', c.color)}
      </div>
      <div class="panel" style="margin-top:12px">
        ${meterRow('经济', c.stats.经济, '#d8b76a')}
        ${meterRow('军事', c.stats.军力, '#e56b6b')}
        ${meterRow('稳定', c.stats.稳定, '#6fd08c')}
        ${meterRow('科研', c.stats.科研, '#5fd6e6')}
        ${meterRow('扩张', c.stats.扩张, '#8b7cf6')}
      </div>

      ${secHead('scroll', '起源与政体')}
      <div class="card-grid cols-2">
        <div class="panel"><div class="sec-head" style="margin:0 0 8px"><span class="sec-ic">${ic('sparkle', 13)}</span><span>起源</span></div><p class="prose">${esc(c.起源)}</p></div>
        <div class="panel"><div class="sec-head" style="margin:0 0 8px"><span class="sec-ic">${ic('balance', 13)}</span><span>政体及运作</span></div><p class="prose">${esc(c.政体及运作)}</p></div>
      </div>

      ${secHead('users', '军事与人口')}
      <div class="panel"><p class="prose">${esc(c.军事与人口)}</p></div>

      ${secHead('arrowR', '发展计划')}
      <div class="panel panel-hi"><p class="prose lead">${esc(c.发展计划)}</p></div>
      </div>`;
  }

  function bigstat(num, label, icon, color) {
    return `<div class="panel" style="display:flex;align-items:center;gap:12px">
      <span style="width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:${color}18;color:${color}">${ic(icon, 18)}</span>
      <div class="bigstat"><span class="bs-num">${num}</span><span class="bs-label">${esc(label)}</span></div></div>`;
  }

  /* ---------- 科技树 ---------- */
  function renderTechTree(el, c) {
    const t = c.科技树;
    const next = D().thresholds.find(x => x.lv === (t.文明等级 + '→' + (t.文明等级 + 1)));
    el.innerHTML = `
      <div class="panel panel-hi" style="display:flex;align-items:center;gap:18px;margin-bottom:16px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:12px">
          ${ring(t.下一阶段, 54, c.color)}
          <div><div style="font-weight:700;color:var(--tx-0)">文明等级 ${t.文明等级}「${civLevelName(t.文明等级)}」</div>
          <div style="font-size:11px;color:var(--tx-2);margin-top:2px">距 ${t.文明等级 + 1} 级「${civLevelName(t.文明等级 + 1)}」进度 ${t.下一阶段}%</div></div>
        </div>
        <div style="flex:1;min-width:180px">
          ${next ? `<div style="font-size:11px;color:var(--tx-2)">跃迁门槛</div>
          <div style="font-weight:700;color:${c.color};margin:2px 0">${esc(next.name)}</div>
          <div style="font-size:11px;color:var(--tx-1);line-height:1.5">${esc(next.能力)}</div>` : ''}
        </div>
        <div style="display:flex;gap:12px;font-size:11px">
          <span style="display:flex;align-items:center;gap:5px"><i style="width:10px;height:10px;border-radius:99px;background:#d8b76a;display:inline-block"></i>已解锁</span>
          <span style="display:flex;align-items:center;gap:5px"><i style="width:10px;height:10px;border-radius:99px;background:#5fd6e6;display:inline-block"></i>研究中</span>
        </div>
      </div>
      <div class="techtree panel" id="tt-host"></div>
      <div id="tt-detail" style="margin-top:14px"></div>`;
    buildTechTreeSVG(el.querySelector('#tt-host'), c);
  }

  function ring(pct, size, color) {
    const r = (size - 8) / 2, circ = 2 * Math.PI * r, off = circ * (1 - pct / 100);
    return `<span class="ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}"><circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="5"/>
      <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="5"
        stroke-dasharray="${circ}" stroke-dashoffset="${off}"/></svg>
      <span class="ring-val" style="font-size:${size * 0.22}px;color:${color}">${pct}%</span></span>`;
  }

  function buildTechTreeSVG(host, c) {
    const nodes = c.科技树.节点;
    const names = Object.keys(nodes);
    // 深度计算
    const depth = {};
    function dep(n, seen) {
      if (depth[n] != null) return depth[n];
      const pre = nodes[n].前置;
      if (!pre || pre === '无' || !nodes[pre]) return (depth[n] = 0);
      if ((seen || []).includes(n)) return (depth[n] = 0);
      return (depth[n] = dep(pre, (seen || []).concat(n)) + 1);
    }
    names.forEach(n => dep(n));
    // 分列布局
    const cols = {};
    names.forEach(n => { const d = depth[n]; (cols[d] = cols[d] || []).push(n); });
    Object.values(cols).forEach(arr => arr.sort());
    const NW = 168, NH = 52, GX = 70, GY = 26, PAD = 20;
    const maxDepth = Math.max(...Object.keys(cols).map(Number));
    const maxRows = Math.max(...Object.values(cols).map(a => a.length));
    const W = PAD * 2 + (maxDepth + 1) * (NW + GX) - GX;
    const H = PAD * 2 + maxRows * (NH + GY) - GY;
    const pos = {};
    Object.entries(cols).forEach(([d, arr]) => {
      const totalH = arr.length * (NH + GY) - GY;
      const y0 = (H - totalH) / 2;
      arr.forEach((n, i) => { pos[n] = { x: PAD + Number(d) * (NW + GX), y: y0 + i * (NH + GY) }; });
    });
    // 连线
    let links = '';
    names.forEach(n => {
      const pre = nodes[n].前置;
      if (pre && pre !== '无' && pos[pre]) {
        const a = pos[pre], b = pos[n];
        const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2;
        const mx = (x1 + x2) / 2;
        const unlocked = nodes[pre].状态 === '已解锁';
        links += `<path class="tt-link ${unlocked ? 'unlocked' : ''} ${nodes[n].状态 === '研究中' ? 'active' : ''}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
      }
    });
    // 节点
    let html = '';
    names.forEach(n => {
      const nd = nodes[n], p = pos[n];
      const unlocked = nd.状态 === '已解锁';
      const col = unlocked ? '#d8b76a' : '#5fd6e6';
      html += `<g class="tt-node" data-name="${esc(n)}" transform="translate(${p.x},${p.y})">
        <rect class="tt-box" width="${NW}" height="${NH}" rx="10" fill="rgba(16,22,38,.9)" stroke="${col}" stroke-opacity="${unlocked ? 0.55 : 0.7}" stroke-width="1.4"/>
        <rect width="4" height="${NH}" rx="2" fill="${col}"/>
        <text x="16" y="22" fill="#f3ecda" font-size="13" font-weight="700" font-family="var(--f-serif)">${esc(n)}</text>
        <text x="16" y="39" fill="#7f8aa6" font-size="10">${nd.状态} · ${nd.进度}%</text>
        ${unlocked
          ? `<g transform="translate(${NW - 26},13)"><circle r="9" cx="9" cy="9" fill="${col}" fill-opacity="0.18"/><path d="M4.5,9.5 l3,3 l6,-6" stroke="${col}" stroke-width="2" fill="none" stroke-linecap="round"/></g>`
          : `<g transform="translate(${NW - 26},13)"><circle r="9" cx="9" cy="9" fill="none" stroke="${col}" stroke-opacity="0.3" stroke-width="2.5"/><circle r="9" cx="9" cy="9" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${2 * Math.PI * 9}" stroke-dashoffset="${2 * Math.PI * 9 * (1 - nd.进度 / 100)}" transform="rotate(-90 9 9)"/></g>`}
      </g>`;
    });
    host.innerHTML = `<svg class="tt-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="min-width:${W}px">${links}${html}</svg>`;
    // 交互
    host.querySelectorAll('.tt-node').forEach(g => {
      g.addEventListener('click', () => {
        const n = g.dataset.name;
        showTechDetail(host.closest('.modal-body').querySelector('#tt-detail'), c, n);
      });
      g.addEventListener('mouseenter', () => { g.querySelector('.tt-box').setAttribute('stroke-width', '2.4'); });
      g.addEventListener('mouseleave', () => { g.querySelector('.tt-box').setAttribute('stroke-width', '1.4'); });
    });
    // 默认选中第一个研究中
    const researching = names.find(n => nodes[n].状态 === '研究中') || names[0];
    showTechDetail(host.closest('.modal-body').querySelector('#tt-detail'), c, researching);
  }

  function showTechDetail(el, c, name) {
    const nd = c.科技树.节点[name]; if (!nd) return;
    const unlocked = nd.状态 === '已解锁';
    const col = unlocked ? '#d8b76a' : '#5fd6e6';
    el.innerHTML = `
      <div class="panel anim-rise" style="border-left:3px solid ${col}">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div style="display:flex;align-items:center;gap:9px">
              <span style="font-size:16px;font-weight:900;font-family:var(--f-serif);color:var(--tx-0)">${esc(name)}</span>
              ${badge(nd.状态, unlocked ? 'gold' : 'cyan')}
              <span class="badge">层级 ${nd.层级}</span>
            </div>
            <p class="prose" style="margin-top:8px">${esc(nd.描述)}</p>
          </div>
          <div style="text-align:center">${ring(nd.进度, 64, col)}<div style="font-size:10px;color:var(--tx-3);margin-top:2px">研究进度</div></div>
        </div>
        <div class="card-grid cols-3" style="margin-top:12px">
          ${kv('前置科技', nd.前置 === '无' ? '<span class="tx2">根源科技</span>' : esc(nd.前置))}
          ${kv('迭代', '<span class="mono">' + esc(nd.迭代) + '</span>')}
          ${kv('状态', `<span style="color:${col}">${esc(nd.状态)}</span>`)}
        </div>
      </div>`;
  }

  /* ---------- 领袖与人物 ---------- */
  function renderCivPeople(el, c) {
    el.innerHTML = `<div class="stagger">` + c.leaders.map((L, i) => `
      <div class="panel" style="display:flex;gap:14px;align-items:center;margin-bottom:12px;cursor:pointer" data-leader="${L.id}">
        ${sigil(L.name[0], c.color, 60)}
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
            <span style="font-size:16px;font-weight:900;font-family:var(--f-serif);color:var(--tx-0)">${esc(L.name)}</span>
            <span style="font-size:11px;color:${c.color}">${esc(L.title)}</span>
            ${L.isAgent ? badge('Agent 驱动', 'violet', 'chip') : ''}
          </div>
          <div style="font-size:11.5px;color:var(--tx-2);margin-top:4px">${esc(L.role)} · ${esc(L.race)} · ${L.age} 岁 · ${esc(L.personality.code)}(${L.personality.stability})</div>
        </div>
        <button class="btn btn-sm btn-gold" data-open-leader="${L.id}">${ic('eye', 13)}查看</button>
      </div>`).join('') + `</div>`;
    el.querySelectorAll('[data-open-leader]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation(); openLeader(c.id, b.dataset.openLeader);
    }));
    el.querySelectorAll('[data-leader]').forEach(p => p.addEventListener('click', () => openLeader(c.id, p.dataset.leader)));
  }

  /* ---------- 疆域与资产 ---------- */
  function renderCivRealm(el, c) {
    const blocks = D().mapBlocks ? (D().mapBlocks.filter(b => b.归属 === c.name)) : [];
    const orbital = c.orbital;
    el.innerHTML = `
      ${secHead('hex', '地表疆域', c.capital)}
      <div class="card-grid cols-3">
        ${bigstat('≈' + (Math.round(c.stats.扩张 * 3.2)) + '万', '疆域 · km²', 'hex', c.color)}
        ${bigstat(c.capital, '首都', 'crown', c.color)}
        ${bigstat(c.文明阶段, '文明阶段', 'pulses', c.color)}
      </div>
      ${orbital ? secHead('satellite', '轨道资产', '晨曦联邦') + `
      <div class="card-grid cols-3">
        ${bigstat(orbital.satellites, '星链卫星', 'satellite', '#5fd6e6')}
        ${bigstat(1, '轨道站', 'station', '#5fd6e6')}
        ${bigstat(orbital.ships, '在轨舰船', 'ship', '#5fd6e6')}
      </div>
      <div class="panel" style="margin-top:12px;display:flex;align-items:center;gap:12px">
        <span style="width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:rgba(95,214,230,.12);color:var(--cyan)">${ic('orbit', 18)}</span>
        <div style="flex:1"><div style="font-weight:700;color:var(--tx-0)">${esc(orbital.station)}</div>
        <div style="font-size:11px;color:var(--tx-2)">揽星计划神经中枢 · 星链星座调度</div></div>
        <button class="btn btn-sm btn-cyan" id="btn-view-orbit">${ic('eye', 13)}在轨查看</button>
      </div>` : ''}
      ${blocks.length ? secHead('globe', '主要区块') + blocks.map(b => kv(b.name, `${b.地形} · ${b.状态}`)) : ''}
      <div class="panel" style="margin-top:14px;border-left:3px solid ${c.color}">
        <div style="font-size:11px;color:var(--tx-2);margin-bottom:4px">领土策略</div>
        <p class="prose">${esc(c.发展计划)}</p>
      </div>`;
    const vb = el.querySelector('#btn-view-orbit');
    if (vb) vb.addEventListener('click', () => { GE.modal.close(); GE.app.switchView('planet'); GE.views.planet.focusCapital(c.id); });
  }

  /* ============================================================
     领袖详情
     ============================================================ */
  function openLeader(civId, leaderId) {
    const c = civById(civId); if (!c) return;
    const L = c.leaders.find(x => x.id === leaderId); if (!L) return;
    const lifePct = Math.min(100, (L.age / L.lifespanMax) * 100);
    GE.modal.open({
      id: 'leader-' + leaderId,
      title: L.name,
      subtitle: `${L.title} · ${c.name}`,
      icon: 'user', accent: c.color, size: 'xl',
      headExtra: L.isAgent ? badge('Agent 驱动', 'violet', 'chip') : '',
      tabs: [
        { id: 'profile', label: '生平', icon: 'user', render: (el) => {
          el.innerHTML = `
            <div class="card-grid" style="grid-template-columns:200px 1fr;gap:18px;align-items:start">
              <div style="display:flex;flex-direction:column;gap:12px;align-items:center">
                ${sigil(L.name[0], c.color, 168, 74)}
                <div style="text-align:center">
                  <div style="font-size:17px;font-weight:900;font-family:var(--f-serif)">${esc(L.name)}</div>
                  <div style="font-size:11px;color:${c.color};margin-top:2px">${esc(L.title)}</div>
                </div>
                <div class="pers-code">${esc(L.personality.code)}<span class="pc-stab">(${L.personality.stability})</span></div>
              </div>
              <div>
                ${secHead('info', '基本信息')}
                <div class="card-grid cols-2">
                  ${kv('性别', genderIcon(L.gender) + ' ' + esc(L.gender))}
                  ${kv('种族', esc(L.race))}
                  ${kv('年龄', '<span class="mono">' + L.age + '</span> 岁')}
                  ${kv('预期寿命', '<span class="mono">' + L.lifespanMax + '</span> 岁')}
                </div>
                <div style="margin:14px 0">
                  <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--tx-2);margin-bottom:5px">
                    <span>寿命进程</span><span class="mono">${L.age} / ${L.lifespanMax}</span></div>
                  <div class="meter"><i style="--m-color:${lifePct > 75 ? '#e56b6b' : lifePct > 50 ? '#e8a15c' : '#6fd08c'};width:${lifePct}%"></i></div>
                </div>
                ${secHead('heart', '身体状态')}
                <div class="panel" style="font-size:12.5px;color:var(--tx-1)">${esc(L.bodyState)}</div>
                ${secHead('brain', '五维性格', '稳定性 · ' + stabName(L.personality.stability))}
                <div class="pers-dims">
                  ${L.personality.dims.map(d => `
                    <div class="pers-dim"><span class="pd-l">${esc(d.a)}</span>
                      <div class="pd-track"><span class="pd-dot" style="left:${d.v}%"></span></div>
                    <span class="pd-r">${esc(d.b)}</span></div>`).join('')}
                </div>
              </div>
            </div>
            ${secHead('sparkle', '能力评估')}
            <div class="panel">${L.abilities.map(a => meterRow(a.name, a.val, c.color)).join('')}</div>
            ${secHead('book', '背景')}
            <div class="panel"><p class="prose">${esc(L.background)}</p></div>
            ${secHead('target', '动机')}
            <div class="panel panel-hi" style="border-left:3px solid ${c.color}"><p class="prose lead">「${esc(L.motive)}」</p></div>`;
        } },
        ...(L.isAgent ? [{ id: 'agent', label: 'Agent', icon: 'chip', render: (el) => {
          el.innerHTML = `
            <div class="panel panel-hi" style="display:flex;gap:14px;align-items:center;margin-bottom:16px">
              <span style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:rgba(139,124,246,.14);color:var(--violet)">${ic('chip', 22)}</span>
              <div style="flex:1">
                <div style="font-weight:700;color:var(--tx-0)">${esc(L.agentModel)}</div>
                <div style="font-size:11px;color:var(--tx-2);margin-top:2px">该角色由创世引擎 Agent 自主驱动，在每一轮推演中代表 ${esc(c.name)} 提交决策。</div>
              </div>
              ${badge('在线', 'green', 'dot')}
            </div>
            ${secHead('compass', '决策立场')}
            <div class="card-grid cols-2">
              <div class="panel">${kv('当前立场', '<span style="color:' + c.color + '">' + esc(L.agentStance) + '</span>')}${kv('人格模型', esc(L.agentModel))}${kv('稳定性', stabName(L.personality.stability))}</div>
              <div class="panel"><div style="font-size:11px;color:var(--tx-2);margin-bottom:6px">行为倾向</div>
                <p class="prose" style="font-size:12px">依据五维性格 <strong>${esc(L.personality.code)}</strong> 与动机「${esc(L.motive)}」进行多角度推演，在每一轮世界演化中独立作出决策。</p></div>
            </div>
            ${secHead('brain', '推演说明')}
            <div class="panel"><p class="prose">Agent 提交的决策将进入推演引擎，由大模型从 <strong>政治 / 军事 / 经济 / 科技 / 思潮 / 个人</strong> 六个角度并行推演对未来的影响，经多轮收敛后改写世界状态，并载入大事记。</p>
            <div style="margin-top:12px"><button class="btn btn-cyan" id="btn-goto-deduce">${ic('brain', 14)}打开推演控制台</button></div></div>`;
          el.querySelector('#btn-goto-deduce').addEventListener('click', () => openDeduction());
        } }] : [])
      ]
    });
  }
  function genderIcon(g) { return ic(g === '男' ? 'male' : 'female', 13); }
  function stabName(s) { return s === 'S' ? '稳固可预测' : s === 'A' ? '可塑随环境' : '流动不确定'; }

  /* ============================================================
     轨道站 / 星球 / 天体 信息
     ============================================================ */
  function openStation() {
    GE.modal.open({
      id: 'station', title: '望舒轨道站', subtitle: '晨曦联邦 · 轨道前哨 · 揽星计划',
      icon: 'station', accent: '#5fd6e6', size: 'lg',
      body: `
        <div class="card-grid cols-3" style="margin-bottom:16px">
          ${bigstat(96, '星链卫星', 'satellite', '#5fd6e6')}
          ${bigstat(86, '驻站人员', 'users', '#5fd6e6')}
          ${bigstat('稳定', '运行状态', 'pulses', '#6fd08c')}
        </div>
        ${secHead('info', '站点概况')}
        <div class="panel"><p class="prose">望舒轨道站是晨曦联邦揽星计划的神经中枢，坐落于盖亚上空约 2 万公里的高轨。自此处调度环绕全球的星链星座——一层由近百颗卫星织就的发光之壳，将全球通讯与观测尽收其中。</p></div>
        ${secHead('orbit', '在轨系统')}
        ${kv('星链星座', '96 颗 · 三壳层倾角轨道')}
        ${kv('轨道高度', '<span class="mono">≈ 20,000 km</span>')}
        ${kv('驻站人员', '<span class="mono">86 人</span>')}
        ${kv('核心职能', '全球通讯 · 对地观测 · 深空中继')}
        <div style="margin-top:14px;display:flex;gap:8px">
          <button class="btn btn-cyan" id="st-view">${ic('globe', 14)}返回星球视图</button>
          <button class="btn" id="st-civ">${ic('flag', 14)}晨曦联邦</button>
        </div>`,
      onOpen: (body) => {
        body.querySelector('#st-view').addEventListener('click', () => { GE.modal.close(); GE.app.switchView('planet'); });
        body.querySelector('#st-civ').addEventListener('click', () => openCiv('dawn'));
      }
    });
  }

  function openPlanetInfo() {
    const w = D().world;
    GE.modal.open({
      id: 'planet-info', title: w.母星名, subtitle: '类地行星 · 文明的摇篮',
      icon: 'globe', accent: '#4fa8e0', size: 'lg',
      body: `
        <div class="card-grid cols-3" style="margin-bottom:16px">
          ${bigstat(D().civs.length, '活跃文明', 'flag', '#4fa8e0')}
          ${bigstat(GE.fmt.compact(D().civs.reduce((s, c) => s + c.stats.人口, 0) * 1e6), '总人口', 'users', '#4fa8e0')}
          ${bigstat(w.能级, '世界能级', 'bolt', '#8b7cf6')}
        </div>
        ${secHead('globe', '星球概况')}
        <div class="panel"><p class="prose">${esc(w.母星名)}是曦阳星系宜居带中的一颗蔚蓝行星，灵能随恒星耀斑周期涨落。其地表被划分为六边形地块，由 ${D().civs.length} 个文明分据；近地轨道之上，晨曦联邦的星链之壳正缓缓旋转。</p></div>
        ${secHead('flag', '地表文明')}
        ${D().civs.map(c => `
          <div class="rel-chip" style="margin-bottom:8px;cursor:pointer" data-civ="${c.id}">
            <i style="width:10px;height:10px;border-radius:99px;background:${c.color};box-shadow:0 0 6px ${c.color}"></i>
            <span style="font-weight:700;color:var(--tx-0)">${esc(c.name)}</span>
            <span class="dot-sep"></span><span class="tx2">${esc(c.社会形态)}</span>
            <span style="flex:1"></span>
            <span class="badge" style="border-color:${c.color}55;color:${c.color}">${c.level} 级</span>
          </div>`).join('')}
        <div style="margin-top:12px"><button class="btn btn-cyan" id="pi-universe">${ic('universe', 14)}在宇宙中查看</button></div>`,
      onOpen: (body) => {
        body.querySelectorAll('[data-civ]').forEach(el => el.addEventListener('click', () => openCiv(el.dataset.civ)));
        body.querySelector('#pi-universe').addEventListener('click', () => { GE.modal.close(); GE.app.switchView('universe'); GE.views.universe.focusBody('gaiya'); });
      }
    });
  }

  /* ============================================================
     大事记
     ============================================================ */
  function openChronicle() {
    const eraColor = { 奇迹纪元: '#d8b76a', 皓月纪元: '#8fd0e8', 混沌纪元: '#e56b6b', 曙光纪元: '#5fd6e6' };
    GE.modal.open({
      id: 'chronicle', title: '大事记', subtitle: '自创世累积 · 不可篡改的世界史',
      icon: 'history', accent: '#d8b76a', size: 'xl',
      body: `<div class="timeline stagger">${D().chronicle.map(e => {
        const col = eraColor[e.纪元] || '#d8b76a';
        return `<div class="tl-item" style="--tl-c:${col}">
          <div class="tl-year">${esc(e.年份)}<span class="badge tl-era-chip" style="border-color:${col}44;color:${col}">${esc(e.纪元)}</span></div>
          <div class="tl-text">${esc(e.事件概述)}</div>
        </div>`;
      }).join('')}</div>`
    });
  }

  /* ============================================================
     收藏夹
     ============================================================ */
  function openFavorites() {
    GE.modal.open({
      id: 'favorites', title: '收藏夹', subtitle: '被注视的个体 · 持续追踪',
      icon: 'star', accent: '#d8b76a', size: 'xl',
      body: `<div class="card-grid cols-1 stagger">${D().favorites.map(f => {
        const col = civColor(f.civ);
        return `<div class="panel" style="display:flex;gap:14px;align-items:flex-start;border-left:3px solid ${col}">
          ${sigil(f.name[0], col, 54)}
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
              <span style="font-size:15px;font-weight:900;font-family:var(--f-serif)">${esc(f.name)}</span>
              <span style="font-size:11px;color:${col}">${esc(f.种族与身份)}</span>
            </div>
            <div class="card-grid cols-2" style="margin-top:10px">
              ${kv('超凡能力', esc(f.超凡能力))}
              ${kv('寿命与年龄', esc(f.寿命与年龄))}
            </div>
            <div style="margin-top:8px">${kv('性格与动机', esc(f.性格与动机))}</div>
            <div class="panel" style="margin-top:10px;background:rgba(0,0,0,.2);font-size:12px;color:var(--tx-1);border-left:2px solid ${col}">
              <span class="tx2">近况 · </span>${esc(f.近况)}</div>
          </div></div>`;
      }).join('')}</div>`
    });
  }

  /* ============================================================
     典籍（种族 / 超凡 / 门槛科技 / 能级 / 文明等级）
     ============================================================ */
  function openCodex(tab) {
    GE.modal.open({
      id: 'codex', title: '世界典籍', subtitle: '种族 · 超凡体系 · 门槛科技 · 尺度',
      icon: 'book', accent: '#d8b76a', size: 'xl',
      tabs: [
        { id: 'races', label: '种族', icon: 'dna', render: renderRaces },
        { id: 'trans', label: '超凡体系', icon: 'sparkle', render: renderTrans },
        { id: 'threshold', label: '门槛科技', icon: 'gate', render: renderThresholds },
        { id: 'scale', label: '尺度', icon: 'balance', render: renderScales }
      ]
    });
    if (tab) { const b = GE.$(`.modal-tab[data-tab="${tab}"]`); if (b) b.click(); }
  }
  function renderRaces(el) {
    el.innerHTML = `<div class="card-grid cols-2 stagger">${D().races.map(r => `
      <div class="codex-card"><div class="cc-icon">${ic('dna', 18)}</div>
        <h4>${esc(r.name)}</h4><div class="cc-tag">${esc(r.寿命极限)}</div>
        <div style="margin-top:10px">${kv('生理特征', '')}</div><p class="prose" style="font-size:12px">${esc(r.生理特征)}</p>
        <div style="margin-top:8px">${kv('核心天赋', '')}</div><p class="prose" style="font-size:12px">${esc(r.核心天赋)}</p>
        <div style="margin-top:8px">${kv('社会习俗', '')}</div><p class="prose" style="font-size:12px">${esc(r.社会习俗)}</p>
      </div>`).join('')}</div>`;
  }
  function renderTrans(el) {
    el.innerHTML = `<div class="stagger">${D().transcendent.map(t => `
      <div class="panel" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span style="width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:rgba(139,124,246,.14);color:var(--violet)">${ic('sparkle', 16)}</span>
          <span style="font-size:15px;font-weight:900;font-family:var(--f-serif)">${esc(t.name)}</span>
        </div>
        <div class="panel" style="background:rgba(139,124,246,.06);border-color:rgba(139,124,246,.2);font-family:var(--f-mono);font-size:12px;color:var(--violet);margin-bottom:10px;letter-spacing:.05em">${esc(t.等级划分)}</div>
        <div class="card-grid cols-2">
          ${kv('体系特点', '')}${kv('升级条件', '')}
        </div>
        <p class="prose" style="font-size:12px">${esc(t.体系特点)}</p>
        <p class="prose" style="font-size:12px;margin-top:6px">${esc(t.升级条件)}</p>
        <div style="margin-top:8px">${kv('等级差距', esc(t.等级差距))}${kv('超凡者数量', esc(t.超凡者数量))}</div>
      </div>`).join('')}</div>`;
  }
  function renderThresholds(el) {
    const statusMeta = {
      crossed: { t: '已跨越', c: '#6fd08c' }, stuck: { t: '受阻', c: '#e8a15c' },
      false: { t: '假性跨越', c: '#e56b6b' }, locked: { t: '未触及', c: '#57618a' }
    };
    el.innerHTML = `<div class="stagger">${D().thresholds.map((th, i) => {
      const crossed = D().civs.filter(c => th.status[c.id] === 'crossed');
      return `<div class="panel" style="margin-bottom:12px;${i < 2 ? 'border-left:3px solid #6fd08c' : i === 2 ? 'border-left:3px solid #e8a15c' : ''}">
        <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap">
          <span class="badge badge-gold" style="font-family:var(--f-mono)">${esc(th.lv)}</span>
          <span style="font-size:15px;font-weight:900;font-family:var(--f-serif)">${esc(th.name)}</span>
          <span style="flex:1"></span>
          ${D().civs.map(c => `<span class="badge" data-tip="${c.name} · ${statusMeta[th.status[c.id]].t}" style="border-color:${c.color}44;color:${statusMeta[th.status[c.id]].c}">${c.short}</span>`).join('')}
        </div>
        <p class="prose" style="margin-top:9px;font-size:12.5px">${esc(th.能力)}</p>
        <div style="margin-top:9px;font-size:11.5px;color:var(--tx-2);display:flex;gap:7px"><span style="color:var(--red);flex-shrink:0">${ic('warn', 13)}</span><span><strong>代价 · </strong>${esc(th.代价)}</span></div>
        ${crossed.length ? `<div style="margin-top:8px;font-size:11px;color:var(--green)">已跨越 · ${crossed.map(c => c.name).join('、')}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }
  function renderScales(el) {
    el.innerHTML = `
      ${secHead('bolt', '能级 · 世界能量浓度', '当前 ' + D().world.能级)}
      ${D().energyScale.map(s => {
        const on = D().world.能级 >= s.min && D().world.能级 <= s.max;
        return `<div class="panel" style="margin-bottom:10px;${on ? 'border-left:3px solid var(--violet);background:rgba(139,124,246,.06)' : ''}">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-weight:700;color:${on ? 'var(--violet)' : 'var(--tx-0)'}">${esc(s.name)}</span>
            <span class="badge mono">${s.min} ~ ${s.max > 900 ? '999+' : s.max}</span>
            ${on ? badge('当前世界', 'violet') : ''}
          </div><p class="prose" style="font-size:12px;margin-top:7px">${esc(s.desc)}</p></div>`;
      }).join('')}
      ${secHead('flask', '文明等级 · 科技发展程度')}
      <div class="card-grid cols-2">${D().civLevels.map(l => {
        const here = D().civs.some(c => c.level === l.lv);
        return `<div class="panel" style="${here ? 'border-color:rgba(95,214,230,.3)' : ''}">
          <div style="display:flex;align-items:center;gap:8px"><span class="badge ${here ? 'badge-cyan' : ''} mono">${l.lv}</span>
          <span style="font-weight:700;color:var(--tx-0)">${esc(l.name)}</span>
          ${here ? '<span style="flex:1"></span>' + badge('有文明', 'cyan') : ''}</div>
          <p class="prose" style="font-size:11px;margin-top:6px;color:var(--tx-2)">${esc(l.desc)}</p></div>`;
      }).join('')}</div>`;
  }

  /* ============================================================
     世界概览
     ============================================================ */
  function openWorld() {
    const w = D().world;
    GE.modal.open({
      id: 'world', title: w.纪元.纪元, subtitle: w.纪元.纪年 + ' · ' + w.纪元.核心特性,
      icon: 'calendar', accent: '#d8b76a', size: 'xl',
      tabs: [
        { id: 'state', label: '世界状态', icon: 'globe', render: (el) => {
          el.innerHTML = `
            <div class="card-grid cols-4" style="margin-bottom:16px">
              ${bigstat(w.年数, '世界年', 'history', '#d8b76a')}
              ${bigstat(w.能级, '能级 · ' + w.能级档位, 'bolt', '#8b7cf6')}
              ${bigstat(D().civs.length, '活跃文明', 'flag', '#5fd6e6')}
              ${bigstat(D().races.length, '种族', 'dna', '#6fd08c')}
            </div>
            <div class="card-grid cols-2">
              ${kv('世界状态', badge(w.状态, 'green', 'pulses'))}
              ${kv('空间形态', esc(w.空间形态))}
              ${kv('核心法则', esc(w.核心法则))}
              ${kv('物质与能量', esc(w.物质与能量))}
            </div>
            ${secHead('history', '纪元因果')}
            <div class="card-grid cols-2">
              <div class="panel"><div style="font-size:11px;color:var(--gold);margin-bottom:6px">承 接</div><p class="prose" style="font-size:12.5px">${esc(D().eraCausal.承接)}</p></div>
              <div class="panel"><div style="font-size:11px;color:var(--cyan);margin-bottom:6px">遗 留</div><p class="prose" style="font-size:12.5px">${esc(D().eraCausal.遗留)}</p></div>
            </div>
            ${secHead('calendar', '纪元史')}
            ${D().eras.map(e => `<div class="rel-chip" style="margin-bottom:8px;${e.current ? 'border-color:rgba(216,183,106,.4);background:rgba(216,183,106,.06)' : ''}">
              <span style="font-weight:700;color:${e.current ? 'var(--gold)' : 'var(--tx-0)'}">${esc(e.name)}</span>
              <span class="tx2 mono" style="font-size:10px">${esc(e.years)}</span><span style="flex:1"></span>
              ${e.current ? badge('当前', 'gold') : ''}</div>`).join('')}`;
        } },
        { id: 'relations', label: '文明关系', icon: 'network', render: (el) => {
          const relColor = { '冷战对峙': '#e56b6b', '旧怨未消': '#e8a15c', '匠艺贸易': '#6fd08c', '谨慎往来': '#8fd0e8', '神秘隔绝': '#8b7cf6', '警惕观望': '#e8a15c' };
          el.innerHTML = `<div class="stagger">${D().relations.map(r => {
            const a = civById(r.a), b = civById(r.b);
            const an = a ? a.name : '诸国', bn = b ? b.name : '诸国';
            const col = relColor[r.state] || '#8fd0e8';
            return `<div class="rel-chip" style="margin-bottom:9px">
              <i style="width:9px;height:9px;border-radius:99px;background:${a ? a.color : '#888'}"></i>
              <span style="font-weight:700;color:var(--tx-0)">${esc(an)}</span>
              <span class="tx3">${ic('arrowR', 12)}</span>
              <i style="width:9px;height:9px;border-radius:99px;background:${b ? b.color : '#888'}"></i>
              <span style="font-weight:700;color:var(--tx-0)">${esc(bn)}</span>
              <span class="rel-state" style="background:${col}22;color:${col};border:1px solid ${col}44">${esc(r.state)}</span>
              <span style="flex:1"></span></div>
              <div style="font-size:11.5px;color:var(--tx-2);margin:-4px 0 9px 26px">${esc(r.reason)}</div>`;
          }).join('')}</div>`;
        } },
        { id: 'legacy', label: '遗留问题', icon: 'warn', render: (el) => {
          el.innerHTML = `<div class="stagger">${D().legacies.map(l => `
            <div class="legacy-item legacy-${l.level}">
              <span class="lg-ic">${ic(l.level === 'critical' ? 'skull' : l.level === 'warn' ? 'warn' : 'info', 16)}</span>
              <div style="flex:1"><div class="lg-text">${esc(l.text)}</div>
              <div class="lg-when">${ic('hourglass', 11)} ${esc(l.when)}</div></div>
            </div>`).join('')}</div>
          <div class="panel" style="margin-top:8px;font-size:11.5px;color:var(--tx-2)">${ic('info', 13)} 暗线正于无人处悄然积累，将在未来的推演中逐一兑现。</div>`;
        } }
      ]
    });
  }

  /* ============================================================
     神谕（玩家最高权限干涉）
     ============================================================ */
  function openEdict() {
    GE.modal.open({
      id: 'edict', title: '神谕', subtitle: '以至高权限干涉世界 · 所言即成真',
      icon: 'hand', accent: '#8b7cf6', size: 'lg',
      body: `
        <div class="panel" style="border-left:3px solid var(--violet);margin-bottom:16px">
          <p class="prose">以「神谕」之名所言之事，将无视一切限制直接成真——降下天灾、篡改记忆、复活死者、扭转因果。世界将忠实呈现改变后的连锁反应，不质疑，不劝阻。</p>
        </div>
        ${secHead('hand', '颂出神谕')}
        <div style="display:flex;gap:8px">
          <input id="edict-input" class="edict-input" placeholder="神谕：【让东大陆沉没】…" autocomplete="off">
          <button class="btn btn-gold" id="edict-send">${ic('send', 14)}降下</button>
        </div>
        ${secHead('sparkle', '神谕范例')}
        <div class="card-grid cols-2">
          ${['让深渊的『低语』显形', '赐予苏砚一次顿悟', '在奥瑞利安降下三年大旱', '复活一位已故的英雄'].map(s =>
            `<button class="panel edict-eg" style="text-align:left;cursor:pointer;font-size:12px;color:var(--tx-1)">${esc(s)}</button>`).join('')}
        </div>`,
      onOpen: (body) => {
        const input = body.querySelector('#edict-input');
        const send = () => {
          const v = input.value.trim();
          if (!v) { GE.toast.warn('神谕为空', '请先颂出你的意志。'); return; }
          GE.modal.close();
          GE.toast.show({ type: 'agent', icon: 'hand', title: '神谕已降下', msg: `「${esc(v)}」—— 世界开始随之改变。` });
          setTimeout(() => GE.app.runDeduction({ edict: v }), 900);
        };
        body.querySelector('#edict-send').addEventListener('click', send);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
        body.querySelectorAll('.edict-eg').forEach(b => b.addEventListener('click', () => { input.value = '神谕：【' + b.textContent + '】'; input.focus(); }));
        input.focus();
      }
    });
  }

  /* ============================================================
     设置
     ============================================================ */
  function openSettings() {
    const s = GE.app.settings;
    GE.modal.open({
      id: 'settings', title: '设置', subtitle: '渲染与表现',
      icon: 'gear', accent: '#8fd0e8', size: 'md',
      body: `
        ${secHead('layers', '渲染质量')}
        ${meterRow('内部分辨率', Math.round(s.quality * 100), '#5fd6e6')}
        <div style="display:flex;gap:8px;margin:6px 0 16px">
          ${[['low', '流畅'], ['mid', '均衡'], ['high', '极致']].map(([k, t]) =>
            `<button class="btn btn-sm ${s.qualityPreset === k ? 'btn-cyan' : ''}" data-q="${k}" style="flex:1;justify-content:center">${t}</button>`).join('')}
        </div>
        ${secHead('sparkle', '表现')}
        ${toggleRow('autoRotate', '星图自转', s.autoRotate)}
        ${toggleRow('cityLights', '城市夜光', s.cityLights)}
        ${toggleRow('reduced', '减弱动效', s.reduced)}
        <div class="panel" style="margin-top:16px;font-size:11.5px;color:var(--tx-2)">${ic('info', 13)} 创世引擎 · 前端原型 v0.1 · 数据为推演演示所用。</div>`,
      onOpen: (body) => {
        body.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
          GE.app.setQuality(b.dataset.q); GE.modal.close(); openSettings();
        }));
        body.querySelectorAll('[data-toggle]').forEach(t => t.addEventListener('change', () => {
          GE.app.setSetting(t.dataset.toggle, t.checked);
        }));
      }
    });
  }
  function toggleRow(key, label, on) {
    return `<div class="kv"><span class="k">${esc(label)}</span>
      <label class="switch"><input type="checkbox" data-toggle="${key}" ${on ? 'checked' : ''}><span class="switch-ui"></span></label></div>`;
  }

  /* ============================================================
     Agent 推演控制台（核心）
     ============================================================ */
  function openDeduction() {
    const d = D().deduction;
    GE.modal.open({
      id: 'deduction', title: '推演控制台', subtitle: '多 Agent 决策 · 大模型多棱镜推演 · 世界收敛',
      icon: 'brain', accent: '#d8b76a', size: 'full',
      body: `<div id="deduce-root"></div>`,
      onOpen: (body) => {
        renderDeduction(body.querySelector('#deduce-root'));
      }
    });
  }

  function renderDeduction(root) {
    const d = D().deduction;
    const lensIcons = { 政治: 'balance', 军事: 'sword', 经济: 'coin', 科技: 'flask', 思潮: 'compass', 个人: 'user' };
    const latest = d.log[0];
    root.innerHTML = `
      <div class="deduce-grid">
        <!-- 流水线 -->
        <div class="panel" style="grid-column:1/-1">
          <div class="pipe" id="pipe">
            ${[['users', '决策提交', '各文明 Agent'], ['brain', '多棱镜推演', '大模型 × ' + d.rounds + ' 轮'], ['network', '世界收敛', 'mvu 变量改写'], ['history', '编年入册', '大事记 + 暗线']].map(([i, t, s], idx) => `
              <div class="pipe-stage" data-stage="${idx}">
                <div class="pipe-node">${ic(i, 22)}</div>
                <div class="pipe-label"><div style="color:var(--tx-0);font-weight:700">${t}</div><div>${s}</div></div>
                ${idx < 3 ? '<div class="pipe-conn"></div>' : ''}
              </div>`).join('')}
          </div>
          <div style="display:flex;gap:10px;justify-content:center;padding-bottom:6px">
            <button class="btn btn-gold" id="btn-run-deduce">${ic('ff', 14)}推进一轮推演</button>
            <button class="btn" id="btn-deduce-info">${ic('info', 14)}推演机制</button>
          </div>
        </div>

        <!-- Agent 决策 -->
        <div>
          ${secHead('chip', 'Agent 决策队列', d.pendingDecisions.length + ' 待命')}
          <div style="display:flex;flex-direction:column;gap:10px;max-height:420px;overflow-y:auto;padding-right:2px">
          ${d.pendingDecisions.map(p => {
            const c = civById(p.civ);
            return `<div class="agent-card" style="border-left:3px solid ${c.color}">
              <div class="agent-ava" style="background:linear-gradient(140deg,${c.color},${c.color}88)">${esc(p.leader[0])}<span class="agent-live"></span></div>
              <div class="agent-meta">
                <div class="agent-name">${esc(p.leader)}<span style="font-weight:400;color:var(--tx-2);font-size:11px"> · ${esc(c.name)}</span></div>
                <div class="agent-role">${badge(p.stance, p.urgency === '高' ? 'red' : p.urgency === '中' ? 'orange' : 'green')} <span class="tx3" style="font-size:10px">紧急度 · ${p.urgency}</span></div>
                <div class="agent-decision">${esc(p.decision)}</div>
              </div></div>`;
          }).join('')}
          </div>
        </div>

        <!-- 推演透镜 + 日志 -->
        <div>
          ${secHead('brain', '六棱镜推演', '第 ' + latest.round + ' 轮 · ' + latest.year)}
          <div class="lens-grid" id="lens-grid">
            ${d.lenses.map(l => `<div class="lens-cell" data-lens="${l}">
              <div class="lc-name">${ic(lensIcons[l], 12)}${l}</div>
              <div class="lc-val">${esc(latest.lenses[l] || '—')}</div></div>`).join('')}
          </div>
          ${secHead('history', '推演日志', d.log.length + ' 轮')}
          <div id="deduce-log" style="display:flex;flex-direction:column;gap:10px;max-height:300px;overflow-y:auto;padding-right:2px">
            ${d.log.map(logCard).join('')}
          </div>
        </div>
      </div>`;
    root.querySelector('#btn-run-deduce').addEventListener('click', () => {
      runPipeline(root);
    });
    root.querySelector('#btn-deduce-info').addEventListener('click', () => {
      GE.toast.show({ type: 'info', icon: 'brain', title: '推演机制', msg: '各文明 Agent 提交决策后，大模型从六个角度并行推演多轮，收敛为世界变量改写（mvu），载入大事记并埋下暗线。' });
    });
  }

  function logCard(l) {
    return `<div class="panel" style="border-left:3px solid var(--gold)">
      <div style="display:flex;align-items:center;gap:9px">
        <span class="badge badge-gold mono">第 ${l.round} 轮</span>
        <span class="tx2 mono" style="font-size:11px">${esc(l.year)}</span>
      </div>
      <p class="prose" style="font-size:12.5px;margin-top:8px">${esc(l.summary)}</p></div>`;
  }

  function runPipeline(root) {
    const stages = root.querySelectorAll('.pipe-stage');
    const btn = root.querySelector('#btn-run-deduce');
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>推演中 …`;
    stages.forEach(s => s.classList.remove('on', 'run'));
    const lenses = root.querySelectorAll('.lens-cell');
    lenses.forEach(l => l.classList.remove('run'));
    let i = 0;
    const seq = [0, 1, 2, 3];
    function nextStage() {
      if (i > 0) { stages[seq[i - 1]].classList.remove('run'); stages[seq[i - 1]].classList.add('on'); }
      if (i >= seq.length) { finish(root, btn); return; }
      const st = stages[seq[i]];
      st.classList.add('run');
      if (seq[i] === 1) { // 透镜并发
        lenses.forEach((l, k) => setTimeout(() => l.classList.add('run'), k * 130));
      }
      i++;
      setTimeout(nextStage, seq[i - 1] === 1 ? 1400 : 850);
    }
    nextStage();
  }

  function finish(root, btn) {
    btn.disabled = false; btn.innerHTML = `${ic('ff', 14)}推进一轮推演`;
    GE.app.runDeduction();   // 交由 app 真正推进世界
  }

  /* ============ 导出 ============ */
  return {
    openCiv, openLeader, openStation, openPlanetInfo, openChronicle,
    openFavorites, openCodex, openWorld, openEdict, openSettings, openDeduction
  };
})();
