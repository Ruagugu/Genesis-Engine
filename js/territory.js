/* ============================================================
   创世引擎 · territory.js — 地块扩张 / 吞并 / 分裂执行器
   客户端唯一写 tiles；服务端只下发 territory 意图。
   ============================================================ */
window.GE = window.GE || {};
GE.territory = (function () {
  'use strict';

  const CAPS = {
    maxExpandPerCiv: 6,
    maxAnnexPerPair: 8,
    maxSplitPerRound: 1,
    maxEventsPerRound: 12
  };

  let lastReport = null;

  function activeState() {
    if (GE.worldState && GE.worldState.active) return GE.worldState.active;
    if (GE.worldState && typeof GE.worldState.build === 'function') {
      try { GE.worldState.build(); } catch (_) { /* ignore */ }
    }
    return GE.worldState && GE.worldState.active;
  }

  function yearNow() {
    return Number(GE.data && GE.data.world && GE.data.world.年数) || 1;
  }

  function isWater(terrain) {
    return terrain === 'ocean' || terrain === 'coast';
  }

  function terrainAllowed(civId, terrain) {
    if (civId === 'abyss') return isWater(terrain);
    return !isWater(terrain);
  }

  function tileScore(tile) {
    let score = 0;
    (tile.resources || []).forEach(r => { score += Number(r.richness) || 1; });
    score += (tile.neighbors || []).filter(id => {
      const n = GE.worldState.getTile(id);
      return n && !n.ownerCivId;
    }).length * 0.35;
    return score;
  }

  function ownershipSummary(state) {
    const st = state || activeState();
    if (!st) return { owned: 0, byCiv: {}, total: 0 };
    const tiles = st.tiles || [];
    const byCiv = {};
    let owned = 0;
    tiles.forEach(t => {
      if (!t.ownerCivId) return;
      owned += 1;
      byCiv[t.ownerCivId] = (byCiv[t.ownerCivId] || 0) + 1;
    });
    return { owned, byCiv, total: tiles.length };
  }

  function frontierTiles(civId) {
    const tiles = GE.worldState.getTilesByCiv(civId);
    const seen = new Set();
    const out = [];
    tiles.forEach(t => {
      (t.neighbors || []).forEach(nid => {
        if (seen.has(nid)) return;
        const n = GE.worldState.getTile(nid);
        if (!n || n.ownerCivId) return;
        if (!terrainAllowed(civId, n.terrain)) return;
        seen.add(nid);
        out.push(n);
      });
    });
    return out.sort((a, b) => tileScore(b) - tileScore(a));
  }

  function borderTiles(attackerId, defenderId) {
    const tiles = GE.worldState.getTilesByCiv(defenderId);
    const out = [];
    tiles.forEach(t => {
      const touches = (t.neighbors || []).some(nid => {
        const n = GE.worldState.getTile(nid);
        return n && n.ownerCivId === attackerId;
      });
      if (touches && terrainAllowed(attackerId, t.terrain)) out.push(t);
    });
    return out.sort((a, b) => tileScore(b) - tileScore(a));
  }

  function reassignTiles(tileIds, ownerCivId, meta) {
    meta = meta || {};
    const report = { changed: 0, tiles: [], skipped: 0 };
    (tileIds || []).forEach(id => {
      const r = GE.worldState.setTileOwner(id, ownerCivId, {
        claimSource: meta.claimSource || 'expand',
        claimTurn: meta.claimTurn != null ? meta.claimTurn : yearNow(),
        skipPersist: true,
        skipRebuild: true
      });
      if (!r) { report.skipped += 1; return; }
      if (r.changed) {
        report.changed += 1;
        report.tiles.push({ id, prev: r.prev, next: r.next });
      }
    });
    if (report.changed && GE.worldState.flushOwnership) GE.worldState.flushOwnership();
    else if (report.changed && GE.worldState.persist) GE.worldState.persist();
    return report;
  }

  function seedFirstSettlement(civId) {
    if (!civId) return null;
    const civ = (GE.data.civs || []).find(c => c.id === civId);
    // 优先用文明 territorySeed / 表面 capitalSeeds
    const def = GE.worldState.def || {};
    const seed = (def.capitalSeeds && def.capitalSeeds[civId])
      || (civ && civ.territorySeed)
      || null;
    let tile = null;
    if (seed && GE.worldGrid && typeof GE.worldGrid.nearestLatLon === 'function') {
      const near = GE.worldGrid.nearestLatLon(seed.lat, seed.lon);
      tile = near && GE.worldState.getTile(near.id);
    }
    if (!tile || tile.ownerCivId || !terrainAllowed(civId, tile.terrain)) {
      tile = (GE.worldState.tiles || []).find(t => !t.ownerCivId && terrainAllowed(civId, t.terrain)) || null;
    }
    if (!tile) return null;
    const r = GE.worldState.setTileOwner(tile.id, civId, {
      claimSource: 'seed',
      claimTurn: yearNow()
    });
    return r && r.changed ? tile : null;
  }

  function expandFrontier(civId, budget, meta) {
    meta = meta || {};
    const cap = Math.max(0, Math.min(Number(budget) || 0, CAPS.maxExpandPerCiv));
    if (!civId || cap <= 0) return { type: 'expand', civId, changed: 0, tiles: [], skipped: true, reason: 'no_budget' };
    let summary = ownershipSummary();
    // 创世全无主：先落一枚首都/营地种子，再扩张
    if (!summary.byCiv[civId] || summary.byCiv[civId] <= 0) {
      const seeded = seedFirstSettlement(civId);
      if (!seeded) return { type: 'expand', civId, changed: 0, tiles: [], skipped: true, reason: 'no_land_for_seed' };
      summary = ownershipSummary();
    }
    const candidates = frontierTiles(civId).slice(0, Math.max(0, cap - (summary.byCiv[civId] === 1 ? 0 : 0)));
    // 若刚种子，仍尝试再扩 cap 格（含种子后的 frontier）
    const want = Math.max(1, cap);
    const pick = frontierTiles(civId).slice(0, want);
    if (!pick.length) {
      // 至少已有种子格
      const owned = GE.worldState.getTilesByCiv(civId);
      return {
        type: 'expand',
        civId,
        changed: owned.length ? 1 : 0,
        tiles: owned.slice(0, 1).map(t => ({ id: t.id, prev: null, next: civId })),
        skipped: false,
        reason: meta.reason || 'first_settlement'
      };
    }
    const r = reassignTiles(pick.map(t => t.id), civId, {
      claimSource: 'expand',
      claimTurn: yearNow()
    });
    return Object.assign({ type: 'expand', civId, reason: meta.reason || 'frontier_expand', source: meta.source || 'rules' }, r);
  }

  function annexBorder(attackerId, defenderId, budget, meta) {
    meta = meta || {};
    const cap = Math.max(0, Math.min(Number(budget) || 0, CAPS.maxAnnexPerPair));
    if (!attackerId || !defenderId || attackerId === defenderId || cap <= 0) {
      return { type: 'annex', attackerId, defenderId, changed: 0, tiles: [], skipped: true, reason: 'bad_args' };
    }
    if (defenderId === 'all' || attackerId === 'all') {
      return { type: 'annex', attackerId, defenderId, changed: 0, tiles: [], skipped: true, reason: 'invalid_civ' };
    }
    const candidates = borderTiles(attackerId, defenderId).slice(0, cap);
    if (!candidates.length) return { type: 'annex', attackerId, defenderId, changed: 0, tiles: [], skipped: true, reason: 'no_border' };
    const r = reassignTiles(candidates.map(t => t.id), attackerId, {
      claimSource: 'annex',
      claimTurn: yearNow()
    });
    return Object.assign({ type: 'annex', attackerId, defenderId, reason: meta.reason || 'border_annex', source: meta.source || 'rules' }, r);
  }

  function splitCiv(parentCivId, childCivId, share, meta) {
    meta = meta || {};
    const ratio = Math.max(0.15, Math.min(0.45, Number(share) || 0.25));
    const parentTiles = GE.worldState.getTilesByCiv(parentCivId);
    if (parentTiles.length < 8) {
      return { type: 'split', parentCivId, childCivId, changed: 0, tiles: [], skipped: true, reason: 'too_small' };
    }
    const target = Math.max(3, Math.floor(parentTiles.length * ratio));
    // BFS 从最边缘格子切出连通块
    const edge = parentTiles
      .map(t => ({
        t,
        edgeScore: (t.neighbors || []).filter(nid => {
          const n = GE.worldState.getTile(nid);
          return !n || n.ownerCivId !== parentCivId;
        }).length
      }))
      .sort((a, b) => b.edgeScore - a.edgeScore);
    const start = edge[0] && edge[0].t;
    if (!start) return { type: 'split', parentCivId, childCivId, changed: 0, tiles: [], skipped: true, reason: 'no_seed' };
    const picked = [];
    const q = [start];
    const seen = new Set([start.id]);
    while (q.length && picked.length < target) {
      const cur = q.shift();
      if (!terrainAllowed(childCivId, cur.terrain) && childCivId !== parentCivId) {
        // 子文明默认沿用母文明地形规则；abyss 特例仅对 abyss 生效
      }
      if (childCivId === 'abyss' ? isWater(cur.terrain) : !isWater(cur.terrain) || parentCivId === 'abyss') {
        picked.push(cur);
      }
      (cur.neighbors || []).forEach(nid => {
        if (seen.has(nid)) return;
        const n = GE.worldState.getTile(nid);
        if (!n || n.ownerCivId !== parentCivId) return;
        seen.add(nid);
        q.push(n);
      });
    }
    if (picked.length < 3) {
      return { type: 'split', parentCivId, childCivId, changed: 0, tiles: [], skipped: true, reason: 'insufficient_connected' };
    }
    const r = reassignTiles(picked.map(t => t.id), childCivId, {
      claimSource: 'split',
      claimTurn: yearNow()
    });
    return Object.assign({
      type: 'split',
      parentCivId,
      childCivId,
      share: ratio,
      reason: meta.reason || 'secession',
      source: meta.source || 'rules'
    }, r);
  }

  function applyEvents(events, ctx) {
    ctx = ctx || {};
    const list = Array.isArray(events) ? events.slice(0, CAPS.maxEventsPerRound) : [];
    const report = {
      year: yearNow(),
      surfaceId: GE.worldState.surfaceId,
      bodyId: GE.worldState.bodyId,
      applied: [],
      skipped: [],
      changedTiles: 0,
      expand: 0,
      annex: 0,
      split: 0
    };
    const summary = ownershipSummary();
    // 创世全无主时：允许 expand 首次定居；annex 仍跳过
    list.forEach(ev => {
      if (!ev || !ev.type) return;
      let result = null;
      if (ev.type === 'expand') {
        result = expandFrontier(ev.civId, ev.budget, ev);
        if (result.changed) report.expand += result.changed;
      } else if (ev.type === 'annex') {
        if (!summary.owned && !ctx.force) {
          result = { type: 'annex', skipped: true, reason: 'genesis_unowned', changed: 0, tiles: [] };
        } else {
          result = annexBorder(ev.attackerId, ev.defenderId, ev.budget, ev);
        }
        if (result.changed) report.annex += result.changed;
      } else if (ev.type === 'split') {
        result = splitCiv(ev.parentCivId, ev.childCivId, ev.share, ev);
        if (result.changed) report.split += result.changed;
      } else if (ev.type === 'dissolve') {
        // v1：仅记录，不自动删 civ
        result = { type: 'dissolve', skipped: true, reason: 'v1_record_only', civId: ev.civId, absorbedBy: ev.absorbedBy };
      } else {
        result = { type: ev.type, skipped: true, reason: 'unknown_type' };
      }
      if (!result) return;
      report.changedTiles += Number(result.changed) || 0;
      if (result.skipped || !result.changed) report.skipped.push(result);
      else report.applied.push(result);
    });
    lastReport = report;
    if (report.changedTiles > 0 && GE.views && GE.views.planet && typeof GE.views.planet.rebuildStrategicMap === 'function') {
      try { GE.views.planet.rebuildStrategicMap(); } catch (_) {
        try { if (typeof GE.views.planet.buildStrategicMap === 'function') GE.views.planet.buildStrategicMap(); } catch (__){ /* ignore */ }
      }
    }
    return report;
  }

  function deriveEventsFromTurn(ctx) {
    ctx = ctx || {};
    const events = [];
    const decisions = (ctx.decisions || (GE.data.deduction && GE.data.deduction.pendingDecisions) || []).slice();
    const relations = GE.data.relations || [];
    let splits = 0;

    // 即使创世全无主，也允许 expand 意图（客户端会首次定居）
    decisions.forEach(d => {
      const civId = d.civId || d.civ;
      const kind = d.kind || '';
      if (!civId) return;
      if (kind === 'policy' || kind === 'explore.body' || d.actionType === 'expand_softly' || d.actionType === 'expand_frontier') {
        events.push({
          type: 'expand',
          civId,
          budget: Math.max(1, Math.min(CAPS.maxExpandPerCiv, 2 + Math.floor((Number((GE.data.civs.find(c => c.id === civId) || {}).stats?.扩张) || 5) / 20))),
          mode: 'frontier',
          reason: d.decision || d.actionReason || 'policy_expand',
          source: d.source || 'rules'
        });
      }
      if (kind === 'military' || d.actionType === 'prepare_defense' || d.actionType === 'threaten' || d.actionType === 'annex_border') {
        const summary = ownershipSummary();
        if (!summary.owned) return; // 无领地时吞并无意义
        const rel = relations.find(r => (r.a === civId || r.b === civId) && r.a !== 'all' && r.b !== 'all');
        if (rel) {
          const other = rel.a === civId ? rel.b : rel.a;
          const tension = Number(rel.tension) || 0;
          if (tension >= 40 || /敌|对峙|戒备|威慑|冷战/.test(rel.state || '') || /敌|威慑|戒备/.test(d.decision || '')) {
            events.push({
              type: 'annex',
              attackerId: civId,
              defenderId: other,
              budget: Math.max(1, Math.min(CAPS.maxAnnexPerPair, 2 + Math.floor(tension / 25))),
              intensity: tension >= 70 ? 2 : 1,
              reason: d.decision || 'military_pressure',
              source: d.source || 'rules'
            });
          }
        }
      }
    });

    // 继承/低稳定分裂：仅当已有子文明 id 在 civs 中
    (GE.data.civs || []).forEach(civ => {
      if (splits >= CAPS.maxSplitPerRound) return;
      const leader = (civ.leaders || [])[0];
      if (!leader || !leader.succession) return;
      const stable = Number(civ.stats && civ.stats.稳定) || 50;
      const gen = Number(leader.succession.generation) || 1;
      const secessionGoal = ((leader.agentGoals && leader.agentGoals.active) || []).some(g => g.type === 'secession' || g.type === 'succession');
      if (gen >= 2 && stable < 35 && secessionGoal) {
        const childId = civ.id + '_split_' + gen;
        if ((GE.data.civs || []).some(c => c.id === childId)) {
          events.push({
            type: 'split',
            parentCivId: civ.id,
            childCivId: childId,
            share: 0.22,
            reason: 'succession_fracture',
            source: 'rules'
          });
          splits += 1;
        }
      }
    });

    return events.slice(0, CAPS.maxEventsPerRound);
  }

  return {
    CAPS,
    applyEvents,
    deriveEventsFromTurn,
    expandFrontier,
    annexBorder,
    splitCiv,
    reassignTiles,
    frontierTiles,
    borderTiles,
    ownershipSummary,
    lastReport() { return lastReport; }
  };
})();
