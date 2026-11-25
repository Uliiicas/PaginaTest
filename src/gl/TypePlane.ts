import * as THREE from 'three';

export interface TypePlaneOptions {
  text: string;
  /** World-space width of the plane. */
  width: number;
  font?: string;
  weight?: number;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  /** Draw outlined glyphs instead of solid ones. */
  stroke?: number;
  glow?: number;
  fogDensity?: number;
  fogColor?: THREE.ColorRepresentation;
}

/**
 * Typography that lives *inside* the 3D world: rasterised to a canvas, placed
 * on a plane, so architecture can pass in front of and behind the letters and
 * the camera can fly through them. Scanline distortion and a sweeping light
 * band keep it alive.
 */
export class TypePlane extends THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  texture: THREE.CanvasTexture;
  aspect: number;

  constructor(o: TypePlaneOptions) {
    const px = 300;
    const font = `${o.weight ?? 900} ${px}px ${o.font ?? 'Unbounded'}, sans-serif`;
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = font;
    const tw = Math.ceil(measure.measureText(o.text).width);
    const pad = Math.round(px * 0.18);
    let cw = tw + pad * 2;
    let ch = Math.round(px * 1.3);
    const scale = Math.min(1, 4096 / cw);
    cw = Math.round(cw * scale);
    ch = Math.round(ch * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    if (o.stroke) {
      ctx.lineWidth = o.stroke;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(o.text, cw / scale / 2, ch / scale / 2 + px * 0.04);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillText(o.text, cw / scale / 2, ch / scale / 2 + px * 0.04);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    const aspect = ch / cw;

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: texture },
        uColor: { value: new THREE.Color(o.color ?? 0xece6da) },
        uOpacity: { value: o.opacity ?? 1 },
        uGlow: { value: o.glow ?? 0 },
        uTime: { value: 0 },
        uReveal: { value: 1 },
        uFogDensity: { value: o.fogDensity ?? 0 },
        uFogColor: { value: new THREE.Color(o.fogColor ?? 0x000000) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vView;
        void main(){
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 uColor; uniform float uOpacity; uniform float uGlow;
        uniform float uTime; uniform float uReveal; uniform float uFogDensity; uniform vec3 uFogColor;
        varying vec2 vUv; varying vec3 vView;
        void main(){
          vec2 uv = vUv;
          float bandPos = fract(uTime * 0.12);
          float band = exp(-pow((uv.x - bandPos) * 9.0, 2.0));
          uv.y += band * 0.012 * sin(uv.x * 380.0 + uTime * 20.0);
          float a = texture2D(map, uv).a;
          float rev = smoothstep(uReveal * 1.15 - 0.15, uReveal * 1.15, uv.x);
          a *= 1.0 - rev;
          vec3 col = uColor * (1.0 + uGlow) + band * vec3(1.0, 0.25, 0.05) * 3.0;
          float scan = 0.85 + 0.15 * sin(gl_FragCoord.y * 1.4);
          float d = length(vView);
          float fog = 1.0 - exp(-pow(d * uFogDensity, 1.5));
          col = mix(col * scan, uFogColor, fog);
          gl_FragColor = vec4(col, a * uOpacity * (1.0 - fog * 0.85));
        }
      `,
    });
    const geometry = new THREE.PlaneGeometry(o.width, o.width * aspect);
    super(geometry, material);
    this.texture = texture;
    this.aspect = aspect;
  }

  get height() {
    return this.geometry.parameters.height;
  }

  set time(t: number) {
    this.material.uniforms.uTime.value = t;
  }

  dispose() {
    this.texture.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
