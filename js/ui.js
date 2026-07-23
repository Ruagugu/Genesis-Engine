/* ============================================================
   创世引擎 · UI 基础设施
   DOM 助手 / 格式化 / 内部通知(toast) / 通知中心 / 模态框 / 工具提示
   ============================================================ */
window.GE = window.GE || {};

/* ---------- DOM 助手 ---------- */
GE.h = function (html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
GE.hs = function (html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return Array.from(t.content.children);
};
GE.$ = (sel, root) => (root || document).querySelector(sel);
GE.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
GE.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- 格式化 ---------- */
GE.fmt = {
  num(n) { // 1234567 -> 1,234,567
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US');
  },
  compact(n) { // 1234567 -> 123万 / 1.2亿
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e8) return (n / 1e8).toFixed(n % 1e8 === 0 ? 0 : 1) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(n % 1e4 === 0 ? 0 : 1) + '万';
    return String(n);
  },
  pct(n) { return (n == null || isNaN(n)) ? '—' : Math.round(n) + '%'; },
  year(y) { return GE.esc(y); }
};

/* 数字滚动动画 */
GE.countUp = function (el, to, opts) {
  opts = opts || {};
  const dur = opts.dur || 900, from = opts.from || 0, fmt = opts.fmt || (v => Math.round(v).toLocaleString('en-US'));
  const t0 = performance.now();
  function tick(t) {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
};

/* ============================================================
   内部通知 Toast（右上角堆叠卡片）
   ============================================================ */
GE.toast = (function () {
  let host = null;
  const icons = { info: 'info', success: 'checkC', warn: 'warn', critical: 'skull', event: 'sparkle', agent: 'chip' };
  function ensure() {
    if (!host) { host = GE.h('<div id="toast-host" aria-live="polite"></div>'); document.body.appendChild(host); }
    return host;
  }
  function show(o) {
    o = o || {};
    const type = o.type || 'info';
    const el = GE.h(`
      <div class="toast toast-${type}" role="status">
        <div class="toast-ic">${GE.icons.icon(o.icon || icons[type] || 'info', 18)}</div>
        <div class="toast-body">
          <div class="toast-title">${GE.esc(o.title || '提示')}</div>
          ${o.msg ? `<div class="toast-msg">${o.msg}</div>` : ''}
        </div>
        <button class="toast-x" aria-label="关闭">${GE.icons.icon('x', 14)}</button>
        <div class="toast-bar"></div>
      </div>`);
    ensure().appendChild(el);
    const life = o.timeout || (type === 'critical' ? 9000 : 4600);
    const bar = GE.$('.toast-bar', el);
    bar.style.animationDuration = life + 'ms';
    let killed = false;
    function kill() {
      if (killed) return; killed = true;
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }
    GE.$('.toast-x', el).addEventListener('click', kill);
    const timer = setTimeout(kill, life);
    el.addEventListener('mouseenter', () => { clearTimeout(timer); bar.style.animationPlayState = 'paused'; });
    // 同步进入通知中心
    if (GE.notify && GE.notify.push) GE.notify.push({ type, title: o.title, msg: o.msg, icon: o.icon || icons[type], time: Date.now() });
    return { kill };
  }
  return { show };
})();
// 便捷别名
GE.toast.info = (t, m) => GE.toast.show({ type: 'info', title: t, msg: m });
GE.toast.success = (t, m) => GE.toast.show({ type: 'success', title: t, msg: m });
GE.toast.warn = (t, m) => GE.toast.show({ type: 'warn', title: t, msg: m });
GE.toast.critical = (t, m) => GE.toast.show({ type: 'critical', title: t, msg: m });

/* ============================================================
   通知中心（铃铛下拉）
   ============================================================ */
GE.notify = (function () {
  const store = [];
  let badge = null, list = null, unread = 0;
  function bind() {
    badge = GE.$('#notify-badge');
    list = GE.$('#notify-list');
    render();
  }
  function push(n) {
    store.unshift(n);
    if (store.length > 60) store.pop();
    unread++;
    render();
  }
  function render() {
    if (badge) {
      badge.textContent = unread > 99 ? '99+' : unread;
      badge.classList.toggle('hidden', unread === 0);
    }
    if (!list) return;
    if (!store.length) {
      list.innerHTML = `<div class="notify-empty">${GE.icons.icon('bell', 26)}<p>暂无通知</p></div>`;
      return;
    }
    list.innerHTML = store.map(n => `
      <div class="notify-item notify-${n.type}">
        <div class="notify-ic">${GE.icons.icon(n.icon || 'info', 16)}</div>
        <div class="notify-txt">
          <div class="notify-title">${GE.esc(n.title || '')}</div>
          ${n.msg ? `<div class="notify-msg">${n.msg}</div>` : ''}
        </div>
      </div>`).join('');
  }
  function markRead() { unread = 0; render(); }
  function clear() { store.length = 0; unread = 0; render(); }
  return { bind, push, markRead, clear, get store() { return store; } };
})();

/* ============================================================
   模态框系统
   ============================================================ */
GE.modal = (function () {
  let root = null, current = null, prevFocus = null;
  const stack = [];
  function ensure() {
    if (!root) {
      root = GE.h('<div id="modal-root" aria-hidden="true"></div>');
      document.body.appendChild(root);
      root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) close(); });
    }
    return root;
  }
  function open(cfg) {
    ensure();
    close(true); // 先关闭已有
    prevFocus = document.activeElement;
    const accent = cfg.accent || 'var(--gold)';
    const tabs = cfg.tabs || null;
    const modal = GE.h(`
      <div class="modal ${cfg.size ? 'modal-' + cfg.size : 'modal-lg'} ${cfg.klass || ''}" role="dialog" aria-modal="true" aria-label="${GE.esc(cfg.title || '面板')}" style="--accent:${accent}">
        <div class="modal-frame cartouche">
          <header class="modal-head">
            <div class="modal-ic">${GE.icons.icon(cfg.icon || 'sparkle', 20)}</div>
            <div class="modal-titles">
              <h2 class="modal-title serif">${GE.esc(cfg.title || '')}</h2>
              ${cfg.subtitle ? `<div class="modal-sub">${cfg.subtitle}</div>` : ''}
            </div>
            <div class="modal-head-x">${cfg.headExtra || ''}</div>
            <button class="modal-close" id="modal-close-btn" aria-label="关闭面板">${GE.icons.icon('x', 16)}</button>
          </header>
          ${tabs ? `<nav class="modal-tabs" role="tablist">${tabs.map((t, i) => `
            <button class="modal-tab ${i === 0 ? 'on' : ''}" role="tab" data-tab="${t.id}" aria-selected="${i === 0}">
              ${GE.icons.icon(t.icon || 'dot', 15)}<span>${GE.esc(t.label)}</span>
            </button>`).join('')}</nav>` : ''}
          <div class="modal-body" id="modal-body"></div>
          ${cfg.footer ? `<footer class="modal-foot">${cfg.footer}</footer>` : ''}
        </div>
      </div>`);
    root.appendChild(modal);
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    current = { cfg, modal };
    stack.push(current);

    const body = GE.$('#modal-body', modal);
    function renderTab(tabId) {
      const tab = (tabs || []).find(t => t.id === tabId) || (tabs || [])[0];
      body.innerHTML = '';
      body.className = 'modal-body anim-rise';
      if (tab && tab.render) tab.render(body);
      else if (cfg.body) (typeof cfg.body === 'function' ? cfg.body(body) : (body.innerHTML = cfg.body));
    }
    if (tabs) {
      GE.$$('.modal-tab', modal).forEach(btn => btn.addEventListener('click', () => {
        GE.$$('.modal-tab', modal).forEach(b => { b.classList.remove('on'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('on'); btn.setAttribute('aria-selected', 'true');
        renderTab(btn.dataset.tab);
      }));
      renderTab(tabs[0].id);
    } else if (cfg.body) {
      (typeof cfg.body === 'function' ? cfg.body(body) : (body.innerHTML = cfg.body));
    }
    GE.$('#modal-close-btn', modal).addEventListener('click', () => close());
    requestAnimationFrame(() => modal.classList.add('show'));
    if (cfg.onOpen) cfg.onOpen(body, modal);
    return modal;
  }
  function close(silent) {
    if (!current) return;
    const { modal, cfg } = current;
    if (cfg.onClose) cfg.onClose();
    stack.pop();
    current = null;
    modal.classList.remove('show');
    modal.classList.add('hide');
    setTimeout(() => {
      modal.remove();
      if (!root.children.length) {
        root.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
      }
    }, silent ? 0 : 240);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }
  function isOpen() { return !!current; }
  return { open, close, isOpen };
})();

/* ============================================================
   工具提示 Tooltip（跟随式）
   ============================================================ */
GE.tooltip = (function () {
  let tip = null, showT = null;
  function ensure() {
    if (!tip) { tip = GE.h('<div id="tooltip" role="tooltip"></div>'); document.body.appendChild(tip); }
    return tip;
  }
  function show(html, x, y) {
    ensure().innerHTML = html;
    tip.classList.add('show');
    move(x, y);
  }
  function move(x, y) {
    if (!tip) return;
    const r = tip.getBoundingClientRect();
    let lx = x + 16, ly = y + 18;
    if (lx + r.width > innerWidth - 10) lx = x - r.width - 14;
    if (ly + r.height > innerHeight - 10) ly = y - r.height - 14;
    tip.style.left = lx + 'px'; tip.style.top = ly + 'px';
  }
  function hide() {
    if (!tip) return;
    tip.classList.remove('show');
    clearTimeout(showT);
  }
  // 事件委托：任何带 data-tip 的元素
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    clearTimeout(showT);
    showT = setTimeout(() => {
      const html = t.getAttribute('data-tip-html') || GE.esc(t.getAttribute('data-tip'));
      show(html, e.clientX, e.clientY);
    }, 160);
  });
  document.addEventListener('mousemove', (e) => {
    if (tip && tip.classList.contains('show')) move(e.clientX, e.clientY);
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-tip]')) hide();
  });
  document.addEventListener('mousedown', hide);
  return { show, hide, move };
})();
