import * as THREE from 'three';
import { Scene3D, type Frame } from '../core/Scene3D';
import type { Ctx } from '../core/Ctx';
import { Q } from '../core/Quality';
import { damp, mulberry32, valueNoise2D, clamp } from '../core/math';
import { hash } from '../gl/chunks';
import { TypePlane } from '../gl/TypePlane';

const ACCENT = new THREE.Color(0xff4a1c);
const BASE = new THREE.Color(0x4a4640);
const FOG = new THREE.Color(0x0c0807);

/**
 * 01 · UMBRAL — a parametric city of thousands of monoliths that grows out
 * of the ground, reacts to the cursor like a pressure field, ripples on
 * click, and is crossed by the camera — straight through the word APEIRON.
 */
export class EntryScene extends Scene3D {
  readonly name = 'UMBRAL';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);

  private shared = {
    uTime: { value: 0 },
    uBuild: { value: 0 },
    uCursor: { value: new THREE.Vector3(0, 0, -20) },
    uCursorStrength: { value: 0 },
    uRipple: { value: new THREE.Vector4(0, 0, -100, 0) },
    uCamPos: { value: new THREE.Vector3() },
    uFogColor: { value: FOG.clone() },
    uFogDensity: { value: 0.0072 },
    uAccent: { value: ACCENT.clone() },
  };

  private disposables: { dispose(): void }[] = [];
  private title!: TypePlane;
  private groundType!: TypePlane;
  private anomaly!: THREE.Mesh;
  private anomalyHalo!: THREE.Mesh;
  private anomalyFound = false;
  private ring!: THREE.Group;
  private dust!: THREE.Points;
  private path!: THREE.CatmullRomCurve3;
  private look!: THREE.CatmullRomCurve3;
  private p = 0;
  private prevCamZ = 100;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private hovering = false;
  private offs: (() => void)[] = [];
  buildTarget = 0;

  constructor(ctx: Ctx) {
    super(ctx);
  }

  init() {
    this.scene.background = FOG.clone();
    this.buildCity();
    this.buildGround();
    this.buildSky();
    this.buildGate();
    this.buildDust();
    this.buildTypography();
    this.buildAnomaly();

    this.path = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 46, 52),
        new THREE.Vector3(0, 24, 20),
        new THREE.Vector3(0, 8, -2),
        new THREE.Vector3(0, 4.6, -30),
        new THREE.Vector3(0, 5.5, -75),
        new THREE.Vector3(0, 9, -135),
      ],
      false,
      'centripetal',
    );
    this.look = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 0, -45),
        new THREE.Vector3(0, 3, -45),
        new THREE.Vector3(0, 5, -45),
        new THREE.Vector3(0, 5, -85),
        new THREE.Vector3(0, 8, -160),
        new THREE.Vector3(0, 14, -300),
      ],
      false,
      'centripetal',
    );

    this.offs.push(
      this.ctx.pointer.on('click', (e) => {
        if (!this.active || e.ui) return;
        if (this.hovering && !this.anomalyFound) return this.collectAnomaly();
        this.shared.uRipple.value.set(this.hit.x, this.hit.z, this.shared.uTime.value, 1);
        this.ctx.bus.emit('glitch', 0.25);
        this.ctx.audio.ping(220 + Math.random() * 110, 0.1, 'triangle');
      }),
    );
    this.ready = true;
  }

  // ───────────────────────────────── city
  private buildCity() {
    const [cols, rows] = Q.grid;
    const spacing = 2.6;
    const noise = valueNoise2D(7);
    const rand = mulberry32(42);
    const offsets: number[] = [];
    const scales: number[] = [];
    const seeds: number[] = [];
    const avenue = 5.2;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = (i - (cols - 1) / 2) * spacing + (rand() - 0.5) * 0.5;
        const z = 25 - j * spacing + (rand() - 0.5) * 0.5;
        if (Math.abs(x) < avenue) continue;
        // keep the gate's sightline open
        if (z < -150) continue;
        const n = noise(x * 0.06, z * 0.06);
        const n2 = noise(x * 0.21 + 30, z * 0.21);
        const edge = Math.abs(x) - avenue;
        let h = 1.2 + Math.pow(n, 2.4) * 20 + n2 * 3;
        h *= 1 + 0.8 * Math.exp(-edge * 0.2);
        if (rand() < 0.02) h += 14 + rand() * 18;
        if (rand() < 0.1) h *= 0.25; // plazas
        const w = spacing * (0.42 + rand() * 0.42);
        const d = spacing * (0.42 + rand() * 0.42);
        offsets.push(x, 0, z);
        scales.push(w, h, d);
        seeds.push(rand());
      }
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.setAttribute('position', box.getAttribute('position'));
    geo.setAttribute('normal', box.getAttribute('normal'));
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(scales), 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
    geo.instanceCount = seeds.length;

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.shared, uBase: { value: BASE.clone() } },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset; attribute vec3 aScale; attribute float aSeed;
        uniform float uTime; uniform float uBuild; uniform vec3 uCursor; uniform float uCursorStrength; uniform vec4 uRipple;
        varying vec3 vN; varying vec3 vW; varying vec3 vLocal; varying float vSeed; varying float vGlow; varying vec3 vScale;
        void main(){
          float d = length(aOffset.xz - vec2(0.0, -10.0));
          float delay = clamp(d / 120.0, 0.0, 1.0) * 0.62 + aSeed * 0.18;
          float b = clamp((uBuild - delay) / 0.28, 0.0, 1.0);
          b = 1.0 - pow(1.0 - b, 3.0);
          float cd = length(aOffset.xz - uCursor.xz);
          float lift = exp(-cd * cd / 46.0) * uCursorStrength;
          float rt = uTime - uRipple.z;
          float rd = length(aOffset.xz - uRipple.xy);
          float rip = exp(-pow(rd - rt * 24.0, 2.0) / 12.0) * exp(-rt * 0.7) * uRipple.w * step(0.0, rt);
          float breathe = sin(d * 0.25 - uTime * 0.9) * 0.5 + 0.5;
          float h = aScale.y * b * (1.0 + lift * 0.7) + (lift * 3.5 + rip * 5.0 + breathe * 0.25) * b;
          vec3 p = position;
          p.xz *= aScale.xz;
          p.y *= h;
          vec4 w = modelMatrix * vec4(p + aOffset, 1.0);
          vW = w.xyz;
          vN = normal;
          vLocal = vec3(position.x * aScale.x, position.y * h, position.z * aScale.z);
          vSeed = aSeed;
          vGlow = lift + rip;
          vScale = vec3(aScale.x, h, aScale.z);
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCamPos; uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uAccent; uniform vec3 uBase; uniform float uTime;
        varying vec3 vN; varying vec3 vW; varying vec3 vLocal; varying float vSeed; varying float vGlow; varying vec3 vScale;
        ${hash}
        void main(){
          vec3 n = normalize(vN);
          vec3 V = normalize(uCamPos - vW);
          float sky = 0.3 + 0.7 * (n.y * 0.5 + 0.5);
          float back = max(dot(n, normalize(vec3(0.0, 0.25, -1.0))), 0.0);
          float front = max(dot(n, normalize(vec3(0.35, 0.5, 1.0))), 0.0);
          float ao = smoothstep(-2.0, 18.0, vW.y) * 0.85 + 0.15;
          vec3 col = uBase * (sky * 0.22 + front * 0.38) * ao;
          col += uAccent * back * 0.5 * ao;

          // facade: procedural windows, a few lit
          float side = 1.0 - abs(n.y);
          vec2 fuv = abs(n.x) > 0.5 ? vec2(vLocal.z, vLocal.y) : vec2(vLocal.x, vLocal.y);
          vec2 g = fuv * vec2(2.4, 1.7);
          vec2 cell = floor(g);
          vec2 fc = fract(g);
          float win = step(0.22, fc.x) * step(fc.x, 0.78) * step(0.32, fc.y) * step(fc.y, 0.72);
          float face = floor(n.x * 3.0 + n.z * 7.0);
          float lit = step(0.86, hash12(cell + vSeed * 91.7 + face * 13.0));
          float flick = 0.75 + 0.25 * sin(uTime * (1.0 + vSeed * 3.0) + cell.y);
          vec3 wcol = mix(vec3(1.0, 0.8, 0.6), uAccent, step(0.6, hash12(cell + vSeed)));
          col += win * lit * side * wcol * 1.8 * flick * step(0.8, vLocal.y);
          col *= 1.0 - win * side * 0.25;

          // incandescent crowns where the cursor lifts the city
          float top = step(0.5, n.y);
          vec2 ed = vScale.xz * 0.5 - abs(vLocal.xz);
          float rim = top * (1.0 - smoothstep(0.0, 0.07, min(ed.x, ed.y)));
          col += uAccent * (rim * (0.35 + vGlow * 5.0) + top * vGlow * 1.2);
          // vertical edges
          vec2 ve = vScale.xz * 0.5 - abs(vLocal.xz);
          float across = abs(n.x) > 0.5 ? ve.y : ve.x;
          float vedge = side * (1.0 - smoothstep(0.0, 0.04, across));
          col += mix(vec3(0.9, 0.85, 0.8) * 0.06, uAccent * 0.5, back) * vedge;

          float dist = length(vW - uCamPos);
          float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.6));
          fog = max(fog, (1.0 - smoothstep(0.0, 4.0, vW.y)) * 0.3 * smoothstep(10.0, 90.0, dist));
          vec3 fogCol = mix(uFogColor, uAccent * 0.55, pow(max(dot(-V, vec3(0.0, 0.0, -1.0)), 0.0), 10.0) * 0.8);
          col = mix(col, fogCol, clamp(fog, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.disposables.push(box, geo, mat);
  }

  // ───────────────────────────────── ground
  private buildGround() {
    const geo = new THREE.PlaneGeometry(900, 900, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.shared,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCursor; uniform float uCursorStrength; uniform float uTime; uniform vec3 uCamPos;
        uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uAccent; uniform vec4 uRipple;
        varying vec3 vW;
        float gridLine(vec2 p, float s){
          vec2 q = p / s;
          vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
          return 1.0 - min(min(g.x, g.y), 1.0);
        }
        void main(){
          vec2 p = vW.xz;
          float g1 = gridLine(p, 2.6) * 0.18;
          float g2 = gridLine(p, 13.0) * 0.45;
          vec3 col = vec3(0.006, 0.005, 0.006);
          col += (g1 + g2) * vec3(0.09, 0.08, 0.075);
          float cd = length(p - uCursor.xz);
          float ring = smoothstep(0.12, 0.0, abs(cd - 6.0)) + smoothstep(0.06, 0.0, abs(cd - 12.0)) * 0.5;
          float ang = atan(p.y - uCursor.z, p.x - uCursor.x);
          float ticks = step(0.92, fract(ang / 6.2831 * 48.0)) * smoothstep(0.9, 0.0, abs(cd - 7.0));
          col += uAccent * (ring + ticks) * 1.6 * uCursorStrength;
          col += uAccent * exp(-cd * 0.18) * (g1 + g2) * 4.0 * uCursorStrength;
          float rt = uTime - uRipple.z;
          float rd = length(p - uRipple.xy);
          col += uAccent * exp(-pow(rd - rt * 24.0, 2.0) / 3.0) * exp(-rt * 0.7) * uRipple.w * step(0.0, rt) * 2.5;
          // glossy reflection of the horizon glow along the avenue
          float refl = exp(-abs(p.x) * 0.05) * smoothstep(40.0, -260.0, p.y);
          col += uAccent * refl * 0.25;
          float dist = length(vW - uCamPos);
          float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.6));
          vec3 V = normalize(vW - uCamPos);
          vec3 fogCol = mix(uFogColor, uAccent * 0.55, pow(max(dot(V, vec3(0.0, 0.0, -1.0)), 0.0), 10.0) * 0.8);
          gl_FragColor = vec4(mix(col, fogCol, clamp(fog, 0.0, 1.0)), 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = -150;
    this.scene.add(mesh);
    this.disposables.push(geo, mat);
  }

  // ───────────────────────────────── sky dome
  private buildSky() {
    const geo = new THREE.SphereGeometry(800, 48, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.shared,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uAccent; uniform vec3 uFogColor; uniform float uTime;
        varying vec3 vDir;
        ${hash}
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 top = vec3(0.004, 0.004, 0.007);
          vec3 col = mix(uFogColor, top, smoothstep(0.0, 0.4, h));
          float sun = pow(max(dot(d, normalize(vec3(0.0, 0.03, -1.0))), 0.0), 18.0);
          col += uAccent * sun * 1.6;
          col += uAccent * exp(-abs(h) * 22.0) * 0.5 * smoothstep(-0.6, -1.0, d.z);
          vec2 sp = floor(vec2(atan(d.x, d.z), h) * 420.0);
          float star = step(0.9985, hash12(sp)) * smoothstep(0.08, 0.5, h);
          col += star * (0.4 + 0.6 * sin(uTime * 2.0 + sp.x)) * 0.8;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
    this.disposables.push(geo, mat);
  }

  // ───────────────────────────────── the gate (it returns at the end)
  private buildGate() {
    this.ring = new THREE.Group();
    this.ring.position.set(0, 18, -330);
    const mk = (r: number, tube: number, intensity: number) => {
      const geo = new THREE.TorusGeometry(r, tube, 12, 256);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: this.shared.uTime, uI: { value: intensity }, uAccent: this.shared.uAccent },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uI; uniform vec3 uAccent; varying vec2 vUv;
          void main(){
            float seg = step(0.12, fract(vUv.x * 64.0 + uTime * 0.2));
            float pulse = 0.6 + 0.4 * sin(vUv.x * 6.2831 * 3.0 - uTime * 1.5);
            gl_FragColor = vec4(uAccent * uI * (0.4 + seg * pulse), 1.0);
          }
        `,
      });
      const m = new THREE.Mesh(geo, mat);
      this.disposables.push(geo, mat);
      return m;
    };
    this.ring.add(mk(78, 0.9, 3.2));
    const inner = mk(70, 0.25, 2.2);
    this.ring.add(inner);
    const tilted = mk(86, 0.18, 1.6);
    tilted.rotation.x = 0.35;
    this.ring.add(tilted);
    this.scene.add(this.ring);
  }

  // ───────────────────────────────── floating dust
  private buildDust() {
    const n = Q.tier === 'low' ? 1200 : 3000;
    const rand = mulberry32(9);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rand() - 0.5) * 140;
      pos[i * 3 + 1] = rand() * 40;
      pos[i * 3 + 2] = 40 - rand() * 220;
      seed[i] = rand();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { ...this.shared, uPx: { value: Q.dpr } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform float uPx; varying float vA; varying float vS;
        void main(){
          vec3 p = position;
          p.y = mod(position.y + uTime * (0.3 + aSeed * 0.6), 40.0);
          p.x += sin(uTime * 0.3 + aSeed * 30.0) * 1.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.0 + aSeed * 2.5) * uPx * 30.0 / -mv.z;
          vA = smoothstep(120.0, 10.0, -mv.z) * smoothstep(0.5, 3.0, -mv.z);
          vS = aSeed;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uAccent; varying float vA; varying float vS;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          vec3 c = mix(vec3(0.9, 0.85, 0.8), uAccent * 2.0, step(0.7, vS));
          gl_FragColor = vec4(c, a * vA * 0.7);
        }
      `,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    this.disposables.push(geo, mat);
  }

  // ───────────────────────────────── typography inside the world
  private buildTypography() {
    this.title = new TypePlane({ text: 'APEIRON', width: 54, color: 0xece6da, fogDensity: 0.006, fogColor: FOG, glow: 0.3 });
    this.title.position.set(0, 8, -34);
    this.scene.add(this.title);
    this.groundType = new TypePlane({ text: 'COTA ±0.00 — UMBRAL', width: 9.5, weight: 500, color: 0xff4a1c, glow: 1.5, opacity: 0.9 });
    this.groundType.rotation.x = -Math.PI / 2;
    this.groundType.position.set(0, 0.03, -8);
    this.scene.add(this.groundType);
    this.disposables.push(this.title, this.groundType);
  }

  private buildAnomaly() {
    const geo = new THREE.OctahedronGeometry(1.1, 0);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a1c).multiplyScalar(5), wireframe: true });
    this.anomaly = new THREE.Mesh(geo, mat);
    this.anomaly.position.set(17, 31, -58);
    const hgeo = new THREE.SphereGeometry(2.6, 16, 12);
    const hmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a1c).multiplyScalar(1.2), transparent: true, opacity: 0.15, depthWrite: false });
    this.anomalyHalo = new THREE.Mesh(hgeo, hmat);
    this.anomaly.add(this.anomalyHalo);
    this.scene.add(this.anomaly);
    this.disposables.push(geo, mat, hgeo, hmat);
  }

  private collectAnomaly() {
    this.anomalyFound = true;
    this.ctx.bus.emit('anomaly', { id: 'city', label: 'EL OCTAEDRO SOBRE LA CIUDAD' });
    this.ctx.bus.emit('cursorHint', null);
    this.hovering = false;
    this.shared.uRipple.value.set(this.anomaly.position.x, this.anomaly.position.z, this.shared.uTime.value, 2.5);
  }

  // ───────────────────────────────── lifecycle
  enter() {
    this.ctx.audio.setScene(0);
  }

  leave() {
    if (this.hovering) this.ctx.bus.emit('cursorHint', null);
    this.hovering = false;
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 72 : 55;
    this.camera.updateProjectionMatrix();
  }

  update(f: Frame) {
    const { dt, time } = f;
    const s = this.shared;
    s.uTime.value = time;
    s.uBuild.value = damp(s.uBuild.value, this.buildTarget, 0.9, dt);
    this.p = damp(this.p, f.progress, 5, dt);

    const pt = this.ctx.pointer;
    const pos = this.path.getPointAt(this.p);
    const par = 1 - this.p * 0.6;
    pos.x += pt.smooth.x * 4 * par;
    pos.y += pt.smooth.y * 2 * par;
    this.camera.position.copy(pos);
    const tgt = this.look.getPointAt(Math.min(1, this.p + 0.01));
    tgt.x += pt.smooth.x * 6;
    tgt.y += pt.smooth.y * 3;
    this.camera.lookAt(tgt);
    this.camera.rotateZ(-pt.vel.x * 0.006);
    s.uCamPos.value.copy(this.camera.position);

    // cursor on the ground
    this.ray.setFromCamera(pt.ndc, this.camera);
    if (this.ray.ray.intersectPlane(this.ground, this.hit)) {
      s.uCursor.value.lerp(this.hit, 1 - Math.exp(-dt * 10));
    }
    s.uCursorStrength.value = damp(s.uCursorStrength.value, pt.hasMoved ? 1 : 0, 3, dt);

    // anomaly
    if (!this.anomalyFound) {
      this.anomaly.rotation.x = time * 0.7;
      this.anomaly.rotation.y = time * 1.1;
      this.anomaly.position.y = 31 + Math.sin(time * 0.8) * 1.2;
      const over = this.ray.intersectObject(this.anomalyHalo, false).length > 0;
      if (over !== this.hovering) {
        this.hovering = over;
        this.ctx.bus.emit('cursorHint', over ? '¿ANOMALÍA?' : null);
      }
    } else {
      this.anomaly.scale.setScalar(damp(this.anomaly.scale.x, 0.0001, 6, dt));
    }

    // camera crosses the title plane → controlled glitch
    const z = this.camera.position.z;
    if (this.prevCamZ > this.title.position.z && z <= this.title.position.z) {
      this.ctx.bus.emit('glitch', 0.9);
      this.ctx.audio.ping(660, 0.12);
    } else if (this.prevCamZ < this.title.position.z && z >= this.title.position.z) {
      this.ctx.bus.emit('glitch', 0.6);
    }
    this.prevCamZ = z;

    this.title.time = time;
    this.title.material.uniforms.uReveal.value = clamp(s.uBuild.value * 1.3 - 0.2);
    this.groundType.time = time;
    this.ring.rotation.z = time * 0.03;
    this.ring.children[2].rotation.y = Math.sin(time * 0.2) * 0.3;
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
