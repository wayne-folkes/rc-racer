import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from './carPhysics';
import {
  CONTINUES,
  MAX_UPGRADE_LEVEL,
  PRIZE_MONEY,
  Season,
  UPGRADE_KINDS,
  UPGRADE_PRICES,
  upgradedTuning,
} from './season';
import { loadSeason, saveSeason } from './seasonStorage';
import { TRACKS } from './tracks';
import { TrackPath } from './trackPath';
import { NO_INPUT, RaceWorld } from './world';

describe('Season', () => {
  it('runs the tracks in order, paying prize money and opening the shop after each qualifying race', () => {
    const season = new Season();
    expect(season.track.id).toBe(TRACKS[0].id);
    expect(season.finishRace(2, 60)).toBe('shop');
    expect(season.state.money).toBe(PRIZE_MONEY[1]);
    season.nextRace();
    expect(season.track.id).toBe(TRACKS[1].id);
    expect(season.state.status).toBe('racing');
  });

  it('crowns the champion after qualifying in the final round', () => {
    const season = new Season();
    for (let round = 0; round < TRACKS.length - 1; round++) {
      season.finishRace(1, 60);
      season.nextRace();
    }
    expect(season.isFinalRound).toBe(true);
    expect(season.finishRace(3, 60)).toBe('champion');
    expect(season.state.results).toHaveLength(TRACKS.length);
  });

  it('allows a limited number of retries for a race outside the top three, then ends', () => {
    const season = new Season();
    for (let k = 0; k < CONTINUES; k++) {
      expect(season.finishRace(4, 60)).toBe('failed');
      expect(season.retry()).toBe(true);
      expect(season.state.round).toBe(0);
    }
    expect(season.finishRace(4, 60)).toBe('gameOver');
    expect(season.retry()).toBe(false);
    expect(season.state.money).toBe(0);

    season.restart();
    expect(season.state).toMatchObject({ round: 0, status: 'racing', continuesLeft: CONTINUES });
  });

  it('sells upgrades in the shop only, at rising prices, up to the maximum level', () => {
    const season = new Season();
    expect(season.buy('engine')).toBe(false); // not in the shop yet
    season.finishRace(1, 60);
    season.state.money = 10_000;
    for (let level = 0; level < MAX_UPGRADE_LEVEL; level++) {
      expect(season.price('engine')).toBe(UPGRADE_PRICES[level]);
      expect(season.buy('engine')).toBe(true);
    }
    expect(season.price('engine')).toBeNull();
    expect(season.buy('engine')).toBe(false);
    expect(season.state.money).toBe(10_000 - UPGRADE_PRICES.reduce((a, b) => a + b, 0));
  });

  it("won't sell what the player can't afford", () => {
    const season = new Season();
    season.finishRace(3, 60);
    expect(season.state.money).toBeLessThan(UPGRADE_PRICES[0]);
    expect(season.canBuy('tires')).toBe(false);
    expect(season.buy('tires')).toBe(false);
  });

  it('makes opponents quicker every round', () => {
    const season = new Season();
    const paces: number[] = [];
    for (let round = 0; round < TRACKS.length; round++) {
      paces.push(season.opponentPace);
      season.finishRace(1, 60);
      season.nextRace();
    }
    for (let i = 1; i < paces.length; i++) expect(paces[i]).toBeGreaterThan(paces[i - 1]);
  });
});

describe('upgrades', () => {
  it('each improve the part of the handling they name', () => {
    const none = upgradedTuning({ engine: 0, tires: 0, battery: 0 });
    expect(none).toEqual(DEFAULT_TUNING);
    expect(upgradedTuning({ engine: 2, tires: 0, battery: 0 }).maxSpeed).toBeGreaterThan(none.maxSpeed);
    expect(upgradedTuning({ engine: 0, tires: 2, battery: 0 }).grip).toBeGreaterThan(none.grip);
    expect(upgradedTuning({ engine: 0, tires: 0, battery: 2 }).accel).toBeGreaterThan(none.accel);
  });
});

describe('season storage', () => {
  it('round-trips a season and rejects anything malformed', () => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;

    expect(loadSeason()).toBeNull();
    const season = new Season();
    season.finishRace(1, 61.5);
    saveSeason(season.state);
    expect(loadSeason()).toEqual(season.state);

    store.set('rc-racer:season', '{"round":"two"}');
    expect(loadSeason()).toBeNull();
    store.set('rc-racer:season', 'not json');
    expect(loadSeason()).toBeNull();
  });
});

describe('a full season', () => {
  it('can be won by a quick driver who buys upgrades', () => {
    const season = new Season();
    let attempt = 0;
    while (season.state.status === 'racing') {
      const def = season.track;
      const world = new RaceWorld(new TrackPath(def.controlPoints, def.halfWidth), {
        autopilot: { pace: 0.95, steerGain: 2.4 },
        layout: def.layout,
        playerTuning: season.playerTuning,
        opponentPace: season.opponentPace,
        seed: ++attempt,
      });
      for (let t = 0; t < 260 && world.race.finishTimes[0] === null; t += 1 / 120) world.step(1 / 120, NO_INPUT);
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
