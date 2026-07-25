/* ============================================================
   创世引擎 · SSE 事件总线（阶段 D）
   单进程 MVP：按 Run 维护 EventSource 连接，断线由前端重连并拉快照。
   ============================================================ */

const clientsByRun = new Map();

function formatSse(type, data) {
  return `event: ${String(type || 'message')}\ndata: ${JSON.stringify(data == null ? {} : data)}\n\n`;
}

function addClient(runId, res, meta) {
  const id = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  const clients = clientsByRun.get(runId) || new Map();
  clients.set(id, { res, meta: meta || {}, connectedAt: Date.now() });
  clientsByRun.set(runId, clients);
  return id;
}

function removeClient(runId, id) {
  const clients = clientsByRun.get(runId);
  if (!clients) return;
  clients.delete(id);
  if (!clients.size) clientsByRun.delete(runId);
}

function publish(runId, type, data) {
  const clients = clientsByRun.get(runId);
  if (!clients || !clients.size) return 0;
  const wire = formatSse(type, data);
  let sent = 0;
  clients.forEach((client, id) => {
    try {
      client.res.write(wire);
      sent++;
    } catch (_) {
      removeClient(runId, id);
    }
  });
  return sent;
}

function heartbeat(runId) {
  const clients = clientsByRun.get(runId);
  if (!clients || !clients.size) return 0;
  let sent = 0;
  clients.forEach((client, id) => {
    try {
      client.res.write(`: ping ${Date.now()}\n\n`);
      sent++;
    } catch (_) {
      removeClient(runId, id);
    }
  });
  return sent;
}

function count(runId) {
  return (clientsByRun.get(runId) || new Map()).size;
}

export { addClient, removeClient, publish, heartbeat, count };
