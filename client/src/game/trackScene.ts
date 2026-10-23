import {
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  Texture,
} from 'three';
import { seededRandom } from './items';
import { gridPosition, OPPONENTS, PLAYER, SLOT_LENGTH, SLOT_WIDTH } from './racers';
import type { Point, TrackPath } from './trackPath';
import type { TrackTheme } from './tracks';

const WALL_HEIGHT = 0.7;
const WALL_THICKNESS = 0.6;
const CURB_WIDTH = 0.9;
/** Scenery is scattered this far beyond the track's bounding box. */
const SCENERY_MARGIN = 30;
/** Scenery keeps this far clear of the road's edge. */
const SCENERY_CLEARANCE = 4;
const SCENERY_SEED = 7;
const POND_Y = 0.012;
/** Ponds keep this far clear of the road's edge, measured from the pond's edge. */
const POND_CLEARANCE = 6;
const POND_SPACING = 14;

/** Builds the ground, road, curbs, walls, start line and scenery for a track, in the theme's colours. */
export function buildTrackScene(track: TrackPath, theme: TrackTheme): Group {
  const group = new Group();

  const ground = new Mesh(
    new PlaneGeometry(600, 600),
    new MeshStandardMaterial({ color: theme.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const hw = track.halfWidth;
  group.add(ribbon(track, -hw, hw, 0.01, new MeshStandardMaterial({ color: theme.road, roughness: 0.95 })));

  const curbMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  group.add(ribbon(track, -hw, -hw + CURB_WIDTH, 0.02, curbMat, true));
  group.add(ribbon(track, hw - CURB_WIDTH, hw, 0.02, curbMat, true));

  const wallMat = new MeshStandardMaterial({ color: '#f1f1f1', flatShading: true, roughness: 0.7 });
  group.add(wall(track, -hw - WALL_THICKNESS, -hw, wallMat));
  group.add(wall(track, hw, hw + WALL_THICKNESS, wallMat));

  group.add(startLine(track));
  group.add(gridSlots(track));
  group.add(scenery(track, theme));
  return group;
}

/** Frees the geometries, materials and textures under an object. Call it before dropping a scene. */
export function disposeScene(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of [object.material].flat() as Material[]) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) value.dispose();
      }
      material.dispose();
    }
  });
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

