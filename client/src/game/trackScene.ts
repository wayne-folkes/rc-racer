import {
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  RepeatWrapping,
} from 'three';
import type { TrackPath } from './trackPath';

const WALL_HEIGHT = 0.7;
const WALL_THICKNESS = 0.6;
const CURB_WIDTH = 0.9;

/** Builds the ground, road, curbs, walls, start line and scenery for a track. */
export function buildTrackScene(track: TrackPath): Group {
  const group = new Group();

  const ground = new Mesh(
    new PlaneGeometry(600, 600),
    new MeshStandardMaterial({ color: '#6fbf5a', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const hw = track.halfWidth;
  group.add(ribbon(track, -hw, hw, 0.01, new MeshStandardMaterial({ color: '#4a4f5a', roughness: 0.95 })));

  const curbMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  group.add(ribbon(track, -hw, -hw + CURB_WIDTH, 0.02, curbMat, true));
  group.add(ribbon(track, hw - CURB_WIDTH, hw, 0.02, curbMat, true));

  const wallMat = new MeshStandardMaterial({ color: '#f1f1f1', flatShading: true, roughness: 0.7 });
  group.add(wall(track, -hw - WALL_THICKNESS, -hw, wallMat));
  group.add(wall(track, hw, hw + WALL_THICKNESS, wallMat));

  group.add(startLine(track));
  group.add(trees(track));
  return group;
}

function offsetPoint(track: TrackPath, i: number, offset: number) {
  const p = track.points[i];
  const t = track.tangent(i);
  // Right of travel is (-tz, tx).
  return { x: p.x - t.z * offset, z: p.z + t.x * offset };
}

/** A flat strip between two lateral offsets, optionally striped red/white per few segments. */
function ribbon(track: TrackPath, from: number, to: number, y: number, mat: MeshStandardMaterial, striped = false) {
  const n = track.points.length;
  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = offsetPoint(track, i, from);
    const a1 = offsetPoint(track, i, to);
    const b0 = offsetPoint(track, j, from);
    const b1 = offsetPoint(track, j, to);
    // Winding chosen so the faces point up (+Y).
    positions.push(a0.x, y, a0.z, a1.x, y, a1.z, b0.x, y, b0.z);
    positions.push(b0.x, y, b0.z, a1.x, y, a1.z, b1.x, y, b1.z);
    if (striped) {
      const [r, g, b] = Math.floor(i / 3) % 2 === 0 ? [0.85, 0.15, 0.15] : [0.95, 0.95, 0.95];
      for (let k = 0; k < 6; k++) colors.push(r, g, b);
    }
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
  if (striped) geom.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  const mesh = new Mesh(geom, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** A low barrier between two lateral offsets: inner face, top and outer face. */
function wall(track: TrackPath, from: number, to: number, mat: MeshStandardMaterial) {
  const n = track.points.length;
  const positions: number[] = [];
  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
  ) => positions.push(...a, ...b, ...c, ...c, ...b, ...d);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ai = offsetPoint(track, i, from);
    const ao = offsetPoint(track, i, to);
    const bi = offsetPoint(track, j, from);
    const bo = offsetPoint(track, j, to);
    const h = WALL_HEIGHT;
    quad([ai.x, 0, ai.z], [ai.x, h, ai.z], [bi.x, 0, bi.z], [bi.x, h, bi.z]);
    quad([ai.x, h, ai.z], [ao.x, h, ao.z], [bi.x, h, bi.z], [bo.x, h, bo.z]);
    quad([ao.x, h, ao.z], [ao.x, 0, ao.z], [bo.x, h, bo.z], [bo.x, 0, bo.z]);
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  mat.side = DoubleSide; // The inner and outer faces wind in opposite directions.
  const mesh = new Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function startLine(track: TrackPath) {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 8; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#111111';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  // Two squares along the direction of travel, repeating across the road.
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(1, track.halfWidth / 4);

  const mesh = new Mesh(
    new PlaneGeometry(1.4, track.halfWidth * 2),
    new MeshStandardMaterial({ map: tex, roughness: 0.9 }),
  );
  const p = track.points[0];
  const t = track.tangent(0);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -Math.atan2(t.z, t.x);
  mesh.position.set(p.x, 0.03, p.z);
  mesh.receiveShadow = true;
  return mesh;
}

/** Deterministic pseudo-random scenery so the track looks the same every load. */
function trees(track: TrackPath) {
  const group = new Group();
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const trunkGeom = new CylinderGeometry(0.25, 0.3, 1.2, 6);
  const leafGeom = new ConeGeometry(1.4, 3, 7);
  const trunkMat = new MeshStandardMaterial({ color: '#7a5230', flatShading: true });
  const leafMats = ['#2f8f46', '#3aa356', '#27753a'].map(
    (color) => new MeshStandardMaterial({ color, flatShading: true }),
  );

  let placed = 0;
  for (let attempt = 0; attempt < 2000 && placed < 140; attempt++) {
    const x = (rand() - 0.5) * 220;
    const z = (rand() - 0.5) * 190 + 10;
    if (Math.abs(track.project(x, z).lateral) < track.halfWidth + 4) continue;

    const tree = new Group();
    const s = 0.7 + rand() * 0.7;
    const trunk = new Mesh(trunkGeom, trunkMat);
    trunk.position.y = 0.6;
    const leaves = new Mesh(leafGeom, leafMats[Math.floor(rand() * leafMats.length)]);
    leaves.position.y = 2.6;
    trunk.castShadow = leaves.castShadow = true;
    tree.add(trunk, leaves);
    tree.scale.setScalar(s);
    tree.position.set(x, 0, z);
    tree.rotation.y = rand() * Math.PI;
    group.add(tree);
    placed++;
  }
  return group;
}
