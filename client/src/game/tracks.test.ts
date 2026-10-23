import { describe, expect, it } from 'vitest';
import { RAMP_LENGTH } from './jumps';
import { buildRacingLine } from './racingLine';
import { TRACKS } from './tracks';
import { TrackPath } from './trackPath';
import { NO_INPUT, RaceWorld } from './world';

const DT = 1 / 120;

describe.each(TRACKS)('$name', (def) => {
  const track = new TrackPath(def.controlPoints, def.halfWidth);
  const line = buildRacingLine(track);
  const n = track.points.length;

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
  });

  it('only puts hazards where the racing line is steady enough to steer round them', () => {
    for (const h of def.layout.hazards) {
      const centre = Math.round(h.at * n);
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

      // Nothing sits on the ramp itself.
      for (const spot of [...def.layout.pickups, ...def.layout.boostPads, ...def.layout.hazards]) {
        const along = (((spot.at * track.length - foot) % track.length) + track.length) % track.length;
        expect(along > RAMP_LENGTH + 1 && along < track.length - 3).toBe(true);
      }
    }
  });

  it('can be raced by the full field with nobody stuck', () => {
    const world = new RaceWorld(track, { autopilot: { pace: 0.9, steerGain: 2.4 }, layout: def.layout });
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
