import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { RAMP_HEIGHT, RAMP_LENGTH, type Ramp } from './jumps';

// Draws the ramps the simulation uses (see jumps.ts): a wedge per ramp, with hazard chevrons on top.

type Vertex = [number, number, number];

/** Yellow and black diagonal stripes, one tile per metre so the pattern reads the same on any ramp. */
function hazardTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#1d1d1d';
  ctx.lineWidth = size / 6;
  // Diagonal black bands. Lines a tile to each side fill in where they cross the edges, so the tile wraps cleanly.
  for (const x of [-size, -size / 2, 0, size / 2, size]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + size, size);
    ctx.stroke();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}

/** A triangle soup with UVs in metres, so the hazard texture tiles once per metre. */
function triangles(list: Vertex[][], width: number): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const tri of list) {
    for (const [x, y, z] of tri) {
      positions.push(x, y, z);
      uvs.push(x + RAMP_LENGTH / 2, z + width / 2);
    }
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * One wedge in its own space: the foot on the ground at x = -L/2, the lip at x = +L/2 and RAMP_HEIGHT
 * high, and the width across z. The underside sits on the road and is never seen, so it isn't built.
 */
function wedge(width: number): { top: BufferGeometry; sides: BufferGeometry } {
  const h = RAMP_LENGTH / 2;
  const w = width / 2;
  // "Minus" and "plus" are the two edges of the road, not left and right of travel.
  const footMinus: Vertex = [-h, 0, -w];
  const footPlus: Vertex = [-h, 0, w];
  const lipMinus: Vertex = [h, RAMP_HEIGHT, -w];
  const lipPlus: Vertex = [h, RAMP_HEIGHT, w];
  const groundMinus: Vertex = [h, 0, -w];
  const groundPlus: Vertex = [h, 0, w];

  const top = triangles(
    [
      [footMinus, lipPlus, lipMinus],
      [footMinus, footPlus, lipPlus],
    ],
    width,
  );
  const sides = triangles(
    [
      // The two sloping-edge triangles, then the vertical back face at the lip.
      [footMinus, lipMinus, groundMinus],
      [footPlus, groundPlus, lipPlus],
      [groundMinus, lipPlus, groundPlus],
      [groundMinus, lipMinus, lipPlus],
    ],
    width,
  );
  return { top, sides };
}

/** The ramps across the road: a sturdy wedge per ramp, hazard-striped on top, sitting where the sim puts it. */
export function buildRamps(ramps: Ramp[]): Group {
  const group = new Group();
  const topMat = new MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7, flatShading: true });
  const sideMat = new MeshStandardMaterial({ color: '#7a4f2a', roughness: 0.9, flatShading: true });

  for (const ramp of ramps) {
    const { top, sides } = wedge(ramp.width);
    const root = new Group();
    root.position.set(ramp.x, 0, ramp.z);
    // Built along +X with the foot behind the middle, then turned to the heading. Three's Y rotation
    // runs the opposite way to the game's heading (see carModel.ts).
    root.rotation.y = -ramp.heading;

    const topMesh = new Mesh(top, topMat);
    const sideMesh = new Mesh(sides, sideMat);
    topMesh.castShadow = sideMesh.castShadow = true;
    topMesh.receiveShadow = sideMesh.receiveShadow = true;
    root.add(topMesh, sideMesh);
    group.add(root);
  }
  return group;
}
