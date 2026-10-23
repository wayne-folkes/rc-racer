import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllRecords, loadRecords, updateRecords } from './records';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

const NONE = { bestRace: null, bestLap: null };

describe('records', () => {
  it('counts the first finished race in a vehicle as a record', () => {
    const update = updateRecords('buggy', 'demo', 60, 19);
    expect(update.newRaceRecord).toBe(true);
    expect(update.newLapRecord).toBe(true);
    expect(loadRecords('buggy', 'demo')).toEqual({ bestRace: 60, bestLap: 19 });
  });

  it('only counts a faster time as a record', () => {
    updateRecords('buggy', 'demo', 60, 19);
    const slower = updateRecords('buggy', 'demo', 61, 20);
    expect(slower.newRaceRecord).toBe(false);
    expect(slower.newLapRecord).toBe(false);
    expect(loadRecords('buggy', 'demo')).toEqual({ bestRace: 60, bestLap: 19 });
    expect(updateRecords('buggy', 'demo', 59, 18.5).newRaceRecord).toBe(true);
  });

  it('keeps each vehicle\'s times apart, so the slower truck can still set records', () => {
    updateRecords('buggy', 'demo', 60, 19);
    // 64 s would never beat the buggy's 60, but nobody has driven the truck here yet.
    const truck = updateRecords('truck', 'demo', 64, 20.5);
    expect(truck.newRaceRecord).toBe(true);
    expect(truck.newLapRecord).toBe(true);
    expect(truck.previous).toEqual(NONE);
    expect(loadRecords('truck', 'demo')).toEqual({ bestRace: 64, bestLap: 20.5 });
    expect(loadRecords('buggy', 'demo')).toEqual({ bestRace: 60, bestLap: 19 });
  });

  it('keeps each track\'s times apart too', () => {
    updateRecords('truck', 'demo', 64, 20.5);
    expect(loadRecords('truck', 'desert')).toEqual(NONE);
  });

  it('loads records saved before vehicles existed as the buggy\'s', () => {
    store.set('rc-racer:records:demo', JSON.stringify({ bestRace: 60, bestLap: 19 }));
    expect(loadRecords('buggy', 'demo')).toEqual({ bestRace: 60, bestLap: 19 });
    expect(loadRecords('truck', 'demo')).toEqual(NONE);
  });

  it('saves the buggy under the key it always used, so nothing needs migrating', () => {
    updateRecords('buggy', 'demo', 60, 19);
    expect([...store.keys()]).toEqual(['rc-racer:records:demo']);
  });

  it('forgets every vehicle\'s times when records are cleared', () => {
    updateRecords('buggy', 'demo', 60, 19);
    updateRecords('truck', 'demo', 64, 20.5);
    updateRecords('truck', 'desert', 70, 22);
    clearAllRecords(['demo', 'desert']);
    expect(store.size).toBe(0);
    expect(loadRecords('buggy', 'demo')).toEqual(NONE);
    expect(loadRecords('truck', 'desert')).toEqual(NONE);
  });

  it('ignores a malformed record', () => {
    store.set('rc-racer:records:demo', 'not json');
    expect(loadRecords('buggy', 'demo')).toEqual(NONE);
    store.set('rc-racer:records:truck:demo', JSON.stringify({ bestRace: 'fast', bestLap: null }));
    expect(loadRecords('truck', 'demo')).toEqual(NONE);
  });
});
