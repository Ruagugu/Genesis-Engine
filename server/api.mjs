/* ============================================================
   创世引擎 · API（阶段 D）
   只读：GET health / snapshot / bodies / surfaces / me / oracle
   写入：runs / deduce / seats / oracle / clock
   同时托管静态资源。
   ============================================================ */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { loadGeData, root } from './load-ge-data.mjs';
import * as runStore from './run-store.mjs';
import { deduce } from './deduce-engine.mjs';
import { ensureSurfaceOnRun } from './surface-ensure.mjs';
import * as llmSettings from './llm-settings.mjs';
import * as llmLog from './llm-log.mjs';
import * as seatService from './seat-service.mjs';
import * as clockService from './clock-service.mjs';
import * as oracleService from './oracle-service.mjs';
import * as sseHub from './sse-hub.mjs';
import * as authService from './auth-service.mjs';
import * as genesisService from './genesis-service.mjs';

const port = process.env.PORT ? Number(process.env.PORT) : 8123;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

const ge = loadGeData();
runStore.ensureDefault();

// 同一 Run 的 deduce 必须串行：LLM 回合可能持续数十秒，若并发会重复读取
// roundN / designQueue 并各自写回，造成重复 seed 与相同回合号。
const deduceLocks = new Map();
async function withDeduceLock(runId, work) {
  const prior = deduceLocks.get(runId) || Promise.resolve();
  let release;
  const mine = new Promise(resolve => { release = resolve; });
  deduceLocks.set(runId, mine);
  await prior.catch(() => {});
  try {
    return await work();
  } finally {
    release();
    if (deduceLocks.get(runId) === mine) deduceLocks.delete(runId);
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function getSnapshot(runId) {
  const run = runStore.get(runId || runStore.DEFAULT_RUN_ID);
  if (!run) return null;
  return runStore.toSnapshot(run, (data, opts) => ge.GE.snapshot.buildFromData(data, opts));
}

function surfaceById(runId, id) {
  const snap = getSnapshot(runId);
  if (!snap) return null;
  return snap.bodySurfaces[id] || null;
}

function bodyById(runId, id) {
  const snap = getSnapshot(runId);
  if (!snap) return null;
  return (snap.spaceBodies || []).find(b => b.id === id) || null;
}

const WRITE_ALLOWED = new Set([
  'POST /api/v1/runs',
  'POST /api/v1/runs/:id/deduce',
  'POST /api/v1/runs/:id/reset',
  'POST /api/v1/bodies/:id/surface/ensure',
  'POST /api/v1/runs/:id/bodies/:bodyId/surface/ensure',
  'PUT /api/v1/llm-settings',
  'POST /api/v1/llm-settings',
  'DELETE /api/v1/llm-settings',
  'DELETE /api/v1/llm-logs',
  'POST /api/v1/runs/:id/seats/claim',
  'POST /api/v1/runs/:id/seats/spectate',
  'POST /api/v1/runs/:id/oracle',
  'POST /api/v1/runs/:id/oracle/:eid/cancel',
  'POST /api/v1/runs/:id/clock/pause',
  'POST /api/v1/runs/:id/clock/advance'
]);

function playerTokenFrom(req, body) {
  const h = req.headers || {};
  const fromHeader = h['x-player-token'] || h['X-Player-Token'];
  if (fromHeader) return String(fromHeader).trim();
  if (body && body.playerToken) return String(body.playerToken).trim();
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.searchParams.get('playerToken')) return u.searchParams.get('playerToken');
  } catch (_) { /* ignore */ }
  return null;
}

function touchRun(run) {
  try { runStore.touch(run); } catch (_) { /* ignore */ }
}

function ensureRunTicked(run) {
  if (!run) return null;
  runStore.ensurePhaseDFields(run);
  const tick = clockService.tick(run);
  if (tick && (tick.yearDelta > 0 || (tick.granted && tick.granted.length))) {
    touchRun(run);
    if (tick.yearDelta > 0) {
      sseHub.publish(run.id, 'year.tick', { year: tick.year, yearDelta: tick.yearDelta });
    }
    (tick.granted || []).forEach(g => sseHub.publish(run.id, 'oracle.points', g));
  }
  return tick;
}

