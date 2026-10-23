import { describe, expect, it } from 'vitest';
import type { CarInput } from './carPhysics';
import { Controls, mergeCarInputs, type Action, type InputSource } from './controls';
import { BUTTON, GamepadInput, padActions, padCarInput, type PadSnapshot } from './gamepad';

/** A standard-layout pad with nothing pressed, plus whatever's given. */
function pad(pressed: Partial<Record<keyof typeof BUTTON, number>> = {}, axes: number[] = [0, 0, 0, 0]): PadSnapshot {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const [name, v] of Object.entries(pressed)) {
    buttons[BUTTON[name as keyof typeof BUTTON]] = { pressed: v > 0.5, value: v };
  }
  return { axes, buttons };
}

describe('padCarInput', () => {
  it('is idle with nothing pressed and the stick resting slightly off-centre', () => {
    expect(padCarInput(pad({}, [0.1, -0.05]))).toEqual({ throttle: 0, steer: 0, handbrake: false });
  });

  it('steers with the stick, starting gently past the deadzone', () => {
    expect(padCarInput(pad({}, [1, 0])).steer).toBe(1);
    expect(padCarInput(pad({}, [-1, 0])).steer).toBe(-1);
    const half = padCarInput(pad({}, [0.6, 0])).steer;
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.6);
  });

  it('lets the d-pad override the stick', () => {
    expect(padCarInput(pad({ left: 1 }, [0.8, 0])).steer).toBe(-1);
  });

  it('reads analog triggers for throttle and brake, and A and X as digital ones', () => {
    expect(padCarInput(pad({ rt: 0.4 })).throttle).toBeCloseTo(0.4);
    expect(padCarInput(pad({ lt: 1 })).throttle).toBe(-1);
    expect(padCarInput(pad({ a: 1 })).throttle).toBe(1);
    expect(padCarInput(pad({ x: 1 })).throttle).toBe(-1);
  });

  it('uses either bumper for the handbrake', () => {
    expect(padCarInput(pad({ lb: 1 })).handbrake).toBe(true);
    expect(padCarInput(pad({ rb: 1 })).handbrake).toBe(true);
  });
});

describe('padActions', () => {
  it('maps face buttons to actions', () => {
    expect(padActions(pad({ b: 1 }))).toContain('fire');
    expect(padActions(pad({ y: 1 }))).toContain('reset');
    expect(padActions(pad({ back: 1 }))).toContain('restart');
    expect(padActions(pad({ start: 1 }))).toContain('confirm');
    expect(padActions(pad({ a: 1 }))).toContain('confirm');
  });

  it('treats a pushed stick as a d-pad for menus', () => {
    expect(padActions(pad({}, [0, -0.9]))).toContain('up');
    expect(padActions(pad({}, [0.9, 0]))).toContain('right');
    expect(padActions(pad({}, [0.3, 0.3])).size).toBe(0);
  });
});

describe('GamepadInput', () => {
  it('reports each button press once, until it is released and pressed again', () => {
    let current: PadSnapshot = pad();
    const input = new GamepadInput(() => [{ ...current, connected: true } as unknown as Gamepad]);
    const frame = () => {
      input.poll();
      const fired = input.pressed('fire');
      input.endFrame();
      return fired;
    };
    expect(frame()).toBe(false);
    current = pad({ b: 1 });
    expect(frame()).toBe(true);
    expect(frame()).toBe(false); // still held
    current = pad();
    expect(frame()).toBe(false);
    current = pad({ b: 1 });
    expect(frame()).toBe(true);
  });

  it('is idle with no controller plugged in', () => {
    const input = new GamepadInput(() => [null]);
    input.poll();
    expect(input.connected).toBe(false);
    expect(input.carInput()).toEqual({ throttle: 0, steer: 0, handbrake: false });
    expect(input.active()).toBe(false);
  });
});

describe('Controls', () => {
  /** A source with fixed driving input and a set of actions pressed. */
  function source(kind: InputSource['kind'], input: CarInput, actions: Action[] = [], used = true): InputSource {
    return {
      kind,
      carInput: () => input,
      pressed: (a) => actions.includes(a),
      active: () => used,
      endFrame: () => {},
    };
  }
  const idle: CarInput = { throttle: 0, steer: 0, handbrake: false };

  it('merges driving input, taking the strongest on each axis', () => {
    expect(
      mergeCarInputs([
        { throttle: 0.3, steer: -1, handbrake: false },
        { throttle: 1, steer: 0.2, handbrake: true },
      ]),
    ).toEqual({ throttle: 1, steer: -1, handbrake: true });
  });

  it('fires an action if any device pressed it, and remembers which device was used last', () => {
    const controls = new Controls([
      source('keyboard', idle, [], false),
      source('touch', { throttle: 1, steer: 0, handbrake: false }, ['fire']),
    ]);
    controls.poll();
    expect(controls.pressed('fire')).toBe(true);
    expect(controls.pressed('reset')).toBe(false);
    expect(controls.carInput().throttle).toBe(1);
    expect(controls.lastUsed).toBe('touch');
  });
});
