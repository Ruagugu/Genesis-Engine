/* ============================================================
   创世引擎 · view.planet.js — 星球地图
   六边形地块 / 文明疆域 / 大气层 / 星链卫星壳 / 轨道站 / 昼夜
   ============================================================ */
window.GE = window.GE || {};
GE.views = GE.views || {};

GE.views.planet = (function () {
  const R = 100;                 // 星球半径
  const D2R = Math.PI / 180;

  const view = {
    id: 'planet', name: '星球',
    scene: null, camera: null, rig: null,
    _built: false
  };

  let env, labels;
  let sunDir, sunLight, ambient;
  let globe, clouds, atmo, glow, starfield;
  let terrainMesh, regionMesh, ownershipMesh, regionBorders, politicalBorders, assetPoints, hoverHex;
  let faceTileIds = [];
  let satShell = null, station = null, ships = [];
  let planetFacilities = [];    // [{ id, body, group, alt, inc, a, speed, mesh }]
  let raycaster, pointer, downPos;
  let selected = null;          // 当前选中 {type, civId/obj}
  let time = 0;
  let currentBodyId = null;
  let pointerBound = false;

  /** 宇宙半长轴 a → 星球视图轨道高度（相对 R） */
  function universeAToPlanetAlt(a, body) {
    const br = Math.max(1, (body && body.radius) || 8);
    // a/br ≈ 1 贴地表；常见近轨 1.4～4；钳制在球外可见带
    const ratio = Math.max(1.12, Math.min(4.2, a / br));
    return R * ratio;
  }

  /** 是否算「近轨」、应在本星球视图显示 */
  function isNearOrbitFacility(fac, bodyId) {
    if (!fac || fac.parent !== bodyId) return false;
    if (!(fac.flags && fac.flags.artificial) && !(fac.visual && fac.visual.class)) {
      if (!['空间站', '轨道设施', '星门', '采矿站', '轨道农场', '防御平台'].includes(fac.type)) return false;
    }
    const a = fac.orbit && fac.orbit.a;
    if (a == null) return false;
    const body = (GE.data.spaceBodies || []).find(b => b.id === bodyId);
    const br = Math.max(1, (body && body.radius) || 8);
    // 超过约 5 倍行星半径的壳层视为远轨/星际，星球视图不画
    return a / br <= 5.0;
  }

  function activeSurfaceDef() {
    return (GE.worldState && GE.worldState.def) || GE.data.strategicMap;
  }
  function activeBody() {
    const id = currentBodyId || (GE.app && GE.app.state && GE.app.state.activeBodyId) || 'gaiya';
    return (GE.data.spaceBodies || []).find(b => b.id === id) || null;
  }
  function catalog() {
    const def = activeSurfaceDef();
    return {
      terrain: def.terrainCatalog || GE.data.terrainCatalog || GE.data.strategicMap.terrainCatalog,
      resource: def.resourceCatalog || GE.data.resourceCatalog || GE.data.strategicMap.resourceCatalog,
      building: def.buildingCatalog || GE.data.buildingCatalog || GE.data.strategicMap.buildingCatalog
    };
  }

  /* ============ 初始化 ============ */
  view.init = function (e) {
    env = e; labels = e.labels;
    view.scene = new THREE.Scene();
    view.camera = new THREE.PerspectiveCamera(42, e.width / e.height, 1, 8000);
    view.rig = new GE.CameraRig(view.camera, e.dom, {
      radius: 300, minRadius: 150, maxRadius: 700,
      theta: 0.9, phi: 1.15, autoRotate: 0.03, damp: 6
    });

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    sunDir = new THREE.Vector3(1, 0.25, 0.4).normalize();
    sunLight = new THREE.DirectionalLight(0xfff2dd, 1.5);
    sunLight.position.copy(sunDir).multiplyScalar(500);
    ambient = new THREE.AmbientLight(0x2a3550, 0.85);
    view.scene.add(sunLight, ambient);

    buildBackground();
    buildGlobe();
    buildAtmosphere();
    buildClouds();
    buildHoverMarker();
    if (!pointerBound) { bindPointer(); pointerBound = true; }

    // 默认加载当前激活表面（SurfaceRegistry 在 boot 中已 activate）
    const bodyId = (GE.app && GE.app.state && GE.app.state.activeBodyId)
      || (GE.surfaces && GE.surfaces.activeBodyId)
      || 'gaiya';
    view.loadSurface(bodyId, { silent: true });

    view._built = true;
    return view;
  };

  /**
   * 切换到指定天体的战略表面（幂等）。
   * @param {string} bodyId
   * @param {{ silent?: boolean, unloadPrevious?: boolean }} opts
   */
  view.loadSurface = function (bodyId, opts) {
    opts = opts || {};
    if (!bodyId) bodyId = 'gaiya';
    if (!GE.surfaces) throw new Error('SurfaceRegistry not loaded');
    if (!GE.surfaces.isLandable(GE.data.spaceBodies.find(b => b.id === bodyId))) {
      throw new Error('body not landable: ' + bodyId);
    }
    if (currentBodyId === bodyId && terrainMesh) {
      // 已是当前表面：仅确保门面绑定
      GE.surfaces.activate(bodyId);
      return view;
    }

    const previousBodyId = currentBodyId;
    const previousEntry = previousBodyId && GE.surfaces.get(previousBodyId);
    const targetEntry = GE.surfaces.ensure(bodyId);
    try {
      GE.surfaces.activate(bodyId);
      currentBodyId = bodyId;
      if (GE.app && GE.app.state) {
        GE.app.state.activeBodyId = bodyId;
        GE.app.state.activeSurfaceId = GE.surfaces.activeSurfaceId;
      }

      disposeStrategicLayers();
      clearSurfaceLabels();
      selected = null;
      if (GE.app && GE.app.clearSelection) GE.app.clearSelection();
      buildStrategicMap();
      buildOrbitalsForBody(bodyId);
      buildLabels();
      applyGlobePalette(bodyId);
      // 切换表面后恢复应用层开关状态（尤其是已关闭的图层）
      if (view._built && GE.app && GE.app.state && GE.app.state.layer) {
        Object.entries(GE.app.state.layer).forEach(([key, on]) => view.setLayer(key, on));
      }

      if (view.rig) view.rig.flyTo({ radius: 300, target: new THREE.Vector3() }, opts.silent ? 0 : 1.0);
      if (GE.app && GE.app.refreshPlanetHud) GE.app.refreshPlanetHud();
      if (opts.unloadPrevious && previousEntry && previousEntry !== targetEntry) {
        GE.surfaces.unload(previousEntry.surfaceId);
      }
      return view;
    } catch (err) {
      if (previousEntry && previousEntry !== targetEntry) {
        GE.surfaces.activate(previousEntry.bodyId);
        currentBodyId = previousEntry.bodyId;
        disposeStrategicLayers();
        clearSurfaceLabels();
        buildStrategicMap();
        buildOrbitalsForBody(previousEntry.bodyId);
        buildLabels();
        applyGlobePalette(previousEntry.bodyId);
        if (GE.app && GE.app.refreshPlanetHud) GE.app.refreshPlanetHud();
      }
      throw err;
    }
  };

  function disposeStrategicLayers() {
    const disposeObj = (o) => {
      if (!o) return;
      if (o.parent) o.parent.remove(o);
      o.traverse && o.traverse(ch => {
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) {
          if (Array.isArray(ch.material)) ch.material.forEach(m => m.dispose && m.dispose());
          else if (ch.material.dispose) ch.material.dispose();
        }
      });
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose && m.dispose());
        else if (o.material.dispose) o.material.dispose();
      }
    };
    [terrainMesh, regionMesh, ownershipMesh, regionBorders, politicalBorders, assetPoints].forEach(disposeObj);
    terrainMesh = regionMesh = ownershipMesh = regionBorders = politicalBorders = assetPoints = null;
    faceTileIds = [];
    view._capitals = [];
    disposeOrbitals();
  }

  function disposeOrbitals() {
    if (satShell) {
      if (satShell.orbitGroup && satShell.orbitGroup.parent) satShell.orbitGroup.parent.remove(satShell.orbitGroup);
      if (satShell.satMesh && satShell.satMesh.parent) satShell.satMesh.parent.remove(satShell.satMesh);
      if (satShell.ringMesh && satShell.ringMesh.parent) satShell.ringMesh.parent.remove(satShell.ringMesh);
      if (satShell.shellGlow && satShell.shellGlow.parent) satShell.shellGlow.parent.remove(satShell.shellGlow);
      satShell = null;
    }
    planetFacilities.forEach(f => {
      if (f.group && f.group.parent) f.group.parent.remove(f.group);
      if (f.orbitLine && f.orbitLine.parent) f.orbitLine.parent.remove(f.orbitLine);
      if (f.group) {
        f.group.traverse(ch => {
          if (ch.geometry) ch.geometry.dispose();
          if (ch.material) {
            if (Array.isArray(ch.material)) ch.material.forEach(m => m.dispose && m.dispose());
            else if (ch.material.dispose) ch.material.dispose();
          }
        });
      }
    });
    planetFacilities = [];
    station = null;
    ships.forEach(s => { if (s.mesh && s.mesh.parent) s.mesh.parent.remove(s.mesh); });
    ships = [];
  }

  function clearSurfaceLabels() {
    if (!labels || !labels.remove) return;
    (view._labelIds || []).forEach(id => labels.remove(id));
    view._labelIds = [];
  }

  function buildOrbitalsForBody(bodyId) {
    buildNearOrbitFacilities(bodyId);
    // 星链壳：有 constellation 近轨设施或盖亚联邦叙事时显示
    const hasConstellation = planetFacilities.some(f => f.cls === 'constellation');
    if (bodyId === 'gaiya' || hasConstellation) {
      buildSatelliteShell(bodyId);
    }
    // 舰船仅在「主站」存在时往返（兼容旧 HUD）
    if (station) buildShipsForStation();
  }

  function buildNearOrbitFacilities(bodyId) {
    planetFacilities = [];
    station = null;
    // 与宇宙图共用程序化分壳（幂等）；保证 parent/a 已排布
    if (GE.facilityLayout && GE.data && Array.isArray(GE.data.spaceBodies)) {
      GE.facilityLayout.apply(GE.data.spaceBodies, {
        seed: (GE.data.world && GE.data.world.seed) || 20260723
      });
    }
    const body = (GE.data.spaceBodies || []).find(b => b.id === bodyId);
    const list = (GE.data.spaceBodies || []).filter(b => isNearOrbitFacility(b, bodyId));
    // 内壳优先显示顺序；星座不占独立大 mesh（用星链壳表达）
    list.sort((a, b) => {
      const aa = (a.orbit && a.orbit.a) || 0;
      const bb = (b.orbit && b.orbit.a) || 0;
      return aa - bb;
    });

    list.forEach((fac, idx) => {
      const cls = (GE.facilityMesh && GE.facilityMesh.resolveClass)
        ? GE.facilityMesh.resolveClass(fac)
        : ((fac.visual && fac.visual.class) || 'generic');

      // 星座：由星链壳 + 标签表达，不重复画一坨环
      if (cls === 'constellation') {
        planetFacilities.push({
          id: fac.id, body: fac, cls, group: null, alt: 0, inc: 0, a: 0, speed: 0,
          isConstellation: true
        });
        return;
      }

      let group;
      if (GE.facilityMesh && GE.facilityMesh.create) {
        group = GE.facilityMesh.create(fac);
        // 宇宙图 mesh 偏小，星球视图放大到可读
        const scale = cls === 'habitat' || cls === 'drydock_ring' ? 3.2
          : cls === 'ark' ? 2.4
          : cls === 'tether' ? 2.8
          : 2.6;
        group.scale.setScalar(scale);
      } else {
        group = new THREE.Group();
        const core = new THREE.Mesh(
          new THREE.CylinderGeometry(1.6, 1.6, 7, 12),
          new THREE.MeshStandardMaterial({ color: 0xb8c4d8, metalness: 0.8, roughness: 0.35, emissive: 0x223040 })
        );
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(4.4, 0.5, 10, 40),
          new THREE.MeshStandardMaterial({ color: 0x8fa4c0, metalness: 0.85, roughness: 0.3, emissive: 0x1a2a3a })
        );
        ring.rotation.x = Math.PI / 2;
        group.add(core, ring);
      }
      group.name = 'facility:' + fac.id;
      group.userData.bodyId = fac.id;
      group.userData.facilityId = fac.id;

      const o = fac.orbit || {};
      const alt = universeAToPlanetAlt(o.a || 16, body);
      const inc = ((o.inc != null ? o.inc : 12) * D2R);
      const phase = o.phase != null ? o.phase : (idx * 0.9);
      const speed = 0.12 / Math.pow(Math.max(alt / R, 1.1), 1.4);

      // 淡色轨道线（同倾角圆）
      const pts = [];
      for (let i = 0; i <= 96; i++) {
        pts.push(orbitPos(alt, inc, (i / 96) * Math.PI * 2, new THREE.Vector3()));
      }
      const orbitLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: fac.color || 0x5fd6e6,
          transparent: true,
          opacity: 0.18,
          blending: THREE.AdditiveBlending
        })
      );

      const entry = {
        id: fac.id,
        body: fac,
        cls,
        group,
        orbitLine,
        alt,
        inc,
        a: phase,
        speed,
        isConstellation: false
      };
      if (GE.facilityMesh && GE.facilityMesh.makeUpdater) {
        entry.update = GE.facilityMesh.makeUpdater({ mesh: group });
      }
      planetFacilities.push(entry);
      view.scene.add(group, orbitLine);

      // 兼容旧逻辑：第一个模块站/空间站当作 station 主锚点
      if (!station && (cls === 'station_modular' || fac.type === '空间站' || fac.id === 'wangshu')) {
        station = entry;
      }
    });

    // 无模块站时仍可用第一个实体设施作舰船锚点
    if (!station) {
      station = planetFacilities.find(f => f.group) || null;
    }
  }

  function buildShipsForStation() {
    ships = [];
    for (let i = 0; i < 3; i++) {
      const ship = new THREE.Mesh(
        new THREE.ConeGeometry(0.7, 2.4, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0 })
      );
      view.scene.add(ship);
      ships.push({ mesh: ship, t: i / 3, speed: 0.05 + i * 0.012 });
    }
  }

  /**
   * 按天体 type + climateProfile 解析程序化地表风格。
   * style: 0 类地宜居 · 1 干旱岩质 · 2 气冷卫星 · 3 寒冷矮行星
   */
  function resolveBodyVisual(body) {
    const cp = (body && body.climateProfile) || {};
    const hydro = cp.hydrosphere != null ? cp.hydrosphere : 0.37;
    const temp = cp.meanTemp || 'temperate';
    const energy = cp.energyAffinity != null ? cp.energyAffinity : 0.4;
    const type = (body && body.type) || '类地行星';
    const seed = (body && (body.surfaceSeed != null ? body.surfaceSeed : body.flags && body.flags.seed)) || 0;
    // 种子 → 着色器噪声偏移
    const seedOff = new THREE.Vector3(
      ((seed % 97) / 97) * 40 - 20,
      (((seed / 97) | 0) % 53) / 53 * 40 - 20,
      (((seed / 5141) | 0) % 71) / 71 * 40 - 20
    );
    const base = new THREE.Color((body && body.color) || '#4fa8e0');

    let style = 0;
    if (type === '类地行星' || (type === '岩质行星' && hydro > 0.25 && temp === 'temperate')) style = 0;
    else if (type === '岩质行星' || temp === 'hot') style = 1;
    else if (type === '卫星') style = 2;
    else if (type === '矮行星' || temp === 'frigid') style = 3;
    else if (type === '冰巨星') style = 3;
    else style = 1;

    // 大气 / 云 / 光照
    let hasAtmo = 1, cloudAmount = 0.55, atmoCol = new THREE.Color(0x6fc3ff);
    let ambientI = 0.85, sunI = 1.5, rimCol = new THREE.Color(0x336699);
    if (style === 0) {
      hasAtmo = 1; cloudAmount = Math.min(0.75, 0.25 + hydro * 1.1);
      atmoCol = new THREE.Color(0x6fc3ff); rimCol = new THREE.Color(0x3377aa);
      ambientI = 0.85; sunI = 1.5;
    } else if (style === 1) {
      hasAtmo = hydro > 0.04 ? 0.55 : 0.15;
      cloudAmount = hydro > 0.1 ? 0.12 : 0.0;
      atmoCol = base.clone().lerp(new THREE.Color(0xffaa66), 0.55);
      rimCol = new THREE.Color(0xaa5522);
      ambientI = 1.05; sunI = 1.95;
    } else if (style === 2) {
      hasAtmo = 0.0; cloudAmount = 0.0;
      atmoCol = new THREE.Color(0x888899); rimCol = new THREE.Color(0x444455);
      ambientI = 0.5; sunI = 1.15;
    } else {
      hasAtmo = 0.2; cloudAmount = 0.05;
      atmoCol = new THREE.Color(0x6688aa); rimCol = new THREE.Color(0x334455);
      ambientI = 0.48; sunI = 1.05;
    }

    return {
      style, hydro, energy, seedOff, base,
      hasAtmo, cloudAmount, atmoCol, rimCol, ambientI, sunI, temp, type
    };
  }

  function applyGlobePalette(bodyId) {
    const body = GE.data.spaceBodies.find(b => b.id === bodyId);
    if (!body || !globe || !globe.material || !globe.material.uniforms) return;
    const v = resolveBodyVisual(body);
    const u = globe.material.uniforms;
    u.uStyle.value = v.style;
    u.uHydro.value = v.hydro;
    u.uEnergy.value = v.energy;
    u.uSeed.value.copy(v.seedOff);
    u.uBase.value.copy(v.base);
    u.uDark.value.copy(v.base.clone().multiplyScalar(0.35));
    u.uLight.value.copy(v.base.clone().lerp(new THREE.Color(0xffffff), 0.4));
    u.uRim.value.copy(v.rimCol);
    u.uHasAtmo.value = v.hasAtmo;

    if (ambient) ambient.intensity = v.ambientI;
    if (sunLight) {
      sunLight.intensity = v.sunI;
      if (v.style === 1) sunLight.color.setHex(0xffe0b0);
      else if (v.style === 2 || v.style === 3) sunLight.color.setHex(0xdde8ff);
      else sunLight.color.setHex(0xfff2dd);
    }

    if (clouds) {
      clouds.visible = v.cloudAmount > 0.05;
      if (clouds.material.uniforms) {
        clouds.material.uniforms.uAmount.value = v.cloudAmount;
        clouds.material.uniforms.uTint.value.copy(
          v.style === 1 ? new THREE.Color(0xffddaa) : new THREE.Color(0xffffff)
        );
      }
    }
    if (atmo) {
      atmo.visible = v.hasAtmo > 0.08;
      if (atmo.material.uniforms) {
        atmo.material.uniforms.uAtmo.value.copy(v.atmoCol);
        atmo.material.uniforms.uStrength.value = v.hasAtmo;
      }
    }
    if (glow) {
      glow.visible = v.hasAtmo > 0.08;
      if (glow.material.uniforms && glow.material.uniforms.uGlow) {
        glow.material.uniforms.uGlow.value.copy(v.atmoCol);
      }
    }
  }

  /* ============ 背景星空 ============ */
  function buildBackground() {
    const geo = new THREE.SphereGeometry(4000, 32, 32);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec3 vDir;uniform float uTime;${GE.glsl.noise}${GE.glsl.starfield}
        void main(){vec3 c=starfield(normalize(vDir),uTime*0.02);gl_FragColor=vec4(c,1.0);}`
    });
    starfield = new THREE.Mesh(geo, mat);
    view.scene.add(starfield);
  }

  /* ============ 星球本体：按 type/climate 程序化地表 ============
     uStyle 0 类地 · 1 干旱岩质 · 2 气冷卫星 · 3 寒冷矮行星 */
  function buildGlobe() {
    const geo = new THREE.SphereGeometry(R, 96, 96);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSun: { value: sunDir },
        uTime: { value: 0 },
        uStyle: { value: 0 },
        uHydro: { value: 0.37 },
        uEnergy: { value: 0.55 },
        uSeed: { value: new THREE.Vector3(5, 0, 0) },
        uBase: { value: new THREE.Color(0x4fa8e0) },
        uDark: { value: new THREE.Color(0x1a3a55) },
        uLight: { value: new THREE.Color(0xa8d8f0) },
        uRim: { value: new THREE.Color(0x3377aa) },
        uHasAtmo: { value: 1.0 }
      },
      vertexShader: `
        varying vec3 vN; varying vec3 vW;
        void main(){ vN=normalize(normalMatrix*normal); vW=(modelMatrix*vec4(position,1.0)).xyz;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vN; varying vec3 vW;
        uniform vec3 uSun, uSeed, uBase, uDark, uLight, uRim;
        uniform float uTime, uStyle, uHydro, uEnergy, uHasAtmo;
        ${GE.glsl.noise}
        void main(){
          vec3 N=normalize(vN); vec3 V=normalize(cameraPosition-vW);
          vec3 p=normalize(vW);
          vec3 d=normalize(p + uSeed*0.001);
          float absLat=abs(d.y);
          float day=smoothstep(-0.08,0.25,dot(N,normalize(uSun)));
          vec3 H=normalize(normalize(uSun)+V);
          vec3 base;
          float landMask=1.0;
          float specMul=0.15;

          if(uStyle < 0.5){
            // —— 0 类地宜居：海陆 + 气候带 + 冰盖 ——
            float cont=fbm3(d*2.1+vec3(5.0,0.0,0.0),4);
            float detail=fbm3(d*6.5+vec3(0.0,9.0,0.0),4);
            float m=cont*0.72+detail*0.28;
            float sea=mix(0.62,0.42,clamp(uHydro*1.4,0.0,1.0));
            landMask=smoothstep(sea-0.04,sea+0.03,m);
            float elev=clamp((m-sea)/max(1.0-sea,0.001),0.0,1.0);
            float moist=fbm3(d*4.0+vec3(20.0,0.0,0.0),3);
            vec3 ocean=mix(vec3(0.03,0.09,0.17),vec3(0.06,0.18,0.30),fbm3(vW*0.03,4));
            ocean=mix(ocean,uBase.rgb*0.35,0.25);
            vec3 desert=vec3(0.72,0.62,0.38);
            vec3 plains=vec3(0.38,0.52,0.28);
            vec3 forest=vec3(0.18,0.38,0.22);
            vec3 hills=vec3(0.42,0.42,0.30);
            vec3 mountain=vec3(0.48,0.50,0.54);
            float arid=step(absLat,0.28)*step(moist,0.42);
            vec3 land=mix(plains,forest,smoothstep(0.45,0.62,moist));
            land=mix(land,desert,arid);
            land=mix(land,hills,smoothstep(0.45,0.60,elev));
            land=mix(land,mountain,smoothstep(0.62,0.82,elev));
            float ice=smoothstep(0.72,0.88,absLat);
            land=mix(land,vec3(0.86,0.90,0.94),ice);
            ocean=mix(ocean,vec3(0.70,0.78,0.88),smoothstep(0.82,0.95,absLat)*0.55);
            base=mix(ocean,land,landMask);
            specMul=0.55*(1.0-landMask*0.85);
          } else if(uStyle < 1.5){
            // —— 1 干旱岩质：琉璃荒漠 + 裂谷 + 偶见暗影盆地 ——
            float n=fbm3(d*3.2+vec3(1.0),5);
            float ridge=fbm3(d*8.0+vec3(4.0,0.0,2.0),4);
            float glass=smoothstep(0.55,0.85,n);
            float rift=smoothstep(0.72,0.9,abs(sin(d.y*18.0+ridge*4.0)));
            float shadow=smoothstep(0.55,0.9,absLat)*smoothstep(0.4,0.7,1.0-n);
            vec3 sand=mix(uDark.rgb,uBase.rgb,n);
            vec3 glaze=mix(uBase.rgb*1.1,uLight.rgb,glass);
            vec3 basalt=uDark.rgb*0.55;
            vec3 hot=mix(vec3(0.55,0.18,0.05),vec3(0.9,0.45,0.1),fbm3(d*12.0,3));
            base=mix(sand,glaze,glass*0.7);
            base=mix(base,basalt,rift*0.55);
            base=mix(base,hot,rift*smoothstep(0.5,0.9,ridge)*0.35*uEnergy);
            base=mix(base,uDark.rgb*0.7,shadow*0.5);
            // 极稀薄「海」：永影盆地暗色沉积
            landMask=1.0-shadow*0.15*step(0.05,uHydro);
            specMul=0.25*glass+0.08;
          } else if(uStyle < 2.5){
            // —— 2 气冷卫星：月海 + 撞击坑 + 高反照极影 ——
            float mare=fbm3(d*2.0+vec3(2.0),4);
            float craters=fbm3(d*14.0+vec3(0.0,3.0,0.0),5);
            float rim=smoothstep(0.62,0.78,craters)*smoothstep(0.88,0.72,craters);
            float pit=smoothstep(0.78,0.92,craters);
            float highlands=smoothstep(0.45,0.7,mare);
            vec3 mareC=mix(uDark.rgb*0.7,uBase.rgb*0.55,0.5);
            vec3 highlandC=mix(uBase.rgb,uLight.rgb,0.45);
            base=mix(mareC,highlandC,highlands);
            base=mix(base,uDark.rgb*0.4,pit*0.7);
            base=mix(base,uLight.rgb,rim*0.55);
            // 永久阴影坑：可能含水冰
            float psr=smoothstep(0.82,0.95,absLat)*smoothstep(0.55,0.8,1.0-mare);
            base=mix(base,vec3(0.75,0.82,0.9),psr*0.45);
            landMask=1.0;
            specMul=0.08+rim*0.12;
          } else {
            // —— 3 寒冷矮行星：暗冰壳 + 稀疏霜纹 + 微弱灵能晕 ——
            float n=fbm3(d*2.6+vec3(8.0),4);
            float frost=fbm3(d*9.0,4);
            float vein=smoothstep(0.65,0.85,abs(sin(d.x*22.0+d.z*18.0+n*3.0)));
            vec3 rock=mix(uDark.rgb*0.5,uBase.rgb*0.45,n);
            vec3 ice=mix(vec3(0.55,0.62,0.72),uLight.rgb,0.4);
            base=mix(rock,ice,smoothstep(0.4,0.75,frost)*0.55);
            base=mix(base,ice*1.15,smoothstep(0.7,0.95,absLat)*0.5);
            // 灵能亲和：微弱紫边脉
            base=mix(base,vec3(0.45,0.35,0.65),vein*uEnergy*0.35);
            landMask=1.0;
            specMul=0.2+frost*0.15;
          }

          float spec=pow(max(dot(N,H),0.0),uStyle<0.5?90.0:40.0)*specMul*day;
          vec3 col=base*(0.12+1.05*day)+vec3(1.0,0.95,0.82)*spec;
          // 边缘光（大气或尘埃晕）
          float fr=pow(1.0-max(dot(N,V),0.0),3.0);
          col+=uRim.rgb*fr*(0.25+0.55*uHasAtmo);
          gl_FragColor=vec4(col,1.0);
        }`
    });
    globe = new THREE.Mesh(geo, mat);
    globe.name = 'globe';
    view.scene.add(globe);
  }

  /* ============ 战略地块：共享边球面对偶网格 ============ */
  function buildStrategicMap() {
    GE.worldState.build();
    const tiles = GE.worldState.tiles;
    // 战略地块全部不铺实心地形色：区域/归属透明染色 + 边界线，星球贴图透出。
    const regionPositions = [], regionColors = [];
    const ownerPositions = [], ownerColors = [];
    const regionEdges = [], politicalEdges = [];
    const buildingMarks = []; // { n:[x,y,z], elev }
    const seenRegionEdges = new Set(), seenPoliticalEdges = new Set();
    const civColors = Object.fromEntries(GE.data.civs.map(c => [c.id, new THREE.Color(c.color)]));

    // 战略层贴在同一球面高度，不体现地形落差
    function elevScale() { return 1.004; }
    function addTriangle(pos, cols, a, b, c, color, scale) {
      [a, b, c].forEach(v => {
        pos.push(v[0] * scale, v[1] * scale, v[2] * scale);
        cols.push(color.r, color.g, color.b);
      });
    }
    function edgeKey(a, b) {
      const aa = a.map(v => v.toFixed(5)).join(','), bb = b.map(v => v.toFixed(5)).join(',');
      return aa < bb ? aa + '|' + bb : bb + '|' + aa;
    }
    function addEdge(target, a, b, scale) {
      target.push(a[0] * scale, a[1] * scale, a[2] * scale, b[0] * scale, b[1] * scale, b[2] * scale);
    }
    // polygon 边序与 neighbors 数组无对应关系，按边中点找共享邻接块
    function neighborAcross(tile, a, b) {
      const mx = a[0] + b[0], my = a[1] + b[1], mz = a[2] + b[2];
      const inv = 1 / (Math.hypot(mx, my, mz) || 1);
      const mid = [mx * inv, my * inv, mz * inv];
      let best = null, score = -Infinity;
      for (let i = 0; i < tile.neighbors.length; i++) {
        const n = GE.worldState.getTile(tile.neighbors[i]);
        if (!n) continue;
        const s = n.center[0] * mid[0] + n.center[1] * mid[1] + n.center[2] * mid[2];
        if (s > score) { score = s; best = n; }
      }
      return best;
    }

    faceTileIds = [];
    tiles.forEach(tile => {
      const region = GE.worldState.getRegion(tile.regionId);
      const regionColor = new THREE.Color(region.color);
      const ownerColor = tile.ownerCivId ? civColors[tile.ownerCivId] : null;
      const surface = R * elevScale(tile.terrain);

      // 全环扇形三角剖分，避免漏掉 (center, p[n-1], p[0]) 等扇区造成菱形空缺
      const poly = tile.polygon;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        addTriangle(regionPositions, regionColors, tile.center, a, b, regionColor, surface * 1.001);
        if (ownerColor) {
          addTriangle(ownerPositions, ownerColors, tile.center, a, b, ownerColor, surface * 1.003);
        }
      }

      for (let i = 0; i < tile.polygon.length; i++) {
        const a = tile.polygon[i], b = tile.polygon[(i + 1) % tile.polygon.length];
        const key = edgeKey(a, b);
        const neighbor = neighborAcross(tile, a, b);
        if (neighbor && neighbor.regionId !== tile.regionId && !seenRegionEdges.has(key)) {
          seenRegionEdges.add(key);
          addEdge(regionEdges, a, b, surface * 1.008);
        }
        if (neighbor && neighbor.ownerCivId !== tile.ownerCivId && (tile.ownerCivId || neighbor.ownerCivId) && !seenPoliticalEdges.has(key)) {
          seenPoliticalEdges.add(key);
          addEdge(politicalEdges, a, b, surface * 1.010);
        }
      }

      // 仅标建筑（立柱）；资源不在地图上铺图标，避免在染色层上戳出菱形空缺
      if (tile.buildings.length) {
        buildingMarks.push({ n: tile.center, elev: surface * 1.016 });
      }
    });

    function makeOverlayMesh(positions, colors, opacity) {
      const geo = new THREE.BufferGeometry();
      if (positions.length) {
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      }
      return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity,
        side: THREE.FrontSide,
        depthWrite: false,
        blending: THREE.NormalBlending
      }));
    }
    function makeLines(positions, color, opacity) {
      const geo = new THREE.BufferGeometry();
      if (positions.length) geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color, transparent: true, opacity, depthWrite: false
      }));
    }

    // 建筑：径向小立柱 + 顶灯（InstancedMesh）
    function buildBuildingLayer(marks) {
      const group = new THREE.Group();
      group.name = 'buildingMarks';
      if (!marks.length) return group;
      const pillarGeo = new THREE.CylinderGeometry(0.35, 0.55, 2.4, 6);
      const pillarMat = new THREE.MeshBasicMaterial({ color: 0xffd089, transparent: true, opacity: 0.92 });
      const capGeo = new THREE.SphereGeometry(0.55, 8, 8);
      const capMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });
      const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, marks.length);
      const caps = new THREE.InstancedMesh(capGeo, capMat, marks.length);
      const dummy = new THREE.Object3D();
      const yUp = new THREE.Vector3(0, 1, 0);
      const n = new THREE.Vector3();
      marks.forEach((m, i) => {
        n.set(m.n[0], m.n[1], m.n[2]).normalize();
        dummy.position.copy(n).multiplyScalar(m.elev + 1.1);
        dummy.quaternion.setFromUnitVectors(yUp, n);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        pillars.setMatrixAt(i, dummy.matrix);
        dummy.position.copy(n).multiplyScalar(m.elev + 2.5);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        caps.setMatrixAt(i, dummy.matrix);
      });
      pillars.instanceMatrix.needsUpdate = true;
      caps.instanceMatrix.needsUpdate = true;
      group.add(pillars, caps);
      return group;
    }

    // 地形色块关闭，点选走 globe
    terrainMesh = makeOverlayMesh([], [], 0);
    terrainMesh.visible = false;
    // 区域/归属染色：更透明，让星球贴图为主
    regionMesh = makeOverlayMesh(regionPositions, regionColors, 0.16);
    ownershipMesh = makeOverlayMesh(ownerPositions, ownerColors, 0.18);
    regionBorders = makeLines(regionEdges, 0xe9d8a6, 0.48);
    view._regionOnlyBorders = null;
    politicalBorders = makeLines(politicalEdges, 0xffffff, 0.58);

    // 资产层：仅建筑立柱（不再铺资源菱形，避免在染色面上戳洞）
    assetPoints = new THREE.Group();
    assetPoints.name = 'assets';
    assetPoints.add(buildBuildingLayer(buildingMarks));

    terrainMesh.userData.faceTileIds = faceTileIds;
    view.scene.add(terrainMesh, regionMesh, ownershipMesh, regionBorders, politicalBorders, assetPoints);

    const seeds = activeSurfaceDef().capitalSeeds || {};
    view._capitals = GE.data.civs
      .filter(c => seeds[c.id])
      .map(c => {
        const seed = seeds[c.id];
        const tile = GE.worldGrid.nearestLatLon(seed.lat, seed.lon);
        return { id: c.id, name: c.capital, civName: c.name, color: c.color, tileId: tile.id, pos: new THREE.Vector3(...tile.center).multiplyScalar(R * 1.05) };
      });
  }

  /* ============ 大气层 ============ */
  function buildAtmosphere() {
    const geo = new THREE.SphereGeometry(R * 1.16, 64, 64);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uSun: { value: sunDir },
        uAtmo: { value: new THREE.Color(0x6fc3ff) },
        uStrength: { value: 1.0 }
      },
      vertexShader: 'varying vec3 vN;varying vec3 vW;void main(){vN=normalize(normalMatrix*normal);vW=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `
        varying vec3 vN;varying vec3 vW;uniform vec3 uSun,uAtmo;uniform float uStrength;
        void main(){
          vec3 N=normalize(vN);vec3 V=normalize(cameraPosition-vW);
          float rim=pow(max(dot(N,V),0.0),3.4);
          float day=smoothstep(-0.2,0.4,dot(normalize(vW),normalize(uSun)));
          vec3 col=mix(uAtmo*0.45,uAtmo*1.15,day);
          float a=rim*(0.35+0.65*day)*uStrength;
          gl_FragColor=vec4(col*rim*(0.4+0.8*day),a*0.95);
        }`
    });
    atmo = new THREE.Mesh(geo, mat);
    view.scene.add(atmo);
    // 外层柔光
    const glowGeo = new THREE.SphereGeometry(R * 1.32, 48, 48);
    const glowMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uGlow: { value: new THREE.Color(0x3377aa) } },
      vertexShader: 'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec3 vN;uniform vec3 uGlow;void main(){float r=pow(max(vN.z,0.0),5.0);gl_FragColor=vec4(uGlow*r*0.55,r*0.4);}'
    });
    glow = new THREE.Mesh(glowGeo, glowMat);
    view.scene.add(glow);
  }

  /* ============ 云层 ============ */
  function buildClouds() {
    const geo = new THREE.SphereGeometry(R * 1.025, 72, 72);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        uSun: { value: sunDir },
        uTime: { value: 0 },
        uAmount: { value: 0.55 },
        uTint: { value: new THREE.Color(0xffffff) }
      },
      vertexShader: 'varying vec3 vN;varying vec3 vW;void main(){vN=normalize(normalMatrix*normal);vW=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `
        varying vec3 vN;varying vec3 vW;uniform vec3 uSun,uTint;uniform float uTime,uAmount;
        ${GE.glsl.noise}
        void main(){
          if(uAmount<0.02){discard;}
          vec3 p=normalize(vW);
          float n=fbm3(p*3.4+vec3(uTime*0.02,0.0,uTime*0.008),5);
          n+=0.35*fbm3(p*8.0-vec3(uTime*0.03,0.0,0.0),4);
          float thr=mix(0.72,0.48,clamp(uAmount,0.0,1.0));
          float a=smoothstep(thr,thr+0.26,n)*uAmount;
          float day=smoothstep(-0.1,0.3,dot(normalize(vN),normalize(uSun)));
          vec3 col=mix(uTint*0.35,uTint,day);
          gl_FragColor=vec4(col,a*(0.14+0.55*day));
        }`
    });
    clouds = new THREE.Mesh(geo, mat);
    view.scene.add(clouds);
  }

  /* ============ 星链卫星壳 ============ */
  function buildSatelliteShell(bodyId) {
    const civ = GE.data.civs.find(c => c.id === 'dawn');
    // 非盖亚：有 constellation 时用较少节点示意
    const N = bodyId === 'gaiya'
      ? (civ && civ.orbital && civ.orbital.satellites ? civ.orbital.satellites : 96)
      : 36;
    // 三个轨道壳层（不同高度/倾角）
    const shells = [
      { alt: 1.16, inc: 53 * D2R, count: Math.floor(N * 0.5), phase: 0 },
      { alt: 1.20, inc: 70 * D2R, count: Math.floor(N * 0.3), phase: 2.1 },
      { alt: 1.13, inc: 38 * D2R, count: N - Math.floor(N * 0.5) - Math.floor(N * 0.3), phase: 4.2 }
    ];
    const sats = [];
    shells.forEach((sh, si) => {
      for (let i = 0; i < sh.count; i++) {
        const a = (i / sh.count) * Math.PI * 2 + sh.phase;
        sats.push({ alt: sh.alt * R, inc: sh.inc, a0: a, speed: 0.22 / Math.pow(sh.alt, 1.5), shell: si });
      }
    });

    // 卫星本体（发光小点 → InstancedMesh 八面体）
    const satGeo = new THREE.OctahedronGeometry(0.85, 0);
    const satMat = new THREE.MeshBasicMaterial({ color: 0x9decf6 });
    const satMesh = new THREE.InstancedMesh(satGeo, satMat, sats.length);
    satMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // 覆盖圈（地面足迹 → InstancedMesh 环）
    const ringGeo = new THREE.RingGeometry(10.5, 12.0, 40);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x5fd6e6, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, sats.length);
    ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // 轨道线
    const orbitGroup = new THREE.Group();
    shells.forEach(sh => {
      const pts = [];
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        pts.push(orbitPos(sh.alt * R, sh.inc, a, new THREE.Vector3()));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x5fd6e6, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending }));
      orbitGroup.add(l);
    });

    // 发光的壳（整层菲涅尔）
    const shellGlow = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.17, 48, 48),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: {},
        vertexShader: 'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: 'varying vec3 vN;void main(){float r=pow(max(vN.z,0.0),6.5);gl_FragColor=vec4(vec3(0.3,0.8,0.9)*r*0.6,r*0.5);}'
      })
    );

    satShell = { sats, satMesh, ringMesh, orbitGroup, shellGlow };
    view.scene.add(satMesh, ringMesh, orbitGroup, shellGlow);
  }

  function orbitPos(alt, inc, a, out) {
    // 圆轨道 + 绕Y倾角
    const x = Math.cos(a) * alt, y = Math.sin(a) * alt * Math.sin(inc), z = Math.sin(a) * alt * Math.cos(inc);
    return out.set(x, y, z);
  }

  /* ============ 悬停标记 ============ */
  function buildHoverMarker() {
    const geo = new THREE.RingGeometry(4.4, 5.4, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xd8b76a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    hoverHex = new THREE.Mesh(geo, mat);
    hoverHex.visible = false;
    view.scene.add(hoverHex);
  }

  /* ============ 标签 ============ */
  function buildLabels() {
    view._labelIds = view._labelIds || [];
    (view._capitals || []).forEach(cap => {
      const id = 'cap-' + cap.id;
      labels.add(id, (v) => v.copy(cap.pos),
        `<div class="ml-inner"><div class="ml-name">${cap.name}</div><div class="ml-tick"></div><div class="ml-dot" style="--ml-c:${cap.color}"></div></div>`,
        { className: 'capital', occlude: true, occludeThreshold: 0.06, fadeFar: [520, 660],
          onClick: () => GE.panels.openCiv(cap.id) });
      view._labelIds.push(id);
      cap.el && cap.el.style.setProperty('--ml-c', cap.color);
    });
    GE.worldState.regions.forEach(region => {
      const tiles = GE.worldState.getTilesByRegion(region.id);
      if (!tiles.length) return;
      const pos = tiles.reduce((sum, tile) => sum.add(new THREE.Vector3(...tile.center)), new THREE.Vector3()).normalize().multiplyScalar(R * 1.045);
      const id = 'region-' + region.id;
      labels.add(id, v => v.copy(pos),
        `<div class="ml-inner"><div class="ml-name">${region.name}</div><div class="ml-sub">地理区域</div></div>`,
        { className:'planet clickable', occlude:true, occludeThreshold:.08, fadeFar:[300, 520], onClick:() => GE.panels.openRegion(region.id) });
      view._labelIds.push(id);
    });
    planetFacilities.forEach(f => {
      if (f.isConstellation || !f.group) return;
      const fac = f.body;
      // 望舒保留 id=station，兼容旧 QA / 滤镜
      const id = (fac.id === 'wangshu') ? 'station' : ('fac-' + fac.id);
      const sub = fac.subtype || fac.type || '轨道设施';
      labels.add(id, (v) => {
        if (f.group) return v.copy(f.group.position);
        return v.set(0, 0, 0);
      },
        `<div class="ml-inner"><div class="ml-name">${fac.name}</div><div class="ml-sub">${sub}</div></div>`,
        {
          className: '',
          occlude: false,
          fadeFar: [480, 680],
          onClick: () => openFacilityPanel(fac)
        });
      view._labelIds.push(id);
    });
    // 星座：挂一枚逻辑标签在星链壳高度
    const cons = planetFacilities.find(f => f.isConstellation);
    if (cons && cons.body) {
      const id = 'fac-' + cons.body.id;
      labels.add(id, (v) => v.set(R * 1.18, R * 0.15, 0),
        `<div class="ml-inner"><div class="ml-name">${cons.body.name}</div><div class="ml-sub">${cons.body.subtype || '星座'}</div></div>`,
        { className: '', occlude: false, fadeFar: [520, 700], onClick: () => openFacilityPanel(cons.body) });
      view._labelIds.push(id);
    }
  }

  function openFacilityPanel(fac) {
    if (!fac) return;
    // 望舒保持原站面板；其余优先天体卡片
    if (fac.id === 'wangshu' && GE.panels && GE.panels.openStation) {
      GE.panels.openStation();
      return;
    }
    if (GE.app && GE.app.showBodyCard) {
      GE.app.showBodyCard(fac, null);
      return;
    }
    if (GE.panels && GE.panels.openStation) GE.panels.openStation();
  }

  /* ============ 指针交互 ============ */
  // 多视图共用同一 canvas；仅当前激活视图响应，避免宇宙视图点出星球地块资源面板
  function isActiveView() {
    return GE.app && GE.app.state && GE.app.state.view === 'planet';
  }
  function bindPointer() {
    const dom = env.dom;
    dom.addEventListener('pointerdown', (e) => {
      if (!isActiveView()) return;
      downPos = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointerup', (e) => {
      if (!isActiveView()) { downPos = null; return; }
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (moved > 6) return; // 拖拽不触发点击
      handleClick(e);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!isActiveView()) return;
      if (view.rig.isDragging()) { hideHover(); return; }
      handleHover(e);
    });
    dom.addEventListener('pointerleave', () => { if (isActiveView()) hideHover(); });
  }

  function setPointer(e) {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  }

  function pickHex(e) {
    setPointer(e);
    raycaster.setFromCamera(pointer, view.camera);
    // 战略色块已透明：全部走 globe 命中 → 最近地块
    const globeHits = globe ? raycaster.intersectObject(globe, false) : [];
    if (globeHits.length) {
      const p = globeHits[0].point;
      const grid = GE.worldGrid.nearestToVector([p.x, p.y, p.z]);
      return grid ? GE.worldState.getTile(grid.id) : null;
    }
    return null;
  }
  function pickFacility(e) {
    const meshes = planetFacilities.filter(f => f.group).map(f => f.group);
    if (!meshes.length) return null;
    setPointer(e);
    raycaster.setFromCamera(pointer, view.camera);
    const hits = raycaster.intersectObjects(meshes, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.facilityId) o = o.parent;
    if (!o || !o.userData.facilityId) return null;
    return planetFacilities.find(f => f.id === o.userData.facilityId) || null;
  }

  function handleClick(e) {
    const facHit = pickFacility(e);
    if (facHit) { openFacilityPanel(facHit.body); return; }
    const hex = pickHex(e);
    if (hex) {
      selectHex(hex);
      GE.app.showTileContext(hex.id);
      return;
    }
    // 点击星球本体 → 星球信息
    setPointer(e);
    raycaster.setFromCamera(pointer, view.camera);
    if (raycaster.intersectObject(globe).length) { GE.panels.openPlanetInfo(); }
    else { GE.app.clearSelection(); }
  }

  let hoverT = 0;
  function handleHover(e) {
    const now = performance.now();
    if (now - hoverT < 40) return; hoverT = now;
    if (pickStation(e)) {
      env.dom.style.cursor = 'pointer';
      GE.app.showHoverCard(e, { title: '望舒轨道站', sub: '晨曦联邦 · 轨道前哨', rows: [['状态', '稳定运行'], ['驻员', '86 人']] });
      hoverHex.visible = false;
      return;
    }
    const hex = pickHex(e);
    if (hex) {
      env.dom.style.cursor = 'pointer';
      const n = new THREE.Vector3(...hex.center);
      hoverHex.visible = true;
      hoverHex.position.copy(n).multiplyScalar(R * 1.035);
      hoverHex.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const civ = hex.ownerCivId ? GE.data.civs.find(c => c.id === hex.ownerCivId) : null;
      const region = GE.worldState.getRegion(hex.regionId);
      const cat = catalog();
      const resources = hex.resources.slice(0, 2).map(r => (cat.resource[r.resourceId] || {}).name || r.resourceId).join('、') || '无显著产出';
      const terrainName = (cat.terrain[hex.terrain] || {}).name || hex.terrain;
      GE.app.showHoverCard(e, {
        title: terrainName + ' · ' + hex.id,
        sub: (region ? region.name : '未知区域') + (civ ? ' · ' + civ.name : ' · 无主'),
        rows: [['地块', hex.kind === 'pentagon' ? '五边战略地块' : '六边战略地块'], ['资源', resources]]
      });
    } else { hideHover(); }
  }
  function hideHover() {
    if (hoverHex) hoverHex.visible = false;
    if (env && env.dom) env.dom.style.cursor = '';
    if (GE.app) GE.app.hideHoverCard();
  }

  function selectHex(hex) { selected = { type: 'hex', hex }; }

  /* ============ 图层开关 ============ */
  view.setLayer = function (key, on) {
    if (!view._built) return;
    switch (key) {
      case 'labels': env.labelsVisible = on; document.getElementById('map-labels').style.display = on ? '' : 'none'; break;
      case 'grid': if (regionBorders) regionBorders.visible = on; if (politicalBorders) politicalBorders.visible = on; break;
      case 'regions': if (regionMesh) regionMesh.visible = on; if (regionBorders) regionBorders.visible = on; break;
      case 'ownership': if (ownershipMesh) ownershipMesh.visible = on; if (politicalBorders) politicalBorders.visible = on; break;
      case 'assets': if (assetPoints) assetPoints.visible = on; break;
      case 'orbit':
        if (satShell) { satShell.orbitGroup.visible = on; satShell.satMesh.visible = on; }
        planetFacilities.forEach(f => {
          if (f.group) f.group.visible = on;
          if (f.orbitLine) f.orbitLine.visible = on;
        });
        ships.forEach(s => { if (s.mesh) s.mesh.visible = on; });
        break;
      case 'coverage': if (satShell) satShell.ringMesh.visible = on; break;
      case 'atmo': {
        const body = activeBody();
        const vis = body ? resolveBodyVisual(body) : { hasAtmo: 1 };
        const show = on && vis.hasAtmo > 0.08;
        if (atmo) atmo.visible = show;
        if (glow) glow.visible = show;
        break;
      }
    }
  };

  /* ============ 帧更新 ============ */
  view.update = function (dt, rawDt, elapsed) {
    time = elapsed;
    // 太阳昼夜循环
    const dayAngle = elapsed * 0.03;
    sunDir.set(Math.cos(dayAngle), 0.28, Math.sin(dayAngle)).normalize();
    sunLight.position.copy(sunDir).multiplyScalar(500);
    if (globe && globe.material.uniforms) globe.material.uniforms.uTime.value = elapsed;
    if (clouds && clouds.visible) {
      clouds.material.uniforms.uTime.value = elapsed;
      clouds.rotation.y += dt * 0.004;
    }
    if (starfield && starfield.material.uniforms) starfield.material.uniforms.uTime.value = elapsed;

    // 卫星与覆盖圈
    if (satShell) {
      const dummy = new THREE.Object3D();
      satShell.sats.forEach((s, k) => {
        const a = s.a0 + elapsed * s.speed;
        const pos = orbitPos(s.alt, s.inc, a, dummy.position);
        dummy.scale.setScalar(1);
        dummy.lookAt(0, 0, 0);
        dummy.updateMatrix();
        satShell.satMesh.setMatrixAt(k, dummy.matrix);
        // 覆盖圈：投到地表
        const sub = pos.clone().normalize();
        dummy.position.copy(sub).multiplyScalar(R * 1.005);
        dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), sub);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        satShell.ringMesh.setMatrixAt(k, dummy.matrix);
      });
      satShell.satMesh.instanceMatrix.needsUpdate = true;
      satShell.ringMesh.instanceMatrix.needsUpdate = true;
      satShell.shellGlow.rotation.y += dt * 0.01;
    }

    // 近轨设施
    planetFacilities.forEach(f => {
      if (!f.group) return;
      f.a += dt * f.speed;
      orbitPos(f.alt, f.inc, f.a, f.group.position);
      f.group.lookAt(0, 0, 0);
      if (f.update) f.update(elapsed);
    });

    // 舰船（主站 ↔ 深空往返）
    ships.forEach((s, i) => {
      s.t += dt * s.speed;
      const tt = s.t % 2;
      const k = tt < 1 ? tt : 2 - tt;
      const from = (station && station.group)
        ? station.group.position
        : new THREE.Vector3(R * 1.4, 0, 0);
      const to = new THREE.Vector3(Math.cos(i * 2.1) * R * 2.6, R * 0.6 * (i - 1), Math.sin(i * 2.1) * R * 2.6);
      s.mesh.position.lerpVectors(from, to, k);
      s.mesh.lookAt(to);
      s.mesh.visible = true;
    });

    // 悬停标记脉动
    if (hoverHex && hoverHex.visible) {
      const s = 1 + 0.06 * Math.sin(elapsed * 6);
      hoverHex.scale.setScalar(s);
    }

    view.rig.update(rawDt);
  };

  view.render = function (renderer) { renderer.render(view.scene, view.camera); };
  view.resize = function (w, h) { view.camera.aspect = w / h; view.camera.updateProjectionMatrix(); };
  view.activate = function () {
    if (env) env.dom.classList.remove('dragging');
    // 切回星球视图时对齐当前 activeBodyId
    const want = (GE.app && GE.app.state && GE.app.state.activeBodyId) || currentBodyId || 'gaiya';
    if (want && want !== currentBodyId) {
      try { view.loadSurface(want, { silent: true }); } catch (e) { console.warn(e); }
    }
  };
  view.deactivate = function () { downPos = null; hideHover(); };
  view.getBodyId = function () { return currentBodyId; };
  view.focusTile = function (tileId) {
    const tile = GE.worldState.getTile(tileId); if (!tile) return;
    view.rig.flyTo({ radius: 190, target:new THREE.Vector3(...tile.center).multiplyScalar(R) }, 1.2);
  };
  view.focusRegion = function (regionId) {
    const tiles = GE.worldState.getTilesByRegion(regionId); if (!tiles.length) return;
    const c = tiles.reduce((sum, tile) => sum.add(new THREE.Vector3(...tile.center)), new THREE.Vector3()).normalize();
    view.rig.flyTo({ radius:260, target:c.multiplyScalar(R) }, 1.35);
  };
  view.focusCapital = function (civId) {
    const cap = (view._capitals || []).find(c => c.id === civId);
    if (cap) view.rig.flyTo({ radius: 220, target: cap.pos.clone() }, 1.4);
  };
  view.focusHome = function () { view.rig.flyTo({ radius: 300, target: new THREE.Vector3() }, 1.4); };
  view.dispose = function () {};

  /* 工具：经纬→向量 */
  function latLonToVec(lat, lon, r) {
    const la = lat * D2R, lo = lon * D2R;
    return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), r * Math.cos(la) * Math.sin(lo));
  }

  return view;
})();
