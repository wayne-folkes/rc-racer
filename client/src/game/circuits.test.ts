import { beforeEach, describe, expect, it } from 'vitest';
import { Season } from './season';
import { loadSeason, saveSeason } from './seasonStorage';
import { ALL_TRACKS, CIRCUIT_IDS, CIRCUITS, circuitTracks, isCircuitId } from './tracks';

describe('circuits', () => {
  it('each have four rounds, so a season is the same length on either', () => {
    for (const id of CIRCUIT_IDS) expect(CIRCUITS[id].tracks, id).toHaveLength(4);
  });

  it('share no track ids, so every track keeps its own records', () => {
    const ids = ALL_TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('look different from one another', () => {
    const themes = ALL_TRACKS.filter((t) => !t.reversed).map((t) => t.theme);
    expect(new Set(themes.map((t) => t.ground)).size).toBe(themes.length);
    const space = CIRCUITS.space.tracks.map((t) => t.theme.scenery);
    expect(new Set(space).size).toBe(space.length);
  });

  it('hand back the same reversed list each time', () => {
    for (const id of CIRCUIT_IDS) {
      expect(circuitTracks(id, true)).toBe(circuitTracks(id, true));
      expect(circuitTracks(id, true).map((t) => t.id)).toEqual(circuitTracks(id, false).map((t) => `${t.id}-rev`));
    }
  });

  it('recognise their ids', () => {
    expect(isCircuitId('space')).toBe(true);
    expect(isCircuitId('galaxy')).toBe(false);
    expect(isCircuitId(undefined)).toBe(false);
  });
});

describe('a Space Cup season', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
  });

  it('starts on a classic season, and restarts on whichever circuit it is told', () => {
    const season = new Season();
    expect(season.state.circuit).toBe('classic');
    expect(season.tracks).toBe(CIRCUITS.classic.tracks);

    season.restart('buggy', false, false, 'space');
    expect(season.tracks).toBe(CIRCUITS.space.tracks);
    expect(season.track.id).toBe(CIRCUITS.space.tracks[0].id);

    season.restart('buggy', false, true, 'space');
    expect(season.tracks).toBe(circuitTracks('space', true));
    expect(season.tracks.every((t) => t.reversed)).toBe(true);

    season.restart();
    expect(season.state.circuit).toBe('classic');
  });

  it('plays through to the championship', () => {
    const season = new Season();
    season.restart('truck', false, false, 'space');
    for (let round = 0; round < 4; round++) {
      expect(season.track.id).toBe(CIRCUITS.space.tracks[round].id);
      season.finishRace(1, 100);
      if (season.state.status === 'shop') season.nextRace();
    }
    expect(season.state.status).toBe('champion');
  });

  it('is saved, an old save loads as the classic cup, and a bad value is rejected', () => {
    const season = new Season();
    season.restart('truck', true, true, 'space');
    saveSeason(season.state);
    expect(loadSeason()).toMatchObject({ circuit: 'space', reverse: true });
    expect(new Season(loadSeason() ?? undefined).tracks).toBe(circuitTracks('space', true));

    const { circuit: _circuit, ...old } = new Season().state;
    store.set('rc-racer:season', JSON.stringify(old));
    expect(loadSeason()?.circuit).toBe('classic');

    store.set('rc-racer:season', JSON.stringify({ ...new Season().state, circuit: 'galaxy' }));
    expect(loadSeason()).toBeNull();
  });
});
