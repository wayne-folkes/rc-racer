import { describe, expect, it } from 'vitest';
import { COUNTDOWN_SECONDS, crossedForward, formatTime, Race, RaceProgress } from './race';

const LEN = 100;

/** Moves a car forward from `from` to `to` (both may exceed LEN) in 1-unit steps. */
function drive(progress: RaceProgress, from: number, to: number, clockPerUnit = 0.1, clock0 = 0) {
  const events: string[] = [];
  for (let d = from; d <= to; d++) {
    const e = progress.update(((d % LEN) + LEN) % LEN, clock0 + (d - from) * clockPerUnit);
    if (e) events.push(e);
  }
  return events;
}

describe('crossedForward', () => {
  it('detects passing a point going forward', () => {
    expect(crossedForward(24, 26, 25, LEN)).toBe(true);
    expect(crossedForward(20, 24, 25, LEN)).toBe(false);
  });

  it('ignores passing a point going backwards', () => {
    expect(crossedForward(26, 24, 25, LEN)).toBe(false);
  });

  it('handles wrapping past the start line', () => {
    expect(crossedForward(99, 1, 0, LEN)).toBe(true);
    expect(crossedForward(1, 99, 0, LEN)).toBe(false);
  });
});

describe('RaceProgress', () => {
  it('starts lap 1 on the first crossing from the grid, then counts full laps', () => {
    const p = new RaceProgress(LEN);
    const events = drive(p, -5, 100 + 2);
    expect(events).toEqual(['start', 'lap']);
    expect(p.lapsCompleted).toBe(1);
  });

  it('times laps from the race clock, with lap 1 including the run from the grid', () => {
    const p = new RaceProgress(LEN);
    drive(p, -5, 200 + 2, 0.1);
    expect(p.lapTimes).toHaveLength(2);
    expect(p.lapTimes[0]).toBeCloseTo(10.5, 5);
    expect(p.lapTimes[1]).toBeCloseTo(10, 5);
    expect(p.bestLap).toBeCloseTo(10, 5);
  });

  it('does not count a lap for reversing over the line and driving back across', () => {
    const p = new RaceProgress(LEN);
    drive(p, -5, 3);
    for (const d of [2, 1, 0, 99, 98, 99, 0, 1, 2]) p.update(d, 0);
    expect(p.lapsCompleted).toBe(0);
  });

  it('requires every checkpoint, in order', () => {
    const p = new RaceProgress(LEN);
    drive(p, -5, 60); // past checkpoints at 25 and 50
    for (let d = 60; d >= 30; d--) p.update(d, 0); // back over 50
    drive(p, 30, 70); // 50 again, still waiting for 75
    expect(p.lapsCompleted).toBe(0);
    drive(p, 70, 102);
    expect(p.lapsCompleted).toBe(1);
  });

  it('reports progress that increases through the race, including from the grid', () => {
    const p = new RaceProgress(LEN);
    p.update(95, 0);
    const onGrid = p.progress(95);
    drive(p, -5, 2);
    expect(p.progress(2)).toBeGreaterThan(onGrid);
    drive(p, 2, 102);
    expect(p.progress(2)).toBeCloseTo(LEN + 2, 5);
  });
});

describe('Race', () => {
  it('locks controls during the countdown, then says go', () => {
    const race = new Race(LEN, 1, 3);
    expect(race.controlsLocked).toBe(true);
    let events: string[] = [];
    for (let t = 0; t < COUNTDOWN_SECONDS + 0.05; t += 0.01) events = events.concat(race.update(0.01, [95]));
    expect(events).toEqual(['go']);
    expect(race.phase).toBe('racing');
    expect(race.controlsLocked).toBe(false);
  });

  it('announces the final lap and finishes after the last lap', () => {
    const race = new Race(LEN, 1, 3);
    while (race.phase === 'countdown') race.update(0.1, [95]);

    const events: string[] = [];
    for (let d = 95; d <= 400 + 2; d++) events.push(...race.update(0.1, [d % LEN]));
    expect(events).toEqual(['lap', 'lap', 'finalLap', 'finish']);
    expect(race.phase).toBe('finished');
    expect(race.finishTime).toBeCloseTo(race.player.lapTimes.reduce((a, b) => a + b, 0), 5);
    expect(race.currentLap).toBe(3);

    // Nothing more happens once finished.
    expect(race.update(0.1, [10])).toEqual([]);
  });
});

describe('Race standings', () => {
  /** Three racers on a 2-lap race, already past GO and over the start line. */
  function startedRace() {
    const race = new Race(LEN, 3, 2);
    while (race.phase === 'countdown') race.update(0.1, [95, 94, 93]);
    for (let d = 95; d <= 102; d++) race.update(0.1, [d % LEN, (d - 1) % LEN, (d - 2) % LEN]);
    return race;
  }

  it('orders racers by distance covered', () => {
    const race = startedRace();
    race.update(0.1, [10, 30, 20]);
    expect(race.standings()).toEqual([1, 2, 0]);
    expect(race.position(0)).toBe(3);
  });

  it('ranks a car a lap ahead above one further round the current lap', () => {
    const race = new Race(LEN, 2, 3);
    while (race.phase === 'countdown') race.update(0.1, [95, 95]);
    for (let d = 95; d <= 102; d++) race.update(0.1, [d % LEN, d % LEN]);
    for (let d = 3; d <= 110; d++) race.update(0.1, [d % LEN, 3 + (d - 3) * 0.5]); // racer 0 laps
    expect(race.racers[0].lapsCompleted).toBe(1);
    race.update(0.1, [10, 80]);
    expect(race.standings()).toEqual([0, 1]);
  });

  it('puts finishers first, in finishing order, and keeps timing the others', () => {
    const race = startedRace();
    const events: string[] = [];
    // Racer 1 finishes first, then the player; racer 2 is still going.
    for (let d = 3; d <= 205; d++) events.push(...race.update(0.1, [Math.max(3, d - 5) % LEN, d % LEN, 20]));
    expect(race.finishTimes[1]).not.toBeNull();
    expect(race.finishTimes[0]).not.toBeNull();
    expect(race.finishTimes[2]).toBeNull();
    expect(events).toContain('finish');
    expect(race.phase).toBe('finished');
    expect(race.standings()).toEqual([1, 0, 2]);

    // The clock keeps running after the player finishes, so the others still get a time.
    for (let d = 20; d <= 205; d++) race.update(0.1, [5, 5, d % LEN]);
    expect(race.finishTimes[2]).toBeGreaterThan(race.finishTimes[0]!);
    expect(race.standings()).toEqual([1, 0, 2]);
  });
});

describe('formatTime', () => {
  it('formats minutes, seconds and hundredths', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(65.432)).toBe('1:05.43');
  });
});