/**
 * 现实 WorldClock 驱动：轻量 tick 不触发 LLM；满 5 年或有已支付神谕时
 * 进入现有 deduce，并复用 per-run lock 防止与手动请求并发。
 */
async function pollWorldClocks() {
  const runs = runStore.activeRuns();
  for (const run of runs) {
    try {
      const tick = ensureRunTicked(run);
      if (!tick || !tick.needHeavyRound) continue;
      // 结算自上次重推演以来的全部时钟年，最多 N=5；不能只结算本次 tick。
      const delta = Math.max(
        1,
        Math.min(5, Number(run.clock?.yearsSinceRound) || Number(tick.yearDelta) || 1)
      );
      sseHub.publish(run.id, 'round.progress', { phase: 'start', year: run.year, clockDriven: true });
      const result = await withDeduceLock(run.id, () => deduce(run, {
        agentMode: 'rules_only',
        clockDriven: true,
        clockAlreadyAdvanced: true,
        clockYearDelta: delta
      }));
      clockService.markHeavyRoundDone(run);
      clockService.syncClockToRunYear(run);
      touchRun(run);
      sseHub.publish(run.id, 'round.done', {
        round: result.round?.n,
        year: result.year,
        revision: result.revision,
        clockDriven: true,
        oracle: result.patchesSummary?.oracle || []
      });
      (result.patchesSummary?.oracle || []).forEach(o => sseHub.publish(run.id, 'oracle.applied', o));
    } catch (err) {
      console.error('[clock]', run && run.id, err);
      sseHub.publish(run.id, 'round.progress', { phase: 'error', error: String(err && err.message || err).slice(0, 160) });
    }
  }
}

