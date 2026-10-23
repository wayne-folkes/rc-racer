import { describe, expect, it } from 'vitest';
import { createCar } from './carPhysics';
import { blendCar, poseOf, SNAP_DISTANCE } from './renderPose';

describe('blendCar', () => {
  const before = createCar(10, 20, 0.2);
  const after = createCar(10.4, 20.2, 0.3);
  after.steer = 0.5;
  after.vx = 12;
  const prev = poseOf(before);

  it('draws the car part of the way from the previous step to the latest', () => {
    const half = blendCar(createCar(0, 0, 0), after, prev, 0.5);
    expect(half.x).toBeCloseTo(10.2, 6);
    expect(half.z).toBeCloseTo(20.1, 6);
    expect(half.heading).toBeCloseTo(0.25, 6);
    expect(half.steer).toBeCloseTo(0.25, 6);
    // Only the pose is blended; speed and the rest are the latest step's.
    expect(half.vx).toBe(12);
  });

  it('moves smoothly with frames that fall unevenly between steps', () => {
    // A car at a steady 10 m/s on a 120 Hz sim, drawn at 144 Hz: even spacing from frame to frame.
    const step = 10 / 120;
    const xs: number[] = [];
    let steps = 0;
    let accumulator = 0;
    let latest = 0;
    let previous = 0;
    for (let frame = 1; frame <= 60; frame++) {
      accumulator += 1 / 144;
      while (accumulator >= 1 / 120) {
        previous = latest;
        latest += step;
        steps++;
        accumulator -= 1 / 120;
      }
      const car = createCar(latest, 0, 0);
      const drawn = blendCar(createCar(0, 0, 0), car, poseOf(createCar(previous, 0, 0)), accumulator * 120);
      xs.push(drawn.x);
    }
    expect(steps).toBeGreaterThan(40);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    // 10 m/s at 144 Hz is 0.0694 m a frame, give or take the first frame's start-up.
    for (const gap of gaps.slice(2)) expect(gap).toBeCloseTo(10 / 144, 4);
  });

  it('takes the short way round when the heading crosses pi', () => {
    const a = createCar(0, 0, Math.PI - 0.05);
    const b = createCar(0, 0, -Math.PI + 0.05);
    const mid = blendCar(createCar(0, 0, 0), b, poseOf(a), 0.5);
    expect(Math.abs(Math.cos(mid.heading) + 1)).toBeLessThan(1e-9);
  });

  it('does not draw a car in between when it was put somewhere else', () => {
    const jumped = createCar(10 + SNAP_DISTANCE + 1, 20, 0.2);
    expect(blendCar(createCar(0, 0, 0), jumped, prev, 0.5).x).toBe(jumped.x);
  });

  it('draws the latest step as it is at alpha 1, or with nothing before it', () => {
    expect(blendCar(createCar(0, 0, 0), after, prev, 1).x).toBe(after.x);
    expect(blendCar(createCar(0, 0, 0), after, undefined, 0.3).x).toBe(after.x);
  });
});
