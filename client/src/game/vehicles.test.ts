import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from './carPhysics';
import type { RacerStatus } from './items';
import { Season, UPGRADE_KINDS, upgradedTuning } from './season';
import { loadSeason, saveSeason } from './seasonStorage';
import { TRACKS } from './tracks';
import { TrackPath } from './trackPath';
import { DEFAULT_VEHICLE, isVehicleId, VEHICLES, type VehicleId } from './vehicles';
import { effectiveTuning, NO_INPUT, RaceWorld } from './world';

const SKILL = { pace: 0.95, steerGain: 2.4 };
const STEP = 1 / 120;

/** A car on its own, driven by the autopilot, to see how long a race takes in a vehicle. */
function timeTrial(vehicle: VehicleId, trackIndex: number): number {
  const def = TRACKS[trackIndex];
  const world = new RaceWorld(new TrackPath(def.controlPoints, def.halfWidth), {
    vehicle,
    opponents: [],
    autopilot: SKILL,
    layout: def.layout,
    seed: 1,
  });
  for (let t = 0; t < 400 && world.race.finishTimes[0] === null; t += STEP) world.step(STEP, NO_INPUT);
  return world.race.finishTimes[0] ?? Infinity;
}

describe('vehicles', () => {
  it('keeps the buggy as the game\'s baseline handling', () => {
    expect(DEFAULT_VEHICLE).toBe('buggy');
    expect(VEHICLES.buggy.tuning).toEqual(DEFAULT_TUNING);
  });

  it('makes the truck slower and softer to steer, but better on oil and in puddles', () => {
    const buggy = VEHICLES.buggy.tuning;
    const truck = VEHICLES.truck.tuning;
    expect(truck.maxSpeed).toBeLessThan(buggy.maxSpeed);
    expect(truck.accel).toBeLessThan(buggy.accel);
    expect(truck.maxTurnRate).toBeLessThan(buggy.maxTurnRate);
    expect(truck.slickGrip).toBeGreaterThan(buggy.slickGrip);
    expect(truck.puddleDrag).toBeLessThan(buggy.puddleDrag);
  });

  it('lets the truck keep more of its grip on an oil slick', () => {
    const slick: RacerStatus = {
      item: null,
      holdTime: 0,
      spin: 0,
      boost: 0,
      slick: 1,
      inPuddle: false,
      onOil: true,
      onPad: false,
    };
    const buggy = effectiveTuning(VEHICLES.buggy.tuning, slick);
    const truck = effectiveTuning(VEHICLES.truck.tuning, slick);
    expect(buggy.grip).toBeCloseTo(VEHICLES.buggy.tuning.grip * 0.1);
    expect(truck.grip).toBeGreaterThan(buggy.grip * 3);
  });

  it('recognises vehicle ids', () => {
    expect(isVehicleId('truck')).toBe(true);
    expect(isVehicleId('tank')).toBe(false);
    expect(isVehicleId(undefined)).toBe(false);
  });
});

describe('a race in a vehicle', () => {
  it('puts every car on the track in the same vehicle, the opponents included', () => {
    const def = TRACKS[0];
    const world = new RaceWorld(new TrackPath(def.controlPoints, def.halfWidth), {
      vehicle: 'truck',
      autopilot: SKILL,
      layout: def.layout,
    });
    expect(world.racers.length).toBeGreaterThan(1);
    for (const racer of world.racers) {
      expect(racer.driver?.tuning.slickGrip).toBe(VEHICLES.truck.tuning.slickGrip);
      expect(racer.driver?.tuning.puddleDrag).toBe(VEHICLES.truck.tuning.puddleDrag);
    }
  });

  it('is a few percent slower in the truck on every track, so the buggy keeps its edge', () => {
    for (let i = 0; i < TRACKS.length; i++) {
      const buggy = timeTrial('buggy', i);
      const truck = timeTrial('truck', i);
      expect(truck, TRACKS[i].id).toBeGreaterThan(buggy * 1.03);
      expect(truck, TRACKS[i].id).toBeLessThan(buggy * 1.12);
    }
  });
});

describe('a season in a vehicle', () => {
  it('starts in the buggy and takes its handling from the chosen vehicle, upgrades on top', () => {
    const season = new Season();
    expect(season.state.vehicle).toBe('buggy');
    expect(season.playerTuning).toEqual(DEFAULT_TUNING);

    season.restart('truck');
    expect(season.state.vehicle).toBe('truck');
    expect(season.playerTuning).toEqual(VEHICLES.truck.tuning);

    season.state.levels.engine = 2;
    expect(season.playerTuning.maxSpeed).toBeGreaterThan(VEHICLES.truck.tuning.maxSpeed);
    expect(season.playerTuning).toEqual(upgradedTuning(season.state.levels, VEHICLES.truck.tuning));
  });

  it('can be won in the truck by a quick driver who buys upgrades', () => {
    const season = new Season();
    season.restart('truck');
    let attempt = 0;
    while (season.state.status === 'racing') {
      const def = season.track;
      const world = new RaceWorld(new TrackPath(def.controlPoints, def.halfWidth), {
        vehicle: season.state.vehicle,
        autopilot: SKILL,
        layout: def.layout,
        playerTuning: season.playerTuning,
        opponentPace: season.opponentPace,
        seed: ++attempt,
      });
      for (let t = 0; t < 260 && world.race.finishTimes[0] === null; t += STEP) world.step(STEP, NO_INPUT);
      const status = season.finishRace(world.race.position(0), world.race.finishTimes[0] ?? 999);
      if (status === 'failed') season.retry();
      if (status === 'shop') {
        for (const kind of UPGRADE_KINDS) season.buy(kind);
        season.nextRace();
      }
    }
    expect(season.state.status).toBe('champion');
  });
});

describe('saving a vehicle', () => {
  const store = new Map<string, string>();
  const install = () => {
    store.clear();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
  };

  it('round-trips the truck', () => {
    install();
    const season = new Season();
    season.restart('truck');
    saveSeason(season.state);
    expect(loadSeason()?.vehicle).toBe('truck');
  });

  it('gives a season saved before vehicles existed the buggy', () => {
    install();
    const { vehicle: _vehicle, ...old } = new Season().state;
    store.set('rc-racer:season', JSON.stringify(old));
    expect(loadSeason()?.vehicle).toBe('buggy');
  });

  it('rejects a season with a vehicle that does not exist', () => {
    install();
    store.set('rc-racer:season', JSON.stringify({ ...new Season().state, vehicle: 'tank' }));
    expect(loadSeason()).toBeNull();
  });
});
