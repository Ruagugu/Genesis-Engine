/* ============================================================
   创世引擎 · LLM 设置（仅由前端表单写入）
   内存 + data/llm-settings.json；无环境变量、无服务端手填。
   密钥不进 git；推演 hybrid 时由 deduce 读取本模块。
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeBase, llmConfigured } from './llm-provider.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE_PATH = process.env.GE_LLM_SETTINGS_PATH
  ? path.resolve(process.env.GE_LLM_SETTINGS_PATH)
  : path.join(root, 'data', 'llm-settings.json');
const DATA_DIR = path.dirname(STORE_PATH);

const DEFAULTS = {
  enabled: false,
  agentMode: 'rules_only', // rules_only | hybrid | full
  baseUrl: '',
  apiKey: '',
  model: '',
  models: [],
  temperature: 0.7,
  timeoutMs: 25000,
  updatedAt: null
};

function sanitize(partial, base) {
  const src = partial && typeof partial === 'object' ? partial : {};
  const next = Object.assign({}, DEFAULTS, base || {}, src);
  next.enabled = !!next.enabled;
  const mode = String(next.agentMode || 'rules_only');
  next.agentMode = (mode === 'hybrid' || mode === 'full') ? mode : 'rules_only';
  next.baseUrl = normalizeBase(next.baseUrl || '');
  next.apiKey = String(next.apiKey || '').slice(0, 800);
  next.model = String(next.model || '').slice(0, 160);
  next.models = Array.isArray(next.models)
    ? next.models.map(m => String(m)).filter(Boolean).slice(0, 200)
    : [];
  const t = Number(next.temperature);
  next.temperature = Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : 0.7;
  const ms = Number(next.timeoutMs);
  next.timeoutMs = Number.isFinite(ms) ? Math.min(120000, Math.max(3000, ms)) : 25000;
  return next;
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(STORE_PATH)) return Object.assign({}, DEFAULTS);
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return sanitize(parsed, DEFAULTS);
  } catch (err) {
    console.warn('[llm-settings] load failed:', err && err.message);
    return Object.assign({}, DEFAULTS);
  }
}

let state = loadFromDisk();

function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = {
      enabled: !!state.enabled,
      agentMode: state.agentMode,
      baseUrl: state.baseUrl || '',
      apiKey: state.apiKey || '',
      model: state.model || '',
      models: Array.isArray(state.models) ? state.models.slice(0, 200) : [],
      temperature: state.temperature,
      timeoutMs: state.timeoutMs,
      updatedAt: state.updatedAt
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(out, null, 2), 'utf8');
  } catch (err) {
    console.warn('[llm-settings] persist failed:', err && err.message);
  }
}

function get() {
  return Object.assign({}, state);
}

/** 对外摘要（不含完整密钥明文可选；本地单机仍返回完整以便表单回填） */
function getPublic(opts) {
  opts = opts || {};
  const s = get();
  if (opts.maskKey && s.apiKey) {
    const k = s.apiKey;
    const masked = k.length <= 8
      ? '****'
      : (k.slice(0, 4) + '…' + k.slice(-4));
    return Object.assign({}, s, { apiKey: masked, apiKeySet: true });
  }
  return Object.assign({}, s, { apiKeySet: !!s.apiKey });
}

function set(partial) {
  state = sanitize(partial, state);
  state.updatedAt = new Date().toISOString();
  persist();
  return get();
}

function clearKey() {
  return set({ apiKey: '' });
}

function reset() {
  state = Object.assign({}, DEFAULTS);
  state.updatedAt = new Date().toISOString();
  try {
    if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
  } catch (_) { /* ignore */ }
  return get();
}

/**
 * 推演用：凭证来自「前端已保存」的服务端存储；请求体可临时覆盖
 * @returns {{ agentMode: string, llm: object|null, source: string }}
 */
function forDeduce(overrides) {
  overrides = overrides || {};
  const s = get();
  const rawMode = overrides.agentMode || s.agentMode || 'rules_only';
  const agentMode = (rawMode === 'hybrid' || rawMode === 'full') ? rawMode : 'rules_only';

  if (agentMode === 'rules_only') {
    return { agentMode: 'rules_only', llm: null, source: 'rules_only' };
  }

  // 请求体临时覆盖优先
  if (overrides.llm && typeof overrides.llm === 'object' && llmConfigured(overrides.llm)) {
    return {
      agentMode,
      llm: {
        baseUrl: overrides.llm.baseUrl,
        apiKey: overrides.llm.apiKey,
        model: overrides.llm.model,
        temperature: overrides.llm.temperature != null ? overrides.llm.temperature : s.temperature,
        timeoutMs: overrides.llm.timeoutMs != null ? overrides.llm.timeoutMs : s.timeoutMs
      },
      source: 'request'
    };
  }

  // 前端已保存到后端，且启用
  if (s.enabled && llmConfigured(s)) {
    return {
      agentMode,
      llm: {
        baseUrl: s.baseUrl,
        apiKey: s.apiKey,
        model: s.model,
        temperature: s.temperature,
        timeoutMs: s.timeoutMs
      },
      source: 'server_store'
    };
  }

  // hybrid/full 但无可用凭证 → deduce 内回落 rules
  return {
    agentMode,
    llm: null,
    source: s.enabled ? 'incomplete' : 'server_disabled'
  };
}

export {
  get,
  getPublic,
  set,
  clearKey,
  reset,
  forDeduce,
  STORE_PATH,
  DEFAULTS
};
