import { describe, expect, it } from 'vitest';
import { createCar, DEFAULT_TUNING, forwardSpeed, speed, stepCar, type CarInput } from './carPhysics';

const DT = 1 / 120;
const drive = (input: CarInput, seconds: number, car = createCar(0, 0, 0)) => {
  for (let t = 0; t < seconds; t += DT) stepCar(car, input, DT);
  return car;
};
const GAS: CarInput = { throttle: 1, steer: 0, handbrake: false };

describe('stepCar', () => {
  it('accelerates forward along its heading', () => {
    const car = drive(GAS, 1);
    expect(forwardSpeed(car)).toBeGreaterThan(10);
    expect(car.x).toBeGreaterThan(0);
    expect(Math.abs(car.z)).toBeLessThan(1e-9);
  });

  it('never exceeds top speed', () => {
    const car = drive(GAS, 20);
    expect(speed(car)).toBeLessThanOrEqual(DEFAULT_TUNING.maxSpeed);
    expect(speed(car)).toBeGreaterThan(DEFAULT_TUNING.maxSpeed * 0.8);
  });

  it('does not turn while stationary', () => {
    const car = drive({ throttle: 0, steer: 1, handbrake: false }, 1);
    expect(car.heading).toBe(0);
  });

  it('turns right (increasing heading) when steering right going forward', () => {
    const car = drive(GAS, 1);
    drive({ ...GAS, steer: 1 }, 0.5, car);
    expect(car.heading).toBeGreaterThan(0.5);
  });

  it('brakes, then reverses, when holding down', () => {
    const car = drive(GAS, 1);
    drive({ throttle: -1, steer: 0, handbrake: false }, 3, car);
    expect(forwardSpeed(car)).toBeLessThan(0);
    expect(forwardSpeed(car)).toBeGreaterThanOrEqual(-DEFAULT_TUNING.maxReverse);
  });

  it('slides more with the handbrake than without', () => {
    const lateralAfterTurn = (handbrake: boolean) => {
      const car = drive(GAS, 2);
      drive({ throttle: 1, steer: 1, handbrake }, 0.4, car);
      const rx = -Math.sin(car.heading);
      const rz = Math.cos(car.heading);
      return Math.abs(car.vx * rx + car.vz * rz);
    };
    expect(lateralAfterTurn(true)).toBeGreaterThan(lateralAfterTurn(false) * 2);
  });

  it('coasts to a stop without input', () => {
    const car = drive(GAS, 1);
    drive({ throttle: 0, steer: 0, handbrake: false }, 10, car);
    expect(speed(car)).toBeLessThan(0.01);
  });
});
