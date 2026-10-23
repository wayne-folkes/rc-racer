import { describe, expect, it } from 'vitest';
import { rubberBand } from './aiDriver';
import { createCar } from './carPhysics';
import { CAR_SPACING, collideCars } from './collision';
import { gridPosition, OPPONENTS, PLAYER } from './racers';
import { DEMO_TRACK, TrackPath } from './trackPath';

describe('rubberBand', () => {
  it('slows cars ahead of the player and speeds up cars behind, within limits', () => {
    expect(rubberBand(0)).toBe(1);
    expect(rubberBand(-20)).toBeLessThan(1);
    expect(rubberBand(20)).toBeGreaterThan(1);
    expect(rubberBand(-1000)).toBeGreaterThanOrEqual(0.9);
    expect(rubberBand(1000)).toBeLessThanOrEqual(1.05);
  });
});

describe('collideCars', () => {
  it('separates overlapping cars and bounces a rear-ender off the car ahead', () => {
    const behind = createCar(0, 0, 0);
    const ahead = createCar(1.5, 0, 0);
    behind.vx = 20;
    ahead.vx = 10;
    expect(collideCars(behind, ahead)).toBe(true);
    expect(ahead.x - behind.x).toBeCloseTo(CAR_SPACING, 5);
    expect(ahead.vx).toBeGreaterThan(behind.vx);
    // Momentum is conserved between equal-mass cars.
    expect(ahead.vx + behind.vx).toBeCloseTo(30, 5);
  });

  it('ignores cars that are apart', () => {
    const a = createCar(0, 0, 0);
    const b = createCar(5, 0, 0);
    a.vx = 10;
    expect(collideCars(a, b)).toBe(false);
    expect(a.vx).toBe(10);
  });
});

describe('starting grid', () => {
  it('gives every car its own slot behind the line, clear of the others', () => {
    const track = new TrackPath(DEMO_TRACK, 5.5);
    const slots = [PLAYER, ...OPPONENTS].map((r) => r.gridSlot);
    expect(new Set(slots).size).toBe(slots.length);

    const cars = slots.map((s) => gridPosition(track, s));
    for (const car of cars) {
      const proj = track.project(car.x, car.z);
      expect(proj.distance).toBeGreaterThan(track.length * 0.9);
      expect(Math.abs(proj.lateral)).toBeLessThan(track.halfWidth - 1);
    }
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        expect(Math.hypot(cars[i].x - cars[j].x, cars[i].z - cars[j].z)).toBeGreaterThan(CAR_SPACING);
      }
    }
  });
});
