import type * as THREE from 'three';
import type { Pointer } from './Pointer';
import type { Scroll } from './Scroll';
import type { Bus } from './Bus';
import type { AmbientAudio } from './Audio';

export interface AppEvents extends Record<string, unknown> {
  glitch: number;
  flash: number;
  anomaly: { id: string; label: string };
  toast: string;
  cursorHint: string | null;
  room: number;
  form: number;
  labStats: { height: number; floors: number; area: number; twist: number };
  ending: boolean;
}

export interface Ctx {
  renderer: THREE.WebGLRenderer;
  pointer: Pointer;
  scroll: Scroll;
  bus: Bus<AppEvents>;
  audio: AmbientAudio;
  /** Viewport in CSS px. */
  size: { w: number; h: number; dpr: number };
}
