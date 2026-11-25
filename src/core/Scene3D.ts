import type * as THREE from 'three';
import type { Ctx } from './Ctx';

export interface Frame {
  time: number;
  dt: number;
  /** Pinned progress of this scene's section (0..1). */
  progress: number;
  /** How visible this scene is right now (1 = alone on screen). */
  visibility: number;
}

/**
 * Contract every scene module implements. Scenes own their resources and
 * must release them in dispose(); the engine only renders scenes that are
 * on screen, so inactive scenes cost nothing per frame.
 */
export abstract class Scene3D {
  active = false;
  ready = false;
  abstract readonly name: string;

  constructor(protected ctx: Ctx) {}

  abstract init(): Promise<void> | void;
  abstract resize(w: number, h: number, dpr: number): void;
  abstract update(f: Frame): void;
  abstract render(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void;
  abstract dispose(): void;

  /** Objects to pre-compile so the first visit never stutters. */
  abstract compileTargets(): { scene: THREE.Scene; camera: THREE.Camera }[];

  enter(): void {}
  leave(): void {}
}
