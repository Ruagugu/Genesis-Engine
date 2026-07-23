/* ============================================================
   创世引擎 · LLM 调用日志（推演 AI 次数与返回内容）
   内存环形缓冲；不写密钥；供 GET /api/v1/llm-logs 与 deduce 响应。
   ============================================================ */

const MAX_ENTRIES = 120;
const MAX_CONTENT = 12000;
const MAX_PROMPT = 4000;

let seq = 0;
/** @type {object[]} */
const entries = [];
const totals = {
  calls: 0,
  ok: 0,
  fail: 0,
  ms: 0
};

function clip(s, n) {
  s = String(s == null ? '' : s);
  if (s.length <= n) return s;
  return s.slice(0, n) + `…(+${s.length - n}字)`;
}

/**
 * 记录一次 LLM 调用
 * @param {object} rec
 * @returns {object} 写入后的条目
 */
function record(rec) {
  rec = rec || {};
  const id = ++seq;
  const entry = {
    id,
    at: new Date().toISOString(),
    runId: rec.runId || null,
    round: rec.round != null ? rec.round : null,
    purpose: rec.purpose || 'unknown', // character_enhance | detail_fill | test | other
    model: rec.model || '',
    baseHost: rec.baseHost || '',
    ok: !!rec.ok,
    ms: Number(rec.ms) || 0,
    error: rec.error ? String(rec.error).slice(0, 400) : null,
    // 请求摘要（不含 key）
    promptPreview: clip(rec.promptPreview || rec.userPreview || '', MAX_PROMPT),
    systemPreview: clip(rec.systemPreview || '', 800),
    // 完整返回正文（截断保护）
    content: rec.content != null ? clip(rec.content, MAX_CONTENT) : '',
    contentLen: rec.content != null ? String(rec.content).length : 0,
    // 可选 usage
    usage: rec.usage || null,
    // 解析结果摘要
    parseOk: rec.parseOk != null ? !!rec.parseOk : null,
    applied: rec.applied != null ? rec.applied : null,
    fallback: rec.fallback || null
  };

  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;

  totals.calls += 1;
  if (entry.ok) totals.ok += 1;
  else totals.fail += 1;
  totals.ms += entry.ms;

  const tag = entry.ok ? 'OK' : 'FAIL';
  console.log(
    `[llm-log] #${entry.id} ${tag} ${entry.purpose} round=${entry.round} ${entry.ms}ms model=${entry.model}`,
    entry.ok
      ? `content=${entry.contentLen}字`
      : `err=${entry.error}`
  );
  if (entry.ok && entry.content) {
    console.log(`[llm-log] #${entry.id} response:\n${entry.content.slice(0, 2000)}`);
  }

  return entry;
}

function list(opts) {
  opts = opts || {};
  let items = entries.slice();
  if (opts.runId) items = items.filter(e => e.runId === opts.runId);
  if (opts.round != null) items = items.filter(e => e.round === Number(opts.round));
  if (opts.purpose) items = items.filter(e => e.purpose === opts.purpose);
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), MAX_ENTRIES);
  items = items.slice(0, limit);
  return {
    totals: Object.assign({}, totals),
    count: items.length,
    bufferSize: entries.length,
    max: MAX_ENTRIES,
    items
  };
}

function forRound(runId, round) {
  return entries.filter(e =>
    (runId == null || e.runId === runId) && e.round === round
  );
}

function clear() {
  entries.length = 0;
  totals.calls = 0;
  totals.ok = 0;
  totals.fail = 0;
  totals.ms = 0;
  return { ok: true, cleared: true };
}

function hostFromBase(baseUrl) {
  try {
    const u = String(baseUrl || '');
    if (!u) return '';
    const m = u.match(/^https?:\/\/([^/]+)/i);
    return m ? m[1] : u.slice(0, 80);
  } catch (_) {
    return '';
  }
}

export {
  record,
  list,
  forRound,
  clear,
  hostFromBase,
  MAX_ENTRIES,
  totals
};
