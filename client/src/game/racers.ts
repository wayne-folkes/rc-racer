import { createCar, type CarState } from './carPhysics';
import type { AiSkill } from './aiDriver';
import type { TrackPath } from './trackPath';

export interface RacerInfo {
  name: string;
  color: string;
  /** Grid slot: 0 is pole position, at the front. */
  gridSlot: number;
}

export interface Opponent extends RacerInfo {
  skill: AiSkill;
}

/** The player starts at the back of the grid and has to fight through. */
export const PLAYER: RacerInfo = { name: 'You', color: '#e63946', gridSlot: 3 };

export const OPPONENTS: Opponent[] = [
  { name: 'Blue', color: '#3b82f6', gridSlot: 0, skill: { pace: 0.92, steerGain: 2.6 } },
  { name: 'Yellow', color: '#facc15', gridSlot: 1, skill: { pace: 0.88, steerGain: 2.3 } },
  { name: 'Green', color: '#22c55e', gridSlot: 2, skill: { pace: 0.84, steerGain: 2.0 } },
];

/** Distance behind the finish line of pole position, and between grid rows. */
const GRID_FRONT = 5;
const GRID_ROW_GAP = 3.5;
/** Grid slots alternate left and right of the centreline by this much. */
const GRID_SIDE = 2;

/** A car on the starting grid, staggered two abreast behind the line. */
export function gridPosition(track: TrackPath, slot: number): CarState {
  const p = track.pointAt(track.length - GRID_FRONT - slot * GRID_ROW_GAP);
  const side = slot % 2 === 0 ? -GRID_SIDE : GRID_SIDE;
  return createCar(p.x - p.tz * side, p.z + p.tx * side, Math.atan2(p.tz, p.tx));
}
