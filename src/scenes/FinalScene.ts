import * as THREE from 'three';
import { Scene3D, type Frame } from '../core/Scene3D';
import { Q } from '../core/Quality';
import { damp, mulberry32, smoothstep } from '../core/math';
import { simplex3 } from '../gl/chunks';

const TAU = Math.PI * 2;

/** Sample the glyph pixels of a word to obtain particle targets. */
function sampleText(text: string, n: number, width: number, rand: () => number) {
  const c = document.createElement('canvas');
  c.width = 1400;
  c.height = 300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.font = '900 230px Unbounded, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 700, 158);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const pts: number[] = [];
  for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (data[(y * c.width + x) * 4 + 3] > 128) pts.push(x, y);
  const out = new Float32Array(n * 3);
  const s = width / c.width;
  const count = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(rand() * count) * 2;
    out[i * 3] = (pts[k] + rand() * 2 - 700) * s;
    out[i * 3 + 1] = (150 - pts[k + 1] - rand() * 2) * s;
    out[i * 3 + 2] = (rand() - 0.5) * 2.5;
  }
  return out;
}

/**
 * 05 · APEIRON — the finale. A particle field that remembers everything:
 * a galactic nebula condenses into a point-cloud skyscraper, which explodes
 * into the word APEIRON, which collapses into the gate from the first scene.
 * The camera crosses the gate. The cursor blows particles like wind
 * (direction and speed matter), clicks send shockwaves.
 */
