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
  let raycaster, pointer, downPos;
  let selected = null;          // 当前选中 {type, civId/obj}
  let time = 0;
  let currentBodyId = null;
  let pointerBound = false;

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
   * @param {{ silent?: boolean }} opts
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

    GE.surfaces.activate(bodyId);
    currentBodyId = bodyId;
    if (GE.app && GE.app.state) {
      GE.app.state.activeBodyId = bodyId;
      GE.app.state.activeSurfaceId = GE.surfaces.activeSurfaceId;
    }

    disposeStrategicLayers();
    clearSurfaceLabels();
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
    return view;
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
    if (station && station.group) {
      if (station.group.parent) station.group.parent.remove(station.group);
      station = null;
    }
    ships.forEach(s => { if (s.mesh && s.mesh.parent) s.mesh.parent.remove(s.mesh); });
    ships = [];
  }

  function clearSurfaceLabels() {
    if (!labels || !labels.remove) return;
    (view._labelIds || []).forEach(id => labels.remove(id));
    view._labelIds = [];
  }

  function buildOrbitalsForBody(bodyId) {
    // 星链 / 望舒仅在盖亚有叙事意义；其他天体暂不显示
    if (bodyId === 'gaiya') {
      buildSatelliteShell();
      buildStationAndShips();
    }
  }

  function applyGlobePalette(bodyId) {
    const body = GE.data.spaceBodies.find(b => b.id === bodyId);
    if (!body || !globe || !globe.material || !globe.material.uniforms) return;
    // 通过 sun 强度与 ambient 粗调非宜居体氛围
    const hydro = (body.climateProfile && body.climateProfile.hydrosphere) || 0.37;
    const cold = body.climateProfile && (body.climateProfile.meanTemp === 'cold' || body.climateProfile.meanTemp === 'frigid');
    const hot = body.climateProfile && body.climateProfile.meanTemp === 'hot';
    if (ambient) ambient.intensity = cold ? 0.55 : hot ? 1.05 : 0.85;
    if (sunLight) sunLight.intensity = hot ? 1.9 : cold ? 1.1 : 1.5;
    // 云层：干旱/冰月弱化
    if (clouds) clouds.visible = hydro > 0.12;
    if (atmo) atmo.visible = true;
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

  /* ============ 星球本体（大陆 + 海洋 + 昼夜 + 冰盖 + 高光） ============ */
  function buildGlobe() {
    const geo = new THREE.SphereGeometry(R, 96, 96);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sunDir }, uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vN; varying vec3 vW;
        void main(){ vN=normalize(normalMatrix*normal); vW=(modelMatrix*vec4(position,1.0)).xyz;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vN; varying vec3 vW; uniform vec3 uSun; uniform float uTime;
        ${GE.glsl.noise}
        void main(){
          vec3 N=normalize(vN); vec3 V=normalize(cameraPosition-vW);
          vec3 p=normalize(vW);
          // 程序化大陆：低频造陆 + 高频细节，与战略地块分层叠加时作星球贴图底色
          float cont=fbm3(p*2.1+vec3(5.0,0.0,0.0),4);
          float detail=fbm3(p*6.5+vec3(0.0,9.0,0.0),4);
          float m=cont*0.72+detail*0.28;
          float sea=0.52;
          float landMask=smoothstep(sea-0.04,sea+0.03,m);
          float elev=clamp((m-sea)/max(1.0-sea,0.001),0.0,1.0);
          float absLat=abs(p.y);
          float moist=fbm3(p*4.0+vec3(20.0,0.0,0.0),3);
          // 海洋底色
          vec3 ocean=mix(vec3(0.03,0.09,0.17),vec3(0.06,0.18,0.30),fbm3(vW*0.03,4));
          // 陆地：沙漠 / 平原 / 森林 / 山地
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
          // 极地冰盖
          float ice=smoothstep(0.72,0.88,absLat);
          land=mix(land,vec3(0.86,0.90,0.94),ice);
          ocean=mix(ocean,vec3(0.70,0.78,0.88),smoothstep(0.82,0.95,absLat)*0.55);
          vec3 base=mix(ocean,land,landMask);
          float day=smoothstep(-0.08,0.25,dot(N,normalize(uSun)));
          // 海洋镜面高光（陆地弱化）
          vec3 H=normalize(normalize(uSun)+V);
          float spec=pow(max(dot(N,H),0.0),90.0)*0.55*day*(1.0-landMask*0.85);
          vec3 col=base*(0.14+1.0*day)+vec3(1.0,0.95,0.8)*spec;
          float fr=pow(1.0-max(dot(N,V),0.0),3.0);
          col+=vec3(0.2,0.5,0.7)*fr*0.35;
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
      uniforms: { uSun: { value: sunDir } },
      vertexShader: 'varying vec3 vN;varying vec3 vW;void main(){vN=normalize(normalMatrix*normal);vW=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `
        varying vec3 vN;varying vec3 vW;uniform vec3 uSun;
        void main(){
          vec3 N=normalize(vN);vec3 V=normalize(cameraPosition-vW);
          float rim=pow(max(dot(N,V),0.0),3.4);
          float day=smoothstep(-0.2,0.4,dot(normalize(vW),normalize(uSun)));
          vec3 col=mix(vec3(0.15,0.4,0.7),vec3(0.4,0.75,0.95),day);
          gl_FragColor=vec4(col*rim*(0.4+0.8*day),rim*0.9);
        }`
    });
    atmo = new THREE.Mesh(geo, mat);
    view.scene.add(atmo);
    // 外层柔光
    const glowGeo = new THREE.SphereGeometry(R * 1.32, 48, 48);
    const glowMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: 'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec3 vN;void main(){float r=pow(max(vN.z,0.0),5.0);gl_FragColor=vec4(vec3(0.2,0.5,0.75)*r*0.5,r*0.4);}'
    });
    glow = new THREE.Mesh(glowGeo, glowMat);
    view.scene.add(glow);
  }

  /* ============ 云层 ============ */
  function buildClouds() {
    const geo = new THREE.SphereGeometry(R * 1.025, 72, 72);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uSun: { value: sunDir }, uTime: { value: 0 } },
      vertexShader: 'varying vec3 vN;varying vec3 vW;void main(){vN=normalize(normalMatrix*normal);vW=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `
        varying vec3 vN;varying vec3 vW;uniform vec3 uSun;uniform float uTime;
        ${GE.glsl.noise}
        void main(){
          vec3 p=normalize(vW);
          float n=fbm3(p*3.4+vec3(uTime*0.02,0.0,uTime*0.008),5);
          n+=0.35*fbm3(p*8.0-vec3(uTime*0.03,0.0,0.0),4);
          float a=smoothstep(0.52,0.78,n);
          float day=smoothstep(-0.1,0.3,dot(normalize(vN),normalize(uSun)));
          vec3 col=mix(vec3(0.25,0.3,0.4),vec3(1.0),day);
          gl_FragColor=vec4(col,a*(0.16+0.6*day));
        }`
    });
    clouds = new THREE.Mesh(geo, mat);
    view.scene.add(clouds);
  }

  /* ============ 星链卫星壳 ============ */
  function buildSatelliteShell() {
    const civ = GE.data.civs.find(c => c.id === 'dawn');
    const N = civ ? civ.orbital.satellites : 96;
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

  /* ============ 轨道站与舰船 ============ */
  function buildStationAndShips() {
    // 望舒轨道站
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 7, 12), new THREE.MeshStandardMaterial({ color: 0xb8c4d8, metalness: 0.8, roughness: 0.35, emissive: 0x223040 }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.5, 10, 40), new THREE.MeshStandardMaterial({ color: 0x8fa4c0, metalness: 0.85, roughness: 0.3, emissive: 0x1a2a3a }));
    ring.rotation.x = Math.PI / 2;
    const panelGeo = new THREE.BoxGeometry(9, 0.1, 2.2);
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x2a4a7a, metalness: 0.6, roughness: 0.4, emissive: 0x0a1a3a });
    const p1 = new THREE.Mesh(panelGeo, panelMat); p1.position.x = 6;
    const p2 = new THREE.Mesh(panelGeo, panelMat); p2.position.x = -6;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), new THREE.MeshBasicMaterial({ color: 0x9decf6 }));
    beacon.position.y = 4;
    g.add(core, ring, p1, p2, beacon);
    station = { group: g, alt: R * 1.42, inc: 28 * D2R, a: 0.8, speed: 0.16, beacon };
    view.scene.add(g);

    // 舰船（往返轨迹）
    ships = [];
    for (let i = 0; i < 3; i++) {
      const ship = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.4, 6), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
      const glowP = new THREE.PointLight(0x6fe0f0, 0, 60);
      view.scene.add(ship);
      ships.push({ mesh: ship, t: i / 3, speed: 0.05 + i * 0.012 });
    }
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
    if (station) {
      labels.add('station', (v) => station ? v.copy(station.group.position) : v.set(0, 0, 0),
        `<div class="ml-inner"><div class="ml-name">望舒轨道站</div><div class="ml-sub">晨曦联邦 · 前哨</div></div>`,
        { className: '', occlude: false, fadeFar: [560, 700], onClick: () => GE.panels.openStation() });
      view._labelIds.push('station');
    }
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
  function pickStation(e) {
    if (!station) return false;
    setPointer(e);
    raycaster.setFromCamera(pointer, view.camera);
    return raycaster.intersectObject(station.group, true).length > 0;
  }

  function handleClick(e) {
    if (pickStation(e)) { GE.panels.openStation(); return; }
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
      case 'orbit': if (satShell) { satShell.orbitGroup.visible = on; satShell.satMesh.visible = on; } break;
      case 'coverage': if (satShell) satShell.ringMesh.visible = on; break;
      case 'atmo': if (atmo) atmo.visible = on; if (glow) glow.visible = on; break;
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

    // 轨道站
    if (station) {
      station.a += dt * station.speed;
      orbitPos(station.alt, station.inc, station.a, station.group.position);
      station.group.rotation.z += dt * 0.2;
      station.group.lookAt(0, 0, 0);
      station.beacon.material.color.setHSL(0.52, 0.9, 0.6 + 0.3 * Math.sin(elapsed * 3));
    }

    // 舰船（站 ↔ 深空往返）
    ships.forEach((s, i) => {
      s.t += dt * s.speed;
      const tt = s.t % 2;
      const k = tt < 1 ? tt : 2 - tt; // 往返
      const from = station ? station.group.position : new THREE.Vector3(R * 1.4, 0, 0);
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
