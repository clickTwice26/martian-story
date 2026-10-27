/**
 * The opening's score and sound design, synthesised in Web Audio like the
 * rest of the game's audio: no sample files.
 *
 * Music: slow string-pad chords in D minor through a long generated reverb,
 * a sub drone, starlight bell plinks, a pulsing ostinato when things go wrong,
 * and a resolution to D major when the pilot gets back up.
 *
 * Sound obeys the same physics as the game. Space carries nothing, so the
 * debris strike is heard as structure-borne noise through the hull. On the
 * surface the 610 Pa CO2 atmosphere crushes everything above ~240 Hz, and the
 * crash boom arrives late: sound crosses Jezero at ~240 m/s, not 343.
 */

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);       // MIDI -> Hz

export class Score {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.0001;
    this.out.connect(destination);
    this.out.gain.setTargetAtTime(1, ctx.currentTime, 0.4);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(5.5, 2.6);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet).connect(this.out);

    this.music = ctx.createGain(); this.music.gain.value = 0.9;
    this.music.connect(this.out);
    this.music.connect(this.reverb);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 1;
    this.sfx.connect(this.out);

    this.noise = this._noiseBuffer(4);
    this.voices = [];
    this._bells = null;
    this._ostinato = null;
    this.stopped = false;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.0 + w * 0.25; }
    return b;
  }

  _noise(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true;
    s.start(t, Math.random() * 3); s.stop(t + dur + 0.1);
    return s;
  }

  /* --------------------------------------------------------------- music -- */
  /** A sustained chord: each note two detuned saws through a slow filter. */
  chord(notes, { at = 0, attack = 3.5, hold = 7, release = 4.5, level = 0.05, bright = 900 } = {}) {
    if (this.stopped) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    for (const n of notes) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + attack);
      g.gain.setValueAtTime(level, t + attack + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.6;
      lp.frequency.setValueAtTime(bright * 0.5, t);
      lp.frequency.linearRampToValueAtTime(bright, t + attack + hold * 0.5);
      lp.frequency.linearRampToValueAtTime(bright * 0.6, t + attack + hold + release);
      lp.connect(g).connect(this.music);
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(n);
        o.detune.value = det;
        o.connect(lp);
        o.start(t); o.stop(t + attack + hold + release + 0.1);
      }
    }
  }

  drone(on = true, { level = 0.07, note = 26 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime;
    if (!on) { if (this._drone) { this._drone.g.gain.setTargetAtTime(0.0001, t, 1.5); this._drone = null; } return; }
    if (this._drone || this.stopped) return;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    g.gain.setTargetAtTime(level, t, 2.5);
    g.connect(this.music);
    const os = [NOTE(note), NOTE(note + 12), NOTE(note + 19)].map((f, i) => {
      const o = ctx.createOscillator(); o.type = i ? 'triangle' : 'sine'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = [1, 0.35, 0.12][i];
      o.connect(og).connect(g); o.start(); return o;
    });
    this._drone = { g, os };
  }

  /** Sparse high bell tones: starlight. */
  bells(on = true) {
    if (!on) { clearInterval(this._bells); this._bells = null; return; }
    if (this._bells || this.stopped) return;
    const scale = [74, 76, 77, 81, 84, 86, 88, 93];
    const ping = () => {
      if (this.stopped) return;
      const ctx = this.ctx, t = ctx.currentTime + Math.random() * 0.4;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = NOTE(scale[Math.floor(Math.random() * scale.length)]);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.022, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      o.connect(g).connect(this.reverb);
      g.connect(this.music);
      o.start(t); o.stop(t + 3.3);
    };
    ping();
    this._bells = setInterval(ping, 1700);
  }

  /** Pulsing low ostinato that tightens as the situation does. */
  ostinato(on = true, bpm = 96) {
    if (!on) { clearInterval(this._ostinato); this._ostinato = null; return; }
    if (this._ostinato || this.stopped) return;
    const step = 60 / bpm / 2;
    let i = 0;
    const hit = () => {
      if (this.stopped) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = NOTE([38, 38, 41, 38, 36, 38, 43, 41][i++ % 8]);
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(180, t + step * 0.9);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 0.95);
      o.connect(lp).connect(g).connect(this.music);
      o.start(t); o.stop(t + step);
    };
    this._ostinato = setInterval(hit, step * 1000);
  }

  /* ----------------------------------------------------------------- sfx -- */
  alarm(on = true) {
    if (!on) { clearInterval(this._alarm); this._alarm = null; return; }
    if (this._alarm || this.stopped) return;
    let hi = true;
    const tone = () => {
      if (this.stopped) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
      o.type = 'square'; o.frequency.value = hi ? 920 : 690; hi = !hi;
      bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.2;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.01);
      g.gain.setValueAtTime(0.03, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      o.connect(bp).connect(g).connect(this.sfx);
      o.start(t); o.stop(t + 0.4);
    };
    tone();
    this._alarm = setInterval(tone, 420);
  }

  /** Debris strike, heard through the hull: clang, groan, sub thump. */
  hullImpact() {
    if (this.stopped) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, d, l] of [[187, 2.6, 0.10], [311, 1.9, 0.07], [523, 1.3, 0.05], [811, 0.9, 0.035], [1290, 0.6, 0.02]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.93, t + d);
      g.gain.setValueAtTime(l, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(this.sfx); g.connect(this.reverb);
      o.start(t); o.stop(t + d);
    }
    this._boom(t, { f0: 90, f1: 32, dur: 1.8, level: 0.5, lp: 900 });
  }

  _boom(t, { f0 = 70, f1 = 24, dur = 4, level = 0.6, lp = 240 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(level, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og).connect(this.sfx); o.start(t); o.stop(t + dur);
    const n = this._noise(t, dur), f = ctx.createBiquadFilter(), ng = ctx.createGain();
    f.type = 'lowpass'; f.frequency.setValueAtTime(lp, t); f.frequency.exponentialRampToValueAtTime(lp * 0.25, t + dur);
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(level * 1.4, t + 0.03);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(ng).connect(this.sfx); ng.connect(this.reverb);
  }

  /** Re-entry: a swelling low roar with crackle. Returns a stopper. */
  rumble(seconds) {
    if (this.stopped) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(t, seconds), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.setValueAtTime(90, t); f.frequency.linearRampToValueAtTime(520, t + seconds * 0.85);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55, t + seconds * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    n.connect(f).connect(g).connect(this.sfx);
    const crackle = () => {
      if (this.stopped || ctx.currentTime > t + seconds * 0.95) return;
      const c = this._noise(ctx.currentTime, 0.05), hp = ctx.createBiquadFilter(), cg = ctx.createGain();
      hp.type = 'highpass'; hp.frequency.value = 1800;
      cg.gain.setValueAtTime(0.03 + Math.random() * 0.05, ctx.currentTime);
      cg.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
      c.connect(hp).connect(cg).connect(this.sfx);
      setTimeout(crackle, 30 + Math.random() * 120);
    };
    crackle();
  }

  /** A rising swell of filtered air, leading into a reveal. */
  swell(seconds) {
    if (this.stopped) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(t, seconds + 0.2), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 0.7;
    f.frequency.setValueAtTime(180, t); f.frequency.exponentialRampToValueAtTime(2200, t + seconds);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + seconds * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.2);
    n.connect(f).connect(g).connect(this.sfx); g.connect(this.reverb);
  }

  /** The title hit: a low, detuned brass-like swell over a sub boom. */
  braam() {
    if (this.stopped) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(140, t); f.frequency.exponentialRampToValueAtTime(1100, t + 0.35);
    f.frequency.exponentialRampToValueAtTime(160, t + 4.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
    f.connect(g).connect(this.sfx); g.connect(this.reverb);
    for (const [hz, det] of [[36.7, -7], [36.7, 6], [55, -4], [73.4, 5]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + 5.6);
    }
    this._boom(t, { f0: 60, f1: 22, dur: 3.5, level: 0.45, lp: 180 });
  }

  /** Fireball overhead on Mars: a low-passed whoosh, louder as it nears. */
  whoosh(seconds) {
    if (this.stopped) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(t, seconds), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.setValueAtTime(120, t); f.frequency.linearRampToValueAtTime(240, t + seconds * 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + seconds * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    n.connect(f).connect(g).connect(this.sfx);
  }

  /** Ground impact at `distance` metres: delayed by Mars' speed of sound. */
  crash(distance) {
    if (this.stopped) return;
    const t = this.ctx.currentTime + distance / 240;
    this._boom(t, { f0: 62, f1: 20, dur: 7.5, level: 0.9, lp: 240 });
    this._boom(t + 0.35, { f0: 44, f1: 18, dur: 6, level: 0.4, lp: 160 });
  }

  /** Quiet keyboard ticks under typewritten text. */
  tick() {
    if (this.stopped) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(t, 0.02), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    g.gain.setValueAtTime(0.018, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    n.connect(hp).connect(g).connect(this.sfx);
  }

  /** Fade everything out and release. */
  stop(fade = 1.2) {
    if (this.stopped) return;
    this.stopped = true;
    this.bells(false); this.ostinato(false); this.alarm(false); this.drone(false);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.0001, t + fade);
    setTimeout(() => { try { this.out.disconnect(); } catch (e) { /* already gone */ } }, fade * 1000 + 200);
  }
}

/* Chords for the score, as MIDI note numbers. */
export const CHORDS = {
  Dm9:    [50, 57, 62, 65, 69, 76],
  Bbmaj7: [46, 53, 62, 65, 69, 74],
  Fmaj7A: [45, 53, 60, 64, 69, 72],
  Csus2:  [48, 55, 62, 67, 74],
  Gm9:    [43, 50, 58, 62, 65, 69],
  Asus4:  [45, 52, 57, 62, 64, 69],
  Dmaj:   [50, 57, 62, 66, 69, 74, 78],
};
