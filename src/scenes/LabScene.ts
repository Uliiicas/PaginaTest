import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Scene3D, type Frame } from '../core/Scene3D';
import { Q } from '../core/Quality';
import { damp, lerp, mulberry32 } from '../core/math';

export interface LabParams {
  floors: number;
  twist: number; // degrees
  taper: number;
  sides: number;
  bulge: number;
  explode: number;
  time: number; // 0 dawn → 0.33 noon → 0.66 dusk → 1 night
}

export const MATERIALS = ['HORMIGÓN', 'CRISTAL', 'CROMO', 'PLANO', 'HOLOGRAMA'] as const;

const MAX_F = 90;
const MAX_S = 48;
const FLOOR_H = 0.62;
const SLAB = 0.14;
const R0 = 3.4;

type Light = { bg: THREE.Color; sun: THREE.Color; sunI: number; amb: number; env: number; night: number; elev: number };
const SKY: Light[] = [
  { bg: new THREE.Color(0x2a140c), sun: new THREE.Color(0xff8a4c), sunI: 2.2, amb: 0.25, env: 0.6, night: 0, elev: 0.12 },
  { bg: new THREE.Color(0x8e8c88), sun: new THREE.Color(0xfff6e8), sunI: 3.2, amb: 0.5, env: 1.0, night: 0, elev: 1.1 },
  { bg: new THREE.Color(0x3a1408), sun: new THREE.Color(0xff5a1c), sunI: 2.0, amb: 0.2, env: 0.5, night: 0.2, elev: 0.18 },
  { bg: new THREE.Color(0x05060c), sun: new THREE.Color(0x6f86ff), sunI: 0.5, amb: 0.08, env: 0.15, night: 1, elev: 0.7 },
];

/**
 * 04 · LABORATORIO — a parametric tower generator. Every slider rebuilds the
 * geometry in place (pre-allocated buffers, no allocations per frame) while
 * parameters glide toward their targets, so the building *morphs* instead of
 * popping. Materials are physically based with real environment reflections,
 * transmission and iridescence; a sun cycle drives light and shadows.
 */
export class LabScene extends Scene3D {
  readonly name = 'LABORATORIO';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
  target: LabParams = { floors: 42, twist: 160, taper: 0.62, sides: 4, bulge: 0.18, explode: 0, time: 0.66 };
  private cur: LabParams = { ...this.target };
  private sidesCur = 4;
  materialIndex = 0;

