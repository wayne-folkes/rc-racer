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
