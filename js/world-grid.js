/* ============================================================
   创世引擎 · world-grid.js — 确定性球面战略网格
   以细分二十面体的对偶网格生成全星球共享边地块。
   ============================================================ */
window.GE = window.GE || {};

GE.worldGrid = (function () {
  'use strict';

  const cfg = () => GE.data.strategicMap.topology;
  let built = false;
  let tiles = [];
  let byId = new Map();

  function normalize(v) {
    const d = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / d, v[1] / d, v[2] / d];
  }

  function midpoint(a, b) { return normalize([a[0] + b[0], a[1] + b[1], a[2] + b[2]]); }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  function build() {
    if (built) return api;
    const t = (1 + Math.sqrt(5)) / 2;
    const verts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
    ].map(normalize);
    let faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ];

    const level = Math.round(Math.log2(cfg().frequency));
    for (let pass = 0; pass < level; pass++) {
      const cache = new Map();
      const mid = (a, b) => {
        const key = a < b ? a + ':' + b : b + ':' + a;
        let id = cache.get(key);
        if (id == null) { id = verts.length; verts.push(midpoint(verts[a], verts[b])); cache.set(key, id); }
        return id;
      };
      const next = [];
      faces.forEach(([a, b, c]) => {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      });
      faces = next;
    }

    const adjacentFaces = Array.from({ length: verts.length }, () => []);
    const neighborSets = Array.from({ length: verts.length }, () => new Set());
    const faceCenters = faces.map((f, fi) => {
      const c = normalize([
        verts[f[0]][0] + verts[f[1]][0] + verts[f[2]][0],
        verts[f[0]][1] + verts[f[1]][1] + verts[f[2]][1],
        verts[f[0]][2] + verts[f[1]][2] + verts[f[2]][2]
      ]);
      f.forEach(v => adjacentFaces[v].push(fi));
      neighborSets[f[0]].add(f[1]).add(f[2]);
      neighborSets[f[1]].add(f[0]).add(f[2]);
      neighborSets[f[2]].add(f[0]).add(f[1]);
      return c;
    });

    tiles = verts.map((center, index) => {
      const up = Math.abs(center[1]) > 0.94 ? [1, 0, 0] : [0, 1, 0];
      const tangent = normalize(cross(up, center));
      const bitangent = normalize(cross(center, tangent));
      const polygon = adjacentFaces[index]
        .map(fi => faceCenters[fi])
        .sort((a, b) => {
          const da = sub(a, center), db = sub(b, center);
          return Math.atan2(dot(da, bitangent), dot(da, tangent)) - Math.atan2(dot(db, bitangent), dot(db, tangent));
        });
      const lat = Math.asin(center[1]) * 180 / Math.PI;
      const lon = Math.atan2(center[2], center[0]) * 180 / Math.PI;
      return {
        id: `g${cfg().frequency}-v${String(index).padStart(5, '0')}`,
        index, center, polygon, lat, lon,
        kind: polygon.length === 5 ? 'pentagon' : 'hex',
        neighborIndices: [...neighborSets[index]].sort((a, b) => a - b),
        neighbors: null
      };
    });
    tiles.forEach(tile => { tile.neighbors = tile.neighborIndices.map(i => tiles[i].id); byId.set(tile.id, tile); });
    built = true;
    return api;
  }

  function nearestToVector(v) {
    build();
    let best = tiles[0], score = -Infinity;
    for (let i = 0; i < tiles.length; i++) {
      const s = dot(v, tiles[i].center);
      if (s > score) { score = s; best = tiles[i]; }
    }
    return best;
  }

  function nearestLatLon(lat, lon) {
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    return nearestToVector([Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)]);
  }

  function validate() {
    build();
    let pentagons = 0, bad = 0;
    tiles.forEach(t => {
      if (t.kind === 'pentagon') pentagons++;
      if (t.neighbors.length !== 5 && t.neighbors.length !== 6) bad++;
      t.neighbors.forEach(n => { if (!byId.get(n)?.neighbors.includes(t.id)) bad++; });
    });
    return { tiles: tiles.length, pentagons, bad };
  }

  const api = {
    build,
    get tiles() { build(); return tiles; },
    get byId() { build(); return byId; },
    get config() { return cfg(); },
    getTile: id => { build(); return byId.get(id) || null; },
    nearestToVector,
    nearestLatLon,
    validate
  };
  return api;
})();
