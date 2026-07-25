/* ============================================================
   创世引擎 · 席位（阶段 D）
   匿名 playerToken 绑文明；一人一席；开局赠 3 神谕点
   ============================================================ */

const STARTING_GRANT = 3;
const POINTS_HARD_CAP = 15;

function ensureSeats(run) {
  if (!Array.isArray(run.seats)) run.seats = [];
  return run.seats;
}

function ensureFlags(run) {
  if (!run.flags || typeof run.flags !== 'object') run.flags = {};
  return run.flags;
}

function normalizeToken(token) {
  const t = String(token || '').trim();
  if (t.length < 8 || t.length > 128) return null;
  if (!/^[a-zA-Z0-9._:-]+$/.test(t)) return null;
  return t;
}

function publicSeat(seat) {
  if (!seat) return null;
  return {
    playerId: seat.playerId,
    civId: seat.civId,
    displayName: seat.displayName || null,
    role: seat.role,
    oraclePoints: Number(seat.oraclePoints) || 0,
    oracleTimeGranted: Number(seat.oracleTimeGranted) || 0,
    startingGrant: Number(seat.startingGrant) || 0,
    yearAtBind: Number(seat.yearAtBind) || 0,
    spectator: seat.role === 'spectator'
  };
}

function findSeatByToken(run, token) {
  const t = normalizeToken(token);
  if (!t) return null;
  return ensureSeats(run).find(s => s.playerId === t) || null;
}

function findSeatByCiv(run, civId) {
  return ensureSeats(run).find(s => s.civId === civId && s.role !== 'spectator') || null;
}

/**
 * 认领文明席位
 * @returns {{ ok, status?, error?, seat?, created? }}
 */
function claimSeat(run, body) {
  body = body || {};
  const token = normalizeToken(body.playerToken);
  if (!token) {
    return { ok: false, status: 400, error: 'invalid_token', message: 'playerToken 须 8～128 位字母数字' };
  }
  const civId = String(body.civId || '').trim();
  if (!civId) {
    return { ok: false, status: 400, error: 'civ_required' };
  }
  const civ = (run.civs || []).find(c => c.id === civId);
  if (!civ) {
    return { ok: false, status: 404, error: 'civ_not_found', civId };
  }

  const seats = ensureSeats(run);
  const existing = seats.find(s => s.playerId === token);

  // 已绑同一文明：幂等返回
  if (existing && existing.civId === civId) {
    return { ok: true, created: false, seat: publicSeat(existing) };
  }
  // 禁止中途换绑
  if (existing && existing.civId && existing.civId !== civId) {
    return {
      ok: false,
      status: 409,
      error: 'already_bound',
      message: '本局不可换绑文明',
      seat: publicSeat(existing)
    };
  }

  const taken = findSeatByCiv(run, civId);
  if (taken && taken.playerId !== token) {
    return {
      ok: false,
      status: 409,
      error: 'civ_taken',
      message: `${civ.name || civId} 已被其他玩家认领`
    };
  }

  const isFirst = !seats.some(s => s.role === 'owner' || s.role === 'member');
  const year = Math.floor(Number(run.year) || 0);
  const seat = {
    playerId: token,
    runId: run.id,
    civId,
    displayName: body.displayName ? String(body.displayName).trim().slice(0, 24) : null,
    role: isFirst ? 'owner' : 'member',
    oraclePoints: STARTING_GRANT,
    oracleTimeGranted: 0,
    startingGrant: STARTING_GRANT,
    yearAtBind: year,
    claimedAt: new Date().toISOString()
  };
  seats.push(seat);
  return { ok: true, created: true, seat: publicSeat(seat) };
}

function claimSpectator(run, body) {
  body = body || {};
  const token = normalizeToken(body.playerToken);
  if (!token) return { ok: false, status: 400, error: 'invalid_token' };
  const seats = ensureSeats(run);
  let seat = seats.find(s => s.playerId === token);
  if (seat && seat.role !== 'spectator') {
    return { ok: false, status: 409, error: 'already_bound', seat: publicSeat(seat) };
  }
  if (!seat) {
    seat = {
      playerId: token,
      runId: run.id,
      civId: null,
      displayName: body.displayName ? String(body.displayName).trim().slice(0, 24) : null,
      role: 'spectator',
      oraclePoints: 0,
      oracleTimeGranted: 0,
      startingGrant: 0,
      yearAtBind: Math.floor(Number(run.year) || 0),
      claimedAt: new Date().toISOString()
    };
    seats.push(seat);
  }
  return { ok: true, seat: publicSeat(seat) };
}

function me(run, token) {
  const seat = findSeatByToken(run, token);
  if (!seat) return { ok: false, status: 404, error: 'no_seat' };
  const civ = seat.civId ? (run.civs || []).find(c => c.id === seat.civId) : null;
  return {
    ok: true,
    seat: publicSeat(seat),
    civ: civ ? { id: civ.id, name: civ.name, short: civ.short, color: civ.color } : null,
    clock: run.clock
      ? {
          year: run.year,
          paused: !!run.clock.paused,
          minutesPerYear: run.clock.minutesPerYear || 10
        }
      : null
  };
}

function listSeatsPublic(run) {
  return ensureSeats(run).map(s => ({
    civId: s.civId,
    role: s.role,
    displayName: s.displayName,
    // 不暴露 token
    occupied: true
  }));
}

export {
  STARTING_GRANT,
  POINTS_HARD_CAP,
  ensureSeats,
  ensureFlags,
  normalizeToken,
  publicSeat,
  findSeatByToken,
  findSeatByCiv,
  claimSeat,
  claimSpectator,
  me,
  listSeatsPublic
};
