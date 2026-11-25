import * as THREE from 'three';
import { Scene3D, type Frame } from '../core/Scene3D';
import { Q } from '../core/Quality';
import { damp, mulberry32, clamp } from '../core/math';
import { TypePlane } from '../gl/TypePlane';

export const FORMS = [
  { name: 'TORRE HELICOIDAL', eq: 'θ(y) = 0.07·y   ·   s(y) = s₀(1 − 0.35·y/h)' },
  { name: 'HIPERBOLOIDE DE SHUKHOV', eq: 'x²/a² + z²/a² − y²/c² = 1' },
  { name: 'CÚPULA GEODÉSICA', eq: 'φᵢ = i·π(3 − √5)   ·   rᵢ = √(1 − yᵢ²)' },
  { name: 'NUDO TÓRICO (2,3)', eq: 'r(t) = cos 3t + 2   ·   (r cos 2t, r sin 2t, −sin 3t)' },
];

const TAU = Math.PI * 2;

/** Each generator fills `pos` (xyz) and `yaw` for N modules. */
function towerForm(n: number, pos: Float32Array, yaw: Float32Array) {
  const floors = 46;
  const per = Math.ceil(n / floors);
  for (let i = 0; i < n; i++) {
    const f = Math.min(floors - 1, Math.floor(i / per));
    const k = i % per;
    const t = f / (floors - 1);
    const y = t * 23 - 11.5;
    const s = 4.4 * (1 - 0.35 * t) * (1 + 0.12 * Math.sin(t * 9));
    const u = k / per;
    const seg = Math.floor(u * 4);
    const lt = (u * 4 - seg) * 2 - 1;
    let x = 0, z = 0;
    if (seg === 0) { x = lt * s; z = s; }
    else if (seg === 1) { x = s; z = -lt * s; }
    else if (seg === 2) { x = -lt * s; z = -s; }
    else { x = -s; z = lt * s; }
    const a = f * 0.07;
    pos[i * 3] = x * Math.cos(a) - z * Math.sin(a);
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = x * Math.sin(a) + z * Math.cos(a);
    yaw[i] = -a + (seg % 2) * Math.PI * 0.5;
  }
}

function hyperboloidForm(n: number, pos: Float32Array, yaw: Float32Array) {
  const R = 7.5;
  const H = 11.5;
  const phi = 2.3;
  const ringN = Math.floor(n * 0.14);
  const lineN = n - ringN;
  const L = 56;
  const per = Math.ceil(lineN / L);
  for (let i = 0; i < lineN; i++) {
    const j = Math.min(L - 1, Math.floor(i / per));
    const k = (i % per) / (per - 1);
    const dir = j < L / 2 ? 1 : -1;
    const a0 = ((j % (L / 2)) / (L / 2)) * TAU;
    const a1 = a0 + dir * phi;
    const bx = R * Math.cos(a0), bz = R * Math.sin(a0);
    const tx = R * Math.cos(a1), tz = R * Math.sin(a1);
    pos[i * 3] = bx + (tx - bx) * k;
    pos[i * 3 + 1] = -H + 2 * H * k;
    pos[i * 3 + 2] = bz + (tz - bz) * k;
    yaw[i] = -Math.atan2(tz - bz, tx - bx);
  }
  const rings = [-H, -H / 3, H / 3, H];
  for (let i = 0; i < ringN; i++) {
    const ri = i % rings.length;
    const y = rings[ri];
    const tt = (y / H + 1) / 2;
    const r = R * Math.sqrt(Math.cos(phi / 2) ** 2 + Math.sin(phi / 2) ** 2 * (2 * tt - 1) ** 2);
    const a = (Math.floor(i / rings.length) / (ringN / rings.length)) * TAU;
    const idx = lineN + i;
    pos[idx * 3] = r * Math.cos(a);
    pos[idx * 3 + 1] = y;
    pos[idx * 3 + 2] = r * Math.sin(a);
    yaw[idx] = -a + Math.PI / 2;
  }
}

function domeForm(n: number, pos: Float32Array, yaw: Float32Array) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const Rxz = 11.5;
  const Ry = 19;
  for (let i = 0; i < n; i++) {
    const y = (i / (n - 1)) * 0.96;
    const r = Math.sqrt(1 - y * y);
    const th = i * golden;
    pos[i * 3] = Rxz * r * Math.cos(th);
    pos[i * 3 + 1] = -11.5 + Ry * y;
    pos[i * 3 + 2] = Rxz * r * Math.sin(th);
    yaw[i] = -th;
  }
}

