/**
 * Suit audio, synthesised entirely in Web Audio. No sample files, so the whole
 * thing stays offline.
 *
 * The design follows real Martian acoustics rather than film convention.
 * Mars' atmosphere is ~610 Pa of CO2, about 0.6% of Earth's pressure, and
 * Perseverance's SuperCam microphone confirmed that it attenuates frequencies
 * above roughly 240 Hz very sharply. Outside noise is therefore faint and
 * heavily low-passed - there is almost nothing to hear.
 *
 * What an EVA crew member actually hears is the inside of their own suit:
 * their breathing, the ventilation fan, the regulator, and footfalls conducted
 * up through the boots as structure-borne vibration rather than through air.
 * So breathing is the loudest thing in the mix, by design.
 */

export class SuitAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.masterVolume = 0.85;
    this.exertion = 0;            // 0..1, drives breath rate and depth
    this._breathT = 0;
    this._breathPhase = 0;        // 0 = inhale next, 1 = exhale next
    this._nextBreath = 0;
  }

  async start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const ctx = this.ctx;

    // ---- master chain: compressor keeps breath peaks from clipping ----
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp).connect(ctx.destination);

    this.noise = this._makeNoiseBuffer(3.0);
    this._buildSuitFan();
    this._buildExteriorWind();
    this._buildCommsBed();

    this.ready = true;
    this._nextBreath = ctx.currentTime + 0.35;
  }

  _makeNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // brown-ish noise: integrated white, which sits better under a low-pass
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2 + w * 0.18;
    }
    return buf;
  }

  _loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start();
    return s;
  }

  /** Ventilation fan + regulator: the constant bed you stop noticing. */
  _buildSuitFan() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.085;

    // two slightly detuned rotors
    for (const [f, amp] of [[61, 0.55], [92.5, 0.3], [123, 0.14]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og).connect(g);
      o.start();
      // slow wobble so it never sounds like a held synth note
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + Math.random() * 0.05;
      const lg = ctx.createGain(); lg.gain.value = f * 0.004;
      lfo.connect(lg).connect(o.frequency); lfo.start();
    }
    // airflow hiss
    const hiss = this._loopNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.7;
    const hg = ctx.createGain(); hg.gain.value = 0.30;
    hiss.connect(bp).connect(hg).connect(g);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    g.connect(lp).connect(this.master);
    this.fanGain = g;
  }

  /**
   * Exterior wind, as heard from inside a sealed helmet on a planet whose
   * atmosphere barely couples to anything. Deliberately almost inaudible.
   */
  _buildExteriorWind() {
    const ctx = this.ctx;
    const src = this._loopNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 135; lp.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.master);

    // gusts
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045;
    const lg = ctx.createGain(); lg.gain.value = 0.028;
    lfo.connect(lg).connect(g.gain); lfo.start();
    this.windGain = g;
  }

  /** Open-channel radio hiss, very low. */
  _buildCommsBed() {
    const ctx = this.ctx;
    const src = this._loopNoise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const g = ctx.createGain(); g.gain.value = 0.012;
    src.connect(hp).connect(lp).connect(g).connect(this.master);
  }

  // ------------------------------------------------------------- breathing
  _breath(inhale) {
    const ctx = this.ctx, t = ctx.currentTime;
    const ex = this.exertion;
    const src = this._loopNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = inhale ? 430 + ex * 180 : 300 + ex * 120;
    bp.Q.value = inhale ? 1.15 : 0.9;

    const g = ctx.createGain();
    const peak = (inhale ? 0.20 : 0.155) * (0.72 + ex * 0.75);
    const dur = inhale ? (0.62 - ex * 0.24) : (0.78 - ex * 0.30);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.42);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    // gentle formant sweep so it reads as air moving, not a noise gate
    bp.frequency.setValueAtTime(bp.frequency.value, t);
    bp.frequency.linearRampToValueAtTime(
      bp.frequency.value * (inhale ? 1.35 : 0.72), t + dur);

    src.connect(bp).connect(g).connect(this.master);
    src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------- footsteps
  /**
   * Structure-borne, not airborne: you feel the boot through the suit far more
   * than you hear it through 610 Pa of CO2. So: a low thud with a short,
   * heavily damped regolith component on top.
   */
  footstep(intensity = 1, slope = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const amp = Math.min(1.4, Math.max(0.15, intensity));

    // thud conducted up the leg
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 58 + Math.random() * 16;
    o.frequency.setValueAtTime(f0 * 1.7, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.30 * amp, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 0.2);

    // regolith granularity, low-passed hard
    const src = this._loopNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 780 + Math.random() * 520 + slope * 6;
    bp.Q.value = 0.85;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1700;      // the CO2 ceiling, stylised
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.115 * amp, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    src.connect(bp).connect(lp).connect(g).connect(this.master);
    src.stop(t + 0.2);
  }

  /** Landing from a hop: heavier thud plus a suit-frame rattle. */
  land(impact) {
    if (!this.ready || !this.enabled) return;
    const a = Math.min(1.5, Math.abs(impact) / 4);
    this.footstep(0.9 + a, 0);
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(44, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26 * a, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.34);
  }

  /**
   * An arm swing, heard from inside: the suit's fabric and bearings rustle,
   * not air rushing past - there is almost no air to rush.
   */
  swing(strength = 1) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._loopNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.exponentialRampToValueAtTime(1300, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07 * strength, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(bp).connect(g).connect(this.master);
    src.stop(t + 0.2);
  }

  /** Glove or rock meeting rock: a dull knock carried through the body. */
  thud(strength = 1) {
    if (!this.ready || !this.enabled) return;
    this.footstep(Math.min(1.4, 0.5 + strength * 0.8), 0);
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * Math.min(1.5, strength), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.14);
  }

  /** Suit effort grunt on a hard exertion spike - used sparingly. */
  exhaleSharp() {
    if (!this.ready || !this.enabled) return;
    this._breath(false);
  }

  beep(kind = 'ok') {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const seq = kind === 'ok' ? [[880, 0], [1320, 0.07]]
              : kind === 'mode' ? [[660, 0], [990, 0.06]]
              : [[440, 0], [330, 0.09]];
    for (const [f, off] of seq) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + off);
      g.gain.exponentialRampToValueAtTime(0.035, t + off + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.075);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2600;
      o.connect(g).connect(lp).connect(this.master);
      o.start(t + off); o.stop(t + off + 0.09);
    }
  }

  /** @param exertion 0..1 */
  update(dt, exertion) {
    if (!this.ready || !this.enabled) return;
    this.exertion += (exertion - this.exertion) * Math.min(1, dt * 1.4);
    const t = this.ctx.currentTime;
    if (t >= this._nextBreath) {
      const inhale = this._breathPhase === 0;
      this._breath(inhale);
      this._breathPhase ^= 1;
      // 4.6 s cycle at rest tightening toward 1.7 s under load
      const cycle = 4.6 - this.exertion * 2.9;
      this._nextBreath = t + (inhale ? cycle * 0.44 : cycle * 0.56);
    }
    if (this.fanGain) this.fanGain.gain.value = 0.085 + this.exertion * 0.05;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.masterVolume : 0;
  }
}
