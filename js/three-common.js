/* ============================================================
   创世引擎 · three-common.js — 3D 共享基础设施
   种子噪声 / 斐波那契球 / 阻尼相机 / 投影标签 / GLSL 工具
   ============================================================ */
window.GE = window.GE || {};

/* ---------- 可播种随机 ---------- */
GE.rng = function (seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/* ---------- CPU 值噪声 + fbm（3D，用于球面无接缝地形） ---------- */
GE.noise = (function () {
  function hash3(x, y, z) {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) >>> 0;
    h = (h ^ (h >> 13)) >>> 0; h = (h * 1274126177) >>> 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }
  const sCurve = (t) => t * t * (3 - 2 * t);
  function value3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = sCurve(xf), v = sCurve(yf), w = sCurve(zf);
    const c000 = hash3(xi, yi, zi),     c100 = hash3(xi + 1, yi, zi);
    const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
    const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
    const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w; // 0..1
  }
  function fbm3(x, y, z, oct, lac, gain) {
    oct = oct || 4; lac = lac || 2; gain = gain || 0.5;
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += a * value3(x * f, y * f, z * f);
      norm += a; a *= gain; f *= lac;
    }
    return sum / norm; // 0..1
  }
  return { value3, fbm3 };
})();

/* ---------- 斐波那契球 ---------- */
GE.fibSphere = function (n, radius) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    pts.push(new THREE.Vector3(Math.cos(th) * r * radius, y * radius, Math.sin(th) * r * radius));
  }
  return pts;
};

