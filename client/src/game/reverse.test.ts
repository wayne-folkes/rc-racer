import { describe, expect, it } from 'vitest';
import { buildRamps } from './jumps';
import { Season } from './season';
import { loadSeason, saveSeason } from './seasonStorage';
import { ALL_TRACKS, CIRCUIT_IDS, circuitTracks, reverseTrack, TRACKS, type TrackDef } from './tracks';
import { TrackPath } from './trackPath';

const pathOf = (def: TrackDef) => new TrackPath(def.controlPoints, def.halfWidth);

/** Where a spot at `at` of the lap and `lateral` metres right of the centreline is, in the world. */
function worldSpot(def: TrackDef, at: number, lateral: number) {
  const track = pathOf(def);
  const p = track.pointAt(at * track.length);
  return { x: p.x - p.tz * lateral, z: p.z + p.tx * lateral };
}

const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

const FORWARD_TRACKS = CIRCUIT_IDS.flatMap((id) => circuitTracks(id, false));
const REVERSED_TRACKS = CIRCUIT_IDS.flatMap((id) => circuitTracks(id, true));

describe.each(FORWARD_TRACKS.map((forward, i) => ({ name: forward.name, forward, reversed: REVERSED_TRACKS[i] })))('$name, reversed', ({ forward, reversed }) => {
  it('is named and identified as a separate track', () => {
    expect(reversed.reversed).toBe(true);
    expect(forward.reversed).toBeUndefined();
    expect(reversed.id).not.toBe(forward.id);
    expect(reversed.name).toContain(forward.name);
  });

  it('is the same road driven the other way, with the start line where it was', () => {
    const f = pathOf(forward);
    const r = pathOf(reversed);
    expect(r.length).toBeCloseTo(f.length, 0);
    // The start is the same place, and a point d along the reversed lap is the point d from the end of the
    // forward one.
    expect(distance(r.pointAt(0), f.pointAt(0))).toBeLessThan(0.5);
    for (const d of [0.1, 0.3, 0.5, 0.8].map((frac) => frac * f.length)) {
      expect(distance(r.pointAt(d), f.pointAt(f.length - d)), `${d.toFixed(0)} m round`).toBeLessThan(0.75);
    }
    // ...and it really runs the other way.
    const a = f.pointAt(0);
    const b = r.pointAt(0);
    expect(a.tx * b.tx + a.tz * b.tz).toBeLessThan(-0.9);
  });

  it('keeps every pickup, hazard and boost pad where it was on the road', () => {
    const spots = [
      ...forward.layout.pickups.map((s, i) => [s, reversed.layout.pickups[i]] as const),
      ...forward.layout.hazards.map((s, i) => [s, reversed.layout.hazards[i]] as const),
      ...forward.layout.boostPads.map((s, i) => [s, reversed.layout.boostPads[i]] as const),
    ];
    expect(spots.length).toBeGreaterThan(0);
    for (const [was, now] of spots) {
      expect(distance(worldSpot(forward, was.at, was.lateral), worldSpot(reversed, now.at, now.lateral))).toBeLessThan(0.75);
    }
  });

  it('keeps every ramp on the same stretch of road, facing the other way', () => {
    const was = buildRamps(pathOf(forward), forward.layout.ramps ?? []);
    const now = buildRamps(pathOf(reversed), reversed.layout.ramps ?? []);
    expect(now.length).toBe(was.length);
    // Ramps are listed in the same order, but a ramp placed by its foot moves; match each to the nearest.
    for (const ramp of was) {
      const twin = now.reduce((best, r) => (distance(r, ramp) < distance(best, ramp) ? r : best));
      expect(distance(twin, ramp)).toBeLessThan(0.75);
      // Turned right round: the headings differ by half a turn.
      const apart = Math.abs(((twin.heading - ramp.heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(Math.PI - apart).toBeLessThan(0.1);
    }
  });
});

describe('all tracks', () => {
  it('have their own ids, so each has its own records', () => {
    const ids = ALL_TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ALL_TRACKS.length).toBe(FORWARD_TRACKS.length * 2);
  });

  it('reversing leaves the original alone', () => {
    const before = JSON.stringify(TRACKS[0]);
    reverseTrack(TRACKS[0]);
    expect(JSON.stringify(TRACKS[0])).toBe(before);
  });
});

describe('a reverse season', () => {
  it('runs the same tracks in the same order, driven the other way', () => {
    const season = new Season();
    expect(season.state.reverse).toBe(false);
    expect(season.tracks).toBe(season.tracks);
    expect(season.tracks.every((t) => !t.reversed)).toBe(true);

    season.restart('buggy', false, true);
    expect(season.state.reverse).toBe(true);
    expect(season.tracks.length).toBe(TRACKS.length);
    expect(season.tracks.every((t) => t.reversed)).toBe(true);
    expect(season.tracks.map((t) => t.id)).toEqual(TRACKS.map((t) => `${t.id}-rev`));
    // The same list each time, so a track can be found in it again.
    expect(season.tracks).toBe(season.tracks);
    expect(season.tracks.indexOf(season.track)).toBe(0);
    expect(season.track.id).toBe(`${TRACKS[0].id}-rev`);
  });

  it('goes back to forward on the next restart', () => {
    const season = new Season();
    season.restart('buggy', false, true);
    season.restart();
    expect(season.state.reverse).toBe(false);
    expect(season.track.reversed).toBeUndefined();
  });

  it('is saved, an old save loads as forward, and a bad value is rejected', () => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;

    const season = new Season();
    season.restart('truck', true, true);
    saveSeason(season.state);
    expect(loadSeason()).toMatchObject({ vehicle: 'truck', easy: true, reverse: true });

    const { reverse: _reverse, ...old } = new Season().state;
    store.set('rc-racer:season', JSON.stringify(old));
    expect(loadSeason()?.reverse).toBe(false);

    store.set('rc-racer:season', JSON.stringify({ ...new Season().state, reverse: 'yes' }));
    expect(loadSeason()).toBeNull();
  });
});
