/**
 * spotted  – a territory's defenses noticed the plane.
 * lock     – one beep of the rocket lock tone.
 * launch   – a rocket has left the rails.
 * hit      – enemy fire struck the plane.
 * collapse – an installation was destroyed.
 * pop      – a rocket was shot down.
 * bandit   – an enemy fighter has turned on the plane.
 * raid     – an enemy bomber is on its way to T1.
 * crumple  – a paper plane was destroyed.
 * kill     – confirmation that the player shot one down.
 * whoosh   – an aircraft flashing past close by.
 * ink      – a burst of ink fire nearby.
 */
export type SoundName = 'spotted' | 'lock' | 'launch' | 'hit' | 'collapse' | 'pop' | 'bandit' | 'raid' | 'crumple' | 'kill' | 'whoosh' | 'ink';

/** The combat track: a bass line and off-beat ticks at this tempo, in sixteenths. */
const BPM = 132;
const BASS = [55, 0, 55, 0, 65.4, 0, 55, 0, 49, 0, 49, 0, 58.3, 0, 49, 0];

/**
 * Small synthesised sound effects (Web Audio, no files): warning beeps and alerts, so the player
 * hears when defenses notice them, lock on and fire. Browsers only allow audio after a key press or
 * click, so `unlock` is called from one; without audio support everything here does nothing.
 */
export class Sounds {
  muted = false;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Seconds until the next lock beep. */
  private lockWait = 0;
  private music: GainNode | null = null;
  private musicLevel = 0;
  /** When the next sixteenth of the combat track is due, and which one it is. */
  private nextBeat = 0;
  private beat = 0;

  /** Call from a user gesture. Creates (or wakes) the audio context. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.32;
        this.out.connect(this.ctx.destination);
        const length = Math.floor(this.ctx.sampleRate * 0.6);
        this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  play(name: SoundName): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    switch (name) {
      case 'spotted':
        this.tone(t, 660, 660, 0.07, 'square', 0.12);
        this.tone(t + 0.09, 990, 990, 0.09, 'square', 0.12);
        break;
      case 'lock':
        this.tone(t, 1250, 1250, 0.06, 'square', 0.1);
        break;
      case 'launch':
        this.tone(t, 1400, 700, 0.22, 'sawtooth', 0.16);
        this.tone(t + 0.26, 1400, 700, 0.22, 'sawtooth', 0.16);
        this.burst(t, 0.35, 900, 0.18);
        break;
      case 'hit':
        this.burst(t, 0.12, 700, 0.35);
        this.tone(t, 160, 70, 0.14, 'sine', 0.4);
        break;
      case 'collapse':
        this.burst(t, 0.55, 1600, 0.45, 180);
        this.tone(t, 110, 40, 0.45, 'sine', 0.5);
        break;
      case 'pop':
        this.burst(t, 0.16, 2400, 0.3);
        this.tone(t, 500, 1100, 0.1, 'triangle', 0.15);
        break;
      case 'bandit':
        this.tone(t, 880, 880, 0.08, 'square', 0.11);
        this.tone(t + 0.11, 660, 660, 0.08, 'square', 0.11);
        this.tone(t + 0.22, 880, 880, 0.08, 'square', 0.11);
        break;
      case 'raid':
        // A short air-raid wail: up and down twice.
        this.tone(t, 420, 820, 0.45, 'sawtooth', 0.09);
        this.tone(t + 0.45, 820, 420, 0.45, 'sawtooth', 0.09);
        this.tone(t + 0.9, 420, 820, 0.45, 'sawtooth', 0.09);
        this.tone(t + 1.35, 820, 380, 0.5, 'sawtooth', 0.09);
        break;
      case 'crumple':
        this.burst(t, 0.35, 3200, 0.4, 600);
        this.burst(t + 0.08, 0.25, 2200, 0.25, 400);
        break;
      case 'kill':
        this.tone(t, 660, 660, 0.09, 'triangle', 0.16);
        this.tone(t + 0.1, 990, 990, 0.16, 'triangle', 0.16);
        break;
      case 'whoosh':
        this.burst(t, 0.5, 900, 0.22, 200);
        break;
      case 'ink':
        this.burst(t, 0.05, 1800, 0.07);
        break;
    }
  }

  /**
   * The combat track: a tense bass line with ticks on the off-beats, fading in while enemy
   * aircraft are fighting the player (`level` 0–1) and out again when the fight is over.
   */
  combat(dt: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || ctx.state !== 'running') return;
    if (!this.music) {
      this.music = ctx.createGain();
      this.music.gain.value = 0;
      this.music.connect(this.out);
    }
    const target = this.muted ? 0 : level;
    this.musicLevel += (target - this.musicLevel) * (1 - Math.exp(-dt / (target > this.musicLevel ? 0.8 : 2.5)));
    this.music.gain.setTargetAtTime(this.musicLevel * 0.55, ctx.currentTime, 0.1);
    if (this.musicLevel < 0.02) {
      this.nextBeat = 0;
      return;
    }
    const step = 60 / BPM / 4;
    if (this.nextBeat < ctx.currentTime) this.nextBeat = ctx.currentTime + 0.05;
    while (this.nextBeat < ctx.currentTime + 0.2) {
      const n = this.beat % BASS.length;
      if (BASS[n]) this.note(this.nextBeat, BASS[n], step * 1.6);
      if (n % 4 === 2) this.tick(this.nextBeat);
      this.beat++;
      this.nextBeat += step;
    }
  }

  private note(at: number, freq: number, length: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.5, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(filter).connect(gain).connect(this.music!);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  private tick(at: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    src.connect(filter).connect(gain).connect(this.music!);
    src.start(at);
    src.stop(at + 0.07);
  }

  /**
   * Keeps the lock warning going while a launcher locks on: beeps that speed up as the lock
   * builds. `progress` is the strongest lock on the plane (0–1), or null for none.
   */
  lockTone(dt: number, progress: number | null): void {
    if (progress === null) {
      this.lockWait = 0;
      return;
    }
    this.lockWait -= dt;
    if (this.lockWait > 0) return;
    this.play('lock');
    this.lockWait = 0.34 - 0.24 * progress;
  }

  private tone(at: number, from: number, to: number, length: number, type: OscillatorType, volume: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + length);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(this.out!);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  /** A burst of filtered noise; with `sweepTo` the filter closes over the burst (a crunch). */
  private burst(at: number, length: number, cutoff: number, volume: number, sweepTo?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    src.connect(filter).connect(gain).connect(this.out!);
    src.start(at);
    src.stop(at + length + 0.02);
  }
}
