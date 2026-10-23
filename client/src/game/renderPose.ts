import type { CarState } from './carPhysics';

// The simulation steps at a fixed rate, but frames arrive at the screen's. Drawing the latest step as it
// is makes a car move in uneven jumps whenever the two don't line up (a 144 Hz screen takes a step every
// 1.2 frames), so each frame is drawn part of the way from the previous step to the latest.

/** Where a car was, and which way it faced, when a fixed step began. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  steer: number;
}

/** A car that moved further than this in one step was put somewhere (a reset, a respawn): not drawn in between. */
export const SNAP_DISTANCE = 2;

export function poseOf(car: CarState): Pose {
  return { x: car.x, y: car.y, z: car.z, heading: car.heading, steer: car.steer };
}

/**
 * Writes `car` into `out`, moved back from its latest step towards `prev` by how far into the next step
 * we are: `alpha` 1 is the latest step, 0 is the one before. Everything but the pose is taken as it is.
 */
export function blendCar(out: CarState, car: CarState, prev: Pose | undefined, alpha: number): CarState {
  Object.assign(out, car);
  if (!prev || alpha >= 1) return out;
  if (Math.hypot(car.x - prev.x, car.z - prev.z) > SNAP_DISTANCE || Math.abs(car.y - prev.y) > SNAP_DISTANCE) return out;
  out.x = prev.x + (car.x - prev.x) * alpha;
  out.y = prev.y + (car.y - prev.y) * alpha;
  out.z = prev.z + (car.z - prev.z) * alpha;
  // The short way round, so a heading crossing ±π doesn't swing the car through a full turn.
  const turn = Math.atan2(Math.sin(car.heading - prev.heading), Math.cos(car.heading - prev.heading));
  out.heading = prev.heading + turn * alpha;
  out.steer = prev.steer + (car.steer - prev.steer) * alpha;
  return out;
}
