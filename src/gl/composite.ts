import * as THREE from 'three';
import { fullscreenVert, hash, valueNoise } from './chunks';
import { fullscreenTriangle } from './fullscreen';

/**
 * Final pass. Receives the current scene (tA) and — while a boundary is being
 * crossed — the next scene (tB), and blends them with one of four
 * cinematic transitions:
 *   0 · glass panes that refract and flip
 *   1 · zoom-through tunnel with radial blur
 *   2 · horizontal glitch slicing
 *   3 · burning noise front
 * Then: mip-chain bloom, scroll-velocity chromatic aberration, controlled
 * glitch, the hidden "blueprint" mode, flash, vignette, grain, tonemapping.
 */
const frag = /* glsl */ `
precision highp float;
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uT;
uniform float uType;
uniform float uTime;
uniform vec2 uRes;
uniform float uVel;
uniform float uGlitch;
uniform float uBlueprint;
uniform float uFlash;
uniform float uGrain;
uniform float uHasB;
varying vec2 vUv;

${hash}
${valueNoise}

const vec3 SIGNAL = vec3(1.0, 0.22, 0.04);

vec3 rgbShift(sampler2D t, vec2 uv, vec2 dir){
  return vec3(texture2D(t, uv + dir).r, texture2D(t, uv).g, texture2D(t, uv - dir).b);
}

vec3 bloom(sampler2D t, vec2 uv){
  vec3 s = vec3(0.0);
  s += max(textureLod(t, uv, 2.0).rgb - 1.2, 0.0) * 0.4;
  s += max(textureLod(t, uv, 3.5).rgb - 1.0, 0.0) * 0.5;
  s += max(textureLod(t, uv, 5.0).rgb - 0.8, 0.0) * 0.6;
  s += max(textureLod(t, uv, 6.5).rgb - 0.6, 0.0) * 0.7;
  return s;
}

float wB = 0.0;

vec3 transition(vec2 uv, vec2 ca){
  float t = uT;
  if (t <= 0.0001 || uHasB < 0.5) { wB = 0.0; return rgbShift(tA, uv, ca); }
  float aspect = uRes.x / uRes.y;
  int type = int(uType + 0.5);

  if (type == 0) {
    // Glass curtain wall: each pane refracts, glints and flips at its own time.
    vec2 g = vec2(uv.x * aspect, uv.y) * 6.0;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float r = hash12(id);
    float lt = clamp(t * 1.8 - r * 0.8, 0.0, 1.0);
    lt = lt * lt * (3.0 - 2.0 * lt);
    float bulge = sin(lt * 3.14159);
    vec2 off = f * 0.16 * bulge + (vec2(hash12(id + 3.1), hash12(id + 7.7)) - 0.5) * 0.08 * bulge;
    vec2 cab = ca * (1.0 + bulge * 6.0);
    vec3 a = rgbShift(tA, uv + off, cab);
    vec3 b = rgbShift(tB, uv - off * 0.6, cab);
    float s = smoothstep(0.35, 0.65, lt);
    wB = s;
    vec3 col = mix(a, b, s);
    float edge = smoothstep(0.43, 0.5, max(abs(f.x), abs(f.y)));
    col += edge * bulge * SIGNAL * 2.2;
    float glint = smoothstep(0.06, 0.0, abs(f.x + f.y - (lt * 2.0 - 1.0) * 1.1));
    col += glint * bulge * 0.6;
    return col;
  }

  if (type == 1) {
    // Fly through: A is pushed into an extreme zoom, B emerges from the vanishing point.
    vec2 c = uv - 0.5;
    float te = t * t;
    float za = 1.0 / (1.0 + te * 16.0);
    float zb = mix(2.4, 1.0, 1.0 - pow(1.0 - t, 3.0));
    vec3 a = vec3(0.0);
    vec3 b = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float k = float(i) / 8.0;
      a += rgbShift(tA, 0.5 + c * za * (1.0 - k * 0.08 * t), ca * 2.0);
      b += rgbShift(tB, 0.5 + c * zb * (1.0 + k * 0.06 * (1.0 - t)), ca * 2.0);
    }
    a /= 8.0; b /= 8.0;
    float r = length(c * vec2(aspect, 1.0));
    float front = t * 1.35;
    float m = smoothstep(front - 0.18, front, r);
    wB = 1.0 - m;
    vec3 col = mix(b, a, m);
    col += SIGNAL * (1.0 - abs(m * 2.0 - 1.0)) * 1.6;
    return col;
  }

  if (type == 2) {
    // Controlled glitch: horizontal slices switch over at random moments.
    float rows = 28.0;
    float row = floor(uv.y * rows);
    float tick = floor(uTime * 24.0);
    float n = hash12(vec2(row, tick));
    float th = hash12(vec2(row, 1.234));
    float sw = step(th * 0.9 + 0.05, t);
    float amp = sin(t * 3.14159);
    vec2 o = vec2((n - 0.5) * 0.28 * amp, 0.0);
    vec2 cab = ca + vec2(amp * 0.012, 0.0);
    vec3 a = rgbShift(tA, uv + o, cab);
    vec3 b = rgbShift(tB, uv - o, cab);
    vec3 col = mix(a, b, sw);
    wB = sw;
    float blk = step(0.93, hash12(floor(uv * vec2(14.0, 44.0)) + tick)) * amp;
    col = mix(col, SIGNAL * (0.4 + dot(col, vec3(0.33)) * 3.0), blk);
    return col;
  }

  // type 3: Burning front with an incandescent edge.
  float n = fbm(vec2(uv.x * aspect, uv.y) * 3.0 + uTime * 0.04);
  float e = t * 1.3 - 0.15;
  float m = smoothstep(e - 0.05, e, n);
  float band = 1.0 - smoothstep(0.0, 0.025, abs(n - e));
  vec2 o = vec2(0.0, band * 0.035);
  vec3 a = rgbShift(tA, uv + o, ca);
  vec3 b = rgbShift(tB, uv - o, ca);
  wB = 1.0 - m;
  vec3 col = mix(b, a, m);
  col += band * SIGNAL * 2.2 * step(0.001, t) * step(t, 0.999);
  return col;
}

float lumAt(vec2 p){
  vec3 c = texture2D(tA, p).rgb;
  if (uHasB > 0.5 && wB > 0.5) c = texture2D(tB, p).rgb;
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main(){
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float v = clamp(abs(uVel), 0.0, 1.0);

  // scroll velocity stretches the image slightly along the scroll axis
  uv.y -= c.y * v * 0.03 * sign(uVel);

  float g = clamp(uGlitch, 0.0, 1.0);
  if (g > 0.001) {
    float tick = floor(uTime * 30.0);
    float line = floor(uv.y * 54.0);
    float n = hash12(vec2(line, tick));
    if (n > 1.0 - g * 0.55) uv.x += (hash12(vec2(line, 9.1 + tick)) - 0.5) * 0.18 * g;
    float blk = step(1.0 - g * 0.12, hash12(floor(uv * vec2(9.0, 22.0)) + tick * 1.7));
    uv += blk * vec2(0.03, 0.0);
  }

  vec2 ca = c * (0.0016 + v * 0.012 + g * 0.025);
  vec3 col = transition(uv, ca);

  vec3 bl = bloom(tA, uv);
  if (uHasB > 0.5 && uT > 0.0001) bl = mix(bl, bloom(tB, uv), wB);
  col += bl;

  if (uBlueprint > 0.001) {
    vec2 px = 1.5 / uRes;
    float l0 = lumAt(uv);
    float gx = lumAt(uv + vec2(px.x, 0.0)) - lumAt(uv - vec2(px.x, 0.0));
    float gy = lumAt(uv + vec2(0.0, px.y)) - lumAt(uv - vec2(0.0, px.y));
    float edge = smoothstep(0.08, 0.5, length(vec2(gx, gy)) / (l0 + 0.08));
    vec2 gp = vec2(uv.x * uRes.x / uRes.y, uv.y) * 24.0;
    vec2 gg = abs(fract(gp) - 0.5);
    float grid = step(0.47, max(gg.x, gg.y)) * 0.06;
    vec2 gp2 = gp / 5.0; vec2 gg2 = abs(fract(gp2) - 0.5);
    grid += step(0.485, max(gg2.x, gg2.y)) * 0.1;
    vec3 bp = vec3(0.012, 0.045, 0.2) + grid + edge * vec3(0.85, 0.9, 1.0) + l0 * 0.08;
    col = mix(col, bp, uBlueprint);
  }

  float vig = smoothstep(0.35, 1.15, length(c * vec2(1.15, 1.0)));
  col *= 1.0 - vig * 0.7;
  col += (hash12(vUv * uRes + fract(uTime * 7.13) * 100.0) - 0.5) * uGrain;
  col = mix(col, vec3(2.2, 2.0, 1.85), clamp(uFlash, 0.0, 1.0));

  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Composite {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tA: { value: null },
        tB: { value: null },
        uT: { value: 0 },
        uType: { value: 0 },
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uVel: { value: 0 },
        uGlitch: { value: 0 },
        uBlueprint: { value: 0 },
        uFlash: { value: 0 },
        uGrain: { value: 0.032 },
        uHasB: { value: 0 },
      },
      vertexShader: fullscreenVert,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  get u() {
    return this.material.uniforms;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
