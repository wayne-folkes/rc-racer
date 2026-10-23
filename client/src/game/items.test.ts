import { describe, expect, it } from 'vitest';
import { createCar, DEFAULT_TUNING, speed, stepCar, type CarState } from './carPhysics';
import { BOOST_TIME, ItemSystem, pickupRow, SPIN_TIME, type ItemEvent, type TrackLayout } from './items';
import { DEMO_TRACK, TrackPath } from './trackPath';
import { effectiveTuning, NO_INPUT, RaceWorld } from './world';

const track = new TrackPath(DEMO_TRACK, 5.5);
const DT = 1 / 120;
const EMPTY: TrackLayout = { hazards: [], pickups: [], boostPads: [] };

/** A car on the centreline at a fraction of the lap, facing along the track. */
function carAt(at: number, lateral = 0, speedAlong = 0): CarState {
  const p = track.pointAt(at * track.length);
  const car = createCar(p.x - p.tz * lateral, p.z + p.tx * lateral, Math.atan2(p.tz, p.tx));
  car.vx = p.tx * speedAlong;
  car.vz = p.tz * speedAlong;
  return car;
}

const projOf = (cars: CarState[]) => cars.map((c) => track.project(c.x, c.z));

/** Runs the item system for a while with cars that don't move (unless `drive` moves them). */
function run(items: ItemSystem, cars: CarState[], seconds: number, drive?: () => void): ItemEvent[] {
  const events: ItemEvent[] = [];
  for (let t = 0; t < seconds; t += DT) {
    drive?.();
    items.update(DT, cars, projOf(cars));
    events.push(...items.drainEvents());
  }
  return events;
}

describe('pickups', () => {
  const row: TrackLayout = { hazards: [], pickups: pickupRow(0.2, ['missile', 'bomb', 'missile']), boostPads: [] };

  it('give the item they show to a car that drives through, then come back', () => {
    const items = new ItemSystem(track, 1, row);
    const bomb = items.pickups[1];
    expect(bomb.kind).toBe('bomb');
    const car = createCar(bomb.x, bomb.z, 0);
    const events = run(items, [car], DT);
    expect(items.status[0].item).toBe('bomb');
    expect(events[0]).toMatchObject({ type: 'pickup', racer: 0, item: 'bomb' });
    expect(bomb.respawn).toBeGreaterThan(0);

    car.x += 50; // drive away
    run(items, [car], 5);
    expect(bomb.respawn).toBe(0);
  });

  it('always give the same item from the same spot', () => {
    const items = new ItemSystem(track, 1, row);
    const missile = items.pickups[0];
    for (let lap = 0; lap < 3; lap++) {
      items.status[0].item = null;
      run(items, [createCar(missile.x, missile.z, 0)], DT);
      expect(items.status[0].item).toBe('missile');
      run(items, [createCar(missile.x + 50, missile.z, 0)], 5);
    }
  });

  it('are left for others when a car already holds an item', () => {
    const items = new ItemSystem(track, 2, row);
    items.status[0].item = 'bomb';
    const missile = items.pickups[0];
    run(items, [createCar(missile.x, missile.z, 0), createCar(missile.x + 50, missile.z, 0)], DT);
    expect(items.status[0].item).toBe('bomb');
    expect(missile.respawn).toBe(0);

    // The next car along, with an empty slot, still gets it.
    run(items, [createCar(missile.x + 50, missile.z, 0), createCar(missile.x, missile.z, 0)], DT);
    expect(items.status[1].item).toBe('missile');
  });
});

describe('missiles', () => {
  it('home in on the car ahead and spin it out', () => {
    const items = new ItemSystem(track, 2, EMPTY);
    const shooter = carAt(0.1);
    const target = carAt(0.1 + 20 / track.length, 2, 10);
    items.status[0].item = 'missile';
    items.use(0, shooter, track.project(shooter.x, shooter.z), projOf([shooter, target]));

    const events = run(items, [shooter, target], 0.9);
    expect(events).toContainEqual(expect.objectContaining({ type: 'explode', victim: 1 }));
    expect(items.status[1].spin).toBeGreaterThan(0);
    expect(speed(target)).toBeLessThan(10);
    expect(items.status[0].spin).toBe(0);
    expect(items.missiles).toHaveLength(0);
  });

  it('fizzle out when nothing is in range', () => {
    const items = new ItemSystem(track, 1, EMPTY);
    const shooter = carAt(0.1);
    items.status[0].item = 'missile';
    items.use(0, shooter, track.project(shooter.x, shooter.z), projOf([shooter]));
    const events = run(items, [shooter], 4);
    expect(events).toContainEqual(expect.objectContaining({ type: 'explode', victim: null }));
    expect(items.status[0].spin).toBe(0);
  });
});

