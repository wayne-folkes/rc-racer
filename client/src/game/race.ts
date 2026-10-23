// Race rules: countdown, checkpoints, laps and finishing. Pure logic driven by each car's
// distance along the track, so it works the same for the player and (later) AI cars.

export const TOTAL_LAPS = 3;
export const COUNTDOWN_SECONDS = 3;
/** Checkpoints as fractions of the track length. The finish line (0) is implicit. */
export const CHECKPOINT_FRACTIONS = [0.25, 0.5, 0.75];

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** True if moving forward from `last` to `now` passed the point `at` (all distances along a loop). */
export function crossedForward(last: number, now: number, at: number, length: number): boolean {
  // Shortest signed change, so wrapping past the start line counts as a small step forward.
  const delta = mod(now - last + length / 2, length) - length / 2;
  if (delta <= 0) return false;
  const rel = mod(at - last, length);
  return rel > 0 && rel <= delta;
}

export type ProgressEvent = 'start' | 'lap';

/**
 * One car's progress through the race. Checkpoints must be passed in order before crossing the
 * finish line counts as a lap, so reversing over the line or cutting back doesn't score.
 */
export class RaceProgress {
  lapsCompleted = 0;
  readonly lapTimes: number[] = [];

  private readonly checkpoints: number[];
  private next = 0;
  private awaitingStart: boolean;
  private lastDistance: number | null = null;
  private lapStartedAt = 0;

  /**
   * @param startsBehindLine The car starts on a grid behind the finish line, so its first
   *   crossing starts lap 1 rather than completing a lap.
   */
  constructor(
    private readonly trackLength: number,
    startsBehindLine = true,
    fractions: number[] = CHECKPOINT_FRACTIONS,
  ) {
    this.checkpoints = fractions.map((f) => f * trackLength);
    this.awaitingStart = startsBehindLine;
  }

  get bestLap(): number | null {
    return this.lapTimes.length ? Math.min(...this.lapTimes) : null;
  }

  currentLapTime(clock: number): number {
    return clock - this.lapStartedAt;
  }

  /** Total distance covered towards the finish, for working out race positions. */
  progress(distance: number): number {
    if (this.awaitingStart) return distance - this.trackLength;
    return this.lapsCompleted * this.trackLength + distance;
  }

  update(distance: number, clock: number): ProgressEvent | null {
    const last = this.lastDistance;
    this.lastDistance = distance;
    if (last === null) return null;

    for (;;) {
      const onFinish = this.awaitingStart || this.next === this.checkpoints.length;
      const target = onFinish ? 0 : this.checkpoints[this.next];
      if (!crossedForward(last, distance, target, this.trackLength)) return null;

      if (this.awaitingStart) {
        this.awaitingStart = false;
        return 'start';
      }
      if (!onFinish) {
        this.next++;
        continue;
      }
      this.lapTimes.push(clock - this.lapStartedAt);
      this.lapStartedAt = clock;
      this.lapsCompleted++;
      this.next = 0;
      return 'lap';
    }
  }

  /** Forget the previous position, e.g. after the car is reset onto the track. */
  resetPosition(): void {
    this.lastDistance = null;
  }
}

export type RacePhase = 'countdown' | 'racing' | 'finished';
export type RaceEvent = 'go' | 'lap' | 'finalLap' | 'finish';

export class Race {
  phase: RacePhase = 'countdown';
  /** Seconds left in the countdown. */
  countdown = COUNTDOWN_SECONDS;
  /** Race clock, starting at GO. */
  clock = 0;
  finishTime: number | null = null;
  readonly player: RaceProgress;

  constructor(
    trackLength: number,
    readonly totalLaps = TOTAL_LAPS,
  ) {
    this.player = new RaceProgress(trackLength);
  }

  /** Cars can't move until GO. */
  get controlsLocked(): boolean {
    return this.phase === 'countdown';
  }

  /** The lap the player is on, 1-based, never past the last lap. */
  get currentLap(): number {
    return Math.min(this.totalLaps, this.player.lapsCompleted + 1);
  }

  update(dt: number, playerDistance: number): RaceEvent[] {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      this.player.update(playerDistance, 0);
      if (this.countdown > 0) return [];
      this.countdown = 0;
      this.phase = 'racing';
      return ['go'];
    }
    if (this.phase === 'finished') return [];

    this.clock += dt;
    if (this.player.update(playerDistance, this.clock) !== 'lap') return [];
    if (this.player.lapsCompleted >= this.totalLaps) {
      this.phase = 'finished';
      this.finishTime = this.clock;
      return ['finish'];
    }
    return this.player.lapsCompleted === this.totalLaps - 1 ? ['lap', 'finalLap'] : ['lap'];
  }
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