async function handleApi(req, res, urlPath) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type, X-Player-Token'
    });
    res.end();
    return true;
  }

  // ---------- health ----------
  if ((urlPath === '/api/v1/health' || urlPath === '/api/health') && req.method === 'GET') {
    const run = runStore.ensureDefault();
    ensureRunTicked(run);
    const llm = llmSettings.getPublic({ maskKey: true });
    json(res, 200, {
      ok: true,
      apiVersion: 'v1',
      schemaVersion: 1,
      phase: 'E',
      writeOps: true,
      c6: true,
      dOracle: true,
      eGenesis: true,
      writeAllow: [
        'POST /api/v1/runs',
        'POST /api/v1/runs/:id/deduce',
        'POST /api/v1/runs/:id/reset',
        'POST /api/v1/bodies/:id/surface/ensure',
        'POST /api/v1/runs/:id/bodies/:bodyId/surface/ensure',
        'PUT /api/v1/llm-settings',
        'POST /api/v1/llm-settings',
        'DELETE /api/v1/llm-settings',
        'DELETE /api/v1/llm-logs',
        'POST /api/v1/auth/register',
        'POST /api/v1/auth/login',
        'DELETE /api/v1/auth/users',
        'POST /api/v1/runs/:id/civs',
        'POST /api/v1/runs/:id/civs/:civId/settle',
        'POST /api/v1/runs/:id/seats/claim',
        'POST /api/v1/runs/:id/seats/spectate',
        'POST /api/v1/runs/:id/oracle',
        'POST /api/v1/runs/:id/oracle/:eid/cancel',
        'POST /api/v1/runs/:id/clock/pause',
        'POST /api/v1/runs/:id/clock/advance'
      ],
      agentModes: ['rules_only', 'hybrid', 'full'],
      agentMode: llm.agentMode || run.agentMode || 'rules_only',
      llm: {
        enabled: !!llm.enabled,
        agentMode: llm.agentMode,
        model: llm.model || '',
        apiKeySet: !!llm.apiKeySet,
        baseUrlSet: !!llm.baseUrl
      },
      llmLog: llmLog.list({ limit: 1 }).totals,
      runId: run.id,
      revision: run.revision,
      year: run.year,
      clock: clockService.clockPublic(run),
      seats: (run.seats || []).length
    });
    return true;
  }

  // ---------- LLM settings（仅前端表单写入；无服务端手填） ----------
  if (urlPath === '/api/v1/llm-settings' && req.method === 'GET') {
    // 本地单机：完整回填表单（含 key）。勿暴露到公网未鉴权部署。
    json(res, 200, llmSettings.getPublic({ maskKey: false }));
    return true;
  }

  if (urlPath === '/api/v1/llm-settings' && (req.method === 'PUT' || req.method === 'POST')) {
    let body = {};
    try {
      body = await readBody(req);
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
      return true;
    }
    const saved = llmSettings.set({
      enabled: body.enabled,
      agentMode: body.agentMode,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      model: body.model,
      models: body.models,
      temperature: body.temperature,
      timeoutMs: body.timeoutMs
    });
    // 同步默认 run 的 agentMode 标签（推演仍以 forDeduce 为准）
    try {
      const run = runStore.ensureDefault();
      run.agentMode = saved.agentMode || 'rules_only';
    } catch (_) { /* ignore */ }
    json(res, 200, {
      ok: true,
      saved: true,
      enabled: saved.enabled,
      agentMode: saved.agentMode,
      baseUrl: saved.baseUrl,
      model: saved.model,
      apiKeySet: !!saved.apiKey,
      temperature: saved.temperature,
      timeoutMs: saved.timeoutMs,
      updatedAt: saved.updatedAt,
      // 回填用：前端保存后与本地缓存对齐
      apiKey: saved.apiKey,
      models: saved.models
    });
    return true;
  }

  if (urlPath === '/api/v1/llm-settings' && req.method === 'DELETE') {
    const saved = llmSettings.reset();
    json(res, 200, { ok: true, cleared: true, settings: llmSettings.getPublic({ maskKey: true }) });
    return true;
  }

  // ---------- LLM 调用日志（推演 AI 次数与返回内容） ----------
  if (urlPath === '/api/v1/llm-logs' && req.method === 'GET') {
    let q = {};
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      q = Object.fromEntries(u.searchParams.entries());
    } catch (_) { /* ignore */ }
    const data = llmLog.list({
      runId: q.runId || q.run || null,
      round: q.round != null && q.round !== '' ? Number(q.round) : null,
      purpose: q.purpose || null,
      limit: q.limit != null ? Number(q.limit) : 50
    });
    json(res, 200, data);
    return true;
  }

  if (urlPath === '/api/v1/llm-logs' && req.method === 'DELETE') {
    json(res, 200, llmLog.clear());
    return true;
  }

  // ---------- snapshot (run-aware) ----------
  if (urlPath === '/api/v1/snapshot' && req.method === 'GET') {
    json(res, 200, getSnapshot(runStore.DEFAULT_RUN_ID));
    return true;
  }

  // ---------- bodies ----------
  if (urlPath === '/api/v1/bodies' && req.method === 'GET') {
    const snap = getSnapshot(runStore.DEFAULT_RUN_ID);
    json(res, 200, {
      schemaVersion: snap.schemaVersion,
      revision: snap.revision,
      items: snap.spaceBodies,
      landableBodyIds: snap.landableBodyIds,
      discovered: snap.discovered
    });
    return true;
  }

  const bodyMatch = urlPath.match(/^\/api\/v1\/bodies\/([^/]+)$/);
  if (bodyMatch && req.method === 'GET') {
    const id = decodeURIComponent(bodyMatch[1]);
    const body = bodyById(runStore.DEFAULT_RUN_ID, id);
    if (!body) {
      json(res, 404, { error: 'not_found', resource: 'body', id });
      return true;
    }
    json(res, 200, body);
    return true;
  }

  // ---------- surfaces ----------
  const surfaceMatch = urlPath.match(/^\/api\/v1\/surfaces\/([^/]+)$/);
  if (surfaceMatch && req.method === 'GET') {
    const id = decodeURIComponent(surfaceMatch[1]);
    let def = surfaceById(runStore.DEFAULT_RUN_ID, id);
    if (!def) {
      const body = bodyById(runStore.DEFAULT_RUN_ID, id);
      if (body && body.surfaceId) def = surfaceById(runStore.DEFAULT_RUN_ID, body.surfaceId);
    }
    if (!def && !id.includes(':')) def = surfaceById(runStore.DEFAULT_RUN_ID, id + ':surface');
    if (!def) {
      json(res, 404, { error: 'not_found', resource: 'surface', id });
      return true;
    }
    json(res, 200, {
      ...def,
      notes: { tiles: 'not-included', use: 'client deterministic rebuild' }
    });
    return true;
  }

  // ---------- runs list / create ----------
  // ---------- Phase E: auth ----------
  if (urlPath === '/api/v1/auth/register' && req.method === 'POST') {
    let body = {};
    try { body = await readBody(req); } catch (e) { json(res, 400, { error: String(e.message || e) }); return true; }
    const result = authService.register(body);
    json(res, result.status || (result.ok ? 201 : 400), result);
    return true;
  }

  if (urlPath === '/api/v1/auth/login' && req.method === 'POST') {
    let body = {};
    try { body = await readBody(req); } catch (e) { json(res, 400, { error: String(e.message || e) }); return true; }
    const result = authService.login(body);
    json(res, result.status || (result.ok ? 200 : 401), result);
    return true;
  }

  if (urlPath === '/api/v1/auth/me' && req.method === 'GET') {
    const token = playerTokenFrom(req, null);
    const user = authService.userByToken(token);
    if (!user) { json(res, 404, { ok: false, error: 'not_registered' }); return true; }
    json(res, 200, { ok: true, ...authService.publicUser(user) });
    return true;
  }

  // QA / 调试：清空本地账号存储（与 DELETE /llm-settings 同权限模型：本地单机）
  if (urlPath === '/api/v1/auth/users' && req.method === 'DELETE') {
    json(res, 200, authService.resetStore());
    return true;
  }

  if (urlPath === '/api/v1/runs' && req.method === 'GET') {
    json(res, 200, { items: runStore.list() });
    return true;
  }

  if (urlPath === '/api/v1/runs' && req.method === 'POST') {
    let body = {};
    try {
      body = await readBody(req);
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
      return true;
    }
    const run = runStore.create({
      id: body.id,
      seed: body.seed,
      agentMode: body.agentMode || 'rules_only',
      reset: !!body.reset
    });
    json(res, 201, {
      id: run.id,
      seed: run.seed,
      year: run.year,
      revision: run.revision,
      agentMode: run.agentMode,
      bodyCount: run.discovered.bodies.length,
      galaxyCount: run.discovered.galaxies.length
    });
    return true;
  }

  // ---------- run by id ----------
  const runMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)$/);
  if (runMatch && req.method === 'GET') {
    const id = decodeURIComponent(runMatch[1]);
    const run = runStore.get(id);
    if (!run) {
      json(res, 404, { error: 'not_found', resource: 'run', id });
      return true;
    }
    json(res, 200, {
      id: run.id,
      seed: run.seed,
      year: run.year,
      revision: run.revision,
      era: run.era,
      agentMode: run.agentMode,
      discovered: {
        galaxyCount: run.discovered.galaxies.length,
        systemCount: run.discovered.systems.length,
        bodyCount: run.discovered.bodies.length
      },
      rounds: run.deductionRounds.length,
      updatedAt: run.updatedAt
    });
    return true;
  }

  // ---------- run snapshot ----------
  const runSnapMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/snapshot$/);
  if (runSnapMatch && req.method === 'GET') {
    const id = decodeURIComponent(runSnapMatch[1]);
    const snap = getSnapshot(id);
    if (!snap) {
      json(res, 404, { error: 'not_found', resource: 'run', id });
      return true;
    }
    json(res, 200, snap);
    return true;
  }

  // ---------- run bodies ----------
  const runBodiesMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/bodies$/);
  if (runBodiesMatch && req.method === 'GET') {
    const id = decodeURIComponent(runBodiesMatch[1]);
    const run = runStore.get(id);
    if (!run) {
      json(res, 404, { error: 'not_found', resource: 'run', id });
      return true;
    }
    json(res, 200, {
      revision: run.revision,
      items: run.discovered.bodies,
      galaxies: run.discovered.galaxies,
      systems: run.discovered.systems
    });
    return true;
  }

  // ---------- Phase D: SSE events ----------
  const eventsMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/events$/);
  if (eventsMatch && req.method === 'GET') {
    const id = decodeURIComponent(eventsMatch[1]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    ensureRunTicked(run);
    const token = playerTokenFrom(req, null);
    const seat = token ? seatService.findSeatByToken(run, token) : null;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    const clientId = sseHub.addClient(run.id, res, { playerId: seat?.playerId || null });
    res.write(`event: ready\ndata: ${JSON.stringify({ runId: run.id, year: run.year, clock: clockService.clockPublic(run), seat: seatService.publicSeat(seat) })}\n\n`);
    const timer = setInterval(() => sseHub.heartbeat(run.id), 25000);
    req.on('close', () => {
      clearInterval(timer);
      sseHub.removeClient(run.id, clientId);
    });
    return true;
  }

  // ---------- Phase D: seats / me / oracle / clock ----------
  const seatClaimMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/seats\/claim$/);
  if (seatClaimMatch && req.method === 'POST') {
    const id = decodeURIComponent(seatClaimMatch[1]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    let body = {};
    try { body = await readBody(req); } catch (e) { json(res, 400, { error: String(e.message || e) }); return true; }
    ensureRunTicked(run);
    const token = playerTokenFrom(req, body) || body.playerToken;
    const result = seatService.claimSeat(run, { ...body, playerToken: token });
    if (!result.ok) { json(res, result.status || 400, result); return true; }
    touchRun(run);
    sseHub.publish(run.id, 'seat.claimed', { seat: result.seat });
    json(res, result.created ? 201 : 200, result);
    return true;
  }

  // ---------- Phase E: 创建文明 / 落地 ----------
  const civCreateMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/civs$/);
  if (civCreateMatch && req.method === 'POST') {
    const id = decodeURIComponent(civCreateMatch[1]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    let body = {};
    try { body = await readBody(req); } catch (e) { json(res, 400, { error: String(e.message || e) }); return true; }
    ensureRunTicked(run);
    const token = playerTokenFrom(req, body);
    const user = authService.userByToken(token);
    if (!user) {
      json(res, 401, { error: 'not_registered', message: '创建文明需要注册账号并登录' });
      return true;
    }
    const result = genesisService.createCiv(run, user, body);
    if (!result.ok) { json(res, result.status || 400, result); return true; }
    touchRun(run);
    sseHub.publish(run.id, 'civ.created', {
      civId: result.civ.id, name: result.civ.name, by: user.username,
      civ: result.civ, seat: result.seat
    });
    sseHub.publish(run.id, 'seat.claimed', { seat: result.seat });
    // LLM 补全异步跟进：成功则 revision++ 并广播，前端可拉快照刷新文案
    genesisService.enrichCivWithLlm(run, result.civ)
      .then(r => {
        if (r && r.ok && r.applied) {
          touchRun(run);
          sseHub.publish(run.id, 'civ.enriched', {
            civId: result.civ.id, applied: r.applied,
            fields: r.fields || {}, leaderFields: r.leaderFields || {}
          });
        }
      })
      .catch(err => console.warn('[genesis] enrich failed', err && err.message));
    json(res, 201, result);
    return true;
  }

  const civSettleMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/civs\/([^/]+)\/settle$/);
  if (civSettleMatch && req.method === 'POST') {
    const id = decodeURIComponent(civSettleMatch[1]);
    const civId = decodeURIComponent(civSettleMatch[2]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    let body = {};
    try { body = await readBody(req); } catch (e) { json(res, 400, { error: String(e.message || e) }); return true; }
    ensureRunTicked(run);
    const token = playerTokenFrom(req, body);
    const user = authService.userByToken(token);
    if (!user) { json(res, 401, { error: 'not_registered' }); return true; }
    const result = genesisService.settleCiv(run, user, civId, body);
    if (!result.ok) { json(res, result.status || 400, result); return true; }
    touchRun(run);
    sseHub.publish(run.id, 'civ.settled', {
      civId, capital: result.capital, tileId: result.tileId, landing: result.landing
    });
    json(res, 200, result);
    return true;
  }

  const seatSpectateMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/seats\/spectate$/);
  if (seatSpectateMatch && req.method === 'POST') {
    const id = decodeURIComponent(seatSpectateMatch[1]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    let body = {};
    try { body = await readBody(req); } catch (e) { json(res, 400, { error: String(e.message || e) }); return true; }
    const token = playerTokenFrom(req, body) || body.playerToken;
    const result = seatService.claimSpectator(run, { ...body, playerToken: token });
    if (!result.ok) { json(res, result.status || 400, result); return true; }
    touchRun(run);
    json(res, 200, result);
    return true;
  }

  const seatsListMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/seats$/);
  if (seatsListMatch && req.method === 'GET') {
    const id = decodeURIComponent(seatsListMatch[1]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    ensureRunTicked(run);
    json(res, 200, { items: seatService.listSeatsPublic(run) });
    return true;
  }

  const meMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/me$/);
  if (meMatch && req.method === 'GET') {
    const id = decodeURIComponent(meMatch[1]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    ensureRunTicked(run);
    const token = playerTokenFrom(req, null);
    const result = seatService.me(run, token);
    if (!result.ok) { json(res, result.status || 404, result); return true; }
    json(res, 200, result);
    return true;
  }

  const oracleGetMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/oracle$/);
  if (oracleGetMatch && req.method === 'GET') {
    const id = decodeURIComponent(oracleGetMatch[1]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    ensureRunTicked(run);
    const token = playerTokenFrom(req, null);
    const result = oracleService.oracleStatus(run, token);
    if (!result.ok) { json(res, result.status || 404, result); return true; }
    json(res, 200, result);
    return true;
  }

  if (oracleGetMatch && req.method === 'POST') {
    const id = decodeURIComponent(oracleGetMatch[1]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    let body = {};
    try { body = await readBody(req); } catch (e) { json(res, 400, { error: String(e.message || e) }); return true; }
    ensureRunTicked(run);
    const token = playerTokenFrom(req, body);
    const result = oracleService.submitOracle(run, token, body);
    if (!result.ok) {
      sseHub.publish(run.id, 'oracle.rejected', { error: result.error, message: result.message, playerId: token || null });
      json(res, result.status || 422, result);
      return true;
    }
    touchRun(run);
    sseHub.publish(run.id, 'oracle.queued', { edictId: result.edictId, cost: result.cost, pointsLeft: result.pointsLeft });
    sseHub.publish(run.id, 'oracle.points', { playerId: token || null, points: result.pointsLeft, delta: -result.cost });
    json(res, 200, result);
    return true;
  }

  const oracleCancelMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/oracle\/([^/]+)\/cancel$/);
  if (oracleCancelMatch && req.method === 'POST') {
    const id = decodeURIComponent(oracleCancelMatch[1]);
    const eid = decodeURIComponent(oracleCancelMatch[2]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    let body = {};
    try { body = await readBody(req); } catch (e) { json(res, 400, { error: String(e.message || e) }); return true; }
    const token = playerTokenFrom(req, body);
    const result = oracleService.cancelOracle(run, token, eid);
    if (!result.ok) { json(res, result.status || 400, result); return true; }
    touchRun(run);
    sseHub.publish(run.id, 'oracle.cancelled', { edictId: eid, points: result.points });
    sseHub.publish(run.id, 'oracle.points', { playerId: token || null, points: result.points });
    json(res, 200, result);
    return true;
  }

  const oracleLedgerMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/oracle\/ledger$/);
  if (oracleLedgerMatch && req.method === 'GET') {
    const id = decodeURIComponent(oracleLedgerMatch[1]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    const token = playerTokenFrom(req, null);
    json(res, 200, oracleService.ledger(run, token));
    return true;
  }

  const clockPauseMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/clock\/pause$/);
  if (clockPauseMatch && req.method === 'POST') {
    const id = decodeURIComponent(clockPauseMatch[1]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    let body = {};
    try { body = await readBody(req); } catch (e) { json(res, 400, { error: String(e.message || e) }); return true; }
    ensureRunTicked(run);
    const token = playerTokenFrom(req, body);
    const seat = seatService.findSeatByToken(run, token);
    if (!seat || seat.role !== 'owner') {
      json(res, 403, { error: 'owner_only', needOwner: true, message: '只有 owner 席位可以控制 WorldClock' });
      return true;
    }
    // body.paused 显式 false 解暂停；缺省 true
    const wantPaused = body.paused == null ? true : !!body.paused;
    const r2 = clockService.setPaused(run, wantPaused, seat);
    if (!r2.ok) { json(res, r2.status || 403, Object.assign({ needOwner: true }, r2)); return true; }
    touchRun(run);
    const clock = clockService.clockPublic(run);
    const seatPublic = seatService.publicSeat(seat);
    sseHub.publish(run.id, 'clock.pause', { paused: r2.paused, year: run.year, clock, seat: seatPublic });
    json(res, 200, { ok: true, ...r2, clock, seat: seatPublic });
    return true;
  }

  const clockAdvanceMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/clock\/advance$/);
  if (clockAdvanceMatch && req.method === 'POST') {
    const id = decodeURIComponent(clockAdvanceMatch[1]);
    const run = runStore.get(id);
    if (!run) { json(res, 404, { error: 'not_found', resource: 'run', id }); return true; }
    let body = {};
    try { body = await readBody(req); } catch (e) { json(res, 400, { error: String(e.message || e) }); return true; }
    const token = playerTokenFrom(req, body);
    const seat = seatService.findSeatByToken(run, token);
    if (!seat || seat.role !== 'owner') { json(res, 403, { error: 'owner_only' }); return true; }
    const result = clockService.advanceYears(run, body.years || 1, body);
    touchRun(run);
    sseHub.publish(run.id, 'year.tick', { year: result.year, yearDelta: result.yearDelta, debug: true });
    (result.granted || []).forEach(g => sseHub.publish(run.id, 'oracle.points', g));
    json(res, 200, { ...result, clock: clockService.clockPublic(run) });
    return true;
  }

  // ---------- deduce ----------
  const deduceMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/deduce$/);
  if (deduceMatch && req.method === 'POST') {
    const id = decodeURIComponent(deduceMatch[1]);
    let run = runStore.get(id);
    if (!run) {
      // 便利：未知 id 时若是 default 名则创建
      if (id === runStore.DEFAULT_RUN_ID) run = runStore.ensureDefault();
      else {
        json(res, 404, { error: 'not_found', resource: 'run', id });
        return true;
      }
    }
    let body = {};
    try {
      body = await readBody(req);
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
      return true;
    }
    try {
      ensureRunTicked(run);
      // C6：优先用前端已保存到后端的 LLM 设置；请求体可临时覆盖
      const overrideLlm = body.llm && typeof body.llm === 'object'
        ? {
            baseUrl: String(body.llm.baseUrl || '').slice(0, 400),
            apiKey: String(body.llm.apiKey || '').slice(0, 800),
            model: String(body.llm.model || '').slice(0, 160),
            temperature: body.llm.temperature != null ? Number(body.llm.temperature) : undefined,
            timeoutMs: body.llm.timeoutMs != null ? Number(body.llm.timeoutMs) : undefined
          }
        : null;
      const resolved = llmSettings.forDeduce({
        agentMode: body.agentMode || null,
        llm: overrideLlm
      });
      // 正式神谕走 /oracle → Drain；body.edict 仅作编年风味/兼容旧 QA
      const result = await withDeduceLock(id, () => deduce(run, {
        force: !!body.force,
        edict: body.edict || null,
        agentMode: resolved.agentMode,
        llm: resolved.llm
      }));
      if (result && result.agentMeta) {
        result.agentMeta.configSource = resolved.source;
      }
      clockService.markHeavyRoundDone(run);
      clockService.syncClockToRunYear(run);
      touchRun(run);
      sseHub.publish(run.id, 'round.done', {
        round: result.round?.n,
        year: result.year,
        revision: result.revision,
        oracle: result.patchesSummary?.oracle || []
      });
      (result.patchesSummary?.oracle || []).forEach(o => sseHub.publish(run.id, 'oracle.applied', o));
      json(res, 200, result);
    } catch (err) {
      console.error('[deduce]', err);
      json(res, 500, { error: 'deduce_failed', message: String(err && err.message || err) });
    }
    return true;
  }

  // ---------- reset (debug) ----------
  const resetMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/reset$/);
  if (resetMatch && req.method === 'POST') {
    const id = decodeURIComponent(resetMatch[1]);
    const run = runStore.reset(id);
    json(res, 200, {
      id: run.id,
      revision: run.revision,
      year: run.year,
      bodyCount: run.discovered.bodies.length
    });
    return true;
  }

  // ---------- surface ensure (default run) ----------
  const ensureMatch = urlPath.match(/^\/api\/v1\/bodies\/([^/]+)\/surface\/ensure$/);
  if (ensureMatch && req.method === 'POST') {
    const bodyId = decodeURIComponent(ensureMatch[1]);
    const run = runStore.ensureDefault();
    const result = ensureSurfaceOnRun(run, bodyId);
    if (!result.ok) {
      json(res, result.status || 400, result);
      return true;
    }
    json(res, result.created ? 201 : 200, result);
    return true;
  }

  // ---------- surface ensure (named run) ----------
  const ensureRunMatch = urlPath.match(/^\/api\/v1\/runs\/([^/]+)\/bodies\/([^/]+)\/surface\/ensure$/);
  if (ensureRunMatch && req.method === 'POST') {
    const runId = decodeURIComponent(ensureRunMatch[1]);
    const bodyId = decodeURIComponent(ensureRunMatch[2]);
    let run = runStore.get(runId);
    if (!run) {
      json(res, 404, { error: 'not_found', resource: 'run', id: runId });
      return true;
    }
    const result = ensureSurfaceOnRun(run, bodyId);
    if (!result.ok) {
      json(res, result.status || 400, result);
      return true;
    }
    json(res, result.created ? 201 : 200, result);
    return true;
  }

  // ---------- method guard for other /api ----------
  if (urlPath.startsWith('/api/')) {
    if (req.method !== 'GET') {
      json(res, 405, {
        error: 'method_not_allowed',
        message: 'Phase C write whitelist: POST runs/deduce/ensure, PUT/POST /api/v1/llm-settings',
        path: urlPath
      });
      return true;
    }
    json(res, 404, {
      error: 'not_found',
      path: urlPath,
      hint: 'Phase C: /api/v1/health|snapshot|bodies|surfaces|runs|llm-settings|…/deduce'
    });
    return true;
  }

  return false;
}

