/* ============================================================
   创世引擎 · view.blackhole.js — 深渊之瞳
   史瓦西黑洞 · 零测地线光线追踪（实时）
   事件视界 / 光子环 / 多次吸积盘穿越 / 引力透镜 / 多普勒增亮 /
   引力红移 / 盘面湍流 / 程序化星空银河
   后处理：HDR Bloom / ACES / 暗角 / 胶片颗粒 / 轻微色散
   ============================================================ */
window.GE = window.GE || {};
GE.views = GE.views || {};

GE.views.blackhole = (function () {
  const view = { id: 'blackhole', name: '黑洞', scene: null, camera: null, rig: null, _built: false };
  let env;
  let fsScene, brightPass, blurH, blurV, composite;
  let rtScene, rtA, rtB;
  let W = 2, H = 2, scale = 0.85;
  let hud = null, frameAcc = 0, frameN = 0, adaptT = 0;

  const R_IN = 3.0, R_OUT = 12.0;   // 吸积盘内/外半径（rs 单位）

  /* ============ 光线追踪着色器 ============ */
  const RAY_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform vec2 uRes;
    uniform vec3 uCamPos,uRight,uUp,uFwd;
    uniform float uTanFov,uAspect,uTime,uCamDist,uDiskOn,uRingBoost,uSteps;
    ${GE.glsl.noise}
    ${GE.glsl.starfield}
    const float R_IN=${R_IN.toFixed(1)};
    const float R_OUT=${R_OUT.toFixed(1)};

    // 黑体式盘温度梯度
    vec3 diskPalette(float t){
      vec3 c=mix(vec3(1.05,0.98,0.9),vec3(1.0,0.62,0.24),pow(t,0.55));
      c=mix(c,vec3(0.42,0.12,0.05),smoothstep(0.55,1.0,t));
      return c;
    }

    void main(){
      vec2 uv=vUv*2.0-1.0;
      vec3 rd=normalize(uFwd + uTanFov*(uv.x*uAspect*uRight + uv.y*uUp));
      vec3 p=uCamPos;
      vec3 v=rd;
      vec3 h=cross(p,v);
      float h2=dot(h,h);

      vec3 col=vec3(0.0);
      float trans=1.0;
      float rMin=1e9;
      float captured=0.0;
      float escR=max(45.0,uCamDist*1.7);
      vec3 prevP=p;
      int STEPS=int(uSteps);

      for(int i=0;i<260;i++){
        if(i>=STEPS) break;
        float r=length(p);
        rMin=min(rMin,r);
        if(r<1.0){ captured=1.0; break; }
        if(r>escR) break;
        float ds=clamp(0.32*(r-1.0),0.016,0.5);
        prevP=p;
        float prevY=p.y;
        // 中点法积分零测地线  dv/ds = -1.5 h² p / r⁵
        vec3 a1=-1.5*h2*p/pow(r,5.0);
        vec3 pm=p+v*ds*0.5;
        vec3 vm=v+a1*ds*0.5;
        float rm=length(pm);
        vec3 a2=-1.5*h2*pm/pow(rm,5.0);
        p=p+vm*ds;
        v=v+a2*ds;
        // 吸积盘穿越（可多次）
        if(uDiskOn>0.5 && prevY*p.y<0.0){
          float t=prevY/(prevY-p.y);
          vec3 pc=mix(prevP,p,t);
          float rc=length(pc.xz);
          if(rc>R_IN && rc<R_OUT){
            float rt=(rc-R_IN)/(R_OUT-R_IN);
            // 开普勒差速旋转 → 湍流
            float omega=1.0/(rc*sqrt(rc)+0.25);
            float ang=atan(pc.z,pc.x);
            float swirl=ang - uTime*omega*6.0;
            float turb=fbm2(vec2(log(rc)*3.2, swirl*1.6),4);
            turb=0.55+0.7*turb;
            vec3 base=diskPalette(rt);
            float I=pow(R_IN/rc,2.3)*turb;
            // 引力红移
            float g=sqrt(max(1.0-1.0/rc,0.0));
            I*=pow(g,1.4);
            base*=mix(vec3(1.0,0.55,0.45),vec3(1.0),g);
            // 多普勒增亮
            vec3 tang=normalize(cross(vec3(0.0,1.0,0.0),normalize(pc)));
            float beta=1.0/sqrt(2.0*rc);
            float gamma=1.0/sqrt(max(1.0-beta*beta,0.01));
            vec3 vView=normalize(uCamPos-pc);
            float dop=1.0/(gamma*(1.0-dot(tang*beta,vView)));
            I*=pow(dop,3.0);
            base=mix(base,base*vec3(0.8,0.9,1.25),clamp((dop-1.0)*0.8,-0.4,0.6)); // 接近侧偏蓝
            // 累积
            float alpha=clamp(I*0.9,0.0,0.92);
            col += trans * I * base;
            trans *= (1.0-alpha*0.75);
            if(trans<0.02) break;
          }
        }
      }

      // 逃逸光线 → 引力透镜后的背景星空/银河
      if(captured<0.5){
        col += trans * starfield(normalize(v),uTime*0.02) * 1.1;
      }
      // 光子环：最小逼近半径接近 1.5rs 的光线
      float ring=exp(-pow((rMin-1.5)*7.0,2.0)) * uRingBoost;
      col += vec3(1.0,0.85,0.6)*ring*(captured<0.5?1.0:0.4);

      gl_FragColor=vec4(col,1.0);
    }
  `;

  const VERT = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';

  const BRIGHT_FRAG = `
    precision highp float;varying vec2 vUv;uniform sampler2D tSrc;uniform float uThresh;
    void main(){vec3 c=texture2D(tSrc,vUv).rgb;float l=dot(c,vec3(0.2126,0.7152,0.0722));
      float k=smoothstep(uThresh,uThresh+0.7,l);gl_FragColor=vec4(c*k,1.0);}`;

  const BLUR_FRAG = `
    precision highp float;varying vec2 vUv;uniform sampler2D tSrc;uniform vec2 uDir;
    void main(){
      vec3 s=texture2D(tSrc,vUv).rgb*0.227027;
      s+=texture2D(tSrc,vUv+uDir*1.3846).rgb*0.3162162;
      s+=texture2D(tSrc,vUv-uDir*1.3846).rgb*0.3162162;
      s+=texture2D(tSrc,vUv+uDir*3.2308).rgb*0.0702703;
      s+=texture2D(tSrc,vUv-uDir*3.2308).rgb*0.0702703;
      gl_FragColor=vec4(s,1.0);}`;

  const COMP_FRAG = `
    precision highp float;varying vec2 vUv;
    uniform sampler2D tScene,tBloom;uniform float uTime,uBloomStr,uGrain,uCA,uVig;
    ${GE.glsl.aces}
    float hashc(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
    void main(){
      vec2 uv=vUv;vec2 d=uv-0.5;float r2=dot(d,d);
      vec2 caOff=d*r2*uCA;
      vec3 scene;
      scene.r=texture2D(tScene,uv+caOff).r;
      scene.g=texture2D(tScene,uv).g;
      scene.b=texture2D(tScene,uv-caOff).b;
      vec3 bloom=texture2D(tBloom,uv).rgb;
      vec3 col=scene+bloom*uBloomStr;
      col=aces(col);
      col=pow(col,vec3(1.0/2.2));
      col*=1.0-uVig*smoothstep(0.12,0.72,r2);
      col+=(hashc(uv*vec2(1920.0,1080.0)+fract(uTime)*7.0)-0.5)*uGrain;
      gl_FragColor=vec4(col,1.0);}`;

  /* ============ 初始化 ============ */
  view.init = function (e) {
    env = e;
    // 用一个占位 scene/camera 满足接口（实际渲染全屏 pass）
    view.scene = new THREE.Scene();
    view.camera = new THREE.PerspectiveCamera(50, e.width / e.height, 0.1, 1000);
    view.rig = new GE.CameraRig(view.camera, e.dom, {
      radius: 26, minRadius: 5.5, maxRadius: 90,
      theta: 0.7, phi: 1.25, autoRotate: 0.05, damp: 5, rotateSpeed: 0.004
    });

    const mk = (frag, uni) => new GE.FullscreenPass(frag, uni, VERT);
    fsScene = mk(RAY_FRAG, {
      uRes: { value: new THREE.Vector2(2, 2) },
      uCamPos: { value: new THREE.Vector3() }, uRight: { value: new THREE.Vector3() },
      uUp: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3(0, 0, -1) },
      uTanFov: { value: 0 }, uAspect: { value: 1 }, uTime: { value: 0 },
      uCamDist: { value: 26 }, uDiskOn: { value: 1 }, uRingBoost: { value: 1.0 }, uSteps: { value: 200 }
    });
    brightPass = mk(BRIGHT_FRAG, { tSrc: { value: null }, uThresh: { value: 1.0 } });
    blurH = mk(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    blurV = mk(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    composite = mk(COMP_FRAG, {
      tScene: { value: null }, tBloom: { value: null },
      uTime: { value: 0 }, uBloomStr: { value: 0.9 }, uGrain: { value: 0.045 }, uCA: { value: 0.6 }, uVig: { value: 0.55 }
    });

    buildHUD();
    view.resize(e.width, e.height);
    view._built = true;
    return view;
  };

  function buildHUD() {
    hud = GE.h(`
      <div>
        <div id="bh-title">
          <div class="bht-name">深渊之瞳</div>
          <div class="bht-sub tk-2">史瓦西时空 · 实时零测地线</div>
        </div>
        <div id="bh-hud" class="glass">
          <div class="bh-stat"><span class="bhs-num" id="bh-dist">26.0</span><span class="bhs-label">距离 · 史瓦西半径</span></div>
          <div class="bh-stat"><span class="bhs-num" id="bh-mass">410万</span><span class="bhs-label">质量 · 太阳质量</span></div>
          <div class="bh-stat"><span class="bhs-num" id="bh-spin">0.00</span><span class="bhs-label">自旋 · 无量纲</span></div>
          <div class="bh-stat"><span class="bhs-num" id="bh-isco">3.0</span><span class="bhs-label">最小稳定轨道 · 半径</span></div>
        </div>
      </div>`);
    document.body.appendChild(hud);
    hud.style.display = 'none';
  }

  /* ============ 尺寸 / 渲染目标 ============ */
  view.resize = function (w, h) {
    W = w; H = h;
    view.camera.aspect = w / h; view.camera.updateProjectionMatrix();
    allocRT();
  };
  function allocRT() {
    [rtScene, rtA, rtB].forEach(rt => rt && rt.dispose());
    const sw = Math.max(2, Math.floor(W * scale)), sh = Math.max(2, Math.floor(H * scale));
    const bw = Math.max(2, Math.floor(sw / 2)), bh = Math.max(2, Math.floor(sh / 2));
    rtScene = GE.makeRT(sw, sh, { half: true });
    rtA = GE.makeRT(bw, bh, { half: true });
    rtB = GE.makeRT(bw, bh, { half: true });
    fsScene.material.uniforms.uRes.value.set(sw, sh);
    fsScene.material.uniforms.uAspect.value = sw / sh;
  }

  /* ============ 帧更新 ============ */
  view.update = function (dt, rawDt, elapsed) {
    view.rig.update(rawDt);
    const cam = view.camera;
    cam.updateMatrixWorld();
    const m = cam.matrixWorld.elements;
    const u = fsScene.material.uniforms;
    u.uCamPos.value.copy(cam.position);
    u.uRight.value.set(m[0], m[1], m[2]).normalize();
    u.uUp.value.set(m[4], m[5], m[6]).normalize();
    u.uFwd.value.set(-m[8], -m[9], -m[10]).normalize();
    u.uTanFov.value = Math.tan((cam.fov * Math.PI / 180) / 2);
    u.uTime.value = elapsed;
    u.uCamDist.value = cam.position.length();
    composite.material.uniforms.uTime.value = elapsed;
    const bd = hud && hud.querySelector('#bh-dist');
    if (bd) bd.textContent = cam.position.length().toFixed(1);

    // 自适应画质：依据帧耗时升降内部分辨率
    frameAcc += rawDt; frameN++; adaptT += rawDt;
    if (adaptT > 1.2) {
      const avg = frameAcc / frameN;
      const target = avg > 0.024 ? Math.max(0.55, scale - 0.08) : (avg < 0.012 ? Math.min(0.95, scale + 0.05) : scale);
      if (Math.abs(target - scale) > 0.01) { scale = target; allocRT(); }
      frameAcc = 0; frameN = 0; adaptT = 0;
    }
  };

  view.render = function (renderer) {
    // 1. 光线追踪 → rtScene
    fsScene.render(renderer, rtScene);
    // 2. 亮部提取 → rtA
    brightPass.material.uniforms.tSrc.value = rtScene.texture;
    brightPass.render(renderer, rtA);
    // 3. 模糊（H → V）→ rtB
    const bw = rtA.width, bh = rtA.height;
    blurH.material.uniforms.tSrc.value = rtA.texture;
    blurH.material.uniforms.uDir.value.set(1 / bw, 0);
    blurH.render(renderer, rtB);
    blurV.material.uniforms.tSrc.value = rtB.texture;
    blurV.material.uniforms.uDir.value.set(0, 1 / bh);
    blurV.render(renderer, rtA);
    // 4. 合成 → 屏幕
    composite.material.uniforms.tScene.value = rtScene.texture;
    composite.material.uniforms.tBloom.value = rtA.texture;
    composite.render(renderer, null);
  };

  view.setLayer = function (key, on) {
    if (!view._built) return;
    if (key === 'orbit') fsScene.material.uniforms.uDiskOn.value = on ? 1 : 0;   // 吸积盘
    if (key === 'atmo') composite.material.uniforms.uBloomStr.value = on ? 0.9 : 0.0; // Bloom
  };

  view.activate = function () { if (hud) hud.style.display = ''; };
  view.deactivate = function () { if (hud) hud.style.display = 'none'; };
  view.dispose = function () {
    [rtScene, rtA, rtB].forEach(rt => rt && rt.dispose());
    [fsScene, brightPass, blurH, blurV, composite].forEach(p => p && p.dispose());
    if (hud) hud.remove();
  };

  return view;
})();
