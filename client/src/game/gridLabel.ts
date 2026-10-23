import { CanvasTexture, Sprite, SpriteMaterial } from 'three';

// A floating "4TH" over the player's car on the grid, like the "1ST" on RC Pro-Am's start screen: it
// says where you'll start from, and it's shown until the lights go out.

/** How far above the car the label floats (m): clear of the tallest vehicle. */
const LABEL_HEIGHT = 2.9;
/** Its width in the world (m); the canvas is twice as wide as it is tall. */
const LABEL_WIDTH = 4;
const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif';

/** Builds the label for a place such as "4th". Hidden until the game shows it. */
export function buildGridLabel(place: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const [, digits = place, suffix = ''] = /^(\d+)(.*)$/.exec(place) ?? [];

  // The number big, with its ending smaller beside it, both centred.
  ctx.textBaseline = 'alphabetic';
  ctx.font = `900 92px ${FONT}`;
  const digitsWidth = ctx.measureText(digits).width;
  ctx.font = `900 50px ${FONT}`;
  const suffixWidth = ctx.measureText(suffix.toUpperCase()).width;
  const left = (canvas.width - digitsWidth - suffixWidth - 4) / 2;
  const baseline = 98;

  ctx.lineJoin = 'round';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#020617';
  ctx.fillStyle = '#f8fafc';
  ctx.font = `900 92px ${FONT}`;
  ctx.strokeText(digits, left, baseline);
  ctx.fillText(digits, left, baseline);
  ctx.font = `900 50px ${FONT}`;
  ctx.strokeText(suffix.toUpperCase(), left + digitsWidth + 4, baseline);
  ctx.fillText(suffix.toUpperCase(), left + digitsWidth + 4, baseline);

  const label = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), transparent: true, depthTest: false }));
  label.scale.set(LABEL_WIDTH, LABEL_WIDTH / 2, 1);
  label.position.set(0, LABEL_HEIGHT, 0);
  // Drawn after everything else, so a tall truck or a tree can't hide it.
  label.renderOrder = 10;
  label.visible = false;
  return label;
}
