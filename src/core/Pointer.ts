import { Vector2 } from 'three';
import { damp } from './math';

export interface PointerEventInfo {
  x: number;
  y: number;
  ndc: Vector2;
  /** True if the event started on an interactive DOM control (buttons, sliders...). */
  ui: boolean;
  duration: number;
  travel: number;
}

type Listener = (e: PointerEventInfo) => void;

const isUi = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest('[data-ui], button, input, a, label, select');

/**
 * Unified pointer: position in px and NDC, smoothed position, velocity in
 * NDC/s (used by shaders that respond to speed and direction) and gestures
 * (click vs. hold vs. drag).
 */
export class Pointer {
  x = innerWidth / 2;
  y = innerHeight / 2;
  ndc = new Vector2();
  smooth = new Vector2();
  vel = new Vector2();
  speed = 0;
  down = false;
  downUi = false;
  downAt = 0;
  travel = 0;
  dragDX = 0;
  dragDY = 0;
  hasMoved = false;

  private prev = new Vector2();
  private downPos = new Vector2();
  private lastX = 0;
  private lastY = 0;
  private listeners = { down: new Set<Listener>(), up: new Set<Listener>(), click: new Set<Listener>() };

  constructor() {
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerdown', this.onDown, { passive: true });
    window.addEventListener('pointerup', this.onUp, { passive: true });
    window.addEventListener('pointercancel', this.onUp, { passive: true });
    window.addEventListener('blur', () => (this.down = false));
  }

  on(type: 'down' | 'up' | 'click', fn: Listener) {
    this.listeners[type].add(fn);
    return () => this.listeners[type].delete(fn);
  }

  private info(e: PointerEvent, ui: boolean): PointerEventInfo {
    return {
      x: e.clientX,
      y: e.clientY,
      ndc: this.ndc.clone(),
      ui,
      duration: performance.now() - this.downAt,
      travel: this.travel,
    };
  }

  private setPos(e: PointerEvent) {
    this.x = e.clientX;
    this.y = e.clientY;
    this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  }

  private onMove = (e: PointerEvent) => {
    this.setPos(e);
    this.hasMoved = true;
    if (this.down) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.dragDX += dx;
      this.dragDY += dy;
      this.travel = Math.max(this.travel, this.downPos.distanceTo(new Vector2(e.clientX, e.clientY)));
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onDown = (e: PointerEvent) => {
    this.setPos(e);
    this.down = true;
    this.downUi = isUi(e.target);
    this.downAt = performance.now();
    this.downPos.set(e.clientX, e.clientY);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.travel = 0;
    const info = this.info(e, this.downUi);
    this.listeners.down.forEach((fn) => fn(info));
  };

  private onUp = (e: PointerEvent) => {
    if (!this.down) return;
    this.setPos(e);
    this.down = false;
    const info = this.info(e, this.downUi);
    this.listeners.up.forEach((fn) => fn(info));
    if (info.duration < 280 && info.travel < 8 && e.type === 'pointerup') {
      this.listeners.click.forEach((fn) => fn(info));
    }
  };

  /** Pending drag delta since last call (px). */
  consumeDrag() {
    const d = { x: this.dragDX, y: this.dragDY };
    this.dragDX = 0;
    this.dragDY = 0;
    return d;
  }

  update(dt: number) {
    const k = Math.max(dt, 1 / 240);
    this.smooth.x = damp(this.smooth.x, this.ndc.x, 6, dt);
    this.smooth.y = damp(this.smooth.y, this.ndc.y, 6, dt);
    const ix = (this.ndc.x - this.prev.x) / k;
    const iy = (this.ndc.y - this.prev.y) / k;
    this.vel.x = damp(this.vel.x, ix, 10, dt);
    this.vel.y = damp(this.vel.y, iy, 10, dt);
    this.speed = this.vel.length();
    this.prev.copy(this.ndc);
  }
}
