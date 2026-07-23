/* ============================================================
   创世引擎 · API（阶段 C）
   只读：GET health / snapshot / bodies / surfaces
   写入：POST /api/v1/runs · POST /api/v1/runs/:id/deduce
   同时托管静态资源。
   ============================================================ */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { loadGeData, root } from './load-ge-data.mjs';
import * as runStore from './run-store.mjs';
import { deduce } from './deduce-engine.mjs';
import { ensureSurfaceOnRun } from './surface-ensure.mjs';

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
  'POST /api/v1/runs/:id/bodies/:bodyId/surface/ensure'
]);

async function handleApi(req, res, urlPath) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type'
    });
    res.end();
    return true;
  }

  // ---------- health ----------
  if ((urlPath === '/api/v1/health' || urlPath === '/api/health') && req.method === 'GET') {
    const run = runStore.ensureDefault();
    json(res, 200, {
      ok: true,
      apiVersion: 'v1',
      schemaVersion: 1,
      phase: 'C',
      writeOps: true,
      c6: true,
      writeAllow: [
        'POST /api/v1/runs',
        'POST /api/v1/runs/:id/deduce',
        'POST /api/v1/bodies/:id/surface/ensure'
      ],
      agentModes: ['rules_only', 'hybrid', 'full'],
      agentMode: run.agentMode || 'rules_only',
      runId: run.id,
      revision: run.revision,
      year: run.year
    });
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
      // C6：前端可传 agentMode + llm（baseUrl/apiKey/model）；密钥不落盘
      const llm = body.llm && typeof body.llm === 'object'
        ? {
            baseUrl: String(body.llm.baseUrl || '').slice(0, 400),
            apiKey: String(body.llm.apiKey || '').slice(0, 400),
            model: String(body.llm.model || '').slice(0, 120),
            temperature: body.llm.temperature != null ? Number(body.llm.temperature) : undefined,
            timeoutMs: body.llm.timeoutMs != null ? Number(body.llm.timeoutMs) : undefined
          }
        : null;
      const result = await deduce(run, {
        force: !!body.force,
        edict: body.edict || null,
        agentMode: body.agentMode || null,
        llm
      });
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
        message: 'Phase C write whitelist: POST /api/v1/runs, POST …/deduce, POST …/surface/ensure',
        path: urlPath
      });
      return true;
    }
    json(res, 404, {
      error: 'not_found',
      path: urlPath,
      hint: 'Phase C: /api/v1/health|snapshot|bodies|surfaces|runs|runs/:id/deduce'
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
  console.log(`[创世引擎] 阶段 C API + 静态 http://localhost:${port}`);
  console.log(`[创世引擎] snapshot  → GET  /api/v1/snapshot`);
  console.log(`[创世引擎] deduce    → POST /api/v1/runs/${runStore.DEFAULT_RUN_ID}/deduce`);
});

export { server, runStore };
