import { describe, expect, it } from 'vitest';
import { VIEW_FORWARD } from './followCamera';
import { fitMap } from './minimapLayout';
import { TrackPath } from './trackPath';
import { ALL_TRACKS } from './tracks';

const SIZE = { width: 220, height: 170, pad: 14 };

describe.each(ALL_TRACKS.filter((t) => !t.reversed))('mini map of $name', (def) => {
  const track = new TrackPath(def.controlPoints, def.halfWidth);
  const view = fitMap(track.points, SIZE, VIEW_FORWARD);

  it('keeps the whole track on the map, clear of the edge', () => {
    for (const p of track.points) {
      const { x, y } = view.project(p.x, p.z);
      expect(x).toBeGreaterThanOrEqual(SIZE.pad - 1e-6);
      expect(x).toBeLessThanOrEqual(SIZE.width - SIZE.pad + 1e-6);
      expect(y).toBeGreaterThanOrEqual(SIZE.pad - 1e-6);
      expect(y).toBeLessThanOrEqual(SIZE.height - SIZE.pad + 1e-6);
    }
  });

  it('fills the map along at least one side', () => {
    const xs = track.points.map((p) => view.project(p.x, p.z).x);
    const ys = track.points.map((p) => view.project(p.x, p.z).y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    expect(Math.max(spanX / (SIZE.width - 2 * SIZE.pad), spanY / (SIZE.height - 2 * SIZE.pad))).toBeCloseTo(1, 6);
  });
});

describe('fitMap', () => {
  const square = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
  ];

  it('puts what is ahead of the camera up the map, and what is to its right on the right', () => {
    const view = fitMap(square, SIZE, VIEW_FORWARD);
    const origin = view.project(5, 5);
    const ahead = view.project(5 + VIEW_FORWARD.x, 5 + VIEW_FORWARD.z);
    expect(ahead.y).toBeLessThan(origin.y);
    expect(ahead.x).toBeCloseTo(origin.x, 6);
    const right = view.project(5 - VIEW_FORWARD.z, 5 + VIEW_FORWARD.x);
    expect(right.x).toBeGreaterThan(origin.x);
    expect(right.y).toBeCloseTo(origin.y, 6);
  });

  it('does not stretch: a metre is the same length either way', () => {
    const view = fitMap(square, SIZE, { x: 0, z: -1 });
    const a = view.project(0, 0);
    const across = view.project(1, 0);
    const along = view.project(0, -1);
    expect(Math.hypot(across.x - a.x, across.y - a.y)).toBeCloseTo(view.scale, 6);
    expect(Math.hypot(along.x - a.x, along.y - a.y)).toBeCloseTo(view.scale, 6);
  });
});
