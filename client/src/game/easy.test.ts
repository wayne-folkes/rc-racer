import { describe, expect, it } from 'vitest';
import { rubberBand } from './aiDriver';
import { EASY_PLAYER_SLOT, OPPONENTS, PLAYER, startingGrid } from './racers';
import { Season } from './season';
import { loadSeason, saveSeason } from './seasonStorage';
import { TRACKS } from './tracks';
import { TrackPath } from './trackPath';
import { NO_INPUT, RaceWorld } from './world';

const STEP = 1 / 120;

describe('starting grid', () => {
  it('puts the player at the back normally', () => {
    const grid = startingGrid(OPPONENTS, false);
    expect(grid.player).toBe(PLAYER);
    expect(grid.opponents).toBe(OPPONENTS);
    expect(grid.player.gridSlot).toBe(3);
  });

  it('moves the player up to 2nd in easy mode, sending whoever was there to the back', () => {
    const grid = startingGrid(OPPONENTS, true);
    expect(grid.player.gridSlot).toBe(EASY_PLAYER_SLOT);
    expect(grid.opponents.find((o) => o.name === 'Yellow')?.gridSlot).toBe(PLAYER.gridSlot);
    // Everyone else keeps their place, and the four slots are still all different.
    expect(grid.opponents.find((o) => o.name === 'Blue')?.gridSlot).toBe(0);
    expect(grid.opponents.find((o) => o.name === 'Green')?.gridSlot).toBe(2);
    const slots = [grid.player, ...grid.opponents].map((r) => r.gridSlot).sort();
    expect(slots).toEqual([0, 1, 2, 3]);
  });

  it('starts the world\'s player 2nd in easy mode', () => {
    const def = TRACKS[0];
    const track = new TrackPath(def.controlPoints, def.halfWidth);
    const normal = new RaceWorld(track, { layout: def.layout });
    const easy = new RaceWorld(track, { layout: def.layout, easy: true });
    expect(normal.racers[0].info.gridSlot).toBe(3);
    expect(easy.racers[0].info.gridSlot).toBe(1);
    // Their cars are really there: 2nd is closer to the line than 4th.
    expect(easy.playerProj.distance).toBeGreaterThan(normal.playerProj.distance);
  });
});

describe('easy mode pace', () => {
  it('holds a runaway leader back further, and changes nothing else', () => {
    expect(rubberBand(-100)).toBe(0.92);
    expect(rubberBand(-100, true)).toBeLessThan(rubberBand(-100));
    // Close to the player, or behind, a car is treated the same either way.
    for (const gap of [-5, 0, 20, 100]) expect(rubberBand(gap, true)).toBe(rubberBand(gap));
  });

  it('makes the opponents slower every round', () => {
    const normal = new Season();
    const easy = new Season();
    easy.restart('buggy', true);
    for (let round = 0; round < TRACKS.length; round++) {
      normal.state.round = round;
      easy.state.round = round;
      expect(easy.opponentPace).toBeLessThan(normal.opponentPace);
    }
  });
});

describe('a season in easy mode', () => {
  it('starts out of easy mode, and keeps the choice', () => {
    const season = new Season();
    expect(season.state.easy).toBe(false);
    season.restart('truck', true);
    expect(season.state.easy).toBe(true);
    expect(season.state.vehicle).toBe('truck');
    season.restart();
    expect(season.state.easy).toBe(false);
  });

  it('is saved, an old save loads as normal, and a bad value is rejected', () => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;

    const season = new Season();
    season.restart('buggy', true);
    saveSeason(season.state);
    expect(loadSeason()?.easy).toBe(true);

    const { easy: _easy, ...old } = new Season().state;
    store.set('rc-racer:season', JSON.stringify(old));
    expect(loadSeason()?.easy).toBe(false);

    store.set('rc-racer:season', JSON.stringify({ ...new Season().state, easy: 'yes' }));
    expect(loadSeason()).toBeNull();
  });
});

/** One race with an autopilot driving the player's car: where it finished, and how long it led. */
function race(round: number, easy: boolean, skill: number) {
  const season = new Season();
  season.restart('buggy', easy);
  season.state.round = round;
  const def = TRACKS[round];
  const world = new RaceWorld(new TrackPath(def.controlPoints, def.halfWidth), {
    easy,
    autopilot: { pace: skill, steerGain: 2.4 },
    layout: def.layout,
    opponentPace: season.opponentPace,
    seed: 1,
  });
  let ledFor = 0;
  for (let t = 0; t < 300 && world.race.finishTimes[0] === null; t += STEP) {
    world.step(STEP, NO_INPUT);
    if (world.race.position(0) === 1) ledFor += STEP;
  }
  return { position: world.race.position(0), ledFor };
}

describe('racing in easy mode', () => {
  it('lets a decent driver lead for longer, and never finish lower, on every track', () => {
    for (let round = 0; round < TRACKS.length; round++) {
      const normal = race(round, false, 0.9);
      const easy = race(round, true, 0.9);
      expect(easy.ledFor, `${TRACKS[round].id}: time in the lead`).toBeGreaterThan(normal.ledFor);
      expect(easy.position, `${TRACKS[round].id}: finishing place`).toBeLessThanOrEqual(normal.position);
    }
  }, 60_000);
});