  private tower = new THREE.Group();
  private slabGeo = new THREE.BufferGeometry();
  private glassGeo = new THREE.BufferGeometry();
  private lineGeo = new THREE.BufferGeometry();
  private slabs!: THREE.Mesh;
  private glass!: THREE.Mesh;
  private lines!: THREE.LineSegments;
  private sun = new THREE.DirectionalLight(0xffffff, 3);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.4);
  private ground!: THREE.Mesh;
  private gridMat!: THREE.ShaderMaterial;
  private controls?: OrbitControls;
  private envTex?: THREE.Texture;
  private mats: { slab: THREE.Material; glass: THREE.Material; lines: boolean; solid: boolean }[] = [];
  private disposables: { dispose(): void }[] = [];
  private dirty = true;
  private height = 1;
  private p = 0;
  private camDist = 40;
  private holoUniforms = { uTime: { value: 0 }, uAccent: { value: new THREE.Color(0xff4a1c) } };
  private found = false;
  private stage?: HTMLElement | null;

  private slabPos = new Float32Array(MAX_F * MAX_S * 12 * 3);
  private slabNor = new Float32Array(MAX_F * MAX_S * 12 * 3);
  private glassPos = new Float32Array(MAX_F * MAX_S * 6 * 3);
  private glassNor = new Float32Array(MAX_F * MAX_S * 6 * 3);
  private glassLit = new Float32Array(MAX_F * MAX_S * 6);
  private linePos = new Float32Array(MAX_F * MAX_S * 4 * 3);

  init() {
    const pm = new THREE.PMREMGenerator(this.ctx.renderer);
    const room = new RoomEnvironment();
    this.envTex = pm.fromScene(room, 0.04).texture;
    room.dispose();
    pm.dispose();
    this.scene.environment = this.envTex;
    this.scene.background = new THREE.Color(0x111111);
    this.scene.fog = new THREE.Fog(0x111111, 60, 160);

    this.slabGeo.setAttribute('position', new THREE.BufferAttribute(this.slabPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.slabGeo.setAttribute('normal', new THREE.BufferAttribute(this.slabNor, 3).setUsage(THREE.DynamicDrawUsage));
    this.glassGeo.setAttribute('position', new THREE.BufferAttribute(this.glassPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.glassGeo.setAttribute('normal', new THREE.BufferAttribute(this.glassNor, 3).setUsage(THREE.DynamicDrawUsage));
    this.glassGeo.setAttribute('aLit', new THREE.BufferAttribute(this.glassLit, 1).setUsage(THREE.DynamicDrawUsage));
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.buildMaterials();

    this.slabs = new THREE.Mesh(this.slabGeo, this.mats[0].slab);
    this.slabs.castShadow = true;
    this.slabs.receiveShadow = true;
    this.glass = new THREE.Mesh(this.glassGeo, this.mats[0].glass);
    this.glass.castShadow = true;
    const lmat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    this.lines = new THREE.LineSegments(this.lineGeo, lmat);
    this.lines.visible = false;
    for (const o of [this.slabs, this.glass, this.lines]) o.frustumCulled = false;
    this.tower.add(this.slabs, this.glass, this.lines);
    this.scene.add(this.tower);
    this.disposables.push(this.slabGeo, this.glassGeo, this.lineGeo, lmat);

    // ground
    const ggeo = new THREE.PlaneGeometry(400, 400);
    ggeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.45 });
    this.ground = new THREE.Mesh(ggeo, shadowMat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uA: { value: 0.18 }, uAccent: this.holoUniforms.uAccent },
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uA; uniform vec3 uAccent; varying vec3 vW;
        float gl(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main(){
          float r = length(vW.xz);
          float fade = 1.0 - smoothstep(8.0, 70.0, r);
          float g = gl(vW.xz, 1.0) * 0.3 + gl(vW.xz, 5.0) * 0.7;
          float site = smoothstep(0.08, 0.0, abs(r - 9.0)) + smoothstep(0.05, 0.0, abs(r - 9.6)) * 0.6;
          float ax = smoothstep(0.06, 0.0, abs(vW.x)) + smoothstep(0.06, 0.0, abs(vW.z));
          vec3 col = uColor * g + uAccent * (site * 2.0 + ax * 1.2);
          gl_FragColor = vec4(col, (g * uA + site * 0.8 + ax * 0.5) * fade);
        }
      `,
    });
    const grid = new THREE.Mesh(ggeo, this.gridMat);
    grid.position.y = 0.01;
    this.scene.add(grid);
    this.disposables.push(ggeo, shadowMat, this.gridMat);

    // lights
    this.sun.castShadow = Q.shadows;
    this.sun.shadow.mapSize.set(Q.tier === 'high' ? 2048 : 1024, Q.tier === 'high' ? 2048 : 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 40; sc.bottom = -30; sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    // orbit (desktop) — wheel stays free so the page keeps scrolling
    this.stage = document.getElementById('lab-stage');
    if (this.stage && !Q.isTouch) {
      this.controls = new OrbitControls(this.camera, this.stage);
      this.controls.enableZoom = false;
      this.controls.enablePan = false;
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.06;
      this.controls.rotateSpeed = 0.55;
      this.controls.minPolarAngle = 0.25;
      this.controls.maxPolarAngle = 1.48;
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 0.6;
      this.controls.enabled = false;
      this.camera.position.set(28, 18, 30);
      this.controls.addEventListener('start', () => (this.controls!.autoRotate = false));
      this.controls.addEventListener('end', () => setTimeout(() => this.controls && (this.controls.autoRotate = true), 3500));
    } else {
      this.camera.position.set(28, 18, 30);
    }
    this.ready = true;
  }

  private concreteTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    const img = g.createImageData(512, 512);
    const rand = mulberry32(11);
    for (let i = 0; i < 512 * 512; i++) {
      const y = Math.floor(i / 512);
      const v = 200 + (rand() - 0.5) * 40 + Math.sin(y * 0.9) * 4 - (rand() < 0.004 ? 60 : 0);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v * 0.97;
      img.data[i * 4 + 2] = v * 0.93;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private buildMaterials() {
    const concreteMap = this.concreteTexture();
    this.disposables.push(concreteMap);
    const holo = (opacity: number) =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { ...this.holoUniforms, uO: { value: opacity } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV; varying vec3 vW;
          void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uAccent; uniform float uO; varying vec3 vN; varying vec3 vV; varying vec3 vW;
          void main(){
            float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
            float scan = 0.6 + 0.4 * sin(vW.y * 18.0 - uTime * 6.0);
            float sweep = exp(-pow(fract(vW.y * 0.03 - uTime * 0.25) - 0.5, 2.0) * 300.0);
            vec3 col = uAccent * (f * 2.4 + 0.12) * scan + vec3(1.0, 0.7, 0.5) * sweep * 1.5;
            gl_FragColor = vec4(col * uO, 1.0);
          }
        `,
      });

    // per-floor window lights: an `aLit` attribute scales the emissive term
    const litPatch = <M extends THREE.Material>(m: M) => {
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = 'attribute float aLit;\nvarying float vLit;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;');
        sh.fragmentShader = 'varying float vLit;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vLit;');
      };
      return m;
    };
    this.mats = [
      {
        slab: new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.88, metalness: 0, map: concreteMap }),
        glass: litPatch(new THREE.MeshPhysicalMaterial({ color: 0x232a36, roughness: 0.06, metalness: 0.3, envMapIntensity: 1.6, transparent: true, opacity: 0.9, emissive: 0xffa060, emissiveIntensity: 0 })),
        lines: false,
        solid: true,
      },
      {
        slab: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, transmission: Q.tier === 'low' ? 0 : 1, thickness: 0.8, ior: 1.5, iridescence: 0.8, iridescenceIOR: 1.3, transparent: Q.tier === 'low', opacity: 0.5 }),
        glass: litPatch(new THREE.MeshPhysicalMaterial({ color: 0xeaf2ff, roughness: 0.0, metalness: 0.1, transmission: Q.tier === 'low' ? 0 : 1, thickness: 0.15, iridescence: 1, iridescenceIOR: 1.6, transparent: true, opacity: 0.55, side: THREE.DoubleSide, emissive: 0xffa060, emissiveIntensity: 0 })),
        lines: true,
        solid: true,
      },
      {
        slab: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.12, metalness: 1, envMapIntensity: 1.4 }),
        glass: litPatch(new THREE.MeshPhysicalMaterial({ color: 0xff5a26, roughness: 0.02, metalness: 1, envMapIntensity: 1.8, clearcoat: 1, emissive: 0xff7a40, emissiveIntensity: 0 })),
        lines: false,
        solid: true,
      },
      {
        slab: new THREE.MeshBasicMaterial({ color: 0x0b2a8a, transparent: true, opacity: 0.25 }),
        glass: new THREE.MeshBasicMaterial({ color: 0x0b2a8a, transparent: true, opacity: 0.12, depthWrite: false }),
        lines: true,
        solid: false,
      },
      { slab: holo(0.32), glass: holo(0.16), lines: true, solid: false },
    ];
    this.mats.forEach((m) => this.disposables.push(m.slab, m.glass));
  }

  setMaterial(i: number) {
    this.materialIndex = i;
    const m = this.mats[i];
    this.slabs.material = m.slab;
    this.glass.material = m.glass;
    this.lines.visible = m.lines;
    (this.lines.material as THREE.LineBasicMaterial).color.set(i === 4 ? 0xff7a40 : i === 1 ? 0x9fb4ff : 0xffffff);
    this.slabs.castShadow = this.glass.castShadow = m.solid;
    this.ctx.bus.emit('glitch', 0.8);
    this.ctx.audio.ping(523 + i * 70, 0.1);
  }

  set(p: Partial<LabParams>) {
    Object.assign(this.target, p);
    this.dirty = true;
    if (!this.found && this.target.sides === 3 && this.target.twist >= 700) {
      this.found = true;
      this.ctx.bus.emit('anomaly', { id: 'tower', label: 'LA TORRE QUE NO DEBERÍA EXISTIR' });
    }
  }

  mutate() {
    const r = Math.random;
    const sides = [3, 4, 5, 6, 8, 48][Math.floor(r() * 6)];
    this.set({
      floors: Math.round(14 + r() * 74),
      twist: Math.round(r() * 540),
      taper: +(0.25 + r() * 1.2).toFixed(2),
      sides,
      bulge: +(-0.4 + r() * 1.1).toFixed(2),
      explode: r() < 0.3 ? +(r() * 1.2).toFixed(2) : 0,
    });
    this.ctx.bus.emit('glitch', 0.5);
    return this.target;
  }

  /** Writes geometry for the current (interpolated) parameters into the shared buffers. */
  private rebuild() {
    const P = this.cur;
    const F = Math.max(2, Math.min(MAX_F, Math.round(P.floors)));
    const S = Math.max(3, Math.min(MAX_S, Math.round(this.sidesCur)));
    const twist = (P.twist * Math.PI) / 180;
    const sp = this.slabPos, sn = this.slabNor, gp = this.glassPos, gn = this.glassNor, gl = this.glassLit, lp = this.linePos;
    let si = 0, gi = 0, li = 0;
    const rand = mulberry32(77);
    const ring = (i: number) => {
      const t = i / (F - 1);
      const r = R0 * lerp(1, P.taper, t) * (1 + P.bulge * Math.sin(t * Math.PI));
      const a0 = twist * t;
      const y = i * FLOOR_H * (1 + P.explode * 1.6);
      return { r, a0, y };
    };
    const vx = (r: number, a: number) => r * Math.cos(a);
    const vz = (r: number, a: number) => r * Math.sin(a);
    const pushS = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      sp[si] = x; sp[si + 1] = y; sp[si + 2] = z;
      sn[si] = nx; sn[si + 1] = ny; sn[si + 2] = nz;
      si += 3;
    };
    const step = (Math.PI * 2) / S;
    for (let i = 0; i < F; i++) {
      const { r, a0, y } = ring(i);
      const y0 = y, y1 = y + SLAB;
      for (let k = 0; k < S; k++) {
        const a = a0 + k * step, b = a + step;
        const ax = vx(r, a), az = vz(r, a), bx = vx(r, b), bz = vz(r, b);
        // top cap
        pushS(0, y1, 0, 0, 1, 0); pushS(bx, y1, bz, 0, 1, 0); pushS(ax, y1, az, 0, 1, 0);
        // bottom cap
        pushS(0, y0, 0, 0, -1, 0); pushS(ax, y0, az, 0, -1, 0); pushS(bx, y0, bz, 0, -1, 0);
        // edge
        const mx = Math.cos(a + step / 2), mz = Math.sin(a + step / 2);
        pushS(ax, y0, az, mx, 0, mz); pushS(ax, y1, az, mx, 0, mz); pushS(bx, y1, bz, mx, 0, mz);
        pushS(ax, y0, az, mx, 0, mz); pushS(bx, y1, bz, mx, 0, mz); pushS(bx, y0, bz, mx, 0, mz);
        // outline (top)
        lp[li++] = ax; lp[li++] = y1; lp[li++] = az; lp[li++] = bx; lp[li++] = y1; lp[li++] = bz;
      }
      if (i < F - 1) {
        const n = ring(i + 1);
        const lit = rand() < 0.55 ? 0.4 + rand() * 0.6 : 0.03;
        for (let k = 0; k < S; k++) {
          const a = a0 + k * step, b = a + step;
          const na = n.a0 + k * step, nb = na + step;
          const ri = r * 0.965, rn = n.r * 0.965;
          const p0 = [vx(ri, a), y + SLAB, vz(ri, a)];
          const p1 = [vx(ri, b), y + SLAB, vz(ri, b)];
          const p2 = [vx(rn, nb), n.y, vz(rn, nb)];
          const p3 = [vx(rn, na), n.y, vz(rn, na)];
          // face normal from two edges
          const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
          const wx = p3[0] - p0[0], wy = p3[1] - p0[1], wz = p3[2] - p0[2];
          let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= -l; ny /= -l; nz /= -l;
          for (const q of [p0, p2, p1, p0, p3, p2]) {
            gp[gi] = q[0]; gp[gi + 1] = q[1]; gp[gi + 2] = q[2];
            gn[gi] = nx; gn[gi + 1] = ny; gn[gi + 2] = nz;
            gl[gi / 3] = lit;
            gi += 3;
          }
          // vertical mullion line
          lp[li++] = vx(r, a); lp[li++] = y + SLAB; lp[li++] = vz(r, a);
          lp[li++] = vx(n.r, na); lp[li++] = n.y; lp[li++] = vz(n.r, na);
        }
      }
    }
    this.height = ring(F - 1).y + SLAB;
    this.slabGeo.setDrawRange(0, si / 3);
    this.glassGeo.setDrawRange(0, gi / 3);
    this.lineGeo.setDrawRange(0, li / 3);
    const upd = (g: THREE.BufferGeometry, floats: number) => {
      for (const a of Object.values(g.attributes) as THREE.BufferAttribute[]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, (floats / 3) * a.itemSize);
        a.needsUpdate = true;
      }
    };
    upd(this.slabGeo, si);
    upd(this.glassGeo, gi);
    upd(this.lineGeo, li);

    // stats for the HUD (1 unit ≈ 5.6 m)
    let area = 0;
    for (let i = 0; i < F; i++) {
      const { r } = ring(i);
      area += 0.5 * S * r * r * Math.sin((Math.PI * 2) / S) * 5.6 * 5.6;
    }
    this.ctx.bus.emit('labStats', { height: (F * FLOOR_H + SLAB) * 5.6, floors: F, area, twist: P.twist });
  }

  enter() {
    this.ctx.audio.setScene(3);
    this.dirty = true;
    if (this.controls) this.controls.enabled = true;
  }

  leave() {
    if (this.controls) this.controls.enabled = false;
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 55 : 38;
    this.camera.updateProjectionMatrix();
  }

  update(f: Frame) {
    const { dt } = f;

    this.p = damp(this.p, f.progress, 4, dt);
    // parameters glide → building morphs
    const k = 1 - Math.exp(-dt * 5);
    let moving = this.dirty;
    for (const key of ['floors', 'twist', 'taper', 'bulge', 'explode', 'time'] as const) {
      const d = this.target[key] - this.cur[key];
      if (Math.abs(d) > 1e-3) {
        this.cur[key] += d * k;
        moving = true;
      } else this.cur[key] = this.target[key];
    }
    const ds = this.target.sides - this.sidesCur;
    if (Math.abs(ds) > 0.01) {
      this.sidesCur += ds * k;
      moving = true;
    } else this.sidesCur = this.target.sides;
    if (moving) {
      this.rebuild();
      this.dirty = false;
    }
    this.tower.position.y = 0;

    // light cycle
    const tt = this.cur.time * (SKY.length - 1);
    const i0 = Math.min(SKY.length - 2, Math.floor(tt));
    const fr = tt - i0;
    const A = SKY[i0], B = SKY[i0 + 1];
    const bp = this.materialIndex === 3;
    const bg = bp ? new THREE.Color(0x06164a) : A.bg.clone().lerp(B.bg, fr);
    (this.scene.background as THREE.Color).copy(bg);
    (this.scene.fog as THREE.Fog).color.copy(bg);
    this.sun.color.copy(A.sun).lerp(B.sun, fr);
    this.sun.intensity = lerp(A.sunI, B.sunI, fr);
    this.hemi.intensity = lerp(A.amb, B.amb, fr);
    this.scene.environmentIntensity = lerp(A.env, B.env, fr);
    const night = lerp(A.night, B.night, fr);
    const elev = lerp(A.elev, B.elev, fr);
    const az = 0.8 + this.cur.time * 2.4;
    this.sun.position.set(Math.cos(az) * Math.cos(elev) * 60, Math.sin(elev) * 60 + 4, Math.sin(az) * Math.cos(elev) * 60);
    this.sun.target.position.set(0, this.height * 0.3, 0);
    const gm = this.glass.material as THREE.MeshPhysicalMaterial;
    if ('emissiveIntensity' in gm) gm.emissiveIntensity = night * (this.materialIndex === 2 ? 0.6 : 2.2);
    this.gridMat.uniforms.uA.value = bp ? 0.5 : 0.14 + night * 0.1;
    this.holoUniforms.uTime.value = f.time;

    // framing: keep the whole tower in view as it grows
    const fit = Math.max(this.height * 0.5, R0 * 2.2);
    const portrait = innerWidth / innerHeight < 0.8;
    const want = fit / Math.tan((this.camera.fov * Math.PI) / 360) * (portrait ? 1.05 : 1.35) + 6;
    this.camDist = damp(this.camDist, want, 3, dt);
    const look = new THREE.Vector3(0, this.height * 0.45, 0);
    if (this.controls && this.controls.enabled) {
      this.controls.target.lerp(look, 1 - Math.exp(-dt * 3));
      const off = this.camera.position.clone().sub(this.controls.target);
      off.setLength(damp(off.length(), this.camDist, 3, dt));
      this.camera.position.copy(this.controls.target).add(off);
      this.controls.update(dt);
    } else {
      const a = f.time * 0.15 + this.p * 1.5;
      this.camera.position.set(Math.sin(a) * this.camDist * 0.8, look.y + this.camDist * 0.35, Math.cos(a) * this.camDist * 0.8);
      this.camera.lookAt(look);
    }
  }

  render(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    r.setRenderTarget(target);
    r.clear();
    r.render(this.scene, this.camera);
  }

  compileTargets() {
    // compile every material variant once
    const out: { scene: THREE.Scene; camera: THREE.Camera }[] = [];
    this.mats.forEach((m) => {
      const s = new THREE.Scene();
      s.environment = this.scene.environment;
      s.add(new THREE.Mesh(this.slabGeo, m.slab), new THREE.Mesh(this.glassGeo, m.glass), this.sun.clone(), new THREE.HemisphereLight());
      out.push({ scene: s, camera: this.camera });
    });
    out.push({ scene: this.scene, camera: this.camera });
    return out;
  }

  dispose() {
    this.controls?.dispose();
    this.envTex?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
