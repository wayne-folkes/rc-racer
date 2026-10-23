import { describe, expect, it } from 'vitest';
import { createCar, speed, stepCar, type CarInput } from './carPhysics';
import { CAR_RADIUS, collideWithWalls } from './collision';
import { TrackPath } from './trackPath';

const DT = 1 / 120;

// A long straight (along +x, then round a loop) so a car can run alongside a wall for a while. The spline
// only runs dead straight between points whose neighbours are collinear too, hence the extra points.
const track = new TrackPath(
  [
    [-120, -30], [-60, -30], [0, -30], [60, -30], [120, -30], [150, 0],
    [120, 30], [60, 30], [0, 30], [-60, 30], [-120, 30], [-150, 0],
  ].map(([x, z]) => ({ x, z })),
  6,
);
const LIMIT = track.halfWidth - CAR_RADIUS;

/** Which wall: 1 is the right-hand one, -1 the left. */
type Side = 1 | -1;

/** A car on the straight beside a wall, with its nose aimed `angle` rad into that wall, at `v` m/s. */
function carBesideWall(angle: number, v: number, side: Side) {
  const p = track.pointAt(110);
  // Turning right (a bigger heading) points the nose at the right-hand wall.
  const heading = Math.atan2(p.tz, p.tx) + side * angle;
  const lateral = side * (LIMIT - 0.7);
  const car = createCar(p.x - p.tz * lateral, p.z + p.tx * lateral, heading);
  car.vx = v * Math.cos(heading);
  car.vz = v * Math.sin(heading);
  return car;
}

interface Sample {
  t: number;
  speed: number;
  /** How far the car is from the wall's limit, in metres: 0 when touching it. */
  fromWall: number;
  /** How far the nose is from running parallel to the road, in radians. */
  angle: number;
}

/** Drives the car for `seconds`, hitting the wall as it goes, and records every step. */
function drive(angle: number, v: number, input: CarInput, seconds: number, side: Side = 1): Sample[] {
  const car = carBesideWall(angle, v, side);
  const log: Sample[] = [];
  for (let t = 0; t < seconds; t += DT) {
    stepCar(car, input, DT);
    const { proj } = collideWithWalls(car, track, DT);
    const roadAngle = Math.atan2(proj.tz, proj.tx);
    const off = ((((car.heading - roadAngle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    log.push({ t, speed: speed(car), fromWall: LIMIT - side * proj.lateral, angle: Math.abs(off) });
  }
  return log;
}

const at = (log: Sample[], t: number) => log[Math.round(t / DT)];

describe('wall friction', () => {
  it('costs more for a hard push into the wall than a gentle one', () => {
    // Same along-wall speed; only the push into the wall differs.
    const hit = (into: number) => {
      const car = carBesideWall(0, 0, 1);
      const p = track.project(car.x, car.z);
      car.x += (LIMIT + 0.1 - p.lateral) * -p.tz;
      car.z += (LIMIT + 0.1 - p.lateral) * p.tx;
      // Right of travel is (-tz, tx), so that is the outward direction.
      car.vx = 20 * p.tx + into * -p.tz;
      car.vz = 20 * p.tz + into * p.tx;
      const { hit: touched } = collideWithWalls(car, track, DT);
      expect(touched).toBe(true);
      const q = track.project(car.x, car.z);
      return car.vx * q.tx + car.vz * q.tz;
    };
    const gentle = hit(0.3);
    const hard = hit(12);
    expect(gentle).toBeGreaterThan(19.5);
    expect(hard).toBeLessThan(gentle - 2);
    expect(hard).toBeGreaterThan(0);
  });
});

describe('a car that touches a wall', () => {
  const gas: CarInput = { throttle: 1, steer: 0, handbrake: false };

  it('swings its nose away from the wall, not into it, on either side', () => {
    for (const side of [1, -1] as const) {
      const car = carBesideWall(0.9, 15, side);
      const before = car.heading;
      // Push it into the wall so it makes contact (it bounces off first, so give it three quarters of a
      // second), then look at which way the nose turned.
      for (let i = 0; i < 90; i++) {
        stepCar(car, gas, DT);
        collideWithWalls(car, track, DT);
      }
      expect(Math.abs(car.heading - before), `side ${side}`).toBeGreaterThan(0.3);
      // Away from the wall: heading falls on the right-hand wall, and rises on the left-hand one.
      expect(Math.sign(car.heading - before), `side ${side}`).toBe(-side);
    }
  });

  it('leaves a nose pointing along or away from the wall alone', () => {
    const car = carBesideWall(-0.3, 10, 1);
    const p = track.project(car.x, car.z);
    // Overlap the wall without the nose pointing at it.
    car.x += (LIMIT + 0.1 - p.lateral) * -p.tz;
    car.z += (LIMIT + 0.1 - p.lateral) * p.tx;
    const before = car.heading;
    expect(collideWithWalls(car, track, DT).hit).toBeDefined();
    expect(car.heading).toBe(before);
  });
});

describe('scraping a wall', () => {
  const gas: CarInput = { throttle: 1, steer: 0, handbrake: false };

  it('costs a shallow brush some speed, but nowhere near a stop', () => {
    const log = drive(0.09, 20, gas, 1.5);
    expect(at(log, 1).speed).toBeGreaterThan(12);
  });

  it('costs speed on a longer scrape, but never glues the car to the wall', () => {
    // Holding the gas and driving into the wall at 11 degrees, with no steering at all.
    const log = drive(0.2, 20, gas, 1.5);
    expect(at(log, 0.5).speed).toBeGreaterThan(10);
    expect(at(log, 1.45).speed).toBeGreaterThan(10);
    // Riding a wall is slower than driving the road, so it is no shortcut round a bend.
    expect(at(log, 1.45).speed).toBeLessThan(20);
  });

  it('still stops a head-on hit', () => {
    const log = drive(1.2, 20, { throttle: 0, steer: 0, handbrake: false }, 1);
    expect(at(log, 0.25).speed).toBeLessThan(8);
  });
});

describe('getting clear of a wall', () => {
  const gas: CarInput = { throttle: 1, steer: 0, handbrake: false };

  it('lets a car pinned nose-first into the wall peel off and pick up speed, whichever wall it is', () => {
    // Gas held, no steering, nose 60 degrees into the wall: it used to sit there at about 1 m/s forever.
    for (const side of [1, -1] as const) {
      const log = drive(1.05, 17, gas, 1.6, side);
      expect(at(log, 1.5).angle, `side ${side}: nose parallel again`).toBeLessThan(0.15);
      expect(at(log, 1.5).speed, `side ${side}: speed back`).toBeGreaterThan(9);
      // ...and it was climbing, not creeping, at the end.
      expect(at(log, 1.5).speed, `side ${side}: still accelerating`).toBeGreaterThan(at(log, 1).speed);
    }
  });

  it('lets a car steer away from the wall without crawling', () => {
    const away: CarInput = { throttle: 1, steer: -0.5, handbrake: false };
    const log = drive(0.52, 15, away, 1.2);
    // It never drops to a crawl while getting clear...
    expect(Math.min(...log.map((s) => s.speed))).toBeGreaterThan(8);
    // ...and is a couple of metres clear of the wall within a second and a bit.
    expect(at(log, 1.15).fromWall).toBeGreaterThan(2);
  });
});