describe('bombs', () => {
  it("don't catch the car that dropped them, but catch the next car along", () => {
    const items = new ItemSystem(track, 2, EMPTY);
    const dropper = carAt(0.3);
    const follower = carAt(0.3 - 12 / track.length, 0, 0);
    items.status[0].item = 'bomb';
    items.use(0, dropper, track.project(dropper.x, dropper.z), projOf([dropper, follower]));
    expect(items.bombs).toHaveLength(1);

    run(items, [dropper, follower], 1);
    expect(items.status[0].spin).toBe(0);
    expect(items.bombs).toHaveLength(1);

    // The follower drives over the bomb.
    const bomb = items.bombs[0];
    const events = run(items, [dropper, follower], 0.5, () => {
      follower.x += (bomb.x - follower.x) * 0.2;
      follower.z += (bomb.z - follower.z) * 0.2;
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'explode', victim: 1 }));
    expect(items.status[1].spin).toBeGreaterThan(0);
  });
});

describe('boost', () => {
  it('raises top speed and acceleration while it lasts', () => {
    const status = { item: null, holdTime: 0, spin: 0, boost: 1, slick: 0, inPuddle: false, onOil: false, onPad: false };
    const boosted = effectiveTuning(DEFAULT_TUNING, status);
    expect(boosted.maxSpeed).toBeGreaterThan(DEFAULT_TUNING.maxSpeed);
    expect(boosted.accel).toBeGreaterThan(DEFAULT_TUNING.accel);
    expect(effectiveTuning(DEFAULT_TUNING, { ...status, boost: 0 })).toBe(DEFAULT_TUNING);

    const plain = createCar(0, 0, 0);
    const fast = createCar(0, 0, 0);
    for (let t = 0; t < 1.5; t += DT) {
      stepCar(plain, { throttle: 1, steer: 0, handbrake: false }, DT);
      stepCar(fast, { throttle: 1, steer: 0, handbrake: false }, DT, boosted);
    }
    expect(speed(fast)).toBeGreaterThan(speed(plain) * 1.2);
  });

  const padAt: TrackLayout = { hazards: [], pickups: [], boostPads: [{ at: 0.1, lateral: 0 }] };

  it('starts when a car drives over a boost pad, once per pass', () => {
    const items = new ItemSystem(track, 1, padAt);
    const car = carAt(0.1 - 6 / track.length, 0, 10);
    const pad = items.boostPads[0];
    const events = run(items, [car], 1.2, () => {
      car.x += car.vx * DT;
      car.z += car.vz * DT;
    });
    expect(events.filter((e) => e.type === 'boost')).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'boost', racer: 0 });
    expect(items.status[0].boost).toBeGreaterThan(0);
    expect(items.status[0].boost).toBeLessThan(BOOST_TIME);
    expect(Math.hypot(car.x - pad.x, car.z - pad.z)).toBeGreaterThan(2); // drove on past it
  });

  it("doesn't boost a car that's spinning over a pad", () => {
    const items = new ItemSystem(track, 1, padAt);
    items.status[0].spin = SPIN_TIME;
    const pad = items.boostPads[0];
    run(items, [createCar(pad.x, pad.z, 0)], DT);
    expect(items.status[0].boost).toBe(0);
  });

  it('AI cars take boost pads near their line', () => {
    const world = new RaceWorld(track, { autopilot: { pace: 0.95, steerGain: 2.4 } });
    let boosts = 0;
    for (let t = 0; t < 200 && world.race.finishTimes.some((f) => f === null); t += DT) {
      world.step(DT, NO_INPUT);
      boosts += world.items.drainEvents().filter((e) => e.type === 'boost').length;
    }
    // Four cars, three laps, three pads: they shouldn't all be ignored.
    expect(boosts).toBeGreaterThan(6);
  });
});

