/* ============================================================
   创世引擎 · facility-mesh.js
   轨道 / 星际人造设施 mesh 工厂（宇宙图 L1）
   对齐 docs/facility-map-drawing-plan.md
   ============================================================ */
window.GE = window.GE || {};

GE.facilityMesh = (function () {
  const CLASSES = [
    'station_modular', 'habitat', 'shipyard', 'array', 'constellation',
    'mining', 'depot', 'stellar_infra', 'gate', 'tether',
    'defense', 'lab', 'ark', 'observatory_bh', 'refinery',
    'farm_orbit', 'hospital', 'prison', 'embassy', 'factory',
    'sensor_buoy', 'fuel_tanker', 'drydock_ring', 'laser_comm',
    'mag_sail_yard', 'cryo_vault', 'terraformer', 'essence_spire',
    'generic'
  ];

  const SCALE_MUL = { micro: 0.55, small: 0.85, medium: 1, large: 1.45, mega: 2.2 };

  function tintOf(b) {
    const v = b.visual || {};
    if (v.civTint) return new THREE.Color(v.civTint);
    if (b.color) return new THREE.Color(b.color);
    return new THREE.Color(0x8fa4c0);
  }

  function matMetal(color, emissive, emInt) {
    return new THREE.MeshStandardMaterial({
      color,
      metalness: 0.78,
      roughness: 0.32,
      emissive: emissive || color,
      emissiveIntensity: emInt != null ? emInt : 0.18
    });
  }

  function matGlow(color, opacity) {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: opacity != null ? opacity : 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
  }

  function resolveClass(b) {
    const v = b.visual || {};
    if (v.class && CLASSES.includes(v.class)) return v.class;
    const kind = (v.kind || b.flags && b.flags.facilityKind || '').toLowerCase();
    const type = b.type || '';
    if (type === '空间站' || kind.includes('outpost') || kind.includes('hub') || kind.includes('station')) return 'station_modular';
    if (type === '星门' || kind.includes('gate')) return 'gate';
    if (type === '采矿站' || kind.includes('mine')) return 'mining';
    if (kind.includes('constellation') || kind.includes('mesh') || kind.includes('星链')) return 'constellation';
    if (kind.includes('shipyard') || kind.includes('drydock')) return 'shipyard';
    if (kind.includes('array') || kind.includes('dish')) return 'array';
    if (kind.includes('depot') || kind.includes('fuel')) return 'depot';
    if (kind.includes('habitat') || kind.includes('ring')) return 'habitat';
    if (kind.includes('defense') || kind.includes('platform')) return 'defense';
    if (kind.includes('lab') || kind.includes('research')) return 'lab';
    if (kind.includes('essence')) return 'essence_spire';
    if (kind.includes('tether') || kind.includes('elevator')) return 'tether';
    if (kind.includes('stellar') || kind.includes('dyson')) return 'stellar_infra';
    if (kind.includes('ark')) return 'ark';
    if (kind.includes('blackhole') || kind.includes('accretion')) return 'observatory_bh';
    if (b.flags && b.flags.artificial) return 'generic';
    return null;
  }

  function isFacility(b) {
    if (!b) return false;
    if (b.flags && b.flags.artificial) return true;
    if (b.visual && b.visual.class) return true;
    return ['空间站', '轨道设施', '星门', '采矿站', '轨道农场', '防御平台'].includes(b.type);
  }

  /* ---------- 零件 ---------- */
  function addCore(grp, r, h, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), mat);
    grp.add(m);
    return m;
  }
  function addRing(grp, R, tube, mat, tilt) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 8, 32), mat);
    m.rotation.x = tilt != null ? tilt : Math.PI / 2;
    grp.add(m);
    return m;
  }
  function addBox(grp, w, h, d, mat, pos) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    if (pos) m.position.copy(pos);
    grp.add(m);
    return m;
  }
  function addSphere(grp, r, mat, pos) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
    if (pos) m.position.copy(pos);
    grp.add(m);
    return m;
  }
  function addCone(grp, r, h, mat, pos) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), mat);
    if (pos) m.position.copy(pos);
    grp.add(m);
    return m;
  }
  function addPanel(grp, w, h, mat, pos, rot) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, h), mat);
    if (pos) m.position.copy(pos);
    if (rot) m.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
    grp.add(m);
    return m;
  }
  function addDish(grp, r, mat, pos, tilt) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), mat);
    if (pos) m.position.copy(pos);
    m.rotation.x = tilt != null ? tilt : -0.6;
    grp.add(m);
    return m;
  }

  /* ---------- 各 class 配方 ---------- */
  const builders = {
    station_modular(grp, s, tint) {
      const metal = matMetal(0xb8c4d8, tint, 0.22);
      const accent = matMetal(tint, tint, 0.35);
      addCore(grp, 0.55 * s, 2.6 * s, metal);
      addRing(grp, 1.5 * s, 0.18 * s, accent);
      addBox(grp, 2.4 * s, 0.15 * s, 0.15 * s, metal, new THREE.Vector3(0, 0.3 * s, 0));
      addBox(grp, 0.15 * s, 0.15 * s, 2.4 * s, metal, new THREE.Vector3(0, -0.3 * s, 0));
      addPanel(grp, 1.8 * s, 0.7 * s, matMetal(0x3a4a60, tint, 0.1), new THREE.Vector3(1.4 * s, 0, 0));
      addPanel(grp, 1.8 * s, 0.7 * s, matMetal(0x3a4a60, tint, 0.1), new THREE.Vector3(-1.4 * s, 0, 0));
      grp.userData.spin = 0.15;
    },
    habitat(grp, s, tint) {
      const metal = matMetal(0xd0d6e0, tint, 0.15);
      const glow = matGlow(tint, 0.35);
      addRing(grp, 2.4 * s, 0.35 * s, metal);
      addRing(grp, 2.4 * s, 0.12 * s, glow);
      addCore(grp, 0.25 * s, 1.2 * s, metal);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        addBox(grp, 2.2 * s, 0.08 * s, 0.1 * s, metal, new THREE.Vector3(Math.cos(a) * 1.1 * s, 0, Math.sin(a) * 1.1 * s))
          .rotation.y = a;
      }
      grp.userData.spin = 0.35;
    },
    shipyard(grp, s, tint) {
      const metal = matMetal(0x7a8a9e, tint, 0.2);
      const frame = matMetal(0x5fd6e6, tint, 0.4);
      // 干船坞框
      [[-1, 0, 0], [1, 0, 0]].forEach(p => {
        addBox(grp, 0.18 * s, 2.8 * s, 3.2 * s, metal, new THREE.Vector3(p[0] * 1.5 * s, 0, 0));
      });
      addBox(grp, 3.2 * s, 0.18 * s, 3.2 * s, metal, new THREE.Vector3(0, 1.4 * s, 0));
      addBox(grp, 3.2 * s, 0.18 * s, 3.2 * s, metal, new THREE.Vector3(0, -1.4 * s, 0));
      // 龙骨半透明
      addBox(grp, 0.5 * s, 0.4 * s, 2.4 * s, matGlow(tint, 0.25));
      addSphere(grp, 0.2 * s, frame, new THREE.Vector3(0, 0, 1.6 * s));
      grp.userData.pulse = true;
    },
    array(grp, s, tint) {
      const metal = matMetal(0xc8d0dc, tint, 0.12);
      const dishM = matMetal(0xe8eef8, tint, 0.3);
      addCore(grp, 0.2 * s, 1.6 * s, metal);
      addDish(grp, 1.4 * s, dishM, new THREE.Vector3(0, 0.9 * s, 0), -0.5);
      addDish(grp, 0.55 * s, dishM, new THREE.Vector3(1.1 * s, 0.2 * s, 0.3 * s), -0.8);
      addDish(grp, 0.55 * s, dishM, new THREE.Vector3(-1.1 * s, 0.2 * s, 0.3 * s), -0.8);
      addDish(grp, 0.4 * s, dishM, new THREE.Vector3(0, -0.4 * s, 1.0 * s), 0.3);
      grp.userData.spin = 0.05;
    },
    constellation(grp, s, tint) {
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 2.2 * s;
        const node = addSphere(grp, 0.18 * s, matMetal(tint, tint, 0.55),
          new THREE.Vector3(Math.cos(a) * r, Math.sin(a * 2) * 0.25 * s, Math.sin(a) * r));
        node.userData.isNode = true;
      }
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.0 * s, 2.15 * s, 64),
        matGlow(tint, 0.22)
      );
      ring.rotation.x = Math.PI / 2;
      grp.add(ring);
      grp.userData.spin = 0.08;
    },
    mining(grp, s, tint) {
      const metal = matMetal(0xa07850, tint, 0.15);
      const rust = matMetal(0xc98452, tint, 0.25);
      addCore(grp, 0.5 * s, 1.4 * s, metal);
      addSphere(grp, 0.7 * s, rust, new THREE.Vector3(0, -0.9 * s, 0));
      // 锚爪
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const claw = addBox(grp, 0.15 * s, 1.2 * s, 0.25 * s, metal,
          new THREE.Vector3(Math.cos(a) * 0.9 * s, -1.3 * s, Math.sin(a) * 0.9 * s));
        claw.rotation.z = Math.cos(a) * 0.5;
        claw.rotation.x = Math.sin(a) * 0.5;
      }
      addCone(grp, 0.25 * s, 0.6 * s, matMetal(0xffaa66, tint, 0.4), new THREE.Vector3(0, 1.0 * s, 0));
    },
    depot(grp, s, tint) {
      const metal = matMetal(0x9aa8b8, tint, 0.12);
      const tank = matMetal(0xe6c86a, tint, 0.2);
      addBox(grp, 0.2 * s, 0.2 * s, 2.4 * s, metal);
      addSphere(grp, 0.7 * s, tank, new THREE.Vector3(-1.0 * s, 0, 0));
      addSphere(grp, 0.7 * s, tank, new THREE.Vector3(1.0 * s, 0, 0));
      addSphere(grp, 0.5 * s, tank, new THREE.Vector3(0, 0.85 * s, 0));
      addSphere(grp, 0.5 * s, tank, new THREE.Vector3(0, -0.85 * s, 0));
      // 警告环
      addRing(grp, 1.3 * s, 0.06 * s, matGlow(0xffaa00, 0.4));
    },
    stellar_infra(grp, s, tint) {
      // 局部弧瓣（绕本地 Y）
      const arcM = matGlow(tint, 0.4);
      const solid = matMetal(0xffd9a0, tint, 0.25);
      for (let i = 0; i < 5; i++) {
        const a0 = (i / 5) * Math.PI * 0.9 - 0.4;
        const mesh = new THREE.Mesh(
          new THREE.TorusGeometry(3.2 * s, 0.12 * s, 6, 24, Math.PI * 0.35),
          i % 2 ? arcM : solid
        );
        mesh.rotation.x = Math.PI / 2;
        mesh.rotation.z = a0;
        grp.add(mesh);
      }
      addSphere(grp, 0.35 * s, matMetal(0xfff0c8, tint, 0.6));
      grp.userData.spin = 0.04;
    },
    gate(grp, s, tint) {
      const metal = matMetal(0x6a5a90, tint, 0.3);
      const portal = matGlow(tint.clone ? tint : new THREE.Color(0x8b7cf6), 0.45);
      addRing(grp, 2.6 * s, 0.28 * s, metal, 0);
      addRing(grp, 2.6 * s, 0.1 * s, matGlow(0xb8a0ff, 0.6), 0);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(2.3 * s, 48), portal);
      grp.add(disc);
      const disc2 = disc.clone();
      disc2.rotation.y = Math.PI;
      grp.add(disc2);
      grp.userData.spin = 0.2;
      grp.userData.spinAxis = 'z';
    },
    tether(grp, s, tint) {
      const metal = matMetal(0xc0c8d4, tint, 0.15);
      addSphere(grp, 0.55 * s, metal);
      addRing(grp, 0.9 * s, 0.08 * s, matMetal(tint, tint, 0.35));
      // 下行缆（示意）
      const cable = addBox(grp, 0.06 * s, 4.5 * s, 0.06 * s, matGlow(tint, 0.35),
        new THREE.Vector3(0, -2.5 * s, 0));
      cable.material = matGlow(0x88aacc, 0.4);
      addSphere(grp, 0.25 * s, metal, new THREE.Vector3(0, -4.6 * s, 0));
    },
    defense(grp, s, tint) {
      const metal = matMetal(0x6a7080, tint, 0.2);
      const alert = matMetal(0xe07050, tint, 0.55);
      addBox(grp, 2.2 * s, 0.35 * s, 2.2 * s, metal);
      addBox(grp, 0.9 * s, 0.5 * s, 0.9 * s, metal, new THREE.Vector3(0, 0.4 * s, 0));
      addCone(grp, 0.2 * s, 1.1 * s, alert, new THREE.Vector3(0.6 * s, 0.9 * s, 0.6 * s));
      addCone(grp, 0.2 * s, 1.1 * s, alert, new THREE.Vector3(-0.6 * s, 0.9 * s, -0.6 * s));
      addSphere(grp, 0.15 * s, matGlow(0xff4422, 0.8), new THREE.Vector3(0, 0.7 * s, 0));
      grp.userData.pulse = true;
    },
    lab(grp, s, tint) {
      const metal = matMetal(0xd8e4f0, tint, 0.18);
      const glass = matGlow(0xaee6f5, 0.4);
      addCore(grp, 0.35 * s, 2.8 * s, metal);
      addBox(grp, 1.6 * s, 0.2 * s, 0.2 * s, metal, new THREE.Vector3(0.9 * s, 0.5 * s, 0));
      addBox(grp, 1.6 * s, 0.2 * s, 0.2 * s, metal, new THREE.Vector3(-0.9 * s, -0.3 * s, 0));
      addSphere(grp, 0.45 * s, glass, new THREE.Vector3(0, 1.5 * s, 0));
      addDish(grp, 0.5 * s, metal, new THREE.Vector3(0.8 * s, -0.8 * s, 0), 0.4);
      grp.userData.spin = 0.06;
    },
    ark(grp, s, tint) {
      const metal = matMetal(0xc4a86a, tint, 0.2);
      const band = matMetal(0x5fd6e6, tint, 0.3);
      addCore(grp, 0.9 * s, 4.5 * s, metal);
      addRing(grp, 1.5 * s, 0.2 * s, band, Math.PI / 2);
      addRing(grp, 1.5 * s, 0.2 * s, band, Math.PI / 2).position.y = 1.2 * s;
      addRing(grp, 1.5 * s, 0.2 * s, band, Math.PI / 2).position.y = -1.2 * s;
      addSphere(grp, 0.7 * s, matMetal(0xffe0b0, tint, 0.25), new THREE.Vector3(0, 2.6 * s, 0));
      addSphere(grp, 0.7 * s, matMetal(0xffe0b0, tint, 0.25), new THREE.Vector3(0, -2.6 * s, 0));
      grp.userData.spin = 0.04;
    },
    observatory_bh(grp, s, tint) {
      const metal = matMetal(0x4a4060, 0x8b7cf6, 0.35);
      addBox(grp, 1.6 * s, 0.25 * s, 1.0 * s, metal);
      addCore(grp, 0.2 * s, 1.2 * s, metal);
      addDish(grp, 0.9 * s, matMetal(0xb8a0ff, 0x8b7cf6, 0.4), new THREE.Vector3(0, 0.6 * s, 0), -1.0);
      const beam = addBox(grp, 0.08 * s, 0.08 * s, 3.5 * s, matGlow(0x8b7cf6, 0.5),
        new THREE.Vector3(0, 0.3 * s, 1.8 * s));
      grp.add(beam);
      grp.userData.pulse = true;
    },
    refinery(grp, s, tint) {
      const metal = matMetal(0x8a9080, tint, 0.15);
      addCore(grp, 0.6 * s, 2.0 * s, metal);
      addCore(grp, 0.35 * s, 2.6 * s, matMetal(0x6a7060, tint, 0.2)).position.x = 0.9 * s;
      addCore(grp, 0.35 * s, 2.2 * s, matMetal(0x6a7060, tint, 0.2)).position.x = -0.9 * s;
      addSphere(grp, 0.4 * s, matMetal(0x70c0a0, tint, 0.3), new THREE.Vector3(0, 1.3 * s, 0));
      addBox(grp, 2.2 * s, 0.15 * s, 0.15 * s, metal, new THREE.Vector3(0, 0.5 * s, 0));
    },
    farm_orbit(grp, s, tint) {
      const metal = matMetal(0xa0b898, tint, 0.15);
      const green = matGlow(0x6fd08c, 0.45);
      addRing(grp, 2.0 * s, 0.4 * s, metal);
      addRing(grp, 2.0 * s, 0.15 * s, green);
      addCore(grp, 0.3 * s, 1.0 * s, metal);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        addPanel(grp, 0.8 * s, 0.5 * s, green,
          new THREE.Vector3(Math.cos(a) * 1.6 * s, 0, Math.sin(a) * 1.6 * s),
          { y: a });
      }
      grp.userData.spin = 0.12;
    },
    hospital(grp, s, tint) {
      const metal = matMetal(0xe8eef5, tint, 0.12);
      const cross = matMetal(0xe07070, tint, 0.5);
      addCore(grp, 0.55 * s, 2.0 * s, metal);
      addBox(grp, 1.4 * s, 0.25 * s, 0.25 * s, cross, new THREE.Vector3(0, 0.3 * s, 0));
      addBox(grp, 0.25 * s, 1.4 * s, 0.25 * s, cross, new THREE.Vector3(0, 0.3 * s, 0));
      addSphere(grp, 0.4 * s, matGlow(0xffffff, 0.35), new THREE.Vector3(0, 1.3 * s, 0));
      addPanel(grp, 1.5 * s, 0.6 * s, matMetal(0xa0c0e0, tint, 0.1), new THREE.Vector3(1.2 * s, 0, 0));
    },
    prison(grp, s, tint) {
      const metal = matMetal(0x4a4a55, tint, 0.1);
      const bar = matMetal(0x8a8090, tint, 0.2);
      addCore(grp, 0.9 * s, 2.2 * s, metal);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        addBox(grp, 0.08 * s, 2.0 * s, 0.08 * s, bar,
          new THREE.Vector3(Math.cos(a) * 1.0 * s, 0, Math.sin(a) * 1.0 * s));
      }
      addRing(grp, 1.15 * s, 0.1 * s, matMetal(0x7050a0, tint, 0.3));
    },
    embassy(grp, s, tint) {
      const metal = matMetal(0xd8c8a0, tint, 0.2);
      addCore(grp, 0.5 * s, 1.8 * s, metal);
      addBox(grp, 2.0 * s, 0.8 * s, 1.2 * s, metal, new THREE.Vector3(0, -0.2 * s, 0));
      // 礼仪环
      addRing(grp, 1.4 * s, 0.08 * s, matMetal(tint, tint, 0.4));
      addSphere(grp, 0.3 * s, matGlow(tint, 0.5), new THREE.Vector3(0, 1.2 * s, 0));
      addPanel(grp, 1.2 * s, 0.5 * s, matMetal(0xffffff, tint, 0.15), new THREE.Vector3(1.3 * s, 0.3 * s, 0));
    },
    factory(grp, s, tint) {
      const metal = matMetal(0x7a8490, tint, 0.15);
      addBox(grp, 2.4 * s, 1.2 * s, 1.6 * s, metal);
      addBox(grp, 1.0 * s, 1.8 * s, 1.0 * s, metal, new THREE.Vector3(-0.7 * s, 0.5 * s, 0));
      addCore(grp, 0.25 * s, 1.5 * s, matMetal(0x505860, tint, 0.2)).position.set(0.8 * s, 1.0 * s, 0.4 * s);
      addCore(grp, 0.25 * s, 1.2 * s, matMetal(0x505860, tint, 0.2)).position.set(0.8 * s, 0.9 * s, -0.4 * s);
      addSphere(grp, 0.2 * s, matGlow(0xff8844, 0.5), new THREE.Vector3(0.8 * s, 1.9 * s, 0.4 * s));
      grp.userData.pulse = true;
    },
    sensor_buoy(grp, s, tint) {
      const metal = matMetal(0xa0b0c8, tint, 0.25);
      addSphere(grp, 0.45 * s, metal);
      addCore(grp, 0.08 * s, 2.0 * s, metal);
      addCone(grp, 0.2 * s, 0.5 * s, matMetal(tint, tint, 0.5), new THREE.Vector3(0, 1.2 * s, 0));
      addRing(grp, 0.7 * s, 0.05 * s, matGlow(tint, 0.4));
      grp.userData.pulse = true;
      grp.userData.spin = 0.4;
    },
    fuel_tanker(grp, s, tint) {
      const tank = matMetal(0xd0a050, tint, 0.18);
      const metal = matMetal(0x8090a0, tint, 0.2);
      addCore(grp, 0.55 * s, 3.2 * s, tank);
      addCore(grp, 0.35 * s, 0.8 * s, metal).position.y = 1.8 * s;
      addCore(grp, 0.35 * s, 0.8 * s, metal).position.y = -1.8 * s;
      addPanel(grp, 1.6 * s, 0.5 * s, matMetal(0x3a4a60, tint, 0.1), new THREE.Vector3(1.0 * s, 0, 0));
      addPanel(grp, 1.6 * s, 0.5 * s, matMetal(0x3a4a60, tint, 0.1), new THREE.Vector3(-1.0 * s, 0, 0));
    },
    drydock_ring(grp, s, tint) {
      const metal = matMetal(0x6fd0e0, tint, 0.25);
      addRing(grp, 2.8 * s, 0.25 * s, metal);
      addRing(grp, 2.0 * s, 0.15 * s, matMetal(0x4a6070, tint, 0.2));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        addBox(grp, 0.12 * s, 0.12 * s, 0.9 * s, metal,
          new THREE.Vector3(Math.cos(a) * 2.4 * s, 0, Math.sin(a) * 2.4 * s));
      }
      addBox(grp, 0.4 * s, 0.3 * s, 1.5 * s, matGlow(tint, 0.3));
      grp.userData.spin = 0.1;
    },
    laser_comm(grp, s, tint) {
      const metal = matMetal(0xc0d0e8, tint, 0.2);
      addCore(grp, 0.25 * s, 1.4 * s, metal);
      addCone(grp, 0.35 * s, 0.9 * s, matMetal(tint, tint, 0.45), new THREE.Vector3(0, 1.0 * s, 0));
      // 激光束示意
      addBox(grp, 0.05 * s, 0.05 * s, 3.0 * s, matGlow(0x80ffd0, 0.55),
        new THREE.Vector3(0, 1.5 * s, 1.5 * s)).rotation.x = -0.4;
      addPanel(grp, 1.4 * s, 0.6 * s, matMetal(0x304050, tint, 0.1), new THREE.Vector3(0.9 * s, 0, 0));
      grp.userData.pulse = true;
    },
    mag_sail_yard(grp, s, tint) {
      const metal = matMetal(0x90a0b8, tint, 0.15);
      addCore(grp, 0.3 * s, 1.5 * s, metal);
      // 帆
      const sail = matGlow(tint, 0.3);
      addPanel(grp, 3.5 * s, 2.2 * s, sail, new THREE.Vector3(0, 0, 0), { y: 0.2 });
      addPanel(grp, 3.5 * s, 2.2 * s, sail, new THREE.Vector3(0, 0, 0), { y: -0.2 });
      addBox(grp, 0.1 * s, 0.1 * s, 2.5 * s, metal, new THREE.Vector3(1.6 * s, 0, 0));
      addBox(grp, 0.1 * s, 0.1 * s, 2.5 * s, metal, new THREE.Vector3(-1.6 * s, 0, 0));
      grp.userData.spin = 0.07;
    },
    cryo_vault(grp, s, tint) {
      const ice = matMetal(0xa8d8f0, tint, 0.2);
      const metal = matMetal(0x6080a0, tint, 0.15);
      addCore(grp, 0.8 * s, 2.4 * s, ice);
      addRing(grp, 1.0 * s, 0.12 * s, metal);
      addRing(grp, 1.0 * s, 0.12 * s, metal).position.y = 0.7 * s;
      addRing(grp, 1.0 * s, 0.12 * s, metal).position.y = -0.7 * s;
      addSphere(grp, 0.35 * s, matGlow(0xc0e8ff, 0.4), new THREE.Vector3(0, 1.5 * s, 0));
    },
    terraformer(grp, s, tint) {
      const metal = matMetal(0x70a080, tint, 0.2);
      addCore(grp, 0.5 * s, 2.0 * s, metal);
      addCone(grp, 0.9 * s, 1.4 * s, matMetal(0x90c0a0, tint, 0.25), new THREE.Vector3(0, -1.4 * s, 0));
      // 喷流
      addCone(grp, 0.4 * s, 1.8 * s, matGlow(0x6fd08c, 0.4), new THREE.Vector3(0, -2.6 * s, 0));
      addRing(grp, 1.2 * s, 0.1 * s, matGlow(0xa0e0c0, 0.35));
      grp.userData.pulse = true;
    },
    essence_spire(grp, s, tint) {
      const crystal = matMetal(0xc8a0ff, 0xb080ff, 0.55);
      const glow = matGlow(0xd0a0ff, 0.5);
      addCone(grp, 0.5 * s, 3.2 * s, crystal, new THREE.Vector3(0, 0.4 * s, 0));
      addCone(grp, 0.35 * s, 1.6 * s, crystal, new THREE.Vector3(0.7 * s, -0.2 * s, 0.3 * s)).rotation.z = 0.5;
      addCone(grp, 0.35 * s, 1.6 * s, crystal, new THREE.Vector3(-0.7 * s, -0.2 * s, -0.3 * s)).rotation.z = -0.5;
      addSphere(grp, 0.45 * s, glow, new THREE.Vector3(0, -0.9 * s, 0));
      addRing(grp, 1.3 * s, 0.08 * s, glow);
      grp.userData.spin = 0.25;
      grp.userData.pulse = true;
    },
    generic(grp, s, tint) {
      const metal = matMetal(0x9aa2b0, tint, 0.15);
      addCore(grp, 0.5 * s, 2.0 * s, metal);
      addRing(grp, 1.1 * s, 0.15 * s, matMetal(tint, tint, 0.25));
      addSphere(grp, 0.3 * s, metal, new THREE.Vector3(0, 1.2 * s, 0));
      grp.userData.spin = 0.1;
    }
  };

  function applyStatus(grp, status) {
    if (!status || status === 'active') return;
    grp.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const m = o.material;
      if (status === 'building' && m.opacity == null) {
        m.transparent = true;
        m.opacity = 0.45;
        m.wireframe = true;
      } else if (status === 'damaged') {
        if (m.color) m.color.offsetHSL(0, -0.2, -0.15);
        if (m.emissiveIntensity != null) m.emissiveIntensity *= 0.4;
      } else if (status === 'abandoned') {
        if (m.emissiveIntensity != null) m.emissiveIntensity = 0;
        if (m.color) m.color.offsetHSL(0, -0.4, -0.1);
      } else if (status === 'destroyed') {
        m.transparent = true;
        m.opacity = 0.25;
      }
    });
  }

  function create(b) {
    const cls = resolveClass(b) || 'generic';
    const visual = b.visual || {};
    const scaleKey = visual.scale || 'medium';
    const s = (b.radius || 2) * 0.55 * (SCALE_MUL[scaleKey] || 1);
    const tint = tintOf(b);
    const grp = new THREE.Group();
    grp.name = 'facility:' + (b.id || cls);
    const builder = builders[cls] || builders.generic;
    builder(grp, s, tint);
    if (visual.essenceAura && cls !== 'essence_spire') {
      addRing(grp, 2.0 * s, 0.06 * s, matGlow(0xc8a0ff, 0.35));
    }
    applyStatus(grp, visual.status || (b.flags && b.flags.status));
    grp.userData.facilityClass = cls;
    grp.userData.isFacility = true;
    return grp;
  }

  function makeUpdater(entry) {
    return function (t) {
      const g = entry.mesh;
      if (!g || !g.userData) return;
      if (g.userData.spin) {
        const axis = g.userData.spinAxis || 'y';
        g.rotation[axis] += g.userData.spin * 0.01;
      }
      if (g.userData.pulse) {
        const pulse = 0.7 + 0.3 * Math.sin(t * 3);
        g.traverse(o => {
          if (o.isMesh && o.material && o.material.emissiveIntensity != null && o.material.emissiveIntensity > 0.3) {
            o.material.emissiveIntensity = 0.35 * pulse + 0.2;
          }
        });
      }
    };
  }

  return {
    CLASSES,
    isFacility,
    resolveClass,
    create,
    makeUpdater
  };
})();
