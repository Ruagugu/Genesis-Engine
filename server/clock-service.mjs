/* ============================================================
   创世引擎 · WorldClock（阶段 D）
   10 现实分钟 = 1 世界年；paused 双停；按席位每 50 年积 1 神谕点
   ============================================================ */
import { POINTS_HARD_CAP, ensureSeats } from './seat-service.mjs';

const DEFAULT_MINUTES_PER_YEAR = 10;
const MAX_CATCHUP_YEARS = 20;
const HEAVY_ROUND_YEARS = 5; // N=5 触发重推演累计

function ensureClock(run, nowMs) {
  const now = nowMs != null ? Number(nowMs) : Date.now();
  if (!run.clock || typeof run.clock !== 'object') {
    run.clock = {
      realEpochMs: now,
      worldYearAtEpoch: Number(run.year) || 0,
      minutesPerYear: DEFAULT_MINUTES_PER_YEAR,
      paused: true,
      speed: 1,
      lastTickAt: now,
      yearsSinceRound: 0
    };
  } else {
    if (run.clock.minutesPerYear == null) run.clock.minutesPerYear = DEFAULT_MINUTES_PER_YEAR;
    if (run.clock.speed == null) run.clock.speed = 1;
    if (run.clock.yearsSinceRound == null) run.clock.yearsSinceRound = 0;
    if (run.clock.realEpochMs == null) run.clock.realEpochMs = now;
    if (run.clock.worldYearAtEpoch == null) run.clock.worldYearAtEpoch = Number(run.year) || 0;
    if (run.clock.paused == null) run.clock.paused = true;
  }
  return run.clock;
}

/** 连续世界年（未 floor） */
function continuousYear(run, nowMs) {
  const clock = ensureClock(run, nowMs);
  const now = nowMs != null ? Number(nowMs) : Date.now();
  if (clock.paused) return Number(clock.worldYearAtEpoch) || 0;
  const mpy = Number(clock.minutesPerYear) || DEFAULT_MINUTES_PER_YEAR;
  const msPerYear = mpy * 60 * 1000;
  const speed = Number(clock.speed) || 1;
  const delta = Math.max(0, (now - Number(clock.realEpochMs || now)) * speed);
  return (Number(clock.worldYearAtEpoch) || 0) + delta / msPerYear;
}

function floorYear(run, nowMs) {
  return Math.floor(continuousYear(run, nowMs));
}

/**
 * 按席位发放时间神谕点
 * @returns {Array<{ playerId, granted, points }>}
 */
function grantOraclePoints(run, floorY) {
  const granted = [];
  const y = Math.floor(Number(floorY));
  ensureSeats(run).forEach(seat => {
    if (!seat || seat.role === 'spectator' || !seat.civId) return;
    const yearAtBind = Number(seat.yearAtBind) || 0;
    const fromTime = Math.max(0, Math.floor((y - yearAtBind) / 50));
    const already = Number(seat.oracleTimeGranted) || 0;
    let toGrant = fromTime - already;
    if (toGrant <= 0) return;
    const cur = Number(seat.oraclePoints) || 0;
    if (cur >= POINTS_HARD_CAP) {
      // 到顶停积：仍推进 oracleTimeGranted，避免解顶后补发
      seat.oracleTimeGranted = fromTime;
      return;
    }
    const room = POINTS_HARD_CAP - cur;
    const give = Math.min(toGrant, room);
    seat.oraclePoints = cur + give;
    seat.oracleTimeGranted = already + give;
    // 若硬顶截断，把时间计数对齐到已发，剩余年进度不补
    if (give < toGrant) {
      seat.oracleTimeGranted = fromTime;
    }
    granted.push({
      playerId: seat.playerId,
      civId: seat.civId,
      granted: give,
      points: seat.oraclePoints
    });
  });
  return granted;
}

/**
 * 惰性 tick：推进 floor 年、积点、记录 yearsSinceRound
 * @returns {{ yearDelta, year, granted, needHeavyRound, events }}
 */
