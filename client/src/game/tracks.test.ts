import { describe, expect, it } from 'vitest';
import { ItemSystem } from './items';
import { RAMP_LENGTH } from './jumps';
import { buildRacingLine } from './racingLine';
import { gridPosition, OPPONENTS, PLAYER, SLOT_LENGTH, SLOT_WIDTH, START_LINE_DEPTH } from './racers';
import { ALL_TRACKS } from './tracks';
import { TrackPath } from './trackPath';
import { NO_INPUT, RaceWorld } from './world';

const DT = 1 / 120;
/** How many different races' worth of random hazards each track is checked against. */
const HAZARD_SEEDS = 40;

describe.each(ALL_TRACKS)('$name', (def) => {
  const track = new TrackPath(def.controlPoints, def.halfWidth);
  const line = buildRacingLine(track);
  const n = track.points.length;

  /** Where along the track every hazard lies: the fixed ones, then the zones' hazards as rolled in many races. */
  const hazardDistances = () => {
    const fixed = def.layout.hazards.map((h) => h.at * track.length);
    const rolled = Array.from({ length: HAZARD_SEEDS }, (_, k) =>
      new ItemSystem(track, 4, def.layout, k + 1).hazards.map((h) => track.project(h.x, h.z).distance),
    );
    return [...fixed, ...rolled.flat()];
  };

  it('has no corner tighter than the road is wide', () => {
    for (let i = 0; i < n; i++) {
      const a = track.tangent((i - 1 + n) % n);
      const b = track.tangent((i + 1) % n);
      const turn = Math.abs(Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z));
      expect((2 * track.length) / n / turn).toBeGreaterThan(track.halfWidth + 2);
    }
  });

  it('never runs close to another part of itself', () => {
    for (let i = 0; i < n; i += 3) {
      for (let j = 0; j < n; j += 3) {
        const apart = Math.min(Math.abs(i - j), n - Math.abs(i - j)) * (track.length / n);
        if (apart < 40) continue;
        const gap = Math.hypot(track.points[i].x - track.points[j].x, track.points[i].z - track.points[j].z);
        expect(gap).toBeGreaterThan(2 * track.halfWidth + 4);
      }
    }
  });

  it('puts every pickup, pad and hazard on the road', () => {
    const room = track.halfWidth - 1.2;
    for (const spot of [...def.layout.pickups, ...def.layout.boostPads, ...def.layout.hazards]) {
      expect(Math.abs(spot.lateral)).toBeLessThanOrEqual(room);
    }
    for (const zone of def.layout.hazardZones ?? []) expect(zone.room).toBeLessThanOrEqual(room);
  });

  it('keeps hazard zones apart, so each gets a hazard of its own', () => {
    const zones = def.layout.hazardZones ?? [];
    expect(zones.length + def.layout.hazards.length).toBeGreaterThanOrEqual(3);
    for (const a of zones) {
      for (const b of zones) {
        if (a === b) continue;
        const gap = Math.abs(a.at - b.at);
        const clear = (Math.min(gap, 1 - gap) - a.reach - b.reach) * track.length;
        expect(clear, 'metres between two zones').toBeGreaterThan(10);
      }
    }
  });

  it('fits every starting pad on the road and behind the start line', () => {
    const startLineHalfDepth = START_LINE_DEPTH / 2;
    for (const { gridSlot } of [PLAYER, ...OPPONENTS]) {
      const { x, z } = gridPosition(track, gridSlot);
      const { lateral, distance } = track.project(x, z);
      expect(Math.abs(lateral) + SLOT_WIDTH / 2, `slot ${gridSlot} across`).toBeLessThan(track.halfWidth);
      expect(track.length - distance - SLOT_LENGTH / 2, `slot ${gridSlot} along`).toBeGreaterThan(startLineHalfDepth);
    }
  });

  it('never drops a hazard on a pickup or a boost pad', () => {
    const spots = [...def.layout.pickups, ...def.layout.boostPads].map((spot) => spot.at * track.length);
    for (const distance of hazardDistances()) {
      for (const at of spots) {
        const gap = Math.abs(distance - at);
        expect(Math.min(gap, track.length - gap), 'metres from the nearest spot').toBeGreaterThan(4.5);
      }
    }
  });

  it('only puts hazards where the racing line is steady enough to steer round them', () => {
    for (const distance of hazardDistances()) {
      const centre = Math.round((distance / track.length) * n);
      const reach = Math.round(20 / (track.length / n));
      const offsets = Array.from({ length: 2 * reach + 1 }, (_, k) => line.offsets[(centre - reach + k + n) % n]);
      expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThan(2.5);
    }
  });

  it('only puts ramps on straight-ish stretches, clear of pads, pickups and hazards', () => {
    const spacing = track.length / n;
    for (const ramp of def.layout.ramps ?? []) {
      const foot = ramp.at * track.length;
      // From just before the ramp to well past the landing: fast, with a steady line.
      const window = Array.from({ length: Math.round(30 / spacing) }, (_, k) => {
        const i = (Math.round((foot - 5) / spacing) + k + n) % n;
        return { speed: line.targetSpeed[i], offset: line.offsets[i] };
      });
      expect(Math.min(...window.map((w) => w.speed))).toBeGreaterThan(20);
      const offsets = window.map((w) => w.offset);
      expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThan(2.5);

      // Nothing sits on the ramp itself, wherever a zone's hazard lands.
      const spots = [...def.layout.pickups, ...def.layout.boostPads].map((spot) => spot.at * track.length);
      for (const at of [...spots, ...hazardDistances()]) {
        const along = (((at - foot) % track.length) + track.length) % track.length;
        expect(along > RAMP_LENGTH + 1 && along < track.length - 3).toBe(true);
      }
    }
  });

  it.each([1, 7])('can be raced by the full field with nobody stuck (hazard seed %i)', (seed) => {
    const world = new RaceWorld(track, { autopilot: { pace: 0.9, steerGain: 2.4 }, layout: def.layout, seed });
    let respawns = 0;
    const reset = world.resetCar.bind(world);
    world.resetCar = (i: number) => {
      respawns++;
      reset(i);
    };
    for (let t = 0; t < 240 && world.race.finishTimes.some((f) => f === null); t += DT) world.step(DT, NO_INPUT);
    expect(world.race.finishTimes.every((f) => f !== null)).toBe(true);
    expect(respawns).toBe(0);
  });
});
