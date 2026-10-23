import { describe, expect, it } from 'vitest';
import { speed } from './carPhysics';
import { CAR_SPACING } from './collision';
import { buildRacingLine } from './racingLine';
import { OPPONENTS } from './racers';
import { DEMO_TRACK, TrackPath } from './trackPath';
import { NO_INPUT, RaceWorld } from './world';

// Full races on the demo track with every car driven by the AI: a smoke test that the track,
// handling, collisions, AI and race rules work together.

const track = new TrackPath(DEMO_TRACK, 5.5);
const DT = 1 / 120;

function runRace(world: RaceWorld, maxSeconds: number): void {
  for (let t = 0; t < maxSeconds && world.race.finishTimes.some((f) => f === null); t += DT) {
    world.step(DT, NO_INPUT);
  }
}

describe('racing line', () => {
  it('stays on the road and slows for corners', () => {
    const line = buildRacingLine(track);
    for (const p of line.points) {
      expect(Math.abs(track.project(p.x, p.z).lateral)).toBeLessThan(track.halfWidth - 1);
    }
    const slowest = Math.min(...line.targetSpeed);
    const fastest = Math.max(...line.targetSpeed);
    expect(slowest).toBeGreaterThan(5);
    expect(slowest).toBeLessThan(fastest * 0.8);
  });
});

describe('demo track race', () => {
  it('a lone AI car laps cleanly and quickly', () => {
    const world = new RaceWorld(track, { opponents: [], autopilot: { pace: 1, steerGain: 2.6 } });
    runRace(world, 120);
    expect(world.race.phase).toBe('finished');
    // ~400 m at up to 26 m/s.
    expect(world.race.player.bestLap).toBeLessThan(22);
  });

  it('a full four-car race finishes cleanly, with every car crossing the line', () => {
    const world = new RaceWorld(track, { autopilot: { pace: 0.95, steerGain: 2.4 } });
    let contactSeconds = 0;
    for (let t = 0; t < 180 && world.race.finishTimes.some((f) => f === null); t += DT) {
      world.step(DT, NO_INPUT);
      const cars = world.racers.map((r) => r.car);
      for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) {
          if (Math.hypot(cars[i].x - cars[j].x, cars[i].z - cars[j].z) <= CAR_SPACING + 0.01) contactSeconds += DT;
        }
      }
    }
    expect(world.race.finishTimes.every((f) => f !== null)).toBe(true);
    // AI cars pass or follow instead of shoving each other round the track.
    expect(contactSeconds).toBeLessThan(1);
    // Rubber-banding keeps it close: the whole field finishes within 15 s of the winner.
    const times = world.race.finishTimes as number[];
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(15);
  });

  it('a quick driver can climb from the back of the grid into the top two', () => {
    const world = new RaceWorld(track, { autopilot: { pace: 1, steerGain: 2.6 } });
    runRace(world, 180);
    expect(world.race.position(0)).toBeLessThanOrEqual(2);
  });

  it('keeps cars still until GO', () => {
    const world = new RaceWorld(track);
    for (let t = 0; t < 2; t += DT) world.step(DT, { throttle: 1, steer: 0, handbrake: false });
    expect(world.racers.every((r) => speed(r.car) === 0)).toBe(true);
  });

  it('puts the player at the back of the grid', () => {
    const world = new RaceWorld(track);
    world.step(DT, NO_INPUT);
    expect(world.race.position(0)).toBe(OPPONENTS.length + 1);
  });
});
