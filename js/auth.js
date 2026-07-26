/* ============================================================
   创世引擎 · auth.js — 玩家身份统一 helper（阶段 E）
   - 收编 main.js / panels.js 的两份 playerToken 分叉实现（F6）
   - 注册/登录后 token 来自服务端账号（稳定，即 seat.playerId）
   - 未登录时保留匿名 token（观察者 / SSE 兼容阶段 D 行为）
   ============================================================ */
window.GE = window.GE || {};
GE.auth = (function () {
  'use strict';

  const KEY_TOKEN = 'ge-player-token';
  const KEY_NAME = 'ge-player-name';
  // localStorage 不可用（隐私模式等）时的会话级兜底：
  // 同一次会话稳定，绝不每次调用新造 token（旧 panels.js 的孤儿席位 bug）
  let memToken = null;
  let memName = null;

  function readLS(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function writeLS(key, val) {
    try {
      if (val == null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
      return true;
    } catch (_) { return false; }
  }

  function randomToken() {
    const bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return 'ge_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /** 当前 token（不生成）。 */
  function token() {
    const t = readLS(KEY_TOKEN);
    if (t && t.length >= 12) return t;
    return memToken;
  }

  /** 确保有 token：优先已存（含账号 token），否则生成匿名 token 并尽力持久化。 */
  function ensureToken() {
    let t = token();
    if (t) return t;
    t = randomToken();
    if (!writeLS(KEY_TOKEN, t)) memToken = t;
    return t;
  }

  function username() {
    return readLS(KEY_NAME) || memName;
  }

  function isLoggedIn() {
    return !!(username() && token());
  }

  function setSession(tok, name) {
    if (!writeLS(KEY_TOKEN, tok)) memToken = tok;
    if (!writeLS(KEY_NAME, name || null)) memName = name || null;
  }

  function logout() {
    // 只清用户名与账号 token；下次操作重新生成匿名 token
    writeLS(KEY_TOKEN, null);
    writeLS(KEY_NAME, null);
    memToken = null;
    memName = null;
  }

  function apiRoot() {
    try {
      if (GE.llmConfig && typeof GE.llmConfig.worldBase === 'function') {
        const w = GE.llmConfig.worldBase();
        if (w) return w;
      }
    } catch (_) { /* ignore */ }
    try {
      if (GE.snapshot && typeof GE.snapshot.apiBase === 'function') {
        const b = GE.snapshot.apiBase();
        if (b) return b;
      }
    } catch (_) { /* ignore */ }
    return '';
  }

  async function authPost(path, body) {
    const res = await fetch(`${apiRoot()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  /** 注册；成功后本地会话切换到账号身份。 */
  async function register(name, password) {
    const r = await authPost('/api/v1/auth/register', { username: name, password });
    if (r.ok && r.data && r.data.token) setSession(r.data.token, r.data.username);
    return r;
  }

  /** 登录；成功后本地会话切换到账号身份（换设备找回同一 token）。 */
  async function login(name, password) {
    const r = await authPost('/api/v1/auth/login', { username: name, password });
    if (r.ok && r.data && r.data.token) setSession(r.data.token, r.data.username);
    return r;
  }

  /** 用服务端校验当前 token 是否为注册账号；同步本地用户名。 */
  async function me() {
    const t = token();
    if (!t) return null;
    try {
      const res = await fetch(`${apiRoot()}/api/v1/auth/me`, {
        headers: { Accept: 'application/json', 'X-Player-Token': t },
        cache: 'no-store'
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.username) {
        if (!writeLS(KEY_NAME, data.username)) memName = data.username;
        return data;
      }
      return null;
    } catch (_) { return null; }
  }

  return { token, ensureToken, username, isLoggedIn, setSession, logout, register, login, me };
})();
