import { describe, expect, it } from 'vitest';
import { createCar } from './carPhysics';
import { CAR_RADIUS, collideWithWalls } from './collision';
import { DEMO_TRACK, TrackPath } from './trackPath';

// A square-ish loop running clockwise on screen: east along z = -20, then south, west, north.
const square = new TrackPath(
  [
    { x: -20, z: -20 },
    { x: 20, z: -20 },
    { x: 20, z: 20 },
    { x: -20, z: 20 },
  ],
  4,
);

describe('TrackPath.project', () => {
  it('reports positive lateral offset to the right of travel', () => {
    // Travelling east along the top edge, the right-hand side is +z.
    const p = square.project(0, -18);
    expect(p.tx).toBeGreaterThan(0.9);
    expect(p.lateral).toBeGreaterThan(0);
  });

  it('measures distance from the start line', () => {
    expect(square.project(-20, -20).distance).toBeLessThan(1);
    const half = square.project(20, 20).distance;
    expect(half / square.length).toBeGreaterThan(0.4);
    expect(half / square.length).toBeLessThan(0.6);
  });

  it('has no corner on the demo track tighter than the road is wide', () => {
    const track = new TrackPath(DEMO_TRACK, 5.5);
    const n = track.points.length;
    for (let i = 0; i < n; i++) {
      const a = track.tangent((i - 1 + n) % n);
      const b = track.tangent((i + 1) % n);
      const turn = Math.abs(Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z));
      const radius = (2 * track.length) / n / turn;
      expect(radius).toBeGreaterThan(track.halfWidth + 2);
    }
  });

  it('keeps the demo track wider than a car everywhere', () => {
    const track = new TrackPath(DEMO_TRACK, 5.5);
    expect(track.length).toBeGreaterThan(300);
    for (let i = 0; i < track.points.length; i += 10) {
      const p = track.points[i];
      expect(Math.abs(track.project(p.x, p.z).lateral)).toBeLessThan(0.01);
    }
  });
});

describe('TrackPath.pointAt', () => {
  it('walks the centreline and wraps around the start line', () => {
    const start = square.pointAt(0);
    expect(start.x).toBeCloseTo(square.points[0].x, 5);
    expect(start.z).toBeCloseTo(square.points[0].z, 5);
    const behind = square.pointAt(-3);
    expect(square.project(behind.x, behind.z).distance).toBeCloseTo(square.length - 3, 1);
    expect(Math.hypot(behind.tx, behind.tz)).toBeCloseTo(1, 5);
  });
});

describe('collideWithWalls', () => {
  it('pushes a car back inside and bounces it off the wall', () => {
    // Start on the centreline, then shove the car well past the right-hand wall, moving outwards.
    const start = square.project(0, -20);
    const p = square.points[start.index];
    const car = createCar(p.x - start.tz * 6, p.z + start.tx * 6, 0);
    car.vx = -start.tz * 10;
    car.vz = start.tx * 10;
    const { hit, proj } = collideWithWalls(car, square);
    expect(hit).toBe(true);
    expect(Math.abs(proj.lateral)).toBeLessThanOrEqual(square.halfWidth - CAR_RADIUS + 1e-6);
    expect(car.vx * -start.tz + car.vz * start.tx).toBeLessThan(0);
  });

  it('leaves a car in the middle of the road alone', () => {
    const p = square.points[10];
    const car = createCar(p.x, p.z, 0);
    car.vx = 10;
    expect(collideWithWalls(car, square).hit).toBe(false);
    expect(car.vx).toBe(10);
  });
});