function serveStatic(urlPath, res) {
  let rel = urlPath;
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(root, '.' + rel.replace(/\\/g, '/'));
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let urlPath = '/';
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (_) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  Promise.resolve()
    .then(() => handleApi(req, res, urlPath))
    .then((handled) => {
      if (!handled) serveStatic(urlPath, res);
    })
    .catch((err) => {
      console.error('[api]', err);
      if (!res.headersSent) {
        json(res, 500, { error: 'internal', message: String(err && err.message || err) });
      }
    });
});

server.listen(port, () => {
  console.log(`[创世引擎] 阶段 D API + 静态 http://localhost:${port}`);
  console.log(`[创世引擎] snapshot  → GET  /api/v1/snapshot`);
  console.log(`[创世引擎] deduce    → POST /api/v1/runs/${runStore.DEFAULT_RUN_ID}/deduce`);
  console.log(`[创世引擎] oracle    → POST /api/v1/runs/:id/oracle`);
  console.log(`[创世引擎] llm 设置 → GET/PUT /api/v1/llm-settings（仅前端表单写入）`);
});

// 低频检查；即使无人访问，也让解除暂停的 Run 随真实世界年推进。
const clockTimer = setInterval(() => {
  pollWorldClocks().catch(err => console.error('[clock-poll]', err));
}, 30_000);
if (typeof clockTimer.unref === 'function') clockTimer.unref();

export { server, runStore };
