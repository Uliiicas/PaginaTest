import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Engine } from './core/Engine';
import { Scroll } from './core/Scroll';
import { Pointer } from './core/Pointer';
import { Bus } from './core/Bus';
import { AmbientAudio } from './core/Audio';
import type { AppEvents, Ctx } from './core/Ctx';
import { Q } from './core/Quality';
import { EntryScene } from './scenes/EntryScene';
import { ImpossibleScene } from './scenes/ImpossibleScene';
import { TransformScene, FORMS } from './scenes/TransformScene';
import { LabScene } from './scenes/LabScene';
import { FinalScene } from './scenes/FinalScene';
import { Cursor } from './ui/Cursor';
import { Toast } from './ui/Toast';
import { splitChars } from './ui/split';
import { bindLab } from './ui/LabPanel';

gsap.registerPlugin(ScrollTrigger);

const SCENE_NAMES = ['UMBRAL', 'ESPACIO IMPOSIBLE', 'TRANSFORMACIÓN', 'LABORATORIO', 'APEIRON'];
const SCENE_HINTS = ['CLIC · ONDA SÍSMICA', 'CLIC · PLEGAR  /  MANTÉN · VÉRTIGO', 'CLIC · DETONAR  /  MANTÉN · SINGULARIDAD', 'ARRASTRA · ORBITAR', 'CLIC · ONDA DE CHOQUE'];
const FONTS = ['900 100px Unbounded', '500 100px Unbounded', '300 100px Unbounded', 'italic 400 100px "Instrument Serif"', '400 14px "JetBrains Mono"'];
const ANOMALY_TOTAL = 4;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s);
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class App {
  private bus = new Bus<AppEvents>();
  private pointer = new Pointer();
  private audio = new AmbientAudio();
  private scroll!: Scroll;
  private engine!: Engine;
  private cursor = new Cursor(this.pointer);
  private toast = new Toast();
  private entry!: EntryScene;
  private transform!: TransformScene;
  private lab!: LabScene;
  private found = new Set<string>();
  private keys = '';
  private last = performance.now();
  private currentIndex = -1;
  private started = false;

  async boot() {
    history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    document.documentElement.classList.add(Q.isTouch ? 'is-touch' : 'is-desktop');
    splitChars();

    const sections = [...document.querySelectorAll<HTMLElement>('.scene')];
    this.scroll = new Scroll(sections);
    this.scroll.stop();
    this.scroll.lenis.on('scroll', ScrollTrigger.update);

    const canvas = $<HTMLCanvasElement>('#gl')!;
    try {
      this.engine = new Engine(canvas, this.scroll);
    } catch (e) {
      this.fatal();
      throw e;
    }
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fatal();
    });

    const ctx: Ctx = {
      renderer: this.engine.renderer,
      pointer: this.pointer,
      scroll: this.scroll,
      bus: this.bus,
      audio: this.audio,
      size: this.engine.size,
    };
    this.entry = new EntryScene(ctx);
    this.transform = new TransformScene(ctx);
    this.lab = new LabScene(ctx);
    [this.entry, new ImpossibleScene(ctx), this.transform, this.lab, new FinalScene(ctx)].forEach((s) => this.engine.add(s));

    this.wireBus();
    await this.load();
    this.wireDom();
    this.wireScrollAnimations();
    gsap.ticker.lagSmoothing(0);
    gsap.ticker.add(this.tick);
    this.revealEnter();
  }

  // ───────────────────────────────── loading
  private progress(v: number, step: string) {
    const n = $('#pl-num');
    const s = $('#pl-step');
    const bar = $('#pl-bar');
    if (n) n.textContent = String(Math.round(v * 100)).padStart(3, '0');
    if (s) s.textContent = step;
    if (bar) bar.style.transform = `scaleX(${v})`;
    document.documentElement.style.setProperty('--pl', String(v));
  }

  private async load() {
    this.progress(0.02, 'CARGANDO TIPOGRAFÍAS');
    await Promise.race([Promise.all(FONTS.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 4000))]);
    await nextFrame();
    const scenes = this.engine.scenes;
    for (let i = 0; i < scenes.length; i++) {
      this.progress(0.08 + (i / scenes.length) * 0.5, `GENERANDO ${scenes[i].name}`);
      await nextFrame();
      await scenes[i].init();
    }
    this.engine.resize();
    this.progress(0.6, 'COMPILANDO SHADERS');
    await this.engine.precompile((i) => this.progress(0.6 + ((i + 1) / scenes.length) * 0.38, `COMPILANDO ${scenes[i].name}`));
    bindLab(this.lab, this.bus);
    this.progress(1, 'LISTO');
  }

  private revealEnter() {
    const enter = $('#pl-enter');
    if (!enter) return;
    enter.hidden = false;
    gsap.fromTo(enter.children, { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.08, duration: 1, ease: 'expo.out' });
    enter.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => this.start(b.dataset.sound === '1'), { once: true }),
    );
  }

  private start(sound: boolean) {
    if (this.started) return;
    this.started = true;
    if (sound) this.setSound(true);
    const pl = $('#preloader')!;
    gsap
      .timeline()
      .to('#pl-enter, .pl-count, .pl-top, .pl-bottom, .pl-drawing', { opacity: 0, duration: 0.4 })
      .to(pl, { clipPath: 'inset(50% 0% 50% 0%)', duration: 1.4, ease: 'expo.inOut' }, 0.2)
      .add(() => {
        pl.remove();
        this.scroll.start();
        this.scroll.measure();
        ScrollTrigger.refresh();
      });
    this.entry.buildTarget = 1;
    this.engine.glitch = 1;
    document.body.classList.add('is-started');
    gsap.fromTo('.s1-title .ch', { yPercent: 120, rotate: 8 }, { yPercent: 0, rotate: 0, duration: 1.6, ease: 'expo.out', stagger: 0.035, delay: 0.7 });
    gsap.fromTo('.s1 .reveal', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 1.2, ease: 'expo.out', stagger: 0.08, delay: 1.1 });
    gsap.fromTo('#hud, #rail', { opacity: 0 }, { opacity: 1, duration: 1.2, delay: 1.2 });
  }

  private fatal() {
    document.body.classList.add('no-webgl');
    const s = $('#pl-step');
    if (s) s.textContent = 'WEBGL NO DISPONIBLE';
  }

  // ───────────────────────────────── events
  private wireBus() {
    this.bus.on('glitch', (v) => (this.engine.glitch = Math.max(this.engine.glitch, v)));
    this.bus.on('flash', (v) => (this.engine.flash = Math.max(this.engine.flash, v)));
    this.bus.on('cursorHint', (t) => this.cursor.setHint(t));
    this.bus.on('toast', (t) => this.toast.show(t));
    this.bus.on('anomaly', ({ id, label }) => {
      if (this.found.has(id)) return;
      this.found.add(id);
      const n = this.found.size;
      const el = $('#anomalies');
      if (el) {
        el.textContent = `${n}/${ANOMALY_TOTAL}`;
        el.parentElement?.classList.add('is-found');
      }
      this.engine.glitch = 1;
      this.audio.ping(880, 0.15);
      setTimeout(() => this.audio.ping(1320, 0.1), 120);
      this.toast.show(`ANOMALÍA ${n}/${ANOMALY_TOTAL} — ${label}`);
      const endCount = $('#end-anomalies');
      if (endCount) endCount.textContent = `${n}/${ANOMALY_TOTAL}`;
      if (n === ANOMALY_TOTAL) {
        setTimeout(() => {
          this.toast.show('TODAS LAS ANOMALÍAS. TECLEA  A·P·E·I·R·O·N  PARA VER LOS PLANOS', 6000);
          this.engine.blueprintTarget = 1;
          setTimeout(() => (this.engine.blueprintTarget = 0), 2600);
        }, 4200);
      }
    });
    this.bus.on('room', (i) => {
      document.querySelectorAll('.rooms li').forEach((li, k) => li.classList.toggle('is-on', k === i));
    });
    this.bus.on('form', (i) => {
      const name = $('#form-name');
      const eq = $('#form-eq');
      if (name) {
        name.textContent = FORMS[i].name;
        gsap.fromTo(name, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.9, ease: 'expo.out' });
      }
      if (eq) eq.textContent = FORMS[i].eq;
      const num = $('#form-num');
      if (num) num.textContent = `0${i + 1}`;
      document.querySelectorAll('[data-form]').forEach((b, k) => b.classList.toggle('is-on', k === i));
    });
    this.bus.on('ending', (on) => {
      $('#end')?.classList.toggle('is-on', on);
      if (on) gsap.fromTo('#end .reveal', { y: 40, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.1, duration: 1.4, ease: 'expo.out' });
    });
  }

  private setSound(on: boolean) {
    this.audio.setEnabled(on);
    const b = $('#sound');
    if (b) {
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
      const t = b.querySelector('b');
      if (t) t.textContent = on ? 'ON' : 'OFF';
    }
  }

  private wireDom() {
    $('#sound')?.addEventListener('click', () => this.setSound(!this.audio.enabled));
    const pc = $('#pcount');
    if (pc) pc.textContent = Q.particles.toLocaleString('es-ES');
    const mods = $('#mods');
    if (mods) mods.textContent = Q.blocks.toLocaleString('es-ES');
    document.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((b) =>
      b.addEventListener('click', () => {
        this.engine.glitch = 0.6;
        this.scroll.scrollToSection(+b.dataset.goto!);
      }),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-form]').forEach((b) =>
      b.addEventListener('click', () => this.transform.setForm(+b.dataset.form!)),
    );
    $('#restart')?.addEventListener('click', () => {
      this.engine.glitch = 1;
      this.scroll.scrollTo(0, 5.5);
      this.audio.ping(220, 0.15);
    });

    // secret: type the name of the institute
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key.length !== 1) return;
      this.keys = (this.keys + e.key.toLowerCase()).slice(-7);
      if (this.keys === 'apeiron') {
        this.engine.blueprintTarget = this.engine.blueprintTarget > 0.5 ? 0 : 1;
        this.engine.glitch = 1;
        this.toast.show(this.engine.blueprintTarget ? 'MODO PLANO — EL MUNDO ES UN DIBUJO' : 'MODO PLANO DESACTIVADO');
        this.audio.ping(660, 0.12);
        if (!this.found.has('word')) this.bus.emit('anomaly', { id: 'word', label: 'LA PALABRA' });
      }
    });

    let rt = 0;
    const onResize = () => {
      clearTimeout(rt);
      rt = window.setTimeout(() => {
        this.engine.resize();
        this.scroll.measure();
        ScrollTrigger.refresh();
      }, 120);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }

  // ───────────────────────────────── DOM choreography tied to scroll
  private wireScrollAnimations() {
    const st = (trigger: string, start = 'top top', end = 'bottom bottom') => ({ trigger, start, end, scrub: true });

    gsap.to('.s1-title .ch', {
      yPercent: (i) => (i % 2 ? -1 : 1) * (60 + i * 12),
      xPercent: (i) => (i - 5) * 40,
      opacity: 0,
      filter: 'blur(12px)',
      stagger: 0.02,
      ease: 'none',
      scrollTrigger: st('#s1', 'top top', '45% top'),
    });
    gsap.to('.s1-title .mid', { opacity: 0, x: 120, ease: 'none', scrollTrigger: st('#s1', 'top top', '30% top') });
    gsap.to('.s1-lead, .s1-meta, .s1-cue, .s1-hint', { opacity: 0, y: -40, ease: 'none', scrollTrigger: st('#s1', '5% top', '30% top') });
    gsap.fromTo('.s1-late', { opacity: 0, y: 40 }, { opacity: 1, y: 0, ease: 'none', scrollTrigger: st('#s1', '45% top', '60% top') });
    gsap.to('.s1-late', { opacity: 0, ease: 'none', scrollTrigger: st('#s1', '78% top', '95% top') });

    gsap.fromTo('.s2-big-a', { xPercent: 20 }, { xPercent: -70, ease: 'none', scrollTrigger: st('#s2', 'top bottom', 'bottom top') });
    gsap.fromTo('.s2-big-b', { xPercent: -60 }, { xPercent: 30, ease: 'none', scrollTrigger: st('#s2', 'top bottom', 'bottom top') });

    gsap.fromTo('.s3-title .w1', { xPercent: 0 }, { xPercent: -30, ease: 'none', scrollTrigger: st('#s3', 'top bottom', 'bottom top') });
    gsap.fromTo('.s3-title .w2', { xPercent: 0 }, { xPercent: 25, ease: 'none', scrollTrigger: st('#s3', 'top bottom', 'bottom top') });

    gsap.fromTo('.s4-title', { yPercent: 30, opacity: 0 }, { yPercent: 0, opacity: 1, ease: 'none', scrollTrigger: st('#s4', 'top 60%', 'top top') });

    document.querySelectorAll<HTMLElement>('.scene').forEach((sec) => {
      ScrollTrigger.create({
        trigger: sec,
        start: 'top 70%',
        end: 'bottom 30%',
        onToggle: (self) => sec.classList.toggle('in-view', self.isActive),
      });
    });
  }

  // ───────────────────────────────── frame
  private tick = (t: number) => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.scroll.raf(t * 1000);
    this.pointer.update(dt);
    this.engine.tick(dt);
    if (!Q.isTouch) this.cursor.update(dt);

    const st = this.scroll.state;
    const idx = st.t > 0.5 && st.next >= 0 ? st.next : st.index;
    if (idx !== this.currentIndex) {
      this.currentIndex = idx;
      const num = $('#rail-num');
      const name = $('#rail-name');
      if (num) num.textContent = `0${idx + 1}`;
      if (name) name.textContent = SCENE_NAMES[idx];
      this.cursor.setSceneHint(SCENE_HINTS[idx]);
      document.querySelectorAll('.hud-nav [data-goto]').forEach((b, k) => b.classList.toggle('is-on', k === idx));
      document.body.dataset.scene = String(idx);
    }
    const fill = $('#rail-fill');
    if (fill) fill.style.transform = `scaleY(${st.total})`;
    this.audio.setEnergy(Math.min(1, Math.abs(st.velocity) / 40 + this.engine.glitch * 0.5));

    // s2 depth readout
    const depth = $('#depth');
    if (depth && idx === 1) depth.textContent = ((this.scroll.state.progress[1] * 150 + now / 1000 * 0.55) * 5.6).toFixed(2).padStart(7, '0');

    // finale lines
    const p5 = st.progress[4];
    document.querySelectorAll<HTMLElement>('.s5-line').forEach((el) => {
      const at = +el.dataset.at!;
      const until = +(el.dataset.until ?? 0.8);
      el.classList.toggle('is-on', p5 >= at && p5 < until && (idx === 4));
    });
  };
}
