import * as THREE from 'three';
import { Scene3D, type Frame } from '../core/Scene3D';
import { Q } from '../core/Quality';
import { damp } from '../core/math';
import { fullscreenTriangle, Blit } from '../gl/fullscreen';
import { fullscreenVert, rot2 } from '../gl/chunks';

const ANOM_PERIOD = 46;
const ANOM_X = 1.05;
const ANOM_Y = 0.55;

/**
 * 02 · ESPACIO IMPOSIBLE — an infinite, signed-distance-field architecture
 * raymarched per pixel. Three spaces morph into each other by blending their
 * distance functions: a groin-vaulted colonnade, a Menger lattice and a
 * twisting gallery. Click folds space into the next one, holding triggers a
 * vertigo dolly-zoom, the cursor steers the gaze.
 */
const frag = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uCamZ;
uniform vec2 uLook;
uniform vec3 uW;
uniform float uFov;
uniform float uFound;
uniform float uPulse;
varying vec2 vUv;
${rot2}

float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }

// A · infinite colonnade with groin vaults
float roomA(vec3 p){
  float floorD = p.y + 1.6;
  vec2 q = mod(p.xz + 3.0, 6.0) - 3.0;
  float H = 1.4;
  float vx = length(vec2(p.y - H, q.y)) - 3.0;
  float vz = length(vec2(p.y - H, q.x)) - 3.0;
  float voidD = min(min(p.y - H, vx), vz);
  float ceilingD = -voidD;
  vec2 cq = abs(q) - 3.0;
  float lc = length(cq);
  float col = lc - 0.42;
  col = min(col, max(lc - 0.62, abs(p.y - H + 0.05) - 0.1));
  col = min(col, max(lc - 0.6, abs(p.y + 1.5) - 0.12));
  return min(min(floorD, ceilingD), col);
}

float sdCross(vec3 p, float r){
  p = abs(p);
  float da = max(p.x, p.y);
  float db = max(p.y, p.z);
  float dc = max(p.z, p.x);
  return min(da, min(db, dc)) - r;
}

// B · Menger lattice (infinite)
float roomB(vec3 p){
  float s = 9.0;
  vec3 q = mod(p + s * 0.5, s) - s * 0.5;
  float d = -sdCross(q, 1.6);
  s = 3.0;
  q = mod(p + s * 0.5, s) - s * 0.5;
  d = max(d, -sdCross(q, 0.52));
  s = 1.0;
  q = mod(p + s * 0.5, s) - s * 0.5;
  d = max(d, -sdCross(q, 0.17));
  return d;
}

// C · twisting gallery with portal frames and slit windows
float roomC(vec3 p){
  p.xy *= rot(p.z * 0.06 + uTime * 0.04);
  float m = max(abs(p.x), abs(p.y));
  float wall = max(2.6 - m, m - 3.2);
  float zz = mod(p.z + 1.5, 3.0) - 1.5;
  float slitH = sdBox(vec3(p.x, p.y, zz), vec3(6.0, 0.7, 0.55));
  float slitV = sdBox(vec3(p.x, p.y, zz), vec3(0.18, 6.0, 0.9));
  wall = max(wall, -min(slitH, slitV));
  float z = mod(p.z, 3.0) - 1.5;
  float frame = max(max(abs(z) - 0.1, 2.0 - m), m - 3.7);
  return min(wall, frame) * 0.8;
}

float scene(vec3 p){
  float d = 0.0;
  if (uW.x > 0.001) d += uW.x * roomA(p);
  if (uW.y > 0.001) d += uW.y * roomB(p);
  if (uW.z > 0.001) d += uW.z * roomC(p);
  return d;
}

float anomaly(vec3 p){
  vec3 q = p;
  q.z = mod(q.z + ${ANOM_PERIOD / 2}.0, ${ANOM_PERIOD}.0) - ${ANOM_PERIOD / 2}.0;
  q -= vec3(${ANOM_X}, ${ANOM_Y}, 0.0);
  q.xz *= rot(uTime * 1.3);
  q.xy *= rot(uTime * 0.7);
  q = abs(q);
  return (q.x + q.y + q.z - 0.22) * 0.577;
}

vec3 calcNormal(vec3 p){
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0025;
  return normalize(k.xyy * scene(p + k.xyy * h) + k.yyx * scene(p + k.yyx * h) + k.yxy * scene(p + k.yxy * h) + k.xxx * scene(p + k.xxx * h));
}

float calcAO(vec3 p, vec3 n){
  float occ = 0.0; float sca = 1.0;
  for (int i = 0; i < 4; i++){
    float h = 0.03 + 0.18 * float(i);
    occ += (h - scene(p + h * n)) * sca;
    sca *= 0.7;
  }
  return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
}