export class FinalScene extends Scene3D {
  readonly name = 'APEIRON';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 800);
  private material!: THREE.ShaderMaterial;
  private points!: THREE.Points;
  private gate = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private offs: (() => void)[] = [];
  private p = 0;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private hit = new THREE.Vector3();
  private crossed = false;
  private ended = false;
  private path!: THREE.CatmullRomCurve3;
  private lookPath!: THREE.CatmullRomCurve3;

  init() {
    const n = Q.particles;
    const rand = mulberry32(2026);
    const A = new Float32Array(n * 3);
    const B = new Float32Array(n * 3);
    const D = new Float32Array(n * 3);
    const R = new Float32Array(n * 4);

    for (let i = 0; i < n; i++) {
      // A · nebula: three logarithmic arms
      const arm = i % 3;
      const r = Math.pow(rand(), 0.55) * 52;
      const a = r * 0.13 + (arm * TAU) / 3 + (rand() - 0.5) * (0.6 + r * 0.01);
      A[i * 3] = Math.cos(a) * r;
      A[i * 3 + 1] = (rand() - 0.5) * 2 * (3.5 - r * 0.05) * (rand() < 0.1 ? 3 : 1);
      A[i * 3 + 2] = Math.sin(a) * r;

      // B · point-cloud skyscraper (laser-scan aesthetic)
      const yRaw = rand();
      const floors = 64;
      const onSlab = rand() < 0.5;
      const yy = onSlab ? Math.floor(yRaw * floors) / floors : yRaw;
      const y = yy * 64 - 30;
      const tw = (y + 30) * 0.035;
      const s = 8.5 * (1 - 0.42 * yy);
      const u = rand();
      const side = Math.floor(u * 4);
      let lt = (u * 4 - side) * 2 - 1;
      if (!onSlab) lt = Math.round(lt * 4) / 4; // mullions
      let x = 0, z = 0;
      if (side === 0) { x = lt * s; z = s; } else if (side === 1) { x = s; z = -lt * s; } else if (side === 2) { x = -lt * s; z = -s; } else { x = -s; z = lt * s; }
      if (onSlab && rand() < 0.25) { x *= rand(); z *= rand(); }
      B[i * 3] = x * Math.cos(tw) - z * Math.sin(tw);
      B[i * 3 + 1] = y;
      B[i * 3 + 2] = x * Math.sin(tw) + z * Math.cos(tw);

      // D · the gate: a torus + a tunnel beyond it
      if (rand() < 0.45) {
        const t = rand() * TAU;
        const v = rand() * TAU;
        const tr = 1.4 + rand() * 0.8;
        D[i * 3] = (16 + Math.cos(v) * tr) * Math.cos(t);
        D[i * 3 + 1] = (16 + Math.cos(v) * tr) * Math.sin(t);
        D[i * 3 + 2] = Math.sin(v) * tr;
      } else {
        const t = rand() * TAU;
        const zt = -rand() * 220;
        const rr = 16 + Math.sin(zt * 0.05) * 3 + (rand() - 0.5) * 1.5;
        D[i * 3] = Math.cos(t + zt * 0.02) * rr;
        D[i * 3 + 1] = Math.sin(t + zt * 0.02) * rr;
        D[i * 3 + 2] = zt;
      }

      R[i * 4] = rand();
      R[i * 4 + 1] = rand();
      R[i * 4 + 2] = rand();
      R[i * 4 + 3] = rand();
    }
    const C = sampleText('APEIRON', n, innerWidth / innerHeight < 0.8 ? 38 : 70, rand);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(A, 3));
    geo.setAttribute('aB', new THREE.BufferAttribute(B, 3));
    geo.setAttribute('aC', new THREE.BufferAttribute(C, 3));
    geo.setAttribute('aD', new THREE.BufferAttribute(D, 3));
    geo.setAttribute('aR', new THREE.BufferAttribute(R, 4));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uS: { value: 0 },
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector3(999, 999, 0) },
        uMouseVel: { value: new THREE.Vector3() },
        uShock: { value: new THREE.Vector4(0, 0, 0, -100) },
        uSize: { value: Q.tier === 'high' ? 1.0 : 1.4 },
        uPx: { value: Q.dpr },
        uAccent: { value: new THREE.Color(0xff4a1c) },
        uBone: { value: new THREE.Color(0xece6da) },
        uBright: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aB; attribute vec3 aC; attribute vec3 aD; attribute vec4 aR;
        uniform float uS; uniform float uTime; uniform vec3 uMouse; uniform vec3 uMouseVel; uniform vec4 uShock;
        uniform float uSize; uniform float uPx; uniform vec3 uAccent; uniform vec3 uBone; uniform float uBright;
        varying vec3 vCol; varying float vA;
        ${simplex3}
        vec3 swirl(vec3 p, float speed){
          float r = length(p.xz);
          float a = uTime * speed * 18.0 / (r + 8.0);
          float c = cos(a), s = sin(a);
          return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
        }
        void main(){
          float s = clamp(uS, 0.0, 3.0);
          float i = floor(min(s, 2.999));
          float f = s - i;
          float fs = clamp((f - aR.x * 0.35) / 0.65, 0.0, 1.0);
          fs = fs * fs * (3.0 - 2.0 * fs);
          vec3 A = swirl(position, 0.12);
          vec3 a = i < 0.5 ? A : (i < 1.5 ? aB : aC);
          vec3 b = i < 0.5 ? aB : (i < 1.5 ? aC : aD);
          vec3 pos = mix(a, b, fs);
          float transit = sin(fs * 3.14159);
          float turb = 0.35 + transit * 7.0 + (i < 0.5 ? (1.0 - fs) * 1.6 : 0.0);
          vec3 q = pos * 0.035 + vec3(0.0, 0.0, uTime * 0.07);
          pos += vec3(snoise(q), snoise(q + 17.1), snoise(q + 31.7)) * turb;
          if (s > 2.9) {
            // the gate breathes and spins
            float t = atan(pos.y, pos.x) + uTime * 0.15 * (0.5 + aR.y);
            float rr = length(pos.xy);
            pos.xy = vec2(cos(t), sin(t)) * rr;
          }
          // wind from the cursor: direction & speed of the gesture
          vec3 md = pos - uMouse;
          float fall = exp(-dot(md.xy, md.xy) / 40.0);
          pos += uMouseVel * fall * (0.6 + aR.z) + normalize(md + 1e-4) * fall * 1.5;
          // shockwave
          float st = uTime - uShock.w;
          float sd = length(pos - uShock.xyz);
          float wave = exp(-pow(sd - st * 38.0, 2.0) / 24.0) * exp(-st * 1.1) * step(0.0, st);
          pos += normalize(pos - uShock.xyz + 1e-4) * wave * 5.0;

          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = uSize * (0.5 + aR.y * 1.1) * (1.0 + wave * 2.5 + fall * 1.2);
          gl_PointSize = size * uPx * 60.0 / -mv.z;
          float heat = clamp(aR.w * 0.25 + transit * 0.9 + wave * 1.5 + fall * 0.8 + step(0.93, aR.w), 0.0, 1.0);
          vCol = mix(uBone * 0.9, uAccent * 2.4, heat) * uBright;
          vA = smoothstep(1.0, 9.0, -mv.z) * (0.35 + aR.y * 0.65);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vCol, a * a * vA);
        }
      `,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.disposables.push(geo, this.material);

    // the gate from scene 01 returns as a solid ring
    const tgeo = new THREE.TorusGeometry(16, 0.12, 8, 256);
    const tmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a1c).multiplyScalar(4), transparent: true, opacity: 0 });
    const t1 = new THREE.Mesh(tgeo, tmat);
    const t2 = new THREE.Mesh(tgeo, tmat);
    t2.scale.setScalar(1.12);
    t2.rotation.x = 0.2;
    this.gate.add(t1, t2);
    this.scene.add(this.gate);
    this.disposables.push(tgeo, tmat);

    // backdrop
    const bgeo = new THREE.SphereGeometry(600, 32, 16);
    const bmat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uS: this.material.uniforms.uS },
      vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uS; varying vec3 vD;
        void main(){
          float g = pow(max(-vD.z, 0.0), 10.0);
          vec3 col = vec3(0.006, 0.005, 0.008) + vec3(1.0, 0.25, 0.05) * g * (0.04 + smoothstep(2.2, 3.0, uS) * 0.12);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(bgeo, bmat));
    this.disposables.push(bgeo, bmat);

    this.path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 70, 70),
      new THREE.Vector3(30, 18, 72),
      new THREE.Vector3(10, 4, 78),
      new THREE.Vector3(0, 0, 70),
      new THREE.Vector3(0, 0, 46),
      new THREE.Vector3(0, 0, -60),
      new THREE.Vector3(0, 0, -200),
    ]);
    this.lookPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 6, 0),
      new THREE.Vector3(0, 6, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -20),
      new THREE.Vector3(0, 0, -160),
      new THREE.Vector3(0, 0, -400),
    ]);

    this.offs.push(
      this.ctx.pointer.on('click', (e) => {
        if (!this.active || e.ui) return;
        this.material.uniforms.uShock.value.set(this.hit.x, this.hit.y, this.hit.z, this.material.uniforms.uTime.value);
        this.ctx.audio.ping(110 * (2 + Math.floor(Math.random() * 4)), 0.12);
        this.ctx.bus.emit('glitch', 0.2);
      }),
    );
    this.ready = true;
  }

  enter() {
    this.ctx.audio.setScene(4);
  }

  leave() {
    if (this.ended) {
      this.ended = false;
      this.ctx.bus.emit('ending', false);
    }
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 68 : 50;
    this.camera.updateProjectionMatrix();
  }

  update(f: Frame) {
    const { dt, time } = f;
    const u = this.material.uniforms;
    this.p = damp(this.p, f.progress, 4, dt);
    const p = this.p;
    u.uTime.value = time;

    // stage mapping with holds: nebula · tower · word · gate
    const seg = (a: number, b: number) => smoothstep(a, b, p);
    const S = seg(0.12, 0.3) + seg(0.4, 0.55) + seg(0.64, 0.78);
    u.uS.value = S;

    // camera: path parameter follows the stages, final dive through the gate
    const cp = p < 0.78 ? (p / 0.78) * (3 / 6) + seg(0.64, 0.78) * (1 / 6) : 4 / 6 + seg(0.8, 1.0) * (2 / 6);
    const pos = this.path.getPoint(Math.min(1, cp));
    const look = this.lookPath.getPoint(Math.min(1, cp + 0.005));
    const pt = this.ctx.pointer;
    const par = 1 - seg(0.78, 0.9);
    pos.x += pt.smooth.x * 6 * par;
    pos.y += pt.smooth.y * 4 * par;
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this.camera.rotateZ(seg(0.8, 1) * time * 0.2);

    // gate
    const gateOn = seg(0.7, 0.8);
    (this.gate.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = gateOn;
    this.gate.rotation.z = time * 0.1;
    this.gate.children[1].rotation.y = Math.sin(time * 0.4) * 0.4;

    // crossing the gate → flash
    const z = this.camera.position.z;
    if (!this.crossed && z < 0 && this.active) {
      this.crossed = true;
      this.ctx.bus.emit('flash', 1);
      this.ctx.bus.emit('glitch', 1);
      this.ctx.audio.boom();
    } else if (this.crossed && z > 4) this.crossed = false;

    const end = p > 0.965;
    if (end !== this.ended && this.active) {
      this.ended = end;
      this.ctx.bus.emit('ending', end);
    }
    u.uBright.value = 1 - seg(0.88, 0.99) * 0.94;

    // cursor in the plane facing the camera through the field
    this.ray.setFromCamera(pt.ndc, this.camera);
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    this.plane.setFromNormalAndCoplanarPoint(dir, this.camera.position.clone().add(dir.multiplyScalar(40)));
    if (pt.hasMoved && this.ray.ray.intersectPlane(this.plane, this.hit)) {
      u.uMouse.value.lerp(this.hit, 1 - Math.exp(-dt * 14));
    }
    // velocity in world units, oriented with the camera
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const wv = right.multiplyScalar(pt.vel.x * 4).add(up.multiplyScalar(pt.vel.y * 4));
    u.uMouseVel.value.lerp(wv, 1 - Math.exp(-dt * 8));
    if (u.uMouseVel.value.length() > 30) u.uMouseVel.value.setLength(30);
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
