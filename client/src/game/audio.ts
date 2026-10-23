// Sound effects and engine notes, synthesized live with the Web Audio API from oscillators and
// noise. There are no sound files: it suits the retro look and costs nothing to download.
//
// Browsers only allow audio after the player has interacted with the page, so nothing plays
// until the first key press, click or tap (see unlock()).

export type SoundName =
  | 'beep'
  | 'go'
  | 'pickup'
  | 'boost'
  | 'explode'
  | 'fire'
  | 'drop'
  | 'splash'
  | 'skid'
  | 'lap'
  | 'finalLap'
  | 'finish';

export type EngineId = 'player' | 'rival';

const MUTE_KEY = 'rc-racer:muted';
const MASTER_VOLUME = 0.6;
/** How quickly engine pitch and volume follow the car (seconds). */
const ENGINE_SMOOTHING = 0.06;
/** Share of top speed where the engine "changes gear" and its pitch drops back. */
const GEAR_CHANGE = 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The engine's pitch (Hz) and loudness for a car's speed and throttle. Pitch climbs through two
 * "gears", dropping back at the change, and the engine is louder under throttle.
 */
export function engineNote(speed: number, throttle: number, topSpeed = 26): { freq: number; gain: number } {
  const s = clamp(Math.abs(speed) / topSpeed, 0, 1.4);
  const inGear = s < GEAR_CHANGE ? s / GEAR_CHANGE : (s - GEAR_CHANGE) / (1.4 - GEAR_CHANGE);
  const gearBase = s < GEAR_CHANGE ? 0 : 35;
  return {
    freq: 55 + gearBase + 150 * inGear + (throttle > 0 ? 8 : 0),
    gain: 0.05 + 0.08 * Math.max(0, throttle) + 0.05 * Math.min(1, s),
  };
}

/** Quieter the further away something happens, but never silent. */
export function distanceVolume(distance: number, reach = 60): number {
  return clamp(1 - distance / reach, 0.15, 1);
}

interface Engine {
  osc: OscillatorNode;
  sub: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class Sound {
  muted: boolean;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly engines = new Map<EngineId, Engine>();

  constructor() {
    this.muted = readMuted();
    const unlock = () => this.unlock();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  /** Starts audio. Safe to call repeatedly; it only does anything the first time it can. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
      this.master.connect(this.ctx.destination);
      this.noise = whiteNoise(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    writeMuted(this.muted);
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  /** Sets an engine's note; a gain of 0 silences it. Call every frame while it should sound. */
  engine(id: EngineId, freq: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    let e = this.engines.get(id);
    if (!e) {
      e = createEngine(ctx, this.master);
      this.engines.set(id, e);
    }
    const t = ctx.currentTime;
    e.osc.frequency.setTargetAtTime(freq, t, ENGINE_SMOOTHING);
    e.sub.frequency.setTargetAtTime(freq / 2, t, ENGINE_SMOOTHING);
    e.filter.frequency.setTargetAtTime(400 + freq * 4, t, ENGINE_SMOOTHING);
    e.gain.gain.setTargetAtTime(gain, t, ENGINE_SMOOTHING);
  }

  /** Fades every engine out, e.g. when a menu opens. */
  silenceEngines(): void {
    for (const id of this.engines.keys()) this.engine(id, 60, 0);
  }

  play(name: SoundName, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const v = clamp(volume, 0, 1);
    switch (name) {
      case 'beep':
        this.tone({ freq: 440, dur: 0.14, type: 'square', vol: 0.22 * v });
        break;
      case 'go':
        this.tone({ freq: 880, dur: 0.45, type: 'square', vol: 0.24 * v });
        this.tone({ freq: 1320, dur: 0.45, type: 'square', vol: 0.08 * v });
        break;
      case 'pickup':
        this.tone({ freq: 660, dur: 0.08, type: 'square', vol: 0.18 * v });
        this.tone({ freq: 990, dur: 0.12, type: 'square', vol: 0.18 * v, delay: 0.07 });
        break;
      case 'boost':
        this.whoosh({ from: 400, to: 3200, dur: 0.55, vol: 0.4 * v, filter: 'bandpass', q: 2 });
        this.tone({ freq: 180, to: 620, dur: 0.5, type: 'sawtooth', vol: 0.1 * v });
        break;
      case 'explode':
        this.whoosh({ from: 1600, to: 90, dur: 0.75, vol: 0.7 * v, filter: 'lowpass', q: 0.7 });
        this.tone({ freq: 95, to: 38, dur: 0.45, type: 'sine', vol: 0.55 * v });
        break;
      case 'fire':
        this.tone({ freq: 950, to: 180, dur: 0.2, type: 'square', vol: 0.14 * v });
        this.whoosh({ from: 3000, to: 800, dur: 0.25, vol: 0.12 * v, filter: 'highpass', q: 0.7 });
        break;
      case 'drop':
        this.tone({ freq: 320, to: 140, dur: 0.12, type: 'square', vol: 0.18 * v });
        break;
      case 'splash':
        this.whoosh({ from: 2200, to: 500, dur: 0.4, vol: 0.32 * v, filter: 'bandpass', q: 1.2 });
        break;
      case 'skid':
        this.whoosh({ from: 2600, to: 2000, dur: 0.45, vol: 0.18 * v, filter: 'bandpass', q: 8 });
        break;
      case 'lap':
        this.melody([523, 659], 0.1, 0.16 * v);
        break;
      case 'finalLap':
        this.melody([523, 659, 784], 0.1, 0.17 * v);
        break;
      case 'finish':
        this.melody([523, 659, 784, 1047, 784, 1047], 0.11, 0.18 * v);
        break;
    }
  }

  /** A note with a quick attack and an exponential fade, optionally sliding in pitch. */
  private tone(o: { freq: number; to?: number; dur: number; type: OscillatorType; vol: number; delay?: number }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    const gain = envelope(ctx, t, o.dur, o.vol);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  /** Filtered noise whose filter sweeps from one frequency to another: whooshes and bangs. */
  private whoosh(o: { from: number; to: number; dur: number; vol: number; filter: BiquadFilterType; q: number }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter;
    filter.Q.value = o.q;
    filter.frequency.setValueAtTime(o.from, t);
    filter.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    const gain = envelope(ctx, t, o.dur, o.vol);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.dur + 0.05);
  }

  private melody(notes: number[], step: number, vol: number): void {
    notes.forEach((freq, i) => {
      const last = i === notes.length - 1;
      this.tone({ freq, dur: last ? step * 3 : step, type: 'square', vol, delay: i * step });
    });
  }
}

function envelope(ctx: AudioContext, t: number, dur: number, vol: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return gain;
}

/** A rough two-oscillator motor through a low-pass filter, silent until engine() is called. */
function createEngine(ctx: AudioContext, out: AudioNode): Engine {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const sub = ctx.createOscillator();
  sub.type = 'square';
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 3;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const subLevel = ctx.createGain();
  subLevel.gain.value = 0.5;
  osc.connect(filter);
  sub.connect(subLevel).connect(filter);
  filter.connect(gain).connect(out);
  osc.start();
  sub.start();
  return { osc, sub, filter, gain };
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Can't remember the setting; it still applies for this visit.
  }
}