vec3 background(vec3 rd){
  float fwd = max(-rd.z, 0.0);
  vec3 c = mix(vec3(0.008, 0.007, 0.01), vec3(1.0, 0.24, 0.04) * 1.1, pow(fwd, 22.0));
  c += vec3(1.0, 0.5, 0.2) * pow(fwd, 400.0) * 2.0;
  return c;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 ro = vec3(0.0, 0.0, uCamZ);
  vec3 rd = normalize(vec3(uv * uFov, -1.0));
  rd.yz *= rot(uLook.y);
  rd.xz *= rot(uLook.x);

  float t = 0.05;
  bool hit = false;
  bool isAnom = false;
  float glow = 0.0;
  for (int i = 0; i < STEPS; i++){
    vec3 p = ro + rd * t;
    float d = scene(p);
    float da = uFound > 0.5 ? 1e3 : anomaly(p);
    glow += 0.012 / (0.01 + da * da * 30.0);
    float dd = min(d, da);
    if (dd < 0.0015 * t){ hit = true; isAnom = da < d; break; }
    t += dd * 0.9;
    if (t > 70.0) break;
  }

  vec3 bg = background(rd);
  vec3 col = bg;
  if (hit){
    vec3 p = ro + rd * t;
    if (isAnom){
      col = vec3(5.0, 1.4, 0.3);
    } else {
      vec3 n = calcNormal(p);
      float ao = calcAO(p, n);
      vec3 L = normalize(vec3(0.4, 0.8, 0.3));
      float key = max(dot(n, L), 0.0);
      float lamp = max(dot(n, -rd), 0.0) / (1.0 + t * t * 0.018);
      vec3 albedo = mix(vec3(0.8, 0.76, 0.7), vec3(0.62, 0.64, 0.7), uW.y);
      albedo = mix(albedo, vec3(0.5, 0.48, 0.47), uW.z);
      vec3 c = albedo * (0.06 + key * 0.3 + lamp * 1.1) * ao;
      // datum line: an orange level that runs through every space
      float datum = exp(-abs(p.y - 0.9) * 40.0);
      c += vec3(1.0, 0.26, 0.05) * datum * 3.0 * (0.6 + 0.4 * sin(p.z * 0.5 - uTime * 3.0));
      // pulse ring travelling away from the viewer after a fold
      float ring = exp(-pow((uCamZ - p.z) - uPulse * 60.0, 2.0) * 0.3) * step(0.01, uPulse) * (1.0 - uPulse);
      c += vec3(1.0, 0.3, 0.06) * ring * 4.0;
      // facing the vanishing point picks up its glow
      c += vec3(1.0, 0.25, 0.05) * max(n.z, 0.0) * 0.12 * ao;
      col = mix(c, bg, 1.0 - exp(-t * 0.05));
    }
  }
  col += vec3(1.0, 0.35, 0.08) * glow * 0.04;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class ImpossibleScene extends Scene3D {
  readonly name = 'ESPACIO IMPOSIBLE';
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private rt!: THREE.WebGLRenderTarget;
  private material!: THREE.ShaderMaterial;
  private mesh!: THREE.Mesh;
  private blit = new Blit();
  private p = 0;
  private drift = 0;
  private room = 0;
  private clicks = 0;
  private hold = 0;
  private look = new THREE.Vector2();
  private pulse = 1;
  private lastRoom = -1;
  private found = false;
  private offs: (() => void)[] = [];
  private hoverAnom = false;
  depth = 0;

  init() {
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.material = new THREE.ShaderMaterial({
      defines: { STEPS: Q.raySteps },
      uniforms: {
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uCamZ: { value: 0 },
        uLook: { value: new THREE.Vector2() },
        uW: { value: new THREE.Vector3(1, 0, 0) },
        uFov: { value: 0.9 },
        uFound: { value: 0 },
        uPulse: { value: 1 },
      },
      vertexShader: fullscreenVert,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    this.offs.push(
      this.ctx.pointer.on('click', (e) => {
        if (!this.active || e.ui) return;
        if (this.hoverAnom && !this.found) {
          this.found = true;
          this.material.uniforms.uFound.value = 1;
          this.ctx.bus.emit('anomaly', { id: 'fold', label: 'EL CRISTAL EN EL CORREDOR' });
          this.ctx.bus.emit('cursorHint', null);
          return;
        }
        this.clicks++;
        this.pulse = 0;
        this.ctx.bus.emit('glitch', 0.7);
        this.ctx.audio.ping(330 * Math.pow(2, (this.clicks % 5) / 5), 0.12, 'triangle');
      }),
    );
    this.ready = true;
  }

  enter() {
    this.ctx.audio.setScene(1);
  }

  leave() {
    if (this.hoverAnom) this.ctx.bus.emit('cursorHint', null);
    this.hoverAnom = false;
  }

  resize(w: number, h: number, dpr: number) {
    const s = Q.rayScale * Math.min(dpr, 1.5);
    const rw = Math.max(2, Math.round(w * s));
    const rh = Math.max(2, Math.round(h * s));
    this.rt.setSize(rw, rh);
    this.material.uniforms.uRes.value.set(rw, rh);
  }

  /** Mirrors the shader camera to find the anomaly on screen. */
  private anomalyScreenHit(camZ: number) {
    const u = this.material.uniforms;
    const pt = this.ctx.pointer;
    const aspect = innerWidth / innerHeight;
    const mx = (pt.ndc.x * aspect) / 2;
    const my = pt.ndc.y / 2;
    // anomalies sit at z = k · PERIOD; test the nearest ones ahead of the camera
    const base = Math.floor(camZ / ANOM_PERIOD) * ANOM_PERIOD;
    for (let k = 0; k < 3; k++) {
      const az = base - k * ANOM_PERIOD;
      let vx = ANOM_X;
      let vy = ANOM_Y;
      let vz = az - camZ;
      if (vz > -0.5) continue;
      // inverse of: rd.yz *= rot(look.y); rd.xz *= rot(look.x)
      const ax = -u.uLook.value.x;
      const cx = Math.cos(ax), sx = Math.sin(ax);
      const nx = vx * cx + vz * sx;
      const nz = -vx * sx + vz * cx;
      vx = nx;
      vz = nz;
      const ay = -u.uLook.value.y;
      const cy = Math.cos(ay), sy = Math.sin(ay);
      const ny = vy * cy + vz * sy;
      const nz2 = -vy * sy + vz * cy;
      vy = ny;
      vz = nz2;
      if (vz >= -0.1) continue;
      const sxp = vx / -vz / u.uFov.value;
      const syp = vy / -vz / u.uFov.value;
      const r = Math.max(0.035, 0.6 / -vz);
      if (Math.hypot(sxp - mx, syp - my) < r && -vz < 30) return true;
    }
    return false;
  }

  update(f: Frame) {
    const { dt, time } = f;
    const u = this.material.uniforms;
    const pt = this.ctx.pointer;
    this.p = damp(this.p, f.progress, 4, dt);

    const holding = this.active && pt.down && !pt.downUi && performance.now() - pt.downAt > 260 && pt.travel < 12;
    this.hold = damp(this.hold, holding ? 1 : 0, holding ? 1.6 : 3, dt);
    this.drift += dt * (0.55 + this.hold * 7);
    const camZ = -this.p * 150 - this.drift;
    u.uCamZ.value = camZ;
    this.depth = -camZ;

    const fovBase = innerWidth / innerHeight < 0.8 ? 1.25 : 0.9;
    u.uFov.value = fovBase + this.hold * 2.2 + Math.sin(time * 0.2) * 0.03;

    this.look.x = damp(this.look.x, -pt.smooth.x * 0.75, 3, dt);
    this.look.y = damp(this.look.y, pt.smooth.y * 0.45, 3, dt);
    u.uLook.value.copy(this.look);

    // which space: scroll moves A → B → C, clicks fold further
    const target = this.p * 2 + this.clicks;
    this.room = damp(this.room, target, 2.2, dt);
    const r = ((this.room % 3) + 3) % 3;
    const cyc = (a: number, b: number) => {
      const d = Math.abs(a - b);
      return Math.min(d, 3 - d);
    };
    u.uW.value.set(Math.max(0, 1 - cyc(r, 0)), Math.max(0, 1 - cyc(r, 1)), Math.max(0, 1 - cyc(r, 2)));
    const nearest = Math.round(r) % 3;
    if (nearest !== this.lastRoom) {
      this.lastRoom = nearest;
      this.ctx.bus.emit('room', nearest);
    }

    this.pulse = Math.min(1, this.pulse + dt * 0.7);
    u.uPulse.value = this.pulse;
    u.uTime.value = time;

    if (!this.found && this.active) {
      const over = this.anomalyScreenHit(camZ);
      if (over !== this.hoverAnom) {
        this.hoverAnom = over;
        this.ctx.bus.emit('cursorHint', over ? '¿ANOMALÍA?' : null);
      }
    }
  }

  render(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    this.blit.render(r, this.rt.texture, target);
  }

  compileTargets() {
    return [{ scene: this.scene, camera: this.camera }];
  }

  dispose() {
    this.offs.forEach((o) => o());
    this.rt.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.blit.dispose();
  }
}
