/* ============================================================
   创世引擎 · llm-config.js — 前端模型 / API 配置
   OpenAI 兼容：baseUrl + apiKey + model
   本机 localStorage 缓存 + 保存到后端 GET/PUT /api/v1/llm-settings
   推演 hybrid 时由服务端读取已存配置（不必每次随 deduce 带密钥）
   ============================================================ */
window.GE = window.GE || {};

GE.llmConfig = (function () {
  'use strict';

  const STORAGE_KEY = 'ge-llm-config-v1';
  const DEFAULTS = {
    enabled: false,
    agentMode: 'rules_only', // rules_only | hybrid | full
    baseUrl: '',
    apiKey: '',
    model: '',
    models: [], // 最近一次 list 结果
    temperature: 0.7,
    timeoutMs: 45000,
    // 世界 API（创世引擎自身）
    worldApiBase: '', // 空 = 同源
    runId: 'local-seed',
    serverSyncedAt: null
  };

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      const parsed = JSON.parse(raw);
      return Object.assign({}, DEFAULTS, parsed);
    } catch (_) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        enabled: !!state.enabled,
        agentMode: state.agentMode || 'rules_only',
        baseUrl: state.baseUrl || '',
        apiKey: state.apiKey || '',
        model: state.model || '',
        models: Array.isArray(state.models) ? state.models.slice(0, 200) : [],
        temperature: state.temperature,
        timeoutMs: state.timeoutMs,
        worldApiBase: state.worldApiBase || '',
        runId: state.runId || 'local-seed',
        serverSyncedAt: state.serverSyncedAt || null
      }));
    } catch (_) { /* ignore quota */ }
  }

  function get() {
    return Object.assign({}, state);
  }

  function set(partial) {
    state = Object.assign({}, state, partial || {});
    if (state.baseUrl) state.baseUrl = String(state.baseUrl).replace(/\/$/, '');
    if (state.worldApiBase) state.worldApiBase = String(state.worldApiBase).replace(/\/$/, '');
    persist();
    // 同步到 snapshot / app 可读位置
    try {
      if (state.worldApiBase) {
        window.GE_API_BASE = state.worldApiBase;
        localStorage.setItem('ge-api-base', state.worldApiBase);
      } else {
        try { localStorage.removeItem('ge-api-base'); } catch (_) { /* ignore */ }
        if (window.GE_API_BASE) {
          // 仅在明确清空时去掉；避免误伤其它写入
        }
      }
      if (state.runId) localStorage.setItem('ge-run-id', state.runId);
    } catch (_) { /* ignore */ }
    return get();
  }

  function reset() {
    state = Object.assign({}, DEFAULTS);
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
    return get();
  }

  function normalizeBase(url) {
    let u = String(url || '').trim().replace(/\/$/, '');
    if (!u) return '';
    // 允许用户只填 host，默认补 /v1
    if (!/\/v1$/i.test(u) && !/\/v1\//i.test(u)) {
      // 若已是完整 chat 路径则不改
      if (!/chat\/completions/i.test(u)) u = u + '/v1';
    }
    return u;
  }

  /** 世界 API 根（创世引擎后端） */
  function worldBase() {
    if (state.worldApiBase) return state.worldApiBase;
    try {
      if (GE.snapshot && typeof GE.snapshot.apiBase === 'function') {
        const b = GE.snapshot.apiBase();
        if (b) return b;
      }
    } catch (_) { /* ignore */ }
    try {
      if (typeof window !== 'undefined' && window.GE_API_BASE) return String(window.GE_API_BASE);
    } catch (_) { /* ignore */ }
    return '';
  }

  function runId() {
    try {
      const q = new URLSearchParams(location.search || '');
      if (q.get('run')) return q.get('run');
    } catch (_) { /* ignore */ }
    return state.runId || 'local-seed';
  }

  function settingsUrl() {
    const root = worldBase().replace(/\/$/, '');
    return root + '/api/v1/llm-settings';
  }

  /**
   * 从后端拉取已保存的 LLM 设置并合并到本机缓存
   * @returns {Promise<{ ok:boolean, settings?:object, error?:string }>}
   */
  async function loadFromServer() {
    const url = settingsUrl();
    try {
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || data.message || `HTTP ${res.status}` };
      }
      set({
        enabled: !!data.enabled,
        agentMode: data.agentMode || 'rules_only',
        baseUrl: data.baseUrl || '',
        apiKey: data.apiKey || '',
        model: data.model || '',
        models: Array.isArray(data.models) ? data.models : state.models,
        temperature: data.temperature != null ? data.temperature : state.temperature,
        timeoutMs: data.timeoutMs != null ? data.timeoutMs : state.timeoutMs,
        serverSyncedAt: data.updatedAt || new Date().toISOString()
      });
      return { ok: true, settings: get() };
    } catch (err) {
      const msg = /Failed to fetch|NetworkError|ERR_/i.test(String(err && err.message || err))
        ? '网络失败：无法连接创世引擎后端（检查世界 API 根地址 / 是否已启动服务）'
        : String(err && err.message || err);
      return { ok: false, error: msg };
    }
  }

  /**
   * 将当前配置保存到后端（前端配置、后端落盘；无服务端手填）
   * @param {object} [partial] 先合并再保存
   * @returns {Promise<{ ok:boolean, settings?:object, error?:string, raw?:any }>}
   */
  async function saveToServer(partial) {
    if (partial) set(partial);
    const cfg = get();
    const url = settingsUrl();
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          enabled: !!cfg.enabled,
          agentMode: cfg.agentMode || 'rules_only',
          baseUrl: cfg.baseUrl || '',
          apiKey: cfg.apiKey || '',
          model: cfg.model || '',
          models: Array.isArray(cfg.models) ? cfg.models.slice(0, 200) : [],
          temperature: cfg.temperature,
          timeoutMs: cfg.timeoutMs
        }),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || data.message || `HTTP ${res.status}`, raw: data };
      }
      set({
        enabled: data.enabled != null ? !!data.enabled : cfg.enabled,
        agentMode: data.agentMode || cfg.agentMode,
        baseUrl: data.baseUrl != null ? data.baseUrl : cfg.baseUrl,
        apiKey: data.apiKey != null ? data.apiKey : cfg.apiKey,
        model: data.model != null ? data.model : cfg.model,
        models: Array.isArray(data.models) ? data.models : cfg.models,
        temperature: data.temperature != null ? data.temperature : cfg.temperature,
        timeoutMs: data.timeoutMs != null ? data.timeoutMs : cfg.timeoutMs,
        serverSyncedAt: data.updatedAt || new Date().toISOString()
      });
      return { ok: true, settings: get(), raw: data };
    } catch (err) {
      const msg = /Failed to fetch|NetworkError|ERR_/i.test(String(err && err.message || err))
        ? '网络失败：无法连接创世引擎后端（配置仅写入了本机缓存）'
        : String(err && err.message || err);
      return { ok: false, error: msg };
    }
  }

  /**
   * 拉取模型列表（OpenAI 兼容 GET {base}/models）
   * @returns {Promise<{ ok:boolean, models:string[], error?:string, raw?:any }>}
   */
  async function listModels(overrides) {
    const cfg = Object.assign({}, state, overrides || {});
    const base = normalizeBase(cfg.baseUrl);
    if (!base) return { ok: false, models: [], error: '请填写 API Base URL' };
    if (!cfg.apiKey) return { ok: false, models: [], error: '请填写 API Key' };

    const url = base.replace(/\/$/, '') + '/models';
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), cfg.timeoutMs || 45000) : null;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + cfg.apiKey,
          Accept: 'application/json'
        },
        signal: ctrl ? ctrl.signal : undefined,
        cache: 'no-store'
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) { /* not json */ }
      if (!res.ok) {
        return {
          ok: false,
          models: [],
          error: `HTTP ${res.status}: ${(text || '').slice(0, 200)}`,
          raw: data
        };
      }
      let models = [];
      if (data && Array.isArray(data.data)) {
        models = data.data.map(m => m.id || m.name).filter(Boolean);
      } else if (data && Array.isArray(data.models)) {
        models = data.models.map(m => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
      } else if (Array.isArray(data)) {
        models = data.map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean);
      }
      models = [...new Set(models)].sort();
      state.models = models;
      if (!state.model && models[0]) state.model = models[0];
      // 若当前 model 不在列表，保留用户手填
      persist();
      return { ok: true, models, raw: data };
    } catch (err) {
      const msg = err && err.name === 'AbortError'
        ? '请求超时'
        : /Failed to fetch|NetworkError|ERR_/i.test(String(err && err.message || err))
          ? '网络失败：无法连接 API（检查 Base URL / 代理 / CORS / 密钥）'
          : String(err && err.message || err);
      return { ok: false, models: [], error: msg };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * OpenAI 兼容 chat.completions（调试「试调用」；走浏览器直连供应商）
   */
  async function chat(messages, overrides) {
    const cfg = Object.assign({}, state, overrides || {});
    if (!cfg.enabled && !(overrides && overrides.force)) {
      return { ok: false, error: '模型调用未启用（设置中打开「启用 LLM」）' };
    }
    const base = normalizeBase(cfg.baseUrl);
    if (!base || !cfg.apiKey || !cfg.model) {
      return { ok: false, error: '请完整填写 Base URL / API Key / Model' };
    }
    const url = /chat\/completions/i.test(base)
      ? base
      : base.replace(/\/$/, '') + '/chat/completions';
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), cfg.timeoutMs || 45000) : null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + cfg.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: messages || [{ role: 'user', content: 'ping' }],
          temperature: cfg.temperature != null ? cfg.temperature : 0.7
        }),
        signal: ctrl ? ctrl.signal : undefined
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: data.error?.message || data.message || `HTTP ${res.status}`,
          raw: data
        };
      }
      const content = data.choices
        && data.choices[0]
        && data.choices[0].message
        && data.choices[0].message.content;
      return { ok: true, content: content || '', raw: data };
    } catch (err) {
      const msg = err && err.name === 'AbortError'
        ? '请求超时'
        : /Failed to fetch|NetworkError|ERR_/i.test(String(err && err.message || err))
          ? '网络失败：无法连接 API（检查 Base URL / 代理 / CORS / 密钥）'
          : String(err && err.message || err);
      return { ok: false, error: msg };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // 启动时恢复 GE_API_BASE
  try {
    if (state.worldApiBase) window.GE_API_BASE = state.worldApiBase;
    else {
      const saved = localStorage.getItem('ge-api-base');
      if (saved) {
        state.worldApiBase = saved;
        window.GE_API_BASE = saved;
      }
    }
  } catch (_) { /* ignore */ }

  return {
    STORAGE_KEY,
    DEFAULTS,
    get,
    set,
    reset,
    listModels,
    chat,
    worldBase,
    runId,
    normalizeBase,
    loadFromServer,
    saveToServer,
    settingsUrl
  };
})();
