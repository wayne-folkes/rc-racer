import { fitMap, type MapView } from '../game/minimapLayout';
import { VIEW_FORWARD } from '../game/followCamera';
import type { TrackPath } from '../game/trackPath';

// A small map of the track in the corner of the screen, with every car on it. The track is drawn once
// per race and the cars are drawn over it each frame. Whether it shows at all is up to the stylesheet:
// it's for big screens with a mouse, not phones.

/** Size on screen in CSS pixels. */
const WIDTH = 220;
const HEIGHT = 170;
const PAD = 14;
const ROAD_MIN = 4;
const OUTLINE = 2;
const DOT = 3.6;
const PLAYER_DOT = 5;

export interface MapCar {
  x: number;
  z: number;
  color: string;
}

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base = document.createElement('canvas');
  private readonly ratio: number;
  private view: MapView | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    // Drawn at the screen's pixel density so the lines stay sharp.
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    for (const surface of [canvas, this.base]) {
      surface.width = Math.round(WIDTH * ratio);
      surface.height = Math.round(HEIGHT * ratio);
    }
    canvas.style.width = `${WIDTH}px`;
    canvas.style.height = `${HEIGHT}px`;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(ratio, ratio);
    this.ratio = ratio;
  }

  /** Draws the road and start line for a new race. */
  setTrack(track: TrackPath): void {
    const view = fitMap(track.points, { width: WIDTH, height: HEIGHT, pad: PAD }, VIEW_FORWARD);
    this.view = view;

    const ctx = this.base.getContext('2d')!;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const outline = new Path2D();
    track.points.forEach((p, i) => {
      const { x, y } = view.project(p.x, p.z);
      if (i === 0) outline.moveTo(x, y);
      else outline.lineTo(x, y);
    });
    outline.closePath();

    // A pale edge, then the dark road inside it.
    const width = Math.max(ROAD_MIN, track.halfWidth * 2 * view.scale);
    ctx.strokeStyle = 'rgb(226 232 240 / 0.9)';
    ctx.lineWidth = width + 2 * OUTLINE;
    ctx.stroke(outline);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = width;
    ctx.stroke(outline);

    // The start line, across the road.
    const start = track.pointAt(0);
    const a = view.project(start.x - start.tz * track.halfWidth, start.z + start.tx * track.halfWidth);
    const b = view.project(start.x + start.tz * track.halfWidth, start.z - start.tx * track.halfWidth);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  /** Draws the cars over the road. The first car is the player's, and is drawn last, on top and larger. */
  update(cars: MapCar[]): void {
    const view = this.view;
    if (!view) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);

    for (let i = cars.length - 1; i >= 0; i--) {
      const { x, y } = view.project(cars[i].x, cars[i].z);
      const you = i === 0;
      ctx.beginPath();
      ctx.arc(x, y, you ? PLAYER_DOT : DOT, 0, Math.PI * 2);
      ctx.fillStyle = cars[i].color;
      ctx.fill();
      ctx.lineWidth = you ? 2 : 1.5;
      ctx.strokeStyle = you ? '#ffffff' : '#0f172a';
      ctx.stroke();
    }
  }
}
