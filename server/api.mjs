/* ============================================================
   创世引擎 · 只读 API（阶段 B）
   GET /api/v1/health
   GET /api/v1/snapshot
   GET /api/v1/bodies
   GET /api/v1/bodies/:id
   GET /api/v1/surfaces/:id
   同时托管静态资源（兼容原 qa/serve.mjs）。
   ============================================================ */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { loadGeData, root } from './load-ge-data.mjs';

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
let cachedSnapshot = null;
let cachedAt = 0;
const CACHE_MS = 2000;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(payload);
}

function getSnapshot() {
  const now = Date.now();
  if (!cachedSnapshot || now - cachedAt > CACHE_MS) {
    cachedSnapshot = ge.buildSnapshot({
      runId: process.env.GE_RUN_ID || 'local-seed',
      revision: 0,
      generatedAt: new Date().toISOString()
    });
    cachedAt = now;
  }
  return cachedSnapshot;
}

function surfaceById(id) {
  const snap = getSnapshot();
  return snap.bodySurfaces[id] || null;
}

function bodyById(id) {
  const snap = getSnapshot();
  return (snap.spaceBodies || []).find(b => b.id === id) || null;
}

function handleApi(req, res, urlPath) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type'
    });
    res.end();
    return true;
  }

  if (req.method !== 'GET') {
    json(res, 405, { error: 'method_not_allowed', message: 'Phase B API is read-only' });
    return true;
  }

  if (urlPath === '/api/v1/health' || urlPath === '/api/health') {
    json(res, 200, {
      ok: true,
      apiVersion: 'v1',
      schemaVersion: 1,
      phase: 'B',
      writeOps: false,
      runId: process.env.GE_RUN_ID || 'local-seed'
    });
    return true;
  }

  if (urlPath === '/api/v1/snapshot') {
    json(res, 200, getSnapshot());
    return true;
  }

  if (urlPath === '/api/v1/bodies') {
    const snap = getSnapshot();
    json(res, 200, {
      schemaVersion: snap.schemaVersion,
      items: snap.spaceBodies,
      landableBodyIds: snap.landableBodyIds
    });
    return true;
  }

  const bodyMatch = urlPath.match(/^\/api\/v1\/bodies\/([^/]+)$/);
  if (bodyMatch) {
    const id = decodeURIComponent(bodyMatch[1]);
    const body = bodyById(id);
    if (!body) {
      json(res, 404, { error: 'not_found', resource: 'body', id });
      return true;
    }
    json(res, 200, body);
    return true;
  }

  const surfaceMatch = urlPath.match(/^\/api\/v1\/surfaces\/([^/]+)$/);
  if (surfaceMatch) {
    const id = decodeURIComponent(surfaceMatch[1]);
    // 允许 bodyId 或 surfaceId
    let def = surfaceById(id);
    if (!def) {
      const body = bodyById(id);
      if (body && body.surfaceId) def = surfaceById(body.surfaceId);
    }
    if (!def && !id.includes(':')) def = surfaceById(id + ':surface');
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

  if (urlPath.startsWith('/api/')) {
    json(res, 404, { error: 'not_found', path: urlPath, hint: 'Phase B exposes /api/v1/snapshot|bodies|surfaces|health only' });
    return true;
  }

  return false;
}

function serveStatic(urlPath, res) {
  let rel = urlPath;
  if (rel === '/') rel = '/index.html';
  // URL 路径始终按站点根解析；阻止 ..、反斜杠和同前缀兄弟目录越界。
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

  try {
    if (handleApi(req, res, urlPath)) return;
    serveStatic(urlPath, res);
  } catch (err) {
    console.error('[api]', err);
    if (!res.headersSent) {
      json(res, 500, { error: 'internal', message: String(err && err.message || err) });
    }
  }
});

server.listen(port, () => {
  console.log(`[创世引擎] 只读 API + 静态 http://localhost:${port}`);
  console.log(`[创世引擎] snapshot  → GET /api/v1/snapshot`);
});
