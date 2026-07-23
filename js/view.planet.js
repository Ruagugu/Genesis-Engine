/* ============================================================
   创世引擎 · view.planet.js — 星球地图
   六边形地块 / 文明疆域 / 大气层 / 星链卫星壳 / 轨道站 / 昼夜
   ============================================================ */
window.GE = window.GE || {};
GE.views = GE.views || {};

GE.views.planet = (function () {
  const R = 100;                 // 星球半径
  const HEX_N = 2600;            // 地块数量
  const D2R = Math.PI / 180;

  // 地形色板
  const TERRAIN = {
    ice:      { c: 0xe6eef6, elev: 0.012, name: '冰原' },
    tundra:   { c: 0xa8b294, elev: 0.010, name: '冻土' },
    desert:   { c: 0xdcc388, elev: 0.008, name: '沙漠' },
    plains:   { c: 0x86ab6b, elev: 0.007, name: '平原' },
    forest:   { c: 0x4f8458, elev: 0.009, name: '森林' },
    hills:    { c: 0x9a9a72, elev: 0.016, name: '丘陵' },
    mountain: { c: 0x8d929c, elev: 0.030, name: '山脉' },
    coast:    { c: 0x2f6d88, elev: 0.0,   name: '海岸' },
    ocean:    { c: 0x14304a, elev: 0.0,   name: '海洋' }
  };

  const view = {
    id: 'planet', name: '星球',
    scene: null, camera: null, rig: null,
    _built: false
  };

  let env, labels;
  let sunDir, sunLight, ambient;
  let globe, clouds, atmo, glow, starfield;
  let landMesh, oceanMesh, cityPoints, hoverHex;
  let satShell = null, station = null, ships = [];
  let hexes = [];               // 全部地块数据
  let raycaster, pointer, downPos;
  let selected = null;          // 当前选中 {type, civId/obj}
  let time = 0;

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
    buildHexes();
    buildAtmosphere();
    buildClouds();
    buildSatelliteShell();
    buildStationAndShips();
    buildHoverMarker();
    buildLabels();
    bindPointer();

    view._built = true;
    return view;
  };

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

  /* ============ 星球本体（海洋 + 昼夜 + 冰盖 + 高光） ============ */
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
          vec3 base=mix(vec3(0.05,0.13,0.23),vec3(0.03,0.09,0.17),fbm3(vW*0.03,4)); // 深海渐变
          float day=smoothstep(-0.08,0.25,dot(N,normalize(uSun)));
          // 极地冰盖微光
          float ice=smoothstep(0.82,0.95,abs(normalize(vW).y));
          base=mix(base,vec3(0.75,0.82,0.9),ice*0.5);
          // 海洋镜面高光
          vec3 H=normalize(normalize(uSun)+V);
          float spec=pow(max(dot(N,H),0.0),90.0)*0.5*day;
          // 昼夜
          vec3 col=base*(0.12+1.05*day)+vec3(1.0,0.95,0.8)*spec;
          // 菲涅尔边缘
          float fr=pow(1.0-max(dot(N,V),0.0),3.0);
          col+=vec3(0.2,0.5,0.7)*fr*0.4;
          gl_FragColor=vec4(col,1.0);
        }`
    });
    globe = new THREE.Mesh(geo, mat);
    globe.name = 'globe';
    view.scene.add(globe);
  }

  /* ============ 六边形地块 ============ */
  function buildHexes() {
    const pts = GE.fibSphere(HEX_N, R);
    const rand = GE.rng(20260722);
    // 文明首都（经纬 → 球面点）
    const civSeeds = GE.data.civs.map(c => ({
      id: c.id, color: new THREE.Color(c.color), w: c.territorySeed.weight,
      pos: latLonToVec(c.territorySeed.lat, c.territorySeed.lon, R)
    }));

    hexes = [];
    const landIdx = [], oceanIdx = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], n = p.clone().normalize();
      const lat = Math.asin(n.y);                 // -pi/2..pi/2
      // 大陆噪声（低频）+ 细节（高频）
      const cont = GE.noise.fbm3(n.x * 2.1 + 5, n.y * 2.1, n.z * 2.1, 4);
      const detail = GE.noise.fbm3(n.x * 6.5, n.y * 6.5 + 9, n.z * 6.5, 4);
      const m = cont * 0.72 + detail * 0.28;      // 0..1
      const seaLevel = 0.52;
      let type;
      if (m < seaLevel - 0.06) type = 'ocean';
      else if (m < seaLevel) type = 'coast';
      else {
        const h = (m - seaLevel) / (1 - seaLevel); // 0..1 海拔
        const absLat = Math.abs(lat) / (Math.PI / 2);
        if (absLat > 0.86) type = 'ice';
        else if (absLat > 0.72) type = 'tundra';
        else if (h > 0.72) type = 'mountain';
        else if (h > 0.55) type = 'hills';
        else {
          const moist = GE.noise.fbm3(n.x * 4 + 20, n.y * 4, n.z * 4, 3);
          const arid = Math.abs(lat) / (Math.PI / 2) < 0.28 && moist < 0.42;
          if (arid) type = 'desert';
          else if (moist > 0.58) type = 'forest';
          else type = 'plains';
        }
      }
      const isLand = !(type === 'ocean' || type === 'coast');
      // 文明归属（加权球面 Voronoi + 噪声扰动边界）
      let civ = null;
      if (isLand) {
        let best = -1, bestScore = 0.32;          // 阈值 → 留出无主地
        for (const s of civSeeds) {
          const d = n.angleTo(s.pos.clone().normalize()); // 角距
          const perturb = GE.noise.fbm3(n.x * 7 + s.pos.x, n.y * 7, n.z * 7, 3) * 0.5;
          const score = (s.w / (0.12 + d)) * (0.7 + perturb);
          if (score > bestScore) { bestScore = score; best = s.id; }
        }
        civ = best;
      }
      const hex = { pos: p, n, type, civ, land: isLand, border: false, i };
      hexes.push(hex);
      (isLand ? landIdx : oceanIdx).push(hex);
    }

    // 边界检测：陆地邻居中归属不同 → 边界
    const landSet = landIdx;
    for (const h of landSet) {
      if (!h.civ) continue;
      let near = 0, diff = false;
      for (const o of landSet) {
        if (o === h) continue;
        const d2 = h.pos.distanceToSquared(o.pos);
        if (d2 < 220) { // 邻距阈值
          near++;
          if (o.civ !== h.civ) { diff = true; break; }
        }
        if (near > 8) break;
      }
      h.border = diff;
    }

    // 构建 InstancedMesh（陆地不透明 / 海洋半透明）
    landMesh = makeHexMesh(landSet, false);
    oceanMesh = makeHexMesh(oceanIdx, true);
    view.scene.add(landMesh, oceanMesh);

    // 城市夜光点
    buildCityLights(landSet, civSeeds);
    // 首都标记数据
    view._capitals = civSeeds.map(s => {
      const civ = GE.data.civs.find(c => c.id === s.id);
      return { id: s.id, name: civ.capital, civName: civ.name, color: '#' + s.color.getHexString(), pos: s.pos.clone().normalize().multiplyScalar(R * 1.03) };
    });
  }

  function makeHexMesh(set, isOcean) {
    if (!set.length) return new THREE.Group();
    const hexGeo = new THREE.CircleGeometry(4.05, 6);
    const mat = new THREE.MeshLambertMaterial({
      transparent: isOcean, opacity: isOcean ? 0.22 : 1.0,
      vertexColors: false
    });
    const mesh = new THREE.InstancedMesh(hexGeo, mat, set.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const civColor = {};
    GE.data.civs.forEach(c => civColor[c.id] = new THREE.Color(c.color));
    set.forEach((h, k) => {
      const t = TERRAIN[h.type];
      const elev = t.elev * (h.land ? 1 : 0);
      dummy.position.copy(h.n).multiplyScalar(R * (1 + elev));
      // 朝向法线
      const up = Math.abs(h.n.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const tan = new THREE.Vector3().crossVectors(up, h.n).normalize();
      const bit = new THREE.Vector3().crossVectors(h.n, tan).normalize();
      dummy.matrix.makeBasis(tan, bit, h.n);
      dummy.quaternion.setFromRotationMatrix(dummy.matrix);
      dummy.scale.setScalar(0.94);
      if (h.type === 'mountain') dummy.scale.setScalar(0.9);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      // 颜色：地形基色，归属文明则染色，边界加深
      color.setHex(t.c);
      if (h.civ && civColor[h.civ]) {
        color.lerp(civColor[h.civ], h.border ? 0.72 : 0.45);
      }
      if (isOcean) color.multiplyScalar(0.8);
      mesh.setColorAt(k, color);
      h.mesh = mesh; h.instId = k; h.isOceanMesh = isOcean;
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.hexSet = set;
    return mesh;
  }

  /* ============ 城市夜光 ============ */
  function buildCityLights(landSet, civSeeds) {
    const owned = landSet.filter(h => h.civ && (h.type === 'plains' || h.type === 'forest' || h.type === 'hills' || h.type === 'coast'));
    const pts = [];
    const rand = GE.rng(7);
    const step = Math.max(1, Math.floor(owned.length / 260));
    for (let i = 0; i < owned.length; i += step) {
      const h = owned[i];
      pts.push(h.n.x * R * 1.02, h.n.y * R * 1.02, h.n.z * R * 1.02);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uSun: { value: sunDir } },
      vertexShader: `
        uniform vec3 uSun; varying float vNight;
        void main(){
          vec3 n=normalize(position);
          vNight=smoothstep(0.15,-0.25,dot(n,normalize(uSun)));
          vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize= (160.0/-mv.z) * (1.5+fract(position.x*13.7));
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader: `
        varying float vNight;
        void main(){
          vec2 c=gl_PointCoord-0.5; float d=length(c);
          float a=smoothstep(0.5,0.0,d);
          gl_FragColor=vec4(vec3(1.0,0.8,0.5)*a*vNight*1.4, a*vNight);
        }`
    });
    cityPoints = new THREE.Points(geo, mat);
    view.scene.add(cityPoints);
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
    (view._capitals || []).forEach(cap => {
      labels.add('cap-' + cap.id, (v) => v.copy(cap.pos),
        `<div class="ml-inner"><div class="ml-name">${cap.name}</div><div class="ml-tick"></div><div class="ml-dot" style="--ml-c:${cap.color}"></div></div>`,
        { className: 'capital', occlude: true, occludeThreshold: 0.06, fadeFar: [520, 660],
          onClick: () => GE.panels.openCiv(cap.id) });
      cap.el && cap.el.style.setProperty('--ml-c', cap.color);
    });
    labels.add('station', (v) => station ? v.copy(station.group.position) : v.set(0, 0, 0),
      `<div class="ml-inner"><div class="ml-name">望舒轨道站</div><div class="ml-sub">晨曦联邦 · 前哨</div></div>`,
      { className: '', occlude: false, fadeFar: [560, 700], onClick: () => GE.panels.openStation() });
  }

  /* ============ 指针交互 ============ */
  function bindPointer() {
    const dom = env.dom;
    dom.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('pointerup', (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (moved > 6) return; // 拖拽不触发点击
      handleClick(e);
    });
    dom.addEventListener('pointermove', (e) => {
      if (view.rig.isDragging()) { hideHover(); return; }
      handleHover(e);
    });
    dom.addEventListener('pointerleave', hideHover);
  }

  function setPointer(e) {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  }

  function pickHex(e) {
    setPointer(e);
    raycaster.setFromCamera(pointer, view.camera);
    const hits = raycaster.intersectObjects([landMesh, oceanMesh], false);
    if (hits.length && hits[0].instanceId != null) {
      const set = hits[0].object.userData.hexSet;
      return set[hits[0].instanceId];
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
      if (hex.civ) { GE.app.selectCiv(hex.civ); GE.panels.openCiv(hex.civ); }
      else if (hex.land) { GE.app.showHexInfo(hex); }
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
    if (hex && hex.land) {
      env.dom.style.cursor = 'pointer';
      hoverHex.visible = true;
      hoverHex.position.copy(hex.n).multiplyScalar(R * (1 + TERRAIN[hex.type].elev + 0.004));
      hoverHex.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hex.n);
      const civ = hex.civ ? GE.data.civs.find(c => c.id === hex.civ) : null;
      GE.app.showHoverCard(e, {
        title: TERRAIN[hex.type].name + (hex.border ? ' · 边境' : ''),
        sub: civ ? civ.name : '无主之地',
        rows: civ ? [['政体', civ.社会形态], ['阶段', civ.文明阶段]] : [['归属', '未开化']]
      });
    } else { hideHover(); }
  }
  function hideHover() {
    hoverHex.visible = false;
    env.dom.style.cursor = '';
    GE.app.hideHoverCard();
  }

  function selectHex(hex) { selected = { type: 'hex', hex }; }

  /* ============ 图层开关 ============ */
  view.setLayer = function (key, on) {
    if (!view._built) return;
    switch (key) {
      case 'labels': env.labelsVisible = on; document.getElementById('map-labels').style.display = on ? '' : 'none'; break;
      case 'grid': landMesh.visible = on; oceanMesh.visible = on; break;
      case 'orbit': satShell.orbitGroup.visible = on; satShell.satMesh.visible = on; break;
      case 'coverage': satShell.ringMesh.visible = on; break;
      case 'atmo': atmo.visible = on; glow.visible = on; break;
    }
  };

  /* ============ 帧更新 ============ */
  view.update = function (dt, rawDt, elapsed) {
    time = elapsed;
    // 太阳昼夜循环
    const dayAngle = elapsed * 0.03;
    sunDir.set(Math.cos(dayAngle), 0.28, Math.sin(dayAngle)).normalize();
    sunLight.position.copy(sunDir).multiplyScalar(500);
    globe.material.uniforms.uTime.value = elapsed;
    clouds.material.uniforms.uTime.value = elapsed;
    clouds.rotation.y += dt * 0.004;
    starfield.material.uniforms.uTime.value = elapsed;

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
    if (hoverHex.visible) {
      const s = 1 + 0.06 * Math.sin(elapsed * 6);
      hoverHex.scale.setScalar(s);
    }

    view.rig.update(rawDt);
  };

  view.render = function (renderer) { renderer.render(view.scene, view.camera); };
  view.resize = function (w, h) { view.camera.aspect = w / h; view.camera.updateProjectionMatrix(); };
  view.activate = function () { if (env) env.dom.classList.remove('dragging'); };
  view.deactivate = function () { hideHover(); };
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
