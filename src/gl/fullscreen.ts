import * as THREE from 'three';
import { fullscreenVert } from './chunks';

/** A single oversized triangle covering clip space. Cheaper than a quad. */
export function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

/** Draws a texture to the current target. Used for upscaling low-res passes. */
export class Blit {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null } },
      vertexShader: fullscreenVert,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap; varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(tMap, vUv); }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(r: THREE.WebGLRenderer, tex: THREE.Texture, target: THREE.WebGLRenderTarget | null) {
    this.material.uniforms.tMap.value = tex;
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
