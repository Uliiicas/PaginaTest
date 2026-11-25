import type { Pointer } from '../core/Pointer';
import { damp } from '../core/math';

/**
 * Architect's cursor: full-screen crosshair, a lagging measuring ring that
 * stretches with velocity, live coordinates, and contextual labels.
 */
export class Cursor {
  private el = document.getElementById('cursor')!;
  private ring = this.el.querySelector<HTMLElement>('.c-ring')!;
  private dot = this.el.querySelector<HTMLElement>('.c-dot')!;
  private h = this.el.querySelector<HTMLElement>('.cx-h')!;
  private v = this.el.querySelector<HTMLElement>('.cx-v')!;
  private label = this.el.querySelector<HTMLElement>('.c-label')!;
  private coords = this.el.querySelector<HTMLElement>('.c-coords')!;
  private rx = innerWidth / 2;
  private ry = innerHeight / 2;
  private hint: string | null = null;
  private sceneHint = '';
  private hoverText: string | null = null;
  private frame = 0;

  constructor(private pointer: Pointer) {
    document.addEventListener('pointerover', (e) => {
      const t = (e.target as Element).closest?.('[data-cursor], button, a, input');
      this.hoverText = t ? (t.getAttribute('data-cursor') ?? '') : null;
      this.el.classList.toggle('is-hover', !!t);
      this.render();
    });
    document.addEventListener('pointerleave', () => this.el.classList.add('is-hidden'));
    document.addEventListener('pointerenter', () => this.el.classList.remove('is-hidden'));
  }

  setSceneHint(t: string) {
    this.sceneHint = t;
    this.render();
  }

  setHint(t: string | null) {
    this.hint = t;
    this.el.classList.toggle('is-anomaly', !!t);
    this.render();
  }

  private render() {
    const text = this.hint ?? (this.hoverText !== null ? this.hoverText : this.sceneHint);
    if (this.label.textContent !== text) this.label.textContent = text;
  }

  update(dt: number) {
    const p = this.pointer;
    this.rx = damp(this.rx, p.x, 14, dt);
    this.ry = damp(this.ry, p.y, 14, dt);
    const sp = Math.min(1, p.speed / 6);
    const ang = Math.atan2(-p.vel.y, p.vel.x);
    this.dot.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    this.ring.style.transform = `translate3d(${this.rx}px, ${this.ry}px, 0) rotate(${ang}rad) scale(${1 + sp * 0.9}, ${1 - sp * 0.35})${p.down ? ' scale(0.6)' : ''}`;
    this.h.style.transform = `translate3d(0, ${p.y}px, 0)`;
    this.v.style.transform = `translate3d(${p.x}px, 0, 0)`;
    this.label.style.transform = `translate3d(${this.rx + 26}px, ${this.ry - 30}px, 0)`;
    this.coords.style.transform = `translate3d(${p.x + 14}px, ${p.y + 14}px, 0)`;
    if ((this.frame++ & 3) === 0) {
      this.coords.textContent = `X ${p.ndc.x >= 0 ? '+' : ''}${p.ndc.x.toFixed(3)}  Y ${p.ndc.y >= 0 ? '+' : ''}${p.ndc.y.toFixed(3)}`;
    }
  }
}