/** Pale diagonal hatching inside a solid border, translucent so it shows on every theme's dark road. */
function slotTexture(): CanvasTexture {
  // Pixels per metre are the same both ways, so the hatching stays at 45 degrees on the road.
  const w = 128;
  const h = Math.round((w * SLOT_WIDTH) / SLOT_LENGTH);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(235, 240, 250, 0.12)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(235, 240, 250, 0.45)';
  ctx.lineWidth = 8;
  for (let d = -h; d < w; d += 20) {
    ctx.beginPath();
    ctx.moveTo(d, h);
    ctx.lineTo(d + h, 0);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(235, 240, 250, 0.85)';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  return new CanvasTexture(canvas);
}

/**
 * The hatched pad each car starts on, like RC Pro-Am's grid. Each sits where gridPosition() puts its car,
 * so the pads and the cars can't drift apart.
 */
function gridSlots(track: TrackPath): Group {
  const group = new Group();
  const geometry = new PlaneGeometry(SLOT_LENGTH, SLOT_WIDTH);
  const material = new MeshStandardMaterial({
    map: slotTexture(),
    transparent: true,
    roughness: 0.95,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  for (const racer of [PLAYER, ...OPPONENTS]) {
    const { x, z, heading } = gridPosition(track, racer.gridSlot);
    const pad = new Mesh(geometry, material);
    // Flat on the road, with the pad's length along the direction of travel (as the start line does).
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = -heading;
    pad.position.set(x, 0.02, z);
    pad.receiveShadow = true;
    group.add(pad);
  }
  return group;
}

/** The theme's scenery, plus ponds if the theme has them. Deterministic, so a track looks the same every load. */
function scenery(track: TrackPath, theme: TrackTheme): Group {
  const group = new Group();
  const rand = seededRandom(SCENERY_SEED);
  const make = { trees, cacti, pines }[theme.scenery];
  group.add(make(track, rand));
  if (theme.ponds) group.add(ponds(track, rand));
  return group;
}

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The track's bounding box, grown by the scenery margin on every side. */
function sceneryBox(track: TrackPath): Box {
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of track.points) {
    box.minX = Math.min(box.minX, p.x);
    box.maxX = Math.max(box.maxX, p.x);
    box.minZ = Math.min(box.minZ, p.z);
    box.maxZ = Math.max(box.maxZ, p.z);
  }
  return {
    minX: box.minX - SCENERY_MARGIN,
    maxX: box.maxX + SCENERY_MARGIN,
    minZ: box.minZ - SCENERY_MARGIN,
    maxZ: box.maxZ + SCENERY_MARGIN,
  };
}

/** Scatters up to `count` objects in the scenery box, skipping spots on or near the road. */
function scatter(track: TrackPath, rand: () => number, count: number, make: () => Object3D): Group {
  const group = new Group();
  const box = sceneryBox(track);
  for (let attempt = 0; attempt < 2000 && group.children.length < count; attempt++) {
    const x = box.minX + rand() * (box.maxX - box.minX);
    const z = box.minZ + rand() * (box.maxZ - box.minZ);
    if (Math.abs(track.project(x, z).lateral) < track.halfWidth + SCENERY_CLEARANCE) continue;

    const object = make();
    object.position.set(x, 0, z);
    object.rotation.y = rand() * Math.PI * 2;
    group.add(object);
  }
  return group;
}

function trees(track: TrackPath, rand: () => number): Group {
  const trunkGeom = new CylinderGeometry(0.25, 0.3, 1.2, 6);
  const leafGeom = new ConeGeometry(1.4, 3, 7);
  const trunkMat = new MeshStandardMaterial({ color: '#7a5230', flatShading: true });
  const leafMats = ['#2f8f46', '#3aa356', '#27753a'].map(
    (color) => new MeshStandardMaterial({ color, flatShading: true }),
  );

  return scatter(track, rand, 140, () => {
    const tree = new Group();
    const s = 0.7 + rand() * 0.7;
    const trunk = new Mesh(trunkGeom, trunkMat);
    trunk.position.y = 0.6;
    const leaves = new Mesh(leafGeom, leafMats[Math.floor(rand() * leafMats.length)]);
    leaves.position.y = 2.6;
    trunk.castShadow = leaves.castShadow = true;
    tree.add(trunk, leaves);
    tree.scale.setScalar(s);
    return tree;
  });
}

/** Low-poly saguaros with a sandy rock now and then. */
function cacti(track: TrackPath, rand: () => number): Group {
  const cactusMat = new MeshStandardMaterial({ color: '#4f8f3a', flatShading: true, roughness: 0.8 });
  const rockMat = new MeshStandardMaterial({ color: '#c49a6c', flatShading: true, roughness: 0.95 });
  const trunkGeom = new CylinderGeometry(0.22, 0.26, 2.6, 7);
  // Arms run out along X from the trunk, then turn up.
  const acrossGeom = new CylinderGeometry(0.13, 0.13, 0.6, 6);
  acrossGeom.rotateZ(Math.PI / 2);
  const upGeom = new CylinderGeometry(0.13, 0.13, 0.9, 6);
  const rockGeom = new DodecahedronGeometry(0.5, 0);

  const arm = (side: number, y: number) => {
    const group = new Group();
    const across = new Mesh(acrossGeom, cactusMat);
    across.position.set(side * 0.42, y, 0);
    const up = new Mesh(upGeom, cactusMat);
    up.position.set(side * 0.72, y + 0.45, 0);
    across.castShadow = up.castShadow = true;
    group.add(across, up);
    return group;
  };

  const cactus = () => {
    const group = new Group();
    const trunk = new Mesh(trunkGeom, cactusMat);
    trunk.position.y = 1.3;
    trunk.castShadow = true;
    group.add(trunk);
    const arms = 1 + Math.floor(rand() * 2);
    const first = rand() < 0.5 ? -1 : 1;
    for (let i = 0; i < arms; i++) {
      group.add(arm(i === 0 ? first : -first, 0.9 + rand() * 0.6));
    }
    group.scale.setScalar(0.8 + rand() * 0.5);
    return group;
  };

  const rock = () => {
    const mesh = new Mesh(rockGeom, rockMat);
    const s = 0.6 + rand() * 0.8;
    mesh.scale.set(s, s * 0.55, s * 0.8);
    mesh.position.y = 0.15 * s;
    mesh.castShadow = true;
    return mesh;
  };

  return scatter(track, rand, 120, () => (rand() < 0.2 ? rock() : cactus()));
}

/** Dark-green stacked cones, each tier narrower than the one below, with a snow cap on top. */
function pines(track: TrackPath, rand: () => number): Group {
  const needleMat = new MeshStandardMaterial({ color: '#1f5a3a', flatShading: true, roughness: 0.9 });
  const snowMat = new MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.6 });
  const tiers: [ConeGeometry, number][] = [
    [new ConeGeometry(1.5, 2.2, 7), 1.1],
    [new ConeGeometry(1.1, 1.8, 7), 2.4],
    [new ConeGeometry(0.7, 1.4, 7), 3.3],
  ];
  const capGeom = new ConeGeometry(0.26, 0.44, 7);

  return scatter(track, rand, 120, () => {
    const tree = new Group();
    for (const [geom, y] of tiers) {
      const tier = new Mesh(geom, needleMat);
      tier.position.y = y;
      tier.castShadow = true;
      tree.add(tier);
    }
    const cap = new Mesh(capGeom, snowMat);
    cap.position.y = 3.78;
    tree.add(cap);
    tree.scale.setScalar(0.8 + rand() * 0.6);
    return tree;
  });
}

