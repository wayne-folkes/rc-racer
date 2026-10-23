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
/** Events for the player's car (racer 0). */
export type RaceEvent = 'go' | 'lap' | 'finalLap' | 'finish';

/**
 * A race between several cars. Racer 0 is the player; the race is "finished" once the player
 * crosses the line, but the clock keeps running so the other cars can still finish.
 */
export class Race {
  phase: RacePhase = 'countdown';
  /** Seconds left in the countdown. */
  countdown = COUNTDOWN_SECONDS;
  /** Race clock, starting at GO. */
  clock = 0;
  readonly racers: RaceProgress[];
  /** Race time at which each racer finished, or null while still racing. */
  readonly finishTimes: (number | null)[];
  private readonly distances: number[];

  constructor(
    trackLength: number,
    racerCount = 1,
    readonly totalLaps = TOTAL_LAPS,
  ) {
    this.racers = Array.from({ length: racerCount }, () => new RaceProgress(trackLength));
    this.finishTimes = this.racers.map(() => null);
    this.distances = this.racers.map(() => 0);
  }

  get player(): RaceProgress {
    return this.racers[0];
  }

  get finishTime(): number | null {
    return this.finishTimes[0];
  }

  /** Cars can't move until GO. */
  get controlsLocked(): boolean {
    return this.phase === 'countdown';
  }

  /** The lap the player is on, 1-based, never past the last lap. */
  get currentLap(): number {
    return Math.min(this.totalLaps, this.player.lapsCompleted + 1);
  }

  /** Distance covered towards the finish; for rubber-banding and positions. */
  progress(racer: number): number {
    return this.racers[racer].progress(this.distances[racer]);
  }

  /** Racer indices in race order: finishers by time, then everyone else by distance covered. */
  standings(): number[] {
    return this.racers
      .map((_, i) => i)
      .sort((a, b) => {
        const fa = this.finishTimes[a];
        const fb = this.finishTimes[b];
        if (fa !== null || fb !== null) {
          if (fa === null) return 1;
          if (fb === null) return -1;
          return fa - fb;
        }
        return this.progress(b) - this.progress(a);
      });
  }

  /** 1-based race position of a racer. */
  position(racer: number): number {
    return this.standings().indexOf(racer) + 1;
  }

  /** `distances[i]` is racer i's distance along the track. */
  update(dt: number, distances: number[]): RaceEvent[] {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      this.trackRacers(distances, 0);
      if (this.countdown > 0) return [];
      this.countdown = 0;
      this.phase = 'racing';
      return ['go'];
    }

    this.clock += dt;
    const playerLapped = this.trackRacers(distances, this.clock)[0];
    if (this.phase === 'finished' || !playerLapped) return [];
    if (this.finishTimes[0] !== null) {
      this.phase = 'finished';
      return ['finish'];
    }
    return this.player.lapsCompleted === this.totalLaps - 1 ? ['lap', 'finalLap'] : ['lap'];
  }

  /** Updates every racer's progress; returns which of them completed a lap this step. */
  private trackRacers(distances: number[], clock: number): boolean[] {
    return this.racers.map((racer, i) => {
      this.distances[i] = distances[i];
      if (this.finishTimes[i] !== null) return false;
      const lapped = racer.update(distances[i], clock) === 'lap';
      if (lapped && racer.lapsCompleted >= this.totalLaps) this.finishTimes[i] = clock;
      return lapped;
    });
  }
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
