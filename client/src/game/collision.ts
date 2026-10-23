import type { CarState } from './carPhysics';
import type { Projection, TrackPath } from './trackPath';

export const CAR_RADIUS = 0.9;
/** Share of the into-wall speed that bounces back out. */
const RESTITUTION = 0.35;
/** Share of the along-wall speed kept when scraping a wall. */
const SCRAPE_KEEP = 0.9;

/**
 * Keeps the car between the walls on either side of the track. Returns the projection of the
 * car's final position and whether it hit a wall.
 */
export function collideWithWalls(car: CarState, track: TrackPath): { proj: Projection; hit: boolean } {
  let proj = track.project(car.x, car.z);
  const limit = track.halfWidth - CAR_RADIUS;
  const overlap = Math.abs(proj.lateral) - limit;
  if (overlap <= 0) return { proj, hit: false };

  const side = Math.sign(proj.lateral);
  // Outward normal of the wall being hit.
  const nx = -proj.tz * side;
  const nz = proj.tx * side;
  car.x -= nx * overlap;
  car.z -= nz * overlap;

  const into = car.vx * nx + car.vz * nz;
  if (into > 0) {
    const tx = car.vx - into * nx;
    const tz = car.vz - into * nz;
    car.vx = tx * SCRAPE_KEEP - into * RESTITUTION * nx;
    car.vz = tz * SCRAPE_KEEP - into * RESTITUTION * nz;
  }

  proj = track.project(car.x, car.z);
  return { proj, hit: into > 0 };
}

/** Centre-to-centre distance at which two cars touch. Cars are treated as equal-mass circles. */
export const CAR_SPACING = 2;
const CAR_RESTITUTION = 0.3;
/** Cars further apart in height than this don't touch. */
const CAR_HEIGHT = 0.8;

/** Separates two overlapping cars and bounces them apart. Returns whether they touched. */
export function collideCars(a: CarState, b: CarState): boolean {
  // A car in the air passes over one on the ground.
  if (Math.abs(a.y - b.y) > CAR_HEIGHT) return false;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist >= CAR_SPACING || dist === 0) return false;

  const nx = dx / dist;
  const nz = dz / dist;
  const push = (CAR_SPACING - dist) / 2;
  a.x -= nx * push;
  a.z -= nz * push;
  b.x += nx * push;
  b.z += nz * push;

  // Closing speed along the line between them; only bounce if they're moving together.
  const closing = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (closing < 0) {
    const j = (-(1 + CAR_RESTITUTION) * closing) / 2;
    a.vx -= j * nx;
    a.vz -= j * nz;
    b.vx += j * nx;
    b.vz += j * nz;
  }
  return true;
}