function knotForm(n: number, pos: Float32Array, yaw: Float32Array) {
  const around = 10;
  const along = Math.ceil(n / around);
  const S = 3.6;
  const tube = 1.35;
  const c = (t: number) => {
    const r = Math.cos(3 * t) + 2;
    return new THREE.Vector3(r * Math.cos(2 * t) * S, -Math.sin(3 * t) * S, r * Math.sin(2 * t) * S);
  };
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i / around);
    const v = ((i % around) / around) * TAU;
    const t = (a / along) * TAU;
    const p = c(t);
    const T = c(t + 0.001).sub(p).normalize();
    const N = new THREE.Vector3().crossVectors(T, up).normalize();
    const B = new THREE.Vector3().crossVectors(T, N);
    const off = N.multiplyScalar(Math.cos(v) * tube).add(B.multiplyScalar(Math.sin(v) * tube));
    // stand the knot upright
    pos[i * 3] = p.x + off.x;
    pos[i * 3 + 1] = p.z + off.z;
    pos[i * 3 + 2] = p.y + off.y;
    yaw[i] = -Math.atan2(T.y, T.x);
  }
}

/**
 * 03 · TRANSFORMACIÓN — thousands of modules that disassemble and rebuild
 * into four canonical structures entirely on the GPU. Scroll chooses the
 * form; the user can force one, detonate it, drag it, or hold to compress
 * it into a singularity.
 */
export class TransformScene extends Scene3D {
  readonly name = 'TRANSFORMACIÓN';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  private group = new THREE.Group();
  private material!: THREE.ShaderMaterial;
  private disposables: { dispose(): void }[] = [];
  private title!: TypePlane;
  private offs: (() => void)[] = [];

  private current = 0;
  private target = 0;
  private morph = 0;
  private morphing = false;
  private manual: { form: number; scrollIdx: number } | null = null;
  private p = 0;
  private spin = 0;
  private spinVel = 0.12;
  private tilt = 0;
  private blast = 0;
  private holdTime = 0;
  private singularityFound = false;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane();
  private tmp = new THREE.Vector3();
  private mouseLocal = new THREE.Vector3(999, 999, 999);
  private wasHolding = false;

  init() {
    const n = Q.blocks;
    const P = [0, 1, 2, 3].map(() => new Float32Array(n * 3));
    const Y = [0, 1, 2, 3].map(() => new Float32Array(n));
    towerForm(n, P[0], Y[0]);
    hyperboloidForm(n, P[1], Y[1]);
    domeForm(n, P[2], Y[2]);
    knotForm(n, P[3], Y[3]);
    const yaw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) yaw[i * 4 + k] = Y[k][i];
    const rand = mulberry32(3);
    const seed = new Float32Array(n * 4);
    const scatter = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      seed[i * 4] = rand();
      seed[i * 4 + 1] = rand();
      seed[i * 4 + 2] = rand();
      seed[i * 4 + 3] = rand();
      const th = rand() * TAU;
      const ph = Math.acos(2 * rand() - 1);
      const r = 8 + rand() * 16;
      scatter[i * 3] = r * Math.sin(ph) * Math.cos(th);
      scatter[i * 3 + 1] = r * Math.cos(ph) * 0.7;
      scatter[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }

