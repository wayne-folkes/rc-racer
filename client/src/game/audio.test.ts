import { describe, expect, it } from 'vitest';
import { distanceVolume, engineNote } from './audio';

describe('engineNote', () => {
  it('rises in pitch through each gear, dropping back at the change', () => {
    const at = (speed: number) => engineNote(speed, 1).freq;
    expect(at(5)).toBeGreaterThan(at(0));
    expect(at(12)).toBeGreaterThan(at(5));
    // Just past the gear change (half of top speed) the pitch drops.
    expect(at(13.5)).toBeLessThan(at(12.5));
    expect(at(24)).toBeGreaterThan(at(14));
  });

  it('is louder on the throttle and when going faster', () => {
    expect(engineNote(10, 1).gain).toBeGreaterThan(engineNote(10, 0).gain);
    expect(engineNote(20, 0).gain).toBeGreaterThan(engineNote(2, 0).gain);
  });

  it('idles rather than going silent when stopped', () => {
    const idle = engineNote(0, 0);
    expect(idle.freq).toBeGreaterThan(40);
    expect(idle.gain).toBeGreaterThan(0);
  });

  it('sounds the same in reverse as going forwards', () => {
    expect(engineNote(-6, 0)).toEqual(engineNote(6, 0));
  });
});

describe('distanceVolume', () => {
  it('is full volume close by, fades with distance, and never goes silent', () => {
    expect(distanceVolume(0)).toBe(1);
    expect(distanceVolume(30)).toBeCloseTo(0.5);
    expect(distanceVolume(500)).toBeCloseTo(0.15);
  });
});