function tick(run, nowMs) {
  const now = nowMs != null ? Number(nowMs) : Date.now();
  const clock = ensureClock(run, now);
  const events = [];

  if (clock.paused) {
    clock.lastTickAt = now;
    return {
      yearDelta: 0,
      year: Math.floor(Number(run.year) || 0),
      granted: [],
      needHeavyRound: false,
      events
    };
  }

  const cont = continuousYear(run, now);
  const prevFloor = Math.floor(Number(run.year) || 0);
  let targetFloor = Math.floor(cont);
  // 追年封顶
  if (targetFloor - prevFloor > MAX_CATCHUP_YEARS) {
    targetFloor = prevFloor + MAX_CATCHUP_YEARS;
    // 校准 epoch，使连续年停在 targetFloor（余量下轮）
    clock.worldYearAtEpoch = targetFloor;
    clock.realEpochMs = now;
  }

  const yearDelta = Math.max(0, targetFloor - prevFloor);
  if (yearDelta > 0) {
    run.year = targetFloor;
    if (run.world) run.world.年数 = targetFloor;
    clock.yearsSinceRound = (Number(clock.yearsSinceRound) || 0) + yearDelta;
    events.push({ type: 'year.tick', year: targetFloor, yearDelta });
  }

  const granted = grantOraclePoints(run, run.year);
  granted.forEach(g => {
    events.push({ type: 'oracle.points', ...g });
  });

  clock.lastTickAt = now;
  const needHeavyRound =
    (Number(clock.yearsSinceRound) || 0) >= HEAVY_ROUND_YEARS
    || (Array.isArray(run.edicts) && run.edicts.some(e => e.status === 'paid' || e.status === 'queued'));

  return { yearDelta, year: Math.floor(Number(run.year) || 0), granted, needHeavyRound, events };
}

function setPaused(run, paused, tokenSeat) {
  const clock = ensureClock(run);
  const want = !!paused;
  if (!!clock.paused === want) {
    return { ok: true, paused: clock.paused, year: run.year };
  }
  // 仅 owner 可暂停（无 seat 时允许单机调试）
  if (tokenSeat && tokenSeat.role !== 'owner') {
    return { ok: false, status: 403, error: 'owner_only' };
  }
  const now = Date.now();
  if (want) {
    // 进入暂停：冻结当前连续年
    const y = continuousYear(run, now);
    clock.worldYearAtEpoch = y;
    clock.realEpochMs = now;
    clock.paused = true;
  } else {
    clock.worldYearAtEpoch = Number(run.year) || continuousYear(run, now);
    clock.realEpochMs = now;
    clock.paused = false;
  }
  clock.lastTickAt = now;
  return { ok: true, paused: clock.paused, year: run.year };
}

/**
 * 测试/调试：快进世界年（不依赖现实时间）
 * 暂停时也可推进（显式作弊钩子）
 */
function advanceYears(run, years, opts) {
  opts = opts || {};
  const n = Math.max(0, Math.min(200, Math.floor(Number(years) || 0)));
  if (!n) return { ok: true, yearDelta: 0, year: run.year, granted: [] };
  const clock = ensureClock(run);
  const prev = Math.floor(Number(run.year) || 0);
  run.year = prev + n;
  if (run.world) run.world.年数 = run.year;
  clock.worldYearAtEpoch = run.year;
  clock.realEpochMs = Date.now();
  clock.yearsSinceRound = (Number(clock.yearsSinceRound) || 0) + n;
  const granted = grantOraclePoints(run, run.year);
  return {
    ok: true,
    yearDelta: n,
    year: run.year,
    granted,
    needHeavyRound: (clock.yearsSinceRound || 0) >= HEAVY_ROUND_YEARS
  };
}

function markHeavyRoundDone(run) {
  const clock = ensureClock(run);
  clock.yearsSinceRound = 0;
}

/** 兼容手动 deduce：旧 C 回合可能一次推进 7 年，需同步现实 clock 基线。 */
function syncClockToRunYear(run, nowMs) {
  const now = nowMs != null ? Number(nowMs) : Date.now();
  const clock = ensureClock(run, now);
  clock.worldYearAtEpoch = Number(run.year) || 0;
  clock.realEpochMs = now;
  clock.lastTickAt = now;
  return clock;
}

function clockPublic(run, nowMs) {
  const clock = ensureClock(run, nowMs);
  const cont = continuousYear(run, nowMs);
  return {
    year: Math.floor(Number(run.year) || 0),
    continuousYear: Math.round(cont * 1000) / 1000,
    era: run.era || null,
    paused: !!clock.paused,
    minutesPerYear: clock.minutesPerYear || DEFAULT_MINUTES_PER_YEAR,
    yearsSinceRound: Number(clock.yearsSinceRound) || 0,
    heavyRoundEvery: HEAVY_ROUND_YEARS,
    nextPointInYears: null // 由 oracle GET 按席位填
  };
}

function nextPointYears(seat, floorY) {
  if (!seat || seat.role === 'spectator') return null;
  const yearAtBind = Number(seat.yearAtBind) || 0;
  const progressed = Math.max(0, floorY - yearAtBind);
  const mod = progressed % 50;
  return mod === 0 && progressed > 0 ? 50 : 50 - mod;
}

export {
  DEFAULT_MINUTES_PER_YEAR,
  MAX_CATCHUP_YEARS,
  HEAVY_ROUND_YEARS,
  ensureClock,
  continuousYear,
  floorYear,
  grantOraclePoints,
  tick,
  setPaused,
  advanceYears,
  markHeavyRoundDone,
  syncClockToRunYear,
  clockPublic,
  nextPointYears
};
