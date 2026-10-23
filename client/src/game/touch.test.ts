import { describe, expect, it } from 'vitest';
import { STICK_DEADZONE, stickKnob, stickSteer } from './touch';

const TRAVEL = 40;

describe('stickSteer', () => {
  it('steers nothing at rest, or inside the dead zone', () => {
    expect(stickSteer(0, TRAVEL)).toBe(0);
    expect(stickSteer(TRAVEL * STICK_DEADZONE * 0.99, TRAVEL)).toBe(0);
    expect(stickSteer(-TRAVEL * STICK_DEADZONE * 0.99, TRAVEL)).toBe(0);
  });

  it('steers harder the further the knob is pushed, to full lock at the edge, either way', () => {
    const steps = [0.3, 0.5, 0.7, 0.9].map((f) => stickSteer(f * TRAVEL, TRAVEL));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    expect(stickSteer(TRAVEL, TRAVEL)).toBe(1);
    expect(stickSteer(-TRAVEL, TRAVEL)).toBe(-1);
    expect(stickSteer(0.5 * TRAVEL, TRAVEL)).toBeCloseTo(-stickSteer(-0.5 * TRAVEL, TRAVEL), 12);
  });

  it('starts from zero at the edge of the dead zone, so there is no jump', () => {
    expect(stickSteer(TRAVEL * STICK_DEADZONE * 1.01, TRAVEL)).toBeLessThan(0.02);
  });

  it('never goes past full lock, however far the thumb slides', () => {
    expect(stickSteer(10 * TRAVEL, TRAVEL)).toBe(1);
    expect(stickSteer(-10 * TRAVEL, TRAVEL)).toBe(-1);
  });
});

describe('stickKnob', () => {
  it('follows the thumb inside the stick', () => {
    expect(stickKnob(10, -15, TRAVEL)).toEqual({ x: 10, y: -15 });
  });

  it('stops at the edge of the stick, in the direction of the thumb', () => {
    const at = stickKnob(300, 400, TRAVEL);
    expect(Math.hypot(at.x, at.y)).toBeCloseTo(TRAVEL, 9);
    expect(at.y / at.x).toBeCloseTo(4 / 3, 9);
  });
});