/** Whether a point lies inside the closed loop of track points (even-odd ray cast). */
function insideLoop(points: Point[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Flat, irregular light-blue ponds: some in the infield, some outside the loop. */
function ponds(track: TrackPath, rand: () => number): Group {
  const group = new Group();
  const mat = new MeshStandardMaterial({ color: '#7dc8ef', roughness: 0.15, metalness: 0.1 });
  const box = sceneryBox(track);
  const centres: Point[] = [];

  // Infield ponds first, so there's always a chance of one even on a tight loop.
  const place = (infield: boolean, wanted: number) => {
    let found = 0;
    for (let attempt = 0; attempt < 4000 && found < wanted; attempt++) {
      const x = box.minX + rand() * (box.maxX - box.minX);
      const z = box.minZ + rand() * (box.maxZ - box.minZ);
      if (insideLoop(track.points, x, z) !== infield) continue;
      const radius = 2 + rand() * 1.5;
      if (Math.abs(track.project(x, z).lateral) < track.halfWidth + POND_CLEARANCE + radius) continue;
      if (centres.some((c) => Math.hypot(c.x - x, c.z - z) < POND_SPACING)) continue;

      centres.push({ x, z });
      group.add(pond(rand, mat, radius, x, z));
      found++;
    }
  };
  place(true, 3);
  place(false, 3);
  return group;
}

/** One pond: a jittered polygon lying flat on the ground. */
function pond(rand: () => number, mat: MeshStandardMaterial, radius: number, x: number, z: number): Mesh {
  const sides = 12;
  const shape = new Shape();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const r = radius * (0.8 + rand() * 0.3);
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const geom = new ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geom, mat);
  mesh.position.set(x, POND_Y, z);
  mesh.receiveShadow = true;
  return mesh;
}