describe('hazards', () => {
  const oilAt: TrackLayout = { hazards: [{ kind: 'oil', at: 0.3, lateral: 0, radius: 1.6 }], pickups: [], boostPads: [] };
  const puddleAt: TrackLayout = { hazards: [{ kind: 'puddle', at: 0.3, lateral: 0, radius: 2.2 }], pickups: [], boostPads: [] };

  it('oil makes a moving car slide and jolts its heading', () => {
    const items = new ItemSystem(track, 1, oilAt);
    const car = carAt(0.3, 0, 15);
    const heading = car.heading;
    const events = run(items, [car], DT);
    expect(events).toContainEqual(expect.objectContaining({ type: 'slick', racer: 0 }));
    expect(items.status[0].slick).toBeGreaterThan(0);
    expect(car.heading).not.toBe(heading);

    const status = items.status[0];
    expect(effectiveTuning(DEFAULT_TUNING, status).grip).toBeLessThan(DEFAULT_TUNING.grip);
  });

  it('a puddle slows cars that drive through it', () => {
    const drive = (withPuddle: boolean) => {
      const world = new RaceWorld(track, { opponents: [], layout: withPuddle ? puddleAt : EMPTY });
      world.race.phase = 'racing';
      world.race.countdown = 0;
      Object.assign(world.player, carAt(0.1, 0, 18));
      // Put the puddle right in the car's path, 12 m straight ahead.
      const puddle = world.items.hazards[0];
      if (puddle) {
        puddle.x = world.player.x + Math.cos(world.player.heading) * 12;
        puddle.z = world.player.z + Math.sin(world.player.heading) * 12;
      }
      let splashed = false;
      for (let t = 0; t < 1.2; t += DT) {
        world.step(DT, { throttle: 1, steer: 0, handbrake: false });
        splashed ||= world.items.drainEvents().some((e) => e.type === 'splash');
      }
      return { speed: speed(world.player), splashed };
    };
    const through = drive(true);
    const clear = drive(false);
    expect(through.splashed).toBe(true);
    expect(through.speed).toBeLessThan(clear.speed - 1);
  });
});

describe('items in a race', () => {
  it('a spinning car ignores its controls until the spin ends', () => {
    const world = new RaceWorld(track, { opponents: [], layout: EMPTY });
    world.race.phase = 'racing';
    world.race.countdown = 0;
    world.items.status[0].spin = SPIN_TIME;
    for (let t = 0; t < SPIN_TIME - 0.1; t += DT) world.step(DT, { throttle: 1, steer: 0, handbrake: false });
    expect(speed(world.player)).toBeLessThan(0.5);
    for (let t = 0; t < 1; t += DT) world.step(DT, { throttle: 1, steer: 0, handbrake: false });
    expect(speed(world.player)).toBeGreaterThan(5);
  });

  it('the player can only use items once the race is on', () => {
    const world = new RaceWorld(track, { opponents: [], layout: EMPTY });
    world.items.status[0].item = 'bomb';
    world.useItem(0);
    world.step(DT, NO_INPUT);
    expect(world.items.status[0].item).toBe('bomb');
  });

  it('AI cars pick up and use items, and the race still finishes', () => {
    const world = new RaceWorld(track, { autopilot: { pace: 0.95, steerGain: 2.4 } });
    const used = new Set<string>();
    let pickups = 0;
    for (let t = 0; t < 200 && world.race.finishTimes.some((f) => f === null); t += DT) {
      world.step(DT, NO_INPUT);
      for (const e of world.items.drainEvents()) {
        if (e.type === 'pickup') pickups++;
        if (e.type === 'fire' || e.type === 'drop') used.add(e.type);
      }
    }
    expect(world.race.finishTimes.every((f) => f !== null)).toBe(true);
    expect(pickups).toBeGreaterThan(4);
    expect(used.size).toBe(2);
  });

  it('plays out the same way every time with the same seed', () => {
    const race = () => {
      const world = new RaceWorld(track, { autopilot: { pace: 0.95, steerGain: 2.4 }, seed: 7 });
      for (let t = 0; t < 60; t += DT) world.step(DT, NO_INPUT);
      return world.racers.map((r) => [r.car.x, r.car.z]);
    };
    expect(race()).toEqual(race());
  });
});
