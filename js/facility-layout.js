/* ============================================================
   创世引擎 · facility-layout.js
   人造设施轨道程序化排布：分宿主、分壳、黄金角相位，避免挤轨
   ============================================================ */
window.GE = window.GE || {};

GE.facilityLayout = (function () {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const TWO_PI = Math.PI * 2;

  /**
   * 形态 → 宿主优先级队列（第一个可用即用；满员则顺延）
   * 虚拟壳：_star / _belt / _mid / _outer 表示绕恒星、无 parent
   */
  const CLASS_HOSTS = {
    station_modular: ['gaiya'],
    tether: ['gaiya'],
    depot: ['gaiya'],
    defense: ['gaiya'],
    hospital: ['gaiya'],
    habitat: ['gaiya'],
    farm_orbit: ['gaiya'],
    constellation: ['gaiya'],
    embassy: ['gaiya', 'yinhui'],
    shipyard: ['gaiya', 'cangqiong'],
    drydock_ring: ['gaiya', 'cangqiong'],
    factory: ['cangqiong', 'gaiya'],
    fuel_tanker: ['gaiya', '_belt'],
    laser_comm: ['yinhui', 'gaiya'],
    array: ['yinhui', 'youxing'],
    sensor_buoy: ['_mid', 'youxing'],
    prison: ['youxing', 'shuanghuan'],
    essence_spire: ['gaiya', 'yinhui'],
    lab: ['yinhui'],
    cryo_vault: ['yinhui'],
    terraformer: ['yanhe'],
    mining: ['_belt'],
    refinery: ['_belt'],
    mag_sail_yard: ['_mid', 'cangqiong'],
    stellar_infra: ['_star'],
    gate: ['_outer'],
    ark: ['_mid'],
    observatory_bh: ['shenyuanzhitong'],
    generic: ['youxing', 'shuanghuan']
  };

  /** 每宿主：壳层半长轴 + 容量上限（超出顺延次选宿主） */
  const HOST_PROFILE = {
    gaiya: {
      shells: [12.5, 16.5, 22, 29, 38],
      perShell: 3,
      max: 12,
      incBase: 10
    },
    yinhui: {
      shells: [5.5, 8.5, 12.5],
      perShell: 2,
      max: 6,
      incBase: 18
    },
    yanhe: {
      shells: [11, 16, 23],
      perShell: 2,
      max: 4,
      incBase: 14
    },
    youxing: {
      shells: [7, 12, 18],
      perShell: 2,
      max: 4,
      incBase: 16
    },
    cangqiong: {
      shells: [32, 48, 68],
      perShell: 2,
      max: 6,
      incBase: 12
    },
    shuanghuan: {
      shells: [24, 38],
      perShell: 2,
      max: 4,
      incBase: 15
    },
    shenyuanzhitong: {
      shells: [42, 60],
      perShell: 2,
      max: 3,
      incBase: 20
    },
    _star: {
      shells: [70, 95, 125],
      perShell: 2,
      max: 4,
      incBase: 3
    },
    _belt: {
      shells: [345, 365, 390, 415],
      perShell: 2,
      max: 8,
      incBase: 6
    },
    _mid: {
      shells: [500, 580, 660],
      perShell: 2,
      max: 6,
      incBase: 9
    },
    _outer: {
      shells: [920, 1050, 1200],
      perShell: 2,
      max: 4,
      incBase: 5
    }
  };

  /** 形态倾角偏好（度）；覆盖 host.incBase */
  const INC_BY_CLASS = {
    tether: 0,
    habitat: 5,
    farm_orbit: 7,
    constellation: 54,
    array: 68,
    prison: 82,
    defense: 30,
    laser_comm: 40,
    sensor_buoy: 22,
    essence_spire: 46,
    observatory_bh: 17,
    gate: 4,
    stellar_infra: 2,
    mining: 7,
    refinery: 4
  };

  /** 同宿主内：希望更靠内壳的形态（望舒、天梯、燃料库等） */
  const INNER_PRIORITY = {
    station_modular: 0,
    tether: 1,
    depot: 2,
    defense: 3,
    hospital: 4,
    habitat: 5,
    farm_orbit: 6,
    constellation: 7,
    embassy: 8,
    shipyard: 9,
    drydock_ring: 10,
    essence_spire: 11,
    factory: 12,
    fuel_tanker: 13,
    laser_comm: 14,
    array: 15,
    sensor_buoy: 16,
    prison: 17
  };

  function isArtificial(b) {
    if (!b) return false;
    if (b.flags && b.flags.artificial) return true;
    if (b.visual && b.visual.class) return true;
    return ['空间站', '轨道设施', '星门', '采矿站', '轨道农场', '防御平台'].includes(b.type);
  }

  function resolveClass(b) {
    if (GE.facilityMesh && GE.facilityMesh.resolveClass) {
      return GE.facilityMesh.resolveClass(b) || 'generic';
    }
    return (b.visual && b.visual.class) || 'generic';
  }

  function parentOf(hostKey) {
    return hostKey.charAt(0) === '_' ? null : hostKey;
  }

  function periodFor(a, hasParent) {
    if (hasParent) return Math.max(30, 10 * Math.pow(Math.max(a, 6) / 12, 1.5));
    return Math.max(50, 88 * Math.pow(Math.max(a, 40) / 150, 1.5));
  }

  function pickHost(cls, idSet, load) {
    const queue = (CLASS_HOSTS[cls] || ['gaiya']).slice();
    // 兜底
    queue.push('gaiya', '_mid', '_outer');
    for (let i = 0; i < queue.length; i++) {
      const h = queue[i];
      if (h.charAt(0) !== '_' && !idSet.has(h)) continue;
      const prof = HOST_PROFILE[h] || HOST_PROFILE.gaiya;
      const used = load[h] || 0;
      if (used < prof.max) return h;
    }
    return '_outer';
  }

  /**
   * 就地改写人造设施 parent / orbit
   * @param {object[]} bodies
   * @param {{ seed?: number }} opts
   */
  function apply(bodies, opts) {
    if (!Array.isArray(bodies) || !bodies.length) return bodies;
    let s = ((opts && opts.seed) || 20260723) >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };

    const idSet = new Set(bodies.map(b => b.id));
    const load = Object.create(null);
    const assigned = []; // { b, cls, host }

    // 先按内层优先级排序，再分配宿主（望舒等先占内壳名额）
    const arts = bodies.filter(isArtificial).map(b => ({ b, cls: resolveClass(b) }));
    arts.sort((u, v) => {
      const pu = INNER_PRIORITY[u.cls] != null ? INNER_PRIORITY[u.cls] : 50;
      const pv = INNER_PRIORITY[v.cls] != null ? INNER_PRIORITY[v.cls] : 50;
      if (pu !== pv) return pu - pv;
      return u.b.id < v.b.id ? -1 : u.b.id > v.b.id ? 1 : 0;
    });

    arts.forEach(item => {
      const host = pickHost(item.cls, idSet, load);
      load[host] = (load[host] || 0) + 1;
      assigned.push({ b: item.b, cls: item.cls, host });
    });

    // 按宿主填壳
    const byHost = Object.create(null);
    assigned.forEach(x => {
      if (!byHost[x.host]) byHost[x.host] = [];
      byHost[x.host].push(x);
    });

    Object.keys(byHost).forEach(host => {
      const list = byHost[host];
      // 组内再按优先级，保证内壳是核心站
      list.sort((u, v) => {
        const pu = INNER_PRIORITY[u.cls] != null ? INNER_PRIORITY[u.cls] : 50;
        const pv = INNER_PRIORITY[v.cls] != null ? INNER_PRIORITY[v.cls] : 50;
        if (pu !== pv) return pu - pv;
        return u.b.id < v.b.id ? -1 : 1;
      });

      const prof = HOST_PROFILE[host] || HOST_PROFILE.gaiya;
      const shells = prof.shells.slice();
      const perShell = prof.perShell || 2;
      const parent = parentOf(host);

      list.forEach((item, idx) => {
        let shellIndex = Math.floor(idx / perShell);
        while (shells.length <= shellIndex) {
          const last = shells[shells.length - 1];
          shells.push(Math.round((last * 1.22 + 8) * 10) / 10);
        }
        const a = shells[shellIndex];
        const slot = idx % perShell;
        // 同壳均分相位 + 壳间黄金角，避免整圈重叠
        const phase =
          (shellIndex * GOLDEN + (slot / perShell) * TWO_PI + rnd() * 0.08) % TWO_PI;

        let inc =
          INC_BY_CLASS[item.cls] != null ? INC_BY_CLASS[item.cls] : prof.incBase;
        // 同壳多枚：倾角扇形打开
        if (perShell > 1) {
          const fan = (slot - (perShell - 1) / 2) * (10 / perShell);
          inc = inc + fan;
        }
        inc += (rnd() - 0.5) * 2.5;

        const b = item.b;
        b.parent = parent;
        b.orbit = {
          a: Math.round(a * 10) / 10,
          e: item.cls === 'sensor_buoy' ? 0.045 : 0.012,
          inc: Math.round(inc * 10) / 10,
          period: periodFor(a, !!parent),
          phase: Math.round(phase * 1000) / 1000
        };
      });
    });

    return bodies;
  }

  return {
    apply,
    isArtificial,
    CLASS_HOSTS,
    HOST_PROFILE
  };
})();
