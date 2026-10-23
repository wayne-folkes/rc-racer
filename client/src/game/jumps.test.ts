import { describe, expect, it } from 'vitest';
import { createCar, type CarState } from './carPhysics';
import { collideCars } from './collision';
import { ItemSystem, type TrackLayout } from './items';
import { buildRamps, RAMP_HEIGHT, RAMP_LENGTH, updateHeight } from './jumps';
import { DEMO_TRACK, TrackPath } from './trackPath';
import { RaceWorld } from './world';

const track = new TrackPath(DEMO_TRACK, 5.5);
const DT = 1 / 120;
const RAMP_AT = 0.1;

/** A car on the centreline some metres before the foot of the ramp, driving along the track. */
function carBeforeRamp(metres: number, speed: number, lateral = 0): CarState {
  const p = track.pointAt(RAMP_AT * track.length - metres);
  const car = createCar(p.x - p.tz * lateral, p.z + p.tx * lateral, Math.atan2(p.tz, p.tx));
  car.vx = p.tx * speed;
  car.vz = p.tz * speed;
  return car;
}

/** Moves a car in a straight line at its current velocity, tracking its height. */
function fly(car: CarState, seconds: number, ramps = buildRamps(track, [{ at: RAMP_AT }])) {
  const events: string[] = [];
  let maxY = 0;
  for (let t = 0; t < seconds; t += DT) {
    car.x += car.vx * DT;
    car.z += car.vz * DT;
    const e = updateHeight(car, track.project(car.x, car.z), ramps, track.length, DT);
    if (e) events.push(e);
    maxY = Math.max(maxY, car.y);
  }
  return { events, maxY };
}

describe('ramps', () => {
  it('launch a fast car into the air and bring it back down', () => {
    const car = carBeforeRamp(3, 20);
    const { events, maxY } = fly(car, 2);
    expect(events).toEqual(['jump', 'land']);
    expect(maxY).toBeGreaterThan(RAMP_HEIGHT + 0.5);
    expect(car.y).toBe(0);
    expect(car.airborne).toBe(false);
  });

  it('send a faster car higher and further', () => {
    const takeoff = (speed: number) => {
      const car = carBeforeRamp(3, speed);
      let airborneFor = 0;
      let maxY = 0;
      const ramps = buildRamps(track, [{ at: RAMP_AT }]);
      for (let t = 0; t < 3; t += DT) {
        car.x += car.vx * DT;
        car.z += car.vz * DT;
        updateHeight(car, track.project(car.x, car.z), ramps, track.length, DT);
        if (car.airborne) airborneFor += DT;
        maxY = Math.max(maxY, car.y);
      }
      return { airborneFor, maxY };
    };
    const normal = takeoff(18);
    const boosted = takeoff(28);
    expect(boosted.airborneFor).toBeGreaterThan(normal.airborneFor);
    expect(boosted.maxY).toBeGreaterThan(normal.maxY);
  });

  it('let a slow car roll off the end without launching', () => {
    const car = carBeforeRamp(2, 3);
    const { events, maxY } = fly(car, 4);
    expect(events).not.toContain('jump');
    expect(maxY).toBeLessThanOrEqual(RAMP_HEIGHT);
    expect(car.y).toBe(0);
  });

  it('lift a car partway up as it drives up the ramp', () => {
    const car = carBeforeRamp(-RAMP_LENGTH / 2, 0); // halfway up
    updateHeight(car, track.project(car.x, car.z), buildRamps(track, [{ at: RAMP_AT }]), track.length, DT);
    expect(car.y).toBeCloseTo(RAMP_HEIGHT / 2, 1);
    expect(car.airborne).toBe(false);
  });

  it('only catch cars driving over them, not beside a narrow one', () => {
    const narrow = buildRamps(track, [{ at: RAMP_AT, lateral: 3, width: 2 }]);
    const car = carBeforeRamp(3, 20, -3);
    expect(fly(car, 2, narrow).events).toEqual([]);
  });
});

describe('in the air', () => {
  function airborneWorld(layout: TrackLayout) {
    const world = new RaceWorld(track, { opponents: [], layout });
    world.race.phase = 'racing';
    world.race.countdown = 0;
    Object.assign(world.player, carBeforeRamp(6, 20));
    return world;
  }
  const rampOnly: TrackLayout = { hazards: [], pickups: [], boostPads: [], ramps: [{ at: RAMP_AT }] };

  it("a car can't steer or accelerate", () => {
    const world = airborneWorld(rampOnly);
    while (!world.player.airborne) world.step(DT, { throttle: 1, steer: 0, handbrake: false });
    const heading = world.player.heading;
    const speed = Math.hypot(world.player.vx, world.player.vz);
    for (let k = 0; k < 20; k++) world.step(DT, { throttle: 1, steer: 1, handbrake: false });
    expect(world.player.airborne).toBe(true);
    expect(world.player.heading).toBeCloseTo(heading, 6);
    expect(Math.hypot(world.player.vx, world.player.vz)).toBeLessThanOrEqual(speed + 1e-6);
  });

  it('a car sails over a puddle just past the ramp', () => {
    // Puddle 8 m past the lip, where a car at 20 m/s is at the top of its jump.
    const puddleAt = RAMP_AT + (RAMP_LENGTH + 8) / track.length;
    const layout: TrackLayout = { ...rampOnly, hazards: [{ kind: 'puddle', at: puddleAt, lateral: 0, radius: 1.5 }] };
    const world = airborneWorld(layout);
    let splashed = false;
    for (let t = 0; t < 1.5; t += DT) {
      world.step(DT, { throttle: 1, steer: 0, handbrake: false });
      splashed ||= world.items.drainEvents().some((e) => e.type === 'splash');
    }
    expect(splashed).toBe(false);
  });

  it("a car passes over one on the ground without touching it", () => {
    const high = createCar(0, 0, 0);
    high.y = 1.5;
    high.vx = 10;
    const low = createCar(0.5, 0, 0);
    expect(collideCars(high, low)).toBe(false);
    expect(high.vx).toBe(10);
  });

  it("can't collect pickups or be bombed", () => {
    const items = new ItemSystem(track, 1, {
      hazards: [],
      pickups: [{ kind: 'missile', at: 0.3, lateral: 0 }],
      boostPads: [],
    });
    const p = items.pickups[0];
    const car = createCar(p.x, p.z, 0);
    car.y = 1.2;
    car.airborne = true;
    items.update(DT, [car], [track.project(car.x, car.z)]);
    expect(items.status[0].item).toBeNull();
  });

  it('records jumps and landings for sounds and dust', () => {
    const world = airborneWorld(rampOnly);
    const types: string[] = [];
    for (let t = 0; t < 2; t += DT) {
      world.step(DT, { throttle: 1, steer: 0, handbrake: false });
      types.push(...world.drainJumps().map((j) => j.type));
    }
    expect(types).toEqual(['jump', 'land']);
  });
});