    const box = new THREE.BoxGeometry(0.44, 0.22, 0.44);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.setAttribute('position', box.getAttribute('position'));
    geo.setAttribute('normal', box.getAttribute('normal'));
    geo.setAttribute('aP0', new THREE.InstancedBufferAttribute(P[0], 3));
    geo.setAttribute('aP1', new THREE.InstancedBufferAttribute(P[1], 3));
    geo.setAttribute('aP2', new THREE.InstancedBufferAttribute(P[2], 3));
    geo.setAttribute('aP3', new THREE.InstancedBufferAttribute(P[3], 3));
    geo.setAttribute('aYaw', new THREE.InstancedBufferAttribute(yaw, 4));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.setAttribute('aScatter', new THREE.InstancedBufferAttribute(scatter, 3));
    geo.instanceCount = n;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uFrom: { value: new THREE.Vector4(1, 0, 0, 0) },
        uTo: { value: new THREE.Vector4(1, 0, 0, 0) },
        uMix: { value: 0 },
        uChaos: { value: 1 },
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector3(999, 999, 999) },
        uBlast: { value: new THREE.Vector4(0, 0, 0, 0) },
        uCollapse: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uAccent: { value: new THREE.Color(0xff4a1c) },
        uAssemble: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aP0; attribute vec3 aP1; attribute vec3 aP2; attribute vec3 aP3;
        attribute vec4 aYaw; attribute vec4 aSeed; attribute vec3 aScatter;
        uniform vec4 uFrom; uniform vec4 uTo; uniform float uMix; uniform float uChaos; uniform float uTime;
        uniform vec3 uMouse; uniform vec4 uBlast; uniform float uCollapse; uniform float uAssemble;
        varying vec3 vN; varying vec3 vW; varying float vHeat; varying float vSeed;
        mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }
        mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1., 0., 0., 0., c, s, 0., -s, c); }
        mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c, s, 0., -s, c, 0., 0., 0., 1.); }
        void main(){
          vec3 a = aP0 * uFrom.x + aP1 * uFrom.y + aP2 * uFrom.z + aP3 * uFrom.w;
          vec3 b = aP0 * uTo.x + aP1 * uTo.y + aP2 * uTo.z + aP3 * uTo.w;
          float ya = dot(aYaw, uFrom);
          float yb = dot(aYaw, uTo);
          // staggered by height so structures rebuild floor by floor
          float order = clamp((b.y + 12.0) / 24.0, 0.0, 1.0) * 0.55 + aSeed.x * 0.25;
          float e = clamp((uMix * 1.8 - order), 0.0, 1.0);
          e = e * e * (3.0 - 2.0 * e);
          float arc = sin(e * 3.14159);
          vec3 pos = mix(a, b, e) + aScatter * arc * uChaos;
          // initial assembly from scattered cloud
          float as = clamp(uAssemble * 1.6 - aSeed.y * 0.6, 0.0, 1.0);
          as = 1.0 - pow(1.0 - as, 3.0);
          pos = mix(aScatter * 2.5 + vec3(0.0, 20.0, 0.0), pos, as);
          float spin = (arc + (1.0 - as)) * (aSeed.y * 6.2831 + 3.0);

          // detonation
          vec3 bd = pos - uBlast.xyz;
          float bl = length(bd);
          float push = uBlast.w * exp(-bl * 0.07) * (0.5 + aSeed.z);
          pos += normalize(bd + 1e-4) * push;
          spin += push * 0.3;

          // pressure field around the cursor
          vec3 md = pos - uMouse;
          float m = exp(-dot(md, md) / 9.0);
          pos += normalize(md + 1e-4) * m * 2.2;

          // singularity
          vec3 core = normalize(pos + 1e-3) * (0.6 + aSeed.w * 1.4);
          float cl = clamp(uCollapse * 1.4 - aSeed.x * 0.4, 0.0, 1.0);
          pos = mix(pos, core, cl * cl);
          spin += cl * 8.0 * aSeed.z;

          mat3 R = rotY(mix(ya, yb, e)) * rotX(spin) * rotZ(spin * 0.7);
          vec3 v = R * position * (1.0 - cl * 0.6);
          vec4 w = modelMatrix * vec4(pos + v, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * (R * normal));
          vHeat = clamp(arc * 1.2 + m * 0.8 + push * 0.12 + cl + (1.0 - as), 0.0, 1.5);
          vSeed = aSeed.w;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCamPos; uniform vec3 uAccent; uniform float uTime;
        varying vec3 vN; varying vec3 vW; varying float vHeat; varying float vSeed;
        void main(){
          vec3 n = normalize(vN);
          vec3 V = normalize(uCamPos - vW);
          vec3 L1 = normalize(vec3(0.6, 0.9, 0.45));
          vec3 L2 = normalize(vec3(-0.8, -0.1, -0.5));
          float k = max(dot(n, L1), 0.0);
          float f = max(dot(n, L2), 0.0);
          vec3 base = mix(vec3(0.86, 0.82, 0.76), vec3(0.16, 0.16, 0.18), step(0.8, vSeed));
          float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          vec3 col = base * (0.05 + k * 0.95) + uAccent * f * 0.35 + fres * 0.12;
          col *= smoothstep(-16.0, 10.0, vW.y) * 0.55 + 0.45;
          col = mix(col, uAccent * 2.2, clamp(vHeat, 0.0, 1.0) * 0.7);
          col += uAccent * step(0.985, vSeed) * 2.5;
          float d = length(vW - uCamPos);
          col = mix(col, vec3(0.01, 0.009, 0.01), smoothstep(40.0, 110.0, d));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.scene.add(this.group);
    this.disposables.push(box, geo, this.material);

    this.buildStage();

    this.offs.push(
      this.ctx.pointer.on('click', (e) => {
        if (!this.active || e.ui) return;
        const u = this.material.uniforms;
        u.uBlast.value.set(this.mouseLocal.x, this.mouseLocal.y, this.mouseLocal.z, 0);
        this.blast = 22;
        this.ctx.bus.emit('glitch', 0.5);
        this.ctx.audio.boom();
      }),
    );
    this.ready = true;
  }

  private buildStage() {
    this.scene.background = new THREE.Color(0x070708);
    // floor: concentric survey rings
    const fgeo = new THREE.CircleGeometry(60, 96);
    fgeo.rotateX(-Math.PI / 2);
    const fmat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: this.material.uniforms.uTime, uAccent: this.material.uniforms.uAccent, uCollapse: this.material.uniforms.uCollapse },
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uAccent; uniform float uCollapse; varying vec3 vW;
        void main(){
          float r = length(vW.xz);
          float ring = abs(fract(r / 2.0) - 0.5) / fwidth(r / 2.0);
          ring = 1.0 - min(ring, 1.0);
          float ang = atan(vW.z, vW.x);
          float rad = abs(fract(ang / 6.2831 * 36.0) - 0.5) / fwidth(ang / 6.2831 * 36.0);
          rad = (1.0 - min(rad, 1.0)) * step(4.0, r);
          float fade = 1.0 - smoothstep(10.0, 55.0, r);
          vec3 col = vec3(0.6) * (ring * 0.18 + rad * 0.06) * fade;
          float wave = exp(-pow(r - mod(uTime * 6.0, 60.0), 2.0) * 0.2) * fade;
          col += uAccent * (wave * 0.6 + uCollapse * exp(-r * 0.15) * 2.0);
          gl_FragColor = vec4(col, (ring * 0.5 + rad * 0.2 + wave + uCollapse) * fade);
        }
      `,
    });
    const floor = new THREE.Mesh(fgeo, fmat);
    floor.position.y = -12.2;
    this.scene.add(floor);
    this.disposables.push(fgeo, fmat);

    this.title = new TypePlane({ text: 'TRANSFORMACIÓN', width: 96, stroke: 6, color: 0xece6da, opacity: 0.32 });
    this.title.position.set(0, 2, -34);
    this.scene.add(this.title);
    this.disposables.push(this.title);
  }

  setForm(i: number) {
    const idx = Math.min(3, Math.floor(this.p * 4));
    this.manual = { form: i, scrollIdx: idx };
  }

  get displayedForm() {
    return this.morphing && this.morph > 0.5 ? this.target : this.current;
  }

  enter() {
    this.ctx.audio.setScene(2);
    this.ctx.pointer.consumeDrag();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 62 : 42;
    this.camera.updateProjectionMatrix();
  }

  update(f: Frame) {
    const { dt, time } = f;
    const u = this.material.uniforms;
    const pt = this.ctx.pointer;
    this.p = damp(this.p, f.progress, 5, dt);
    u.uTime.value = time;
    u.uAssemble.value = damp(u.uAssemble.value, this.active ? 1 : u.uAssemble.value, 0.9, dt);

    // target form: scroll segment unless the user intervened
    const scrollIdx = Math.min(3, Math.floor(this.p * 4));
    if (this.manual && this.manual.scrollIdx !== scrollIdx) this.manual = null;
    const want = this.manual ? this.manual.form : scrollIdx;
    if (!this.morphing && want !== this.current) {
      this.target = want;
      this.morph = 0;
      this.morphing = true;
      this.ctx.bus.emit('form', want);
      this.ctx.audio.ping(196 * (1 + want * 0.25), 0.1, 'triangle');
    }
    if (this.morphing) {
      this.morph += dt / 2.6;
      if (this.morph >= 1) {
        this.morph = 0;
        this.morphing = false;
        this.current = this.target;
      }
    }
    const oh = (i: number, v: THREE.Vector4) => v.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0, i === 3 ? 1 : 0);
    oh(this.current, u.uFrom.value);
    oh(this.morphing ? this.target : this.current, u.uTo.value);
    u.uMix.value = this.morphing ? this.morph : 0;
    u.uChaos.value = 0.8 + Math.sin(this.p * Math.PI * 8) * 0.2;

    // drag → rotate with inertia; hold → singularity
    const drag = pt.consumeDrag();
    const dragging = this.active && pt.down && !pt.downUi && pt.travel > 8;
    if (dragging) {
      const d = drag.x * 0.006;
      this.spin += d;
      this.spinVel = THREE.MathUtils.clamp(d / Math.max(dt, 1 / 240), -6, 6);
      this.tilt = THREE.MathUtils.clamp(this.tilt + drag.y * 0.003, -0.5, 0.5);
    } else {
      this.spinVel = damp(this.spinVel, 0.15, 1.2, dt);
      this.spin += this.spinVel * dt;
    }
    this.group.rotation.y = this.spin + this.p * Math.PI * 1.2;
    this.group.rotation.x = damp(this.group.rotation.x, this.tilt, 4, dt);

    const holding = this.active && pt.down && !pt.downUi && pt.travel < 8 && performance.now() - pt.downAt > 300;
    if (holding) {
      this.holdTime += dt;
      if (this.holdTime > 2.2 && !this.singularityFound) {
        this.singularityFound = true;
        this.ctx.bus.emit('anomaly', { id: 'singularity', label: 'LA SINGULARIDAD' });
      }
    }
    if (!holding && this.wasHolding) {
      // release → shockwave from the core
      u.uBlast.value.set(0, 0, 0, 0);
      this.blast = 10 + Math.min(2.5, this.holdTime) * 14;
      this.ctx.bus.emit('glitch', 0.4 + Math.min(1, this.holdTime / 2.5) * 0.6);
      this.ctx.audio.boom();
      this.holdTime = 0;
    }
    this.wasHolding = holding;
    u.uCollapse.value = damp(u.uCollapse.value, holding ? Math.min(1, this.holdTime / 1.6) : 0, holding ? 3 : 7, dt);

    this.blast = damp(this.blast, 0, 2.2, dt);
    u.uBlast.value.w = this.blast;

    // camera orbit by scroll
    const portrait = innerWidth / innerHeight < 0.8;
    const ang = -0.35 + this.p * 0.8;
    const radius = (portrait ? 46 : 38) - Math.sin(this.p * Math.PI) * 6;
    this.camera.position.set(Math.sin(ang) * radius + pt.smooth.x * 3, 4 + (1 - this.p) * 6 + pt.smooth.y * 2, Math.cos(ang) * radius);
    this.camera.lookAt(0, 0, 0);
    u.uCamPos.value.copy(this.camera.position);

    // cursor → object space for the pressure field
    this.ray.setFromCamera(pt.ndc, this.camera);
    this.camera.getWorldDirection(this.tmp);
    this.plane.setFromNormalAndCoplanarPoint(this.tmp, new THREE.Vector3(0, 0, 0));
    if (pt.hasMoved && this.ray.ray.intersectPlane(this.plane, this.tmp)) {
      this.group.updateMatrixWorld();
      this.mouseLocal.copy(this.tmp);
      this.group.worldToLocal(this.mouseLocal);
      u.uMouse.value.lerp(this.mouseLocal, 1 - Math.exp(-dt * 12));
    }

    this.title.time = time;
    this.title.lookAt(this.camera.position.x * 0.3, 2, this.camera.position.z);
    this.title.material.uniforms.uOpacity.value = 0.25 + clamp(u.uCollapse.value) * 0.5;
  }

  render(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    r.setRenderTarget(target);
    r.clear();
    r.render(this.scene, this.camera);
  }

  compileTargets() {
    return [{ scene: this.scene, camera: this.camera }];
  }

  dispose() {
    this.offs.forEach((o) => o());
    this.disposables.forEach((d) => d.dispose());
  }
}
