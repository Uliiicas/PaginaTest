/**
 * Generative ambient score (no audio files). A detuned drone through a
 * resonant low-pass whose cutoff follows scroll energy; each scene shifts the
 * chord. Interactions trigger tuned "pings" into a feedback delay.
 */
const CHORDS: number[][] = [
  [55.0, 82.41, 110.0, 164.81], // A — umbral
  [49.0, 73.42, 98.0, 155.56], // G (b6) — espacio imposible
  [43.65, 65.41, 87.31, 130.81], // F — transformación
  [58.27, 87.31, 116.54, 174.61], // Bb — laboratorio
  [55.0, 82.41, 123.47, 196.0], // A sus — apeiron
];

export class AmbientAudio {
  enabled = false;
  private ctx?: AudioContext;
  private master?: GainNode;
  private filter?: BiquadFilterNode;
  private delayIn?: GainNode;
  private voices: OscillatorNode[][] = [];
  private scene = 0;

  get started() {
    return !!this.ctx;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const master = (this.master = ctx.createGain());
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    master.connect(comp).connect(ctx.destination);

    const filter = (this.filter = ctx.createBiquadFilter());
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 7;
    filter.connect(master);

    // feedback delay = space
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.43;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    this.delayIn = ctx.createGain();
    this.delayIn.connect(delay);
    delay.connect(tone).connect(fb).connect(delay);
    tone.connect(wet).connect(master);
    filter.connect(this.delayIn);

    // slow LFO on the cutoff
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    CHORDS[0].forEach((f, i) => {
      const g = ctx.createGain();
      g.gain.value = 0.05 / (1 + i * 0.25);
      const pan = ctx.createStereoPanner();
      pan.pan.value = (i % 2 ? 1 : -1) * 0.35;
      const a = ctx.createOscillator();
      a.type = 'sawtooth';
      a.frequency.value = f;
      a.detune.value = -6;
      const b = ctx.createOscillator();
      b.type = 'triangle';
      b.frequency.value = f * 1.002;
      b.detune.value = 7;
      a.connect(g);
      b.connect(g);
      g.connect(pan).connect(filter);
      a.start();
      b.start();
      this.voices.push([a, b]);
    });

    // air: filtered noise
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.value = 0.012;
    noise.connect(bp).connect(ng).connect(master);
    noise.start();
  }

  setEnabled(on: boolean) {
    if (on && !this.ctx) this.start();
    this.enabled = on;
    if (!this.ctx || !this.master) return;
    if (on && this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, on ? 1.2 : 0.3);
  }

  setScene(i: number) {
    if (i === this.scene || !this.ctx) return;
    this.scene = i;
    const chord = CHORDS[i % CHORDS.length];
    const t = this.ctx.currentTime;
    this.voices.forEach(([a, b], k) => {
      a.frequency.setTargetAtTime(chord[k], t, 1.4);
      b.frequency.setTargetAtTime(chord[k] * 1.002, t, 1.6);
    });
  }

  /** 0..1 — opens the filter with scroll speed / intensity. */
  setEnergy(v: number) {
    if (!this.ctx || !this.filter) return;
    this.filter.frequency.setTargetAtTime(380 + Math.min(1, v) * 2600, this.ctx.currentTime, 0.25);
  }

  ping(freq = 880, gain = 0.12, type: OscillatorType = 'sine') {
    if (!this.ctx || !this.enabled || !this.master || !this.delayIn) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 1.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g);
    g.connect(this.master);
    g.connect(this.delayIn);
    o.start(t);
    o.stop(t + 1.5);
  }

  /** Low sub hit for impacts (detonations, collapses). */
  boom() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.3);
  }
}
