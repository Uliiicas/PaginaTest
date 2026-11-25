import * as THREE from 'three';
import { Composite } from '../gl/composite';
import type { Scene3D } from './Scene3D';
import type { Scroll } from './Scroll';
import { Q } from './Quality';
import { damp, clamp } from './math';

/**
 * One renderer, many worlds. Each scene renders into an off-screen HDR target;
 * the composite pass blends the current and next scene with a transition
 * shader whose progress is driven by scroll. Only on-screen scenes update.
 */
export class Engine {
  renderer: THREE.WebGLRenderer;
  scenes: Scene3D[] = [];
  composite = new Composite();
  rtA!: THREE.WebGLRenderTarget;
  rtB!: THREE.WebGLRenderTarget;
  size = { w: innerWidth, h: innerHeight, dpr: Q.dpr };

  glitch = 0;
  flash = 0;
  blueprint = 0;
  blueprintTarget = 0;
  paused = false;
  private time = 0;

  constructor(canvas: HTMLCanvasElement, private scroll: Scroll) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.size.dpr);
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = Q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x050506, 1);
    this.rtA = this.makeTarget();
    this.rtB = this.makeTarget();
    document.addEventListener('visibilitychange', () => (this.paused = document.hidden));
  }

  private makeTarget() {
    const { w, h, dpr } = this.size;
    return new THREE.WebGLRenderTarget(Math.round(w * dpr), Math.round(h * dpr), {
      type: THREE.HalfFloatType,
      samples: Q.msaa,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
  }

  add(scene: Scene3D) {
    this.scenes.push(scene);
  }

  resize() {
    this.size.w = innerWidth;
    this.size.h = innerHeight;
    const { w, h, dpr } = this.size;
    this.renderer.setSize(w, h, false);
    this.rtA.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.rtB.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.composite.u.uRes.value.set(w * dpr, h * dpr);
    for (const s of this.scenes) if (s.ready) s.resize(w, h, dpr);
  }

  /** Compile every scene's programs ahead of time (non-blocking where supported). */
  async precompile(onStep?: (i: number) => void) {
    for (let i = 0; i < this.scenes.length; i++) {
      const s = this.scenes[i];
      for (const t of s.compileTargets()) {
        try {
          await this.renderer.compileAsync(t.scene, t.camera);
        } catch {
          this.renderer.compile(t.scene, t.camera);
        }
      }
      // one real frame per scene warms up render targets & uploads buffers
      s.update({ time: 0, dt: 0.016, progress: 0, visibility: 1 });
      s.render(this.renderer, this.rtA);
      onStep?.(i);
    }
    this.renderer.setRenderTarget(null);
  }

  tick(dt: number) {
    if (this.paused) return;
    this.time += dt;
    const st = this.scroll.update();
    const want = new Set<number>([st.index]);
    if (st.next >= 0 && st.t > 0.0005) want.add(st.next);

    this.scenes.forEach((s, i) => {
      const on = want.has(i) && s.ready;
      if (on && !s.active) {
        s.active = true;
        s.enter();
      } else if (!on && s.active) {
        s.active = false;
        s.leave();
      }
    });

    const a = this.scenes[st.index];
    const b = st.next >= 0 ? this.scenes[st.next] : undefined;
    const hasB = !!b && st.t > 0.0005 && b.ready;

    if (a?.ready) a.update({ time: this.time, dt, progress: st.progress[st.index], visibility: 1 - st.t });
    if (hasB && b) b.update({ time: this.time, dt, progress: st.progress[st.next], visibility: st.t });

    if (a?.ready) a.render(this.renderer, this.rtA);
    if (hasB && b) b.render(this.renderer, this.rtB);

    // post
    this.glitch = damp(this.glitch, 0, 3.2, dt);
    this.flash = damp(this.flash, 0, 2.2, dt);
    this.blueprint = damp(this.blueprint, this.blueprintTarget, 4, dt);
    const u = this.composite.u;
    u.tA.value = this.rtA.texture;
    u.tB.value = this.rtB.texture;
    u.uHasB.value = hasB ? 1 : 0;
    u.uT.value = hasB ? st.t : 0;
    u.uType.value = st.index;
    u.uTime.value = this.time;
    u.uVel.value = clamp(st.velocity / 60, -1, 1) * (Q.reducedMotion ? 0.2 : 1);
    u.uGlitch.value = Q.reducedMotion ? this.glitch * 0.25 : this.glitch;
    u.uFlash.value = this.flash;
    u.uBlueprint.value = this.blueprint;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.composite.scene, this.composite.camera);
  }

  dispose() {
    this.scenes.forEach((s) => s.dispose());
    this.rtA.dispose();
    this.rtB.dispose();
    this.composite.dispose();
    this.renderer.dispose();
  }
}
