import type { Point } from './trackPath';

// Where things go on the mini map. The map is turned to match the camera, so what is up the screen in
// the game is up the map too and turning a corner looks the same on both.

export interface MapSize {
  width: number;
  height: number;
  /** Space kept clear round the track, in the same units as the size. */
  pad: number;
}

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapView {
  /** Where a world point lands on the map, in the size's units. */
  project(x: number, z: number): MapPoint;
  /** Map units per metre. */
  scale: number;
}

/**
 * Fits the points on a map of this size, as large as they'll go without stretching, and centred.
 * `forward` is the world direction that points up the map.
 */
export function fitMap(points: Point[], size: MapSize, forward: Point): MapView {
  // Right of forward on the ground, so a point to the right of the view lands to the right of the map.
  const rightX = -forward.z;
  const rightZ = forward.x;
  const across = (x: number, z: number) => x * rightX + z * rightZ;
  const along = (x: number, z: number) => x * forward.x + z * forward.z;

  const us = points.map((p) => across(p.x, p.z));
  const vs = points.map((p) => along(p.x, p.z));
  const minU = Math.min(...us);
  const maxU = Math.max(...us);
  const minV = Math.min(...vs);
  const maxV = Math.max(...vs);
  const scale = Math.min((size.width - 2 * size.pad) / (maxU - minU || 1), (size.height - 2 * size.pad) / (maxV - minV || 1));
  const centreU = (minU + maxU) / 2;
  const centreV = (minV + maxV) / 2;

  return {
    scale,
    project: (x, z) => ({
      x: size.width / 2 + (across(x, z) - centreU) * scale,
      // Screen y grows downwards, so further along the view is smaller y.
      y: size.height / 2 - (along(x, z) - centreV) * scale,
    }),
  };
}
