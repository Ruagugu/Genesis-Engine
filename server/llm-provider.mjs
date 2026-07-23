/* ============================================================
   创世引擎 · OpenAI 兼容 LLM Provider（C6）
   供 deduce hybrid/full 调用；超时 / 失败由调用方回落 rules。
   密钥由请求体传入（前端 localStorage），服务端不落盘。
   ============================================================ */

function normalizeBase(url) {
  let u = String(url || '').trim().replace(/\/$/, '');
  if (!u) return '';
  if (!/\/v1$/i.test(u) && !/\/v1\//i.test(u)) {
    if (!/chat\/completions/i.test(u)) u = u + '/v1';
  }
  return u;
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {{ baseUrl?:string, apiKey?:string, model?:string, temperature?:number, timeoutMs?:number }} cfg
 * @returns {Promise<{ ok:boolean, content?:string, raw?:any, error?:string, ms?:number }>}
 */
async function chat(messages, cfg) {
  cfg = cfg || {};
  const started = Date.now();
  const base = normalizeBase(cfg.baseUrl);
  const apiKey = String(cfg.apiKey || '').trim();
  const model = String(cfg.model || '').trim();
  if (!base) return { ok: false, error: 'missing_base_url', ms: 0 };
  if (!apiKey) return { ok: false, error: 'missing_api_key', ms: 0 };
  if (!model) return { ok: false, error: 'missing_model', ms: 0 };

  const url = /chat\/completions/i.test(base)
    ? base
    : base.replace(/\/$/, '') + '/chat/completions';
  const timeoutMs = Math.max(3000, Math.min(Number(cfg.timeoutMs) || 25000, 90000));
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: messages || [],
        temperature: cfg.temperature != null ? Number(cfg.temperature) : 0.7
      }),
      signal: ctrl ? ctrl.signal : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { /* not json */ }
    if (!res.ok) {
      const msg = (data && (data.error?.message || data.message)) || `HTTP ${res.status}`;
      return { ok: false, error: String(msg).slice(0, 240), raw: data, ms: Date.now() - started };
    }
    const content = data?.choices?.[0]?.message?.content;
    if (content == null || content === '') {
      return { ok: false, error: 'empty_content', raw: data, ms: Date.now() - started };
    }
    return { ok: true, content: String(content), raw: data, ms: Date.now() - started };
  } catch (err) {
    const msg = err && err.name === 'AbortError'
      ? 'timeout'
      : String(err && err.message || err);
    return { ok: false, error: msg, ms: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 从模型输出中尽量抠出 JSON 对象 / 数组 */
function parseJsonLoose(text) {
  if (text == null) return null;
  let s = String(text).trim();
  if (!s) return null;
  // ```json ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch (_) { /* fall through */ }
  const obj = s.match(/\{[\s\S]*\}/);
  if (obj) {
    try { return JSON.parse(obj[0]); } catch (_) { /* ignore */ }
  }
  const arr = s.match(/\[[\s\S]*\]/);
  if (arr) {
    try { return JSON.parse(arr[0]); } catch (_) { /* ignore */ }
  }
  return null;
}

function llmConfigured(llm) {
  if (!llm || typeof llm !== 'object') return false;
  return !!(String(llm.baseUrl || '').trim()
    && String(llm.apiKey || '').trim()
    && String(llm.model || '').trim());
}

export { chat, parseJsonLoose, normalizeBase, llmConfigured };
