import { DEMO_LAYOUT, pickupRow, type TrackLayout } from './items';
import { DEMO_TRACK, type Point } from './trackPath';

// The season's tracks, in race order. Each must pass tracks.test.ts: no corner tighter than the
// road is wide, hazards only where the racing line is steady enough to steer round them, and a
// full AI race with nobody getting stuck.

export type Scenery = 'trees' | 'cacti' | 'pines';
/** Ambient effects drawn over the track. Purely visual: they don't touch the cars. */
export type Weather = 'snow' | 'tumbleweeds';

export interface TrackTheme {
  sky: string;
  ground: string;
  road: string;
  scenery: Scenery;
  /** Small ponds dotted around the infield and outside the track. */
  ponds?: boolean;
  weather?: Weather;
}

export interface TrackDef {
  id: string;
  name: string;
  halfWidth: number;
  controlPoints: Point[];
  layout: TrackLayout;
  theme: TrackTheme;
}

const pts = (coords: number[][]): Point[] => coords.map(([x, z]) => ({ x, z }));

export const TRACKS: TrackDef[] = [
  {
    id: 'demo',
    name: 'Meadow Loop',
    halfWidth: 5.5,
    controlPoints: DEMO_TRACK,
    layout: DEMO_LAYOUT,
    theme: { sky: '#8fc7e8', ground: '#6fbf5a', road: '#4a4f5a', scenery: 'trees' },
  },
  {
    id: 'desert',
    name: 'Desert Dash',
    // Wide and fast: long straights joined by sweeping hairpins.
    halfWidth: 6.5,
    controlPoints: pts([
      [-60, -40], [-20, -42], [20, -42], [58, -40], [80, -26], [86, -4], [78, 16], [56, 22],
      [30, 18], [4, 26], [-26, 34], [-58, 36], [-80, 24], [-86, 0], [-80, -24],
    ]),
    layout: {
      hazards: [
        { kind: 'puddle', at: 0.2, lateral: -2.2, radius: 2.4 },
        { kind: 'oil', at: 0.36, lateral: 3.6, radius: 1.6 },
        { kind: 'puddle', at: 0.86, lateral: -1.5, radius: 2.2 },
      ],
      pickups: [...pickupRow(0.12, ['missile', 'bomb', 'missile']), ...pickupRow(0.66, ['bomb', 'missile', 'bomb'])],
      boostPads: [
        { at: 0.04, lateral: -2.4 },
        { at: 0.72, lateral: -2 },
        { at: 0.92, lateral: 3.8 },
      ],
      // Over the top-straight puddle, and straight after a boost pad for a big one.
      ramps: [{ at: 0.175 }, { at: 0.77 }],
    },
    theme: { sky: '#f2d3a0', ground: '#e0c08a', road: '#5a5048', scenery: 'cacti', weather: 'tumbleweeds' },
  },
  {
    id: 'lakeside',
    name: 'Lakeside Snake',
    // A long serpentine: three straights linked by tight U-turns, with plenty of puddles.
    halfWidth: 5.5,
    controlPoints: pts([
      [-60, -42], [-10, -44], [40, -40], [62, -28], [58, -10], [36, -4], [0, -4], [-30, -2],
      [-46, 10], [-40, 26], [-14, 30], [30, 28], [56, 36], [62, 52], [46, 64], [0, 66],
      [-44, 64], [-70, 50], [-78, 20], [-76, -14], [-72, -34],
    ]),
    layout: {
      hazards: [
        { kind: 'puddle', at: 0.12, lateral: -2, radius: 2.2 },
        { kind: 'puddle', at: 0.33, lateral: 1.6, radius: 2 },
        { kind: 'oil', at: 0.54, lateral: -1.8, radius: 1.6 },
        { kind: 'puddle', at: 0.76, lateral: 2.6, radius: 2 },
        { kind: 'oil', at: 0.86, lateral: -1.4, radius: 1.6 },
      ],
      pickups: [...pickupRow(0.08, ['missile', 'bomb', 'missile']), ...pickupRow(0.5, ['bomb', 'missile', 'bomb'])],
      boostPads: [
        { at: 0.28, lateral: -2.2 },
        { at: 0.7, lateral: -2.3 },
        { at: 0.9, lateral: 3 },
      ],
      ramps: [{ at: 0.1 }, { at: 0.72 }],
    },
    theme: { sky: '#9fd4ef', ground: '#7cc36b', road: '#4a4f5a', scenery: 'trees', ponds: true },
  },
  {
    id: 'snow',
    name: 'Snow Peak',
    // Narrow and technical, with a hairpin that doubles back into the infield.
    halfWidth: 5,
    controlPoints: pts([
      [-50, -40], [-10, -44], [28, -40], [48, -24], [42, -6], [22, -2], [8, 6], [6, 18],
      [18, 27], [44, 26], [60, 38], [60, 54], [42, 63], [16, 62], [-6, 50], [-20, 32],
      [-36, 30], [-50, 38], [-66, 40], [-76, 26], [-72, 2], [-62, -24],
    ]),
    layout: {
      hazards: [
        { kind: 'oil', at: 0.16, lateral: 3, radius: 1.4 },
        { kind: 'puddle', at: 0.645, lateral: -2.2, radius: 1.8 },
        { kind: 'oil', at: 0.88, lateral: -1.8, radius: 1.4 },
      ],
      pickups: [...pickupRow(0.08, ['missile', 'bomb', 'missile']), ...pickupRow(0.62, ['bomb', 'missile', 'bomb'])],
      boostPads: [
        { at: 0.12, lateral: -2.4 },
        { at: 0.58, lateral: -1.6 },
        { at: 0.92, lateral: 2.8 },
      ],
      // Snow Peak's one proper straight; land short and you're on the ice.
      ramps: [{ at: 0.135 }],
    },
    theme: { sky: '#c9dbe9', ground: '#eef3f7', road: '#59616e', scenery: 'pines', weather: 'snow' },
  },
];
