/* ============================================================
   创世引擎 · view.universe.js — 宇宙地图
   曦阳星系 · 自动星轨 / 分类型行星渲染 / 小行星带 / 可点击天体
   ============================================================ */
window.GE = window.GE || {};
GE.views = GE.views || {};

GE.views.universe = (function () {
  const D2R = Math.PI / 180;
  const DAY_PER_SEC = 6;                  // 轨道时间缩放（1×流速下每秒折算天数）

  const view = { id: 'universe', name: '宇宙', scene: null, camera: null, rig: null, _built: false };
  let env, labels, raycaster, pointer, downPos;
  let bodies = {};                        // id -> {data, mesh, orbitLine, pos}
  let belt, starGlow, habitable;
  let time = 0;
  let simDays = 0;                        // 模拟时间（经流速缩放、可暂停）
  let beltSpin = 0;                       // 小行星带翻滚累积（模拟时间）

  /* ============ 初始化 ============ */
  view.init = function (e) {
    env = e; labels = e.labels;
    view.scene = new THREE.Scene();
    view.camera = new THREE.PerspectiveCamera(45, e.width / e.height, 1, 20000);
    view.rig = new GE.CameraRig(view.camera, e.dom, {
      radius: 900, minRadius: 120, maxRadius: 3800,
      theta: 0.5, phi: 1.05, autoRotate: 0.012, damp: 5.5
    });
    raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2();
    view.scene.add(new THREE.AmbientLight(0x2a3550, 0.7));

    buildBackground();
    buildBodies();
    buildBelt();
    bindPointer();
    view._built = true;
    return view;
  };

  /* ============ 背景 ============ */
  function buildBackground() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec3 vDir;uniform float uTime;${GE.glsl.noise}${GE.glsl.starfield}
        void main(){gl_FragColor=vec4(starfield(normalize(vDir),uTime*0.02),1.0);}`
    });
    view.scene.add(new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 32), mat));
    view._bg = mat;
  }

  /* ============ 行星着色器（按类型 + climate 细分） ============ */
  function planetMaterial(b) {
    // 0 岩质/干旱 · 1 类地 · 2 气态 · 3 冰巨星 · 4 气冷卫星 · 5 寒冷矮行星
    let style = 0;
    const cp = b.climateProfile || {};
    const temp = cp.meanTemp || '';
    const hydro = cp.hydrosphere != null ? cp.hydrosphere : -1;
    if (b.type === '类地行星') style = 1;
    else if (b.type === '气态巨星' || b.type === '气态行星') style = 2;
    else if (b.type === '冰巨星') style = 3;
    else if (b.type === '卫星') style = 4;
    else if (b.type === '矮行星' || temp === 'frigid') style = 5;
    else if (b.type === '岩质行星' || temp === 'hot') style = 0;
    else style = 0;

    const c = new THREE.Color(b.color);
    const dark = c.clone().multiplyScalar(0.42);
    const light = c.clone().lerp(new THREE.Color(0xffffff), 0.38);
    let atmoCol, hasAtmo = 0;
    if (style === 1) { atmoCol = new THREE.Color(0x6fc3ff); hasAtmo = 1; }
    else if (style === 2) { atmoCol = c.clone().lerp(new THREE.Color(0xffffff), 0.45); hasAtmo = 1; }
    else if (style === 3) { atmoCol = new THREE.Color(0xaee6f5); hasAtmo = 1; }
    else if (style === 0 && hydro > 0.05) { atmoCol = c.clone().lerp(new THREE.Color(0xffaa66), 0.4); hasAtmo = 0.4; }
    else { atmoCol = c.clone().lerp(new THREE.Color(0xffffff), 0.3); hasAtmo = 0; }

    const seed = (b.surfaceSeed || 0) * 0.0001;
    return new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: dark }, uB: { value: c }, uC: { value: light },
        uStyle: { value: style }, uTime: { value: 0 }, uSeed: { value: seed },
        uAtmo: { value: atmoCol }, uHasAtmo: { value: hasAtmo }
      },
      vertexShader: 'varying vec3 vN;varying vec3 vW;void main(){vN=normalize(normal);vW=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `
        varying vec3 vN;varying vec3 vW;
        uniform vec3 uA,uB,uC,uAtmo;uniform float uStyle,uTime,uHasAtmo,uSeed;
        ${GE.glsl.noise}
        void main(){
          vec3 N=normalize(vN);
          vec3 dir=normalize(vN + vec3(uSeed,uSeed*1.3,-uSeed*0.7));
          vec3 col;
          if(uStyle<0.5){ // 干旱岩质
            float n=fbm3(dir*4.0+vec3(3.0),5);
            float cr=fbm3(dir*11.0,4);
            float rift=smoothstep(0.7,0.92,abs(sin(dir.y*16.0+cr*3.0)));
            col=mix(uA,uB,n); col=mix(col,uC,smoothstep(0.6,0.85,cr)*0.45);
            col=mix(col,uA*0.5,rift*0.4);
          } else if(uStyle<1.5){ // 类地
            float cont=fbm3(dir*2.4+vec3(7.0),5);
            float land=smoothstep(0.5,0.56,cont);
            vec3 ocean=mix(uA*0.6,uB,0.4);
            vec3 landc=mix(uB*1.05,uC,fbm3(dir*6.0,4));
            col=mix(ocean,landc,land);
            float ice=smoothstep(0.86,0.95,abs(dir.y)); col=mix(col,vec3(0.9,0.95,1.0),ice*0.8);
            float cl=smoothstep(0.55,0.8,fbm3(dir*3.5+vec3(uTime*0.02,0.0,0.0),4)); col=mix(col,vec3(1.0),cl*0.35);
          } else if(uStyle<2.5){ // 气态条带
            float bands=sin(dir.y*9.0 + fbm3(dir*3.0,4)*3.0);
            float t=fbm3(vec3(dir.x*2.0,dir.y*8.0,dir.z*2.0),4);
            col=mix(uA,uB,0.5+0.5*bands); col=mix(col,uC,t*0.4);
          } else if(uStyle<3.5){ // 冰巨星柔和
            col=mix(uA,uB,0.6+0.3*fbm3(dir*2.5,4)); col=mix(col,uC,0.25);
          } else if(uStyle<4.5){ // 气冷卫星：月海+坑
            float mare=fbm3(dir*2.2,4);
            float cr=fbm3(dir*12.0,5);
            float pit=smoothstep(0.78,0.92,cr);
            float rim=smoothstep(0.62,0.78,cr)*smoothstep(0.88,0.72,cr);
            col=mix(uA*0.75,uB,smoothstep(0.4,0.7,mare));
            col=mix(col,uA*0.4,pit*0.65);
            col=mix(col,uC,rim*0.5);
          } else { // 寒冷矮行星
            float n=fbm3(dir*2.8,4);
            float frost=fbm3(dir*9.0,3);
            col=mix(uA*0.55,uB*0.6,n);
            col=mix(col,uC,smoothstep(0.45,0.8,frost)*0.4);
            col=mix(col,vec3(0.7,0.78,0.88),smoothstep(0.75,0.95,abs(dir.y))*0.45);
          }
          vec3 L=normalize(-vW);
          float diff=max(dot(N,L),0.0);
          float wrap=max(dot(N,L)*0.5+0.5,0.0);
          col*= (0.06 + 1.15*mix(diff,wrap,0.25));
          if(uHasAtmo>0.05){
            vec3 V=normalize(cameraPosition-vW);
            float rim=pow(1.0-max(dot(N,V),0.0),3.0);
            col+=uAtmo*rim*0.75*uHasAtmo;
          }
          gl_FragColor=vec4(col,1.0);
        }`
    });
  }

  /* ============ 构建天体 ============ */
  function buildBodies() {
    // 人造设施：程序化分壳 / 相位，避免挤在同一轨道
    if (GE.facilityLayout && GE.data && Array.isArray(GE.data.spaceBodies)) {
      GE.facilityLayout.apply(GE.data.spaceBodies, {
        seed: (GE.data.world && GE.data.world.seed) || 20260723
      });
    }
    GE.data.spaceBodies.forEach(b => {
      if (b.type === '小行星带') { bodies[b.id] = { data: b, pos: new THREE.Vector3() }; return; }
      const entry = { data: b, pos: new THREE.Vector3() };

      if (b.type === '恒星') {
        // 恒星本体
        const mat = new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(0xffb060) }, uB: { value: new THREE.Color(0xfff0c8) } },
          vertexShader: 'varying vec3 vN;void main(){vN=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader: `varying vec3 vN;uniform float uTime;uniform vec3 uA,uB;${GE.glsl.noise}
            void main(){
              vec3 d=normalize(vN);
              float n=fbm3(d*3.0+vec3(uTime*0.05),5);
              float g=fbm3(d*8.0-vec3(uTime*0.08),4);
              vec3 col=mix(uA,uB,smoothstep(0.3,0.8,n));
              col+=uB*smoothstep(0.6,0.9,g)*0.7;
              col*=1.4;
              gl_FragColor=vec4(col,1.0);
            }`
        });
        entry.mesh = new THREE.Mesh(new THREE.SphereGeometry(b.radius, 48, 48), mat);
        entry.isStar = true;
        // 日冕光晕
        const glowMat = new THREE.SpriteMaterial({
          map: makeGlowTexture(), color: 0xffd9a0, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false
        });
        const sprite = new THREE.Sprite(glowMat);
        sprite.scale.setScalar(b.radius * 9);
        entry.mesh.add(sprite);
        const light = new THREE.PointLight(0xffe0b0, 1.6, 0, 1.2);
        entry.mesh.add(light);
        view.scene.add(entry.mesh);
        entry.update = (t) => { mat.uniforms.uTime.value = t; sprite.material.rotation += 0.0004; };
      }
      else if (b.type === '黑洞') {
        // 导航标记（真实渲染在黑洞视图）
        const grp = new THREE.Group();
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(b.radius * 1.8, b.radius * 0.5, 12, 48),
          new THREE.MeshBasicMaterial({ color: 0x8b7cf6, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending })
        );
        const dark = new THREE.Mesh(new THREE.SphereGeometry(b.radius, 24, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0x8b7cf6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
        halo.scale.setScalar(b.radius * 8);
        grp.add(dark, ring, halo);
        grp.rotation.x = 0.9;
        entry.mesh = grp; entry.isBH = true; entry.ring = ring;
        view.scene.add(grp);
        entry.update = (t, days) => { ring.rotation.z = days * 0.08; };
      }
      else if (GE.facilityMesh && GE.facilityMesh.isFacility(b)) {
        entry.mesh = GE.facilityMesh.create(b);
        entry.isFacility = true;
        entry.isStation = true;
        entry.update = GE.facilityMesh.makeUpdater(entry);
        view.scene.add(entry.mesh);
      }
      else if (b.type === '空间站') {
        // 无 facility-mesh 时的回落
        const grp = new THREE.Group();
        const core = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.4, 8), new THREE.MeshStandardMaterial({ color: 0xb8c4d8, metalness: 0.8, roughness: 0.3, emissive: 0x1a2a3a }));
        const ringS = new THREE.Mesh(new THREE.TorusGeometry(2, 0.28, 8, 24), new THREE.MeshStandardMaterial({ color: 0x8fa4c0, metalness: 0.8, roughness: 0.3 }));
        ringS.rotation.x = Math.PI / 2;
        grp.add(core, ringS);
        entry.mesh = grp; entry.isStation = true;
        view.scene.add(grp);
      }
      else {
        // 行星 / 卫星
        const mat = planetMaterial(b);
        entry.mesh = new THREE.Mesh(new THREE.SphereGeometry(b.radius, 48, 48), mat);
        entry.mat = mat;
        // 环
        if (b.ring) {
          const ringGeo = new THREE.RingGeometry(b.radius * 1.4, b.radius * 2.3, 64, 1);
          const ringMat = new THREE.ShaderMaterial({
            transparent: true, side: THREE.DoubleSide, depthWrite: false,
            uniforms: { uC: { value: new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.3) } },
            vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
            fragmentShader: `varying vec2 vUv;uniform vec3 uC;${GE.glsl.noise}
              void main(){
                float r=vUv.x; float band=fbm2(vec2(r*20.0,0.5),4);
                float a=smoothstep(0.0,0.15,r)*smoothstep(1.0,0.85,r);
                a*=0.35+0.5*band;
                gl_FragColor=vec4(uC,a*0.8);
              }`
          });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.rotation.x = Math.PI / 2 - 0.28;
          entry.mesh.add(ring);
        }
        view.scene.add(entry.mesh);
        entry.update = (t, days) => { mat.uniforms.uTime.value = t; entry.mesh.rotation.y = days * 0.008 / Math.max(1, b.radius * 0.2); };
      }

      // 轨道线（母星 / landable 高亮；人造设施默认不画，星座/星门除外）
      const isFac = entry.isFacility || (GE.facilityMesh && GE.facilityMesh.isFacility(b));
      const facClass = isFac && GE.facilityMesh ? GE.facilityMesh.resolveClass(b) : null;
      const drawFacOrbit = facClass === 'constellation' || facClass === 'gate' || facClass === 'stellar_infra';
      if (b.orbit && b.type !== '卫星' && b.type !== '空间站' && (!isFac || drawFacOrbit)) {
        const homeish = GE.surfaces ? GE.surfaces.isPlayerHome(b) : !!b.home;
        const landable = GE.surfaces ? GE.surfaces.isLandable(b) : !!b.home;
        let col = b.type === '黑洞' ? 0x8b7cf6 : (homeish ? 0x5fd6e6 : landable ? 0x6fd08c : 0x4a5a7a);
        let op = homeish ? 0.5 : landable ? 0.35 : 0.22;
        if (drawFacOrbit) {
          col = facClass === 'gate' ? 0xa080ff : facClass === 'stellar_infra' ? 0xffd9a0 : 0x5fd6e6;
          op = 0.28;
        }
        entry.orbitLine = makeOrbitLine(b, col, op);
        view.scene.add(entry.orbitLine);
      }
      // 标签（仅中文名；设施用更近淡出，减挤叠）
      if (b.type !== '恒星') {
        labels.add('u-' + b.id, (v) => v.copy(entry.pos),
          `<div class="ml-inner"><div class="ml-name">${b.name}</div><div class="ml-tick"></div></div>`,
          { className: isFac ? 'planet fac' : 'planet',
            fadeFar: b.type === '黑洞' ? [2600, 3400] : isFac ? [700, 1400] : [1400, 2400],
            onClick: () => focusBody(b.id) });
      } else {
        labels.add('u-' + b.id, (v) => v.copy(entry.pos),
          `<div class="ml-inner"><div class="ml-name" style="color:#ffd9a0">${b.name}</div><div class="ml-tick"></div></div>`,
          { className: 'planet', fadeFar: [2200, 3200] });
      }
      bodies[b.id] = entry;
    });

    // 宜居带
    const habGeo = new THREE.RingGeometry(200, 285, 128);
    habitable = new THREE.Mesh(habGeo, new THREE.MeshBasicMaterial({ color: 0x6fd08c, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }));
    habitable.rotation.x = Math.PI / 2;
    view.scene.add(habitable);
  }

  function makeOrbitLine(b, colorHex, opacity) {
    const pts = [];
    const o = b.orbit;
    for (let i = 0; i <= 160; i++) {
      const E = (i / 160) * Math.PI * 2;
      pts.push(orbitPos(o, E, new THREE.Vector3(), b.parent ? bodies[b.parent] && bodies[b.parent].pos : null));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity, blending: THREE.AdditiveBlending }));
  }

  function makeGlowTexture() {
    if (makeGlowTexture._t) return makeGlowTexture._t;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    makeGlowTexture._t = t; return t;
  }

  /* ============ 轨道位置 ============ */
  function orbitPos(o, E, out, parentPos) {
    // E 为偏近点角（近似真近点角）
    const x = o.a * (Math.cos(E) - o.e);
    const z = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
    // 倾角（绕X轴）
    const y = -z * Math.sin(o.inc * D2R);
    const z2 = z * Math.cos(o.inc * D2R);
    out.set(x, y, z2);
    if (parentPos) out.add(parentPos);
    return out;
  }
  function anomalyAt(o, days) {
    // 平近点角 ≈ 偏近点角（低偏心率近似）
    // 超短周期天体（卫星/空间站）做最小周期钳制，避免在星图尺度上快成虚影
    const period = Math.max(o.period, 30);
    return (o.phase || 0) + (days / period) * Math.PI * 2;
  }
  function bodyPos(b, days, out) {
    if (!b.orbit) return out.set(0, 0, 0);
    const parentPos = b.parent && bodies[b.parent] ? bodyPos(bodies[b.parent].data, days, new THREE.Vector3()) : null;
    return orbitPos(b.orbit, anomalyAt(b.orbit, days), out, parentPos);
  }

  /* ============ 小行星带 ============ */
  function buildBelt() {
    const data = GE.data.spaceBodies.find(b => b.type === '小行星带');
    const a = data.orbit.a;
    const N = 900;
    const geo = new THREE.DodecahedronGeometry(0.8, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a90a0, roughness: 0.95, metalness: 0.05 });
    belt = new THREE.InstancedMesh(geo, mat, N);
    belt.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const rand = GE.rng(42);
    belt._rocks = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < N; i++) {
      const r = a + (rand() - 0.5) * 46;
      const ang = rand() * Math.PI * 2;
      const y = (rand() - 0.5) * 22;
      const scale = 0.3 + rand() * 1.6;
      const speed = 0.02 / Math.pow(r / a, 1.5);
      belt._rocks.push({ r, ang, y, scale, speed, rot: rand() * Math.PI * 2, rotSp: (rand() - 0.5) * 0.5 });
    }
    view.scene.add(belt);
  }

  /* ============ 交互 ============ */
  // 多视图共用同一 canvas；仅当前激活视图响应
  function isActiveView() {
    return GE.app && GE.app.state && GE.app.state.view === 'universe';
  }
  function bindPointer() {
    const dom = env.dom;
    dom.addEventListener('pointerdown', (e) => {
      if (!isActiveView()) return;
      downPos = { x: e.clientX, y: e.clientY, t: 0 };
    });
    dom.addEventListener('pointerup', (e) => {
      if (!isActiveView()) { downPos = null; return; }
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (moved > 6) return;
      handleClick(e);
    });
    dom.addEventListener('dblclick', (e) => {
      if (!isActiveView()) return;
      const b = pickBody(e);
      if (b && GE.surfaces && GE.surfaces.isLandable(b)) {
        GE.app.enterPlanet(b.id);
      }
    });
  }
  function pickBody(e) {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, view.camera);
    const meshes = Object.values(bodies).filter(x => x.mesh).map(x => x.mesh);
    const hits = raycaster.intersectObjects(meshes, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.bodyId) o = o.parent;
    return o && o.userData.bodyId ? bodies[o.userData.bodyId].data : null;
  }
  function handleClick(e) {
    const b = pickBody(e);
    if (!b) { GE.app.clearSelection(); return; }
    if (b.type === '黑洞') { GE.app.switchView('blackhole'); return; }
    focusBody(b.id);
  }
  function focusBody(id) {
    const entry = bodies[id]; if (!entry || !entry.mesh) return;
    const b = entry.data;
    GE.app.showBodyCard(b, entry);
    const dist = Math.max(b.radius * 6, b.type === '恒星' ? 260 : 60);
    // 平滑跟踪目标由 update 中的 focus 跟踪
    view._focus = id;
    view.rig.flyTo({ radius: dist, target: entry.pos.clone() }, 1.5);
  }
  view.focusBody = focusBody;

  // 记录 bodyId 便于射线回溯
  view._tagMeshes = function () {
    Object.entries(bodies).forEach(([id, entry]) => {
      if (entry.mesh) entry.mesh.traverse(o => { o.userData.bodyId = id; });
    });
  };

  /* ============ 图层开关 ============ */
  view.setLayer = function (key, on) {
    if (!view._built) return;
    switch (key) {
      case 'labels': document.getElementById('map-labels').style.display = on ? '' : 'none'; break;
      case 'orbit': Object.values(bodies).forEach(x => { if (x.orbitLine) x.orbitLine.visible = on; }); habitable.visible = on; break;
      case 'grid': if (belt) belt.visible = on; break;
    }
  };

  /* ============ 帧更新 ============ */
  view.update = function (dt, rawDt, elapsed) {
    time = elapsed;
    // 模拟时间经流速缩放，暂停时冻结；恒星/星空/云层等环境动画仍用真实时间
    simDays += dt * DAY_PER_SEC;
    beltSpin += dt;
    const days = simDays;
    view._bg.uniforms.uTime.value = elapsed;
    Object.values(bodies).forEach(entry => {
      if (!entry.mesh) return;
      bodyPos(entry.data, days, entry.pos);
      entry.mesh.position.copy(entry.pos);
      if (entry.update) entry.update(elapsed, days);
    });
    // 小行星带旋转
    if (belt) {
      const dummy = new THREE.Object3D();
      belt._rocks.forEach((rk, i) => {
        rk.ang += dt * rk.speed * 60;
        dummy.position.set(Math.cos(rk.ang) * rk.r, rk.y, Math.sin(rk.ang) * rk.r);
        dummy.rotation.set(rk.rot + beltSpin * rk.rotSp, rk.rot, 0);
        dummy.scale.setScalar(rk.scale);
        dummy.updateMatrix();
        belt.setMatrixAt(i, dummy.matrix);
      });
      belt.instanceMatrix.needsUpdate = true;
    }
    // 焦点跟踪
    if (view._focus && bodies[view._focus]) {
      const entry = bodies[view._focus];
      // 目标缓慢跟随天体
      const cur = view.rig.goalTarget.clone();
      view.rig.goalTarget.lerp(entry.pos, 0.06);
    }
    view.rig.update(rawDt);
  };

  view.render = function (renderer) { renderer.render(view.scene, view.camera); };
  view.resize = function (w, h) { view.camera.aspect = w / h; view.camera.updateProjectionMatrix(); };
  view.activate = function () { view._tagMeshes(); };
  view.deactivate = function () { downPos = null; view._focus = null; };
  view.dispose = function () {};

  /** 推演后增量刷新：按 GE.data.spaceBodies 重建天体网格与标签 */
  view.reloadBodies = function () {
    if (!view._built || !view.scene) return;
    Object.keys(bodies).forEach(id => {
      const entry = bodies[id];
      if (entry && entry.mesh) {
        view.scene.remove(entry.mesh);
        entry.mesh.traverse && entry.mesh.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose && obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose && m.dispose());
            else obj.material.dispose && obj.material.dispose();
          }
        });
      }
      if (entry && entry.orbitLine) {
        view.scene.remove(entry.orbitLine);
        if (entry.orbitLine.geometry) entry.orbitLine.geometry.dispose();
        if (entry.orbitLine.material) entry.orbitLine.material.dispose();
      }
      if (labels) labels.remove('u-' + id);
    });
    bodies = {};
    if (habitable) {
      view.scene.remove(habitable);
      if (habitable.geometry) habitable.geometry.dispose();
      if (habitable.material) habitable.material.dispose();
      habitable = null;
    }
    buildBodies();
    view._tagMeshes && view._tagMeshes();
  };

  return view;
})();
