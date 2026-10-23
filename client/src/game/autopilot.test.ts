import { describe, expect, it } from 'vitest';
import { createCar, stepCar } from './carPhysics';
import { collideWithWalls } from './collision';
import { Race } from './race';
import { DEMO_TRACK, TrackPath } from './trackPath';

// Races the demo track with a simple "aim at a point ahead" autopilot: a smoke test that the
// track, handling, walls and race rules work together. It's also a rough baseline for the
// AI opponents later.
describe('demo track', () => {
  it('can be raced from the grid to the finish by a simple autopilot', () => {
    const track = new TrackPath(DEMO_TRACK, 5.5);
    const grid = track.pointAt(track.length - 6);
    const car = createCar(grid.x, grid.z, Math.atan2(grid.tz, grid.tx));
    const race = new Race(track.length);

    const dt = 1 / 120;
    const n = track.points.length;
    for (let t = 0; t < 180 && race.phase !== 'finished'; t += dt) {
      const proj = track.project(car.x, car.z);
      const aim = track.points[(proj.index + 14) % n];
      let diff = Math.atan2(aim.z - car.z, aim.x - car.x) - car.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const input = race.controlsLocked
        ? { throttle: 0, steer: 0, handbrake: false }
        : { throttle: Math.abs(diff) > 0.5 ? 0.3 : 1, steer: Math.max(-1, Math.min(1, diff * 3)), handbrake: false };
      stepCar(car, input, dt);
      race.update(dt, collideWithWalls(car, track).proj.distance);
    }

    expect(race.phase).toBe('finished');
    expect(race.player.lapTimes).toHaveLength(3);
    // ~400 m at up to 26 m/s: a clean lap is well under 30 s.
    expect(race.player.bestLap).toBeLessThan(30);
  });
});