/* ---------- 阻尼轨道相机 ---------- */
GE.CameraRig = class {
  constructor(camera, dom, opts) {
    opts = opts || {};
    this.camera = camera;
    this.dom = dom;
    this.target = opts.target ? opts.target.clone() : new THREE.Vector3();
    this.goalTarget = this.target.clone();
    // 球坐标
    this.radius = opts.radius || 300;
    this.theta = opts.theta != null ? opts.theta : 0.6;
    this.phi = opts.phi != null ? opts.phi : 1.05;
    this.goal = { radius: this.radius, theta: this.theta, phi: this.phi };
    this.minRadius = opts.minRadius || 120;
    this.maxRadius = opts.maxRadius || 900;
    this.minPhi = opts.minPhi != null ? opts.minPhi : 0.12;
    this.maxPhi = opts.maxPhi != null ? opts.maxPhi : Math.PI - 0.12;
    this.rotateSpeed = opts.rotateSpeed || 0.0052;
    this.zoomSpeed = opts.zoomSpeed || 0.0011;
    this.damp = opts.damp || 6.5;                 // 每秒插值速率
    this.autoRotate = opts.autoRotate || 0;       // 弧度/秒
    this.enabled = true;
    this._drag = null;
    this._bind();
  }
  _bind() {
    const d = this.dom;
    d.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this._drag = { x: e.clientX, y: e.clientY, moved: 0 };
      d.setPointerCapture && d.setPointerCapture(e.pointerId);
      d.classList.add('dragging');
    });
    d.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this._drag) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX; this._drag.y = e.clientY;
      this._drag.moved += Math.abs(dx) + Math.abs(dy);
      this.goal.theta -= dx * this.rotateSpeed;
      this.goal.phi -= dy * this.rotateSpeed;
      this.goal.phi = Math.max(this.minPhi, Math.min(this.maxPhi, this.goal.phi));
    });
    const up = (e) => { this._drag = null; d.classList.remove('dragging'); };
    d.addEventListener('pointerup', up);
    d.addEventListener('pointercancel', up);
    d.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const f = 1 + e.deltaY * this.zoomSpeed;
      this.goal.radius = THREE.MathUtils.clamp(this.goal.radius * f, this.minRadius, this.maxRadius);
    }, { passive: false });
  }
  flyTo(o, dur) {
    // o: {radius,theta,phi,target} 缓动飞行
    const from = { radius: this.goal.radius, theta: this.goal.theta, phi: this.goal.phi, t: this.goalTarget.clone() };
    const to = { radius: o.radius != null ? o.radius : from.radius,
                 theta: o.theta != null ? o.theta : from.theta,
                 phi: o.phi != null ? o.phi : from.phi,
                 t: o.target ? o.target.clone() : from.t.clone() };
    const t0 = performance.now(), D = (dur || 1.4) * 1000;
    const self = this;
    // 处理角度环绕最短路径
    let dth = to.theta - from.theta;
    dth = ((dth + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    to.theta = from.theta + dth;
    if (this._fly) cancelAnimationFrame(this._fly);
    (function step(now) {
      const p = Math.min(1, (now - t0) / D);
      const e = 1 - Math.pow(1 - p, 3);
      self.goal.radius = from.radius + (to.radius - from.radius) * e;
      self.goal.theta = from.theta + (to.theta - from.theta) * e;
      self.goal.phi = from.phi + (to.phi - from.phi) * e;
      self.goalTarget.lerpVectors(from.t, to.t, e);
      if (p < 1) self._fly = requestAnimationFrame(step); else self._fly = null;
    })(t0);
  }
  update(dt) {
    if (this.autoRotate && !this._drag) this.goal.theta += this.autoRotate * dt;
    const k = 1 - Math.exp(-this.damp * dt);
    this.radius += (this.goal.radius - this.radius) * k;
    this.theta += (this.goal.theta - this.theta) * k;
    this.phi += (this.goal.phi - this.phi) * k;
    this.target.lerp(this.goalTarget, k);
    const sp = Math.sin(this.phi), r = this.radius;
    this.camera.position.set(
      this.target.x + r * sp * Math.sin(this.theta),
      this.target.y + r * Math.cos(this.phi),
      this.target.z + r * sp * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  }
  isDragging() { return !!this._drag && this._drag.moved > 6; }
};

/* ---------- 投影标签管理 ---------- */
GE.Labels = class {
  constructor(container) {
    this.container = container;
    this.items = new Map();
    this._v = new THREE.Vector3();
  }
  add(id, getPos, html, opts) {
    opts = opts || {};
    let el = this.container.querySelector(`[data-label="${id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'map-label ' + (opts.className || '');
      el.dataset.label = id;
      el.innerHTML = html;
      if (opts.onClick) { el.classList.add('clickable'); el.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(); }); }
      this.container.appendChild(el);
    }
    this.items.set(id, { getPos, el, opts });
    return el;
  }
  remove(id) {
    const it = this.items.get(id);
    if (it) { it.el.remove(); this.items.delete(id); }
  }
  clear() { this.items.forEach(it => it.el.remove()); this.items.clear(); }
  update(camera, w, h, center) {
    const camPos = camera.position;
    this.items.forEach((it) => {
      const p = it.getPos(this._v); // 复用向量
      // 投影
      const v = this._v.copy(p).project(camera);
      const behind = v.z > 1;
      let visible = !behind;
      if (visible && it.opts.occlude && center) {
        // 位于星球背面则隐藏（法线 · 视线 < 阈值）
        const toCam = new THREE.Vector3().subVectors(camPos, center).normalize();
        const n = new THREE.Vector3().subVectors(p, center).normalize();
        if (n.dot(toCam) < (it.opts.occludeThreshold != null ? it.opts.occludeThreshold : 0.02)) visible = false;
      }
      if (!visible) { it.el.style.opacity = '0'; it.el.style.pointerEvents = 'none'; return; }
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      it.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
      // 依据距离淡出
      let op = 1;
      if (it.opts.fadeNear || it.opts.fadeFar) {
        const dist = camPos.distanceTo(p);
        if (it.opts.fadeNear) op = Math.min(op, THREE.MathUtils.clamp((dist - it.opts.fadeNear[0]) / (it.opts.fadeNear[1] - it.opts.fadeNear[0]), 0, 1));
        if (it.opts.fadeFar) op = Math.min(op, THREE.MathUtils.clamp((it.opts.fadeFar[1] - dist) / (it.opts.fadeFar[1] - it.opts.fadeFar[0]), 0, 1));
      }
      it.el.style.opacity = op.toFixed(2);
      it.el.style.pointerEvents = it.opts.onClick && op > 0.4 ? 'auto' : 'none';
    });
  }
};

/* ---------- GLSL 共享片段 ---------- */
GE.glsl = {
  noise: `
    float hash11(float p){p=fract(p*0.1031);p*=p+33.33;p*=p+p;return fract(p);}
    float hash21(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
    float hash31(vec3 p3){p3=fract(p3*0.1031);p3+=dot(p3,p3.zyx+31.32);return fract((p3.x+p3.y)*p3.z);}
    float vnoise2(vec2 p){
      vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);
      float a=hash21(i),b=hash21(i+vec2(1.,0.)),c=hash21(i+vec2(0.,1.)),d=hash21(i+vec2(1.,1.));
      return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
    }
    float vnoise3(vec3 p){
      vec3 i=floor(p),f=fract(p);vec3 u=f*f*(3.0-2.0*f);
      float n000=hash31(i),n100=hash31(i+vec3(1,0,0)),n010=hash31(i+vec3(0,1,0)),n110=hash31(i+vec3(1,1,0));
      float n001=hash31(i+vec3(0,0,1)),n101=hash31(i+vec3(1,0,1)),n011=hash31(i+vec3(0,1,1)),n111=hash31(i+vec3(1,1,1));
      return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),
                 mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
    }
    float fbm2(vec2 p,int o){float s=0.,a=.5;for(int i=0;i<8;i++){if(i>=o)break;s+=a*vnoise2(p);p*=2.03;a*=.5;}return s;}
    float fbm3(vec3 p,int o){float s=0.,a=.5;for(int i=0;i<8;i++){if(i>=o)break;s+=a*vnoise3(p);p*=2.02;a*=.5;}return s;}
  `,
  aces: `
    vec3 aces(vec3 x){
      const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
      return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
    }
  `,
  starfield: `
    // 程序化星空 + 银河带
    vec3 starfield(vec3 dir,float t){
      vec3 col=vec3(0.0);
      // 银河带：绕一条大圆的雾带
      vec3 bandN=normalize(vec3(0.35,1.0,0.25));
      float band=1.0-abs(dot(dir,bandN));
      float milky=pow(max(band,0.0),6.0);
      float wisp=fbm3(dir*4.5+vec3(0.0,0.0,1.7),5);
      milky*=0.55+0.75*wisp;
      vec3 milkyCol=mix(vec3(0.10,0.12,0.22),vec3(0.35,0.32,0.42),wisp);
      col+=milkyCol*milky*1.4;
      // 暗尘埃缕
      float dust=fbm3(dir*7.0-vec3(2.0),5);
      col*=1.0-0.5*pow(max(band,0.0),5.0)*smoothstep(0.4,0.75,dust);
      // 三层星点
      for(int i=0;i<3;i++){
        float fi=float(i);
        float scale=90.0+fi*140.0;
        vec3 g=dir*scale;
        vec3 id=floor(g);
        float h=hash31(id);
        vec3 f=fract(g)-0.5;
        float star=smoothstep(0.5,0.0,length(f))*step(0.985,h);
        float tw=0.6+0.4*sin(t*(1.0+h*3.0)+h*40.0);
        float bright=pow(hash31(id+7.7),6.0);
        col+=vec3(0.9,0.95,1.0)*star*tw*bright*(1.0-fi*0.28)*(1.0-milky*0.7);
      }
      return col;
    }
  `
};

/* ---------- 渲染目标/全屏四边形工具（供后处理） ---------- */
GE.makeRT = function (w, h, opts) {
  opts = opts || {};
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat, type: opts.half ? THREE.HalfFloatType : THREE.UnsignedByteType,
    depthBuffer: !!opts.depth, stencilBuffer: false
  });
};
GE.FullscreenPass = class {
  constructor(fragShader, uniforms, vertexShader) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms, fragmentShader: fragShader,
      vertexShader: vertexShader || 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
      depthTest: false, depthWrite: false
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);
  }
  render(renderer, target) {
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, this.camera);
  }
  dispose() { this.quad.geometry.dispose(); this.material.dispose(); }
};
