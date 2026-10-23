import { describe, expect, it } from 'vitest';
import { IdleWatch } from './idle';

describe('IdleWatch', () => {
  it('goes away after the limit with nothing happening, and not before', () => {
    const watch = new IdleWatch(30);
    expect(watch.update(0, true)).toBe(false);
    expect(watch.update(29.9, true)).toBe(false);
    expect(watch.update(30, true)).toBe(true);
    expect(watch.update(90, true)).toBe(true);
  });

  it('is put off by activity, which starts the count again', () => {
    const watch = new IdleWatch(30);
    watch.update(0, true);
    expect(watch.poke(20)).toBe(false);
    expect(watch.update(49, true)).toBe(false);
    expect(watch.update(50, true)).toBe(true);
  });

  it('says it was away when woken, so that input can be spent on waking it', () => {
    const watch = new IdleWatch(30);
    watch.update(40, true);
    expect(watch.poke(41)).toBe(true);
    // Awake now: the next input counts as ordinary.
    expect(watch.poke(42)).toBe(false);
    expect(watch.update(43, true)).toBe(false);
  });

  it('only counts while it is being watched, and starts over when it stops', () => {
    const watch = new IdleWatch(30);
    watch.update(0, true);
    watch.update(25, false);
    expect(watch.update(50, true)).toBe(false);
    expect(watch.update(54, true)).toBe(false);
    expect(watch.update(55, true)).toBe(true);
    expect(watch.update(81, false)).toBe(false);
  });
});
