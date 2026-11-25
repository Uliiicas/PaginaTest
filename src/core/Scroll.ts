import Lenis from 'lenis';
import { clamp } from './math';

export interface ScrollState {
  /** Section whose top has passed the viewport top. */
  index: number;
  /** Following section (or -1) — rendered while the boundary crosses the viewport. */
  next: number;
  /** 0..1 transition from `index` to `next` over the last viewport of `index`. */
  t: number;
  /** Pinned progress of each section, 0..1. */
  progress: number[];
  /** Whole-document progress 0..1. */
  total: number;
  y: number;
  velocity: number;
}

interface Section {
  el: HTMLElement;
  top: number;
  height: number;
}

/**
 * Lenis-powered smooth scroll + a scroll "director" that maps the document
 * position to scenes, per-scene progress and inter-scene transitions.
 */
export class Scroll {
  lenis: Lenis;
  sections: Section[];
  vh = innerHeight;
  max = 1;
  state: ScrollState;

  constructor(els: HTMLElement[]) {
    this.lenis = new Lenis({
      lerp: 0.075,
      smoothWheel: true,
      wheelMultiplier: 0.85,
      touchMultiplier: 1.2,
    });
    this.sections = els.map((el) => ({ el, top: 0, height: 0 }));
    this.state = {
      index: 0,
      next: 1,
      t: 0,
      progress: els.map(() => 0),
      total: 0,
      y: 0,
      velocity: 0,
    };
    this.measure();
  }

  measure() {
    this.vh = innerHeight;
    const sy = window.scrollY;
    for (const s of this.sections) {
      const r = s.el.getBoundingClientRect();
      s.top = r.top + sy;
      s.height = r.height;
    }
    this.max = Math.max(1, document.documentElement.scrollHeight - this.vh);
  }

  raf(timeMs: number) {
    this.lenis.raf(timeMs);
  }

  update(): ScrollState {
    const y = this.lenis.scroll;
    const st = this.state;
    const n = this.sections.length;
    let index = 0;
    for (let i = 0; i < n; i++) if (y >= this.sections[i].top - 1) index = i;
    for (let i = 0; i < n; i++) {
      const s = this.sections[i];
      st.progress[i] = clamp((y - s.top) / Math.max(1, s.height - this.vh));
    }
    const nxt = this.sections[index + 1];
    st.index = index;
    st.next = nxt ? index + 1 : -1;
    st.t = nxt ? clamp((y - (nxt.top - this.vh)) / this.vh) : 0;
    st.y = y;
    st.total = clamp(y / this.max);
    st.velocity = this.lenis.velocity || 0;
    return st;
  }

  scrollToSection(i: number, opts: { duration?: number; immediate?: boolean } = {}) {
    const s = this.sections[i];
    if (!s) return;
    this.lenis.scrollTo(s.top + 2, { duration: opts.duration ?? 2.2, immediate: opts.immediate, force: true });
  }

  scrollTo(y: number, duration = 2.2) {
    this.lenis.scrollTo(y, { duration, force: true });
  }

  stop() {
    this.lenis.stop();
  }

  start() {
    this.lenis.start();
  }
}
