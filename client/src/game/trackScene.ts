import {
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
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
  RingGeometry,
  Shape,
  ShapeGeometry,
  Sprite,
  Texture,
} from 'three';
import { seededRandom } from './items';
import { gridPosition, OPPONENTS, PLAYER, SLOT_LENGTH, SLOT_WIDTH, START_LINE_DEPTH } from './racers';
import type { Point, TrackPath } from './trackPath';
import type { PondStyle, TrackTheme } from './tracks';

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
    // Every sprite shares one geometry, so only a sprite's material and texture are its own to free.
    if (object instanceof Sprite) {
      disposeMaterial(object.material);
      return;
    }
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of [object.material].flat() as Material[]) disposeMaterial(material);
  });
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
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
  // Squares are 0.7 m along the road, so a deeper block just has more of them.
  const columns = Math.round(START_LINE_DEPTH / 0.7);
  const canvas = document.createElement('canvas');
  canvas.width = columns;
  canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  for (let x = 0; x < columns; x++) {
    for (let y = 0; y < 8; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#111111';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  // Several squares along the direction of travel, repeating across the road.
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(1, track.halfWidth / 4);

  const mesh = new Mesh(
    new PlaneGeometry(START_LINE_DEPTH, track.halfWidth * 2),
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
  const make = { trees, cacti, pines, craters, mesas, volcanoes, ice }[theme.scenery];
  group.add(make(track, rand));
  if (theme.ponds) group.add(ponds(track, rand, theme.ponds));
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

/**
 * Scatters up to `count` objects in the scenery box, skipping spots on or near the road. Wide objects
 * pass how far they reach from their centre, so their edges keep clear of the road too.
 */
function scatter(track: TrackPath, rand: () => number, count: number, make: () => Object3D, reach = 0): Group {
  const group = new Group();
  const box = sceneryBox(track);
  for (let attempt = 0; attempt < 2000 && group.children.length < count; attempt++) {
    const x = box.minX + rand() * (box.maxX - box.minX);
    const z = box.minZ + rand() * (box.maxZ - box.minZ);
    if (Math.abs(track.project(x, z).lateral) < track.halfWidth + SCENERY_CLEARANCE + reach) continue;

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

/** Moon: shallow craters with a pale rim, grey boulders, and the odd flag. */
function craters(track: TrackPath, rand: () => number): Group {
  const floorGeom = new CircleGeometry(1, 16);
  floorGeom.rotateX(-Math.PI / 2);
  const rimGeom = new RingGeometry(1, 1.25, 16);
  rimGeom.rotateX(-Math.PI / 2);
  const floorMat = new MeshStandardMaterial({ color: '#5d5d64', roughness: 1 });
  const rimMat = new MeshStandardMaterial({ color: '#b6b6bc', roughness: 1 });
  const boulderGeom = new DodecahedronGeometry(0.6, 0);
  const boulderMat = new MeshStandardMaterial({ color: '#9b9ba1', flatShading: true, roughness: 0.95 });
  const poleGeom = new CylinderGeometry(0.04, 0.04, 2.2, 5);
  const poleMat = new MeshStandardMaterial({ color: '#d8d8d8', roughness: 0.6 });
  const clothGeom = new PlaneGeometry(0.9, 0.6);
  const clothMat = new MeshStandardMaterial({ color: '#e0e0e8', side: DoubleSide, roughness: 0.9 });

  const crater = () => {
    const group = new Group();
    const floor = new Mesh(floorGeom, floorMat);
    const rim = new Mesh(rimGeom, rimMat);
    floor.position.y = rim.position.y = POND_Y;
    floor.receiveShadow = rim.receiveShadow = true;
    group.add(floor, rim);
    const r = 1.4 + rand() * 2.2;
    group.scale.set(r, 1, r);
    return group;
  };
  const boulder = () => {
    const mesh = new Mesh(boulderGeom, boulderMat);
    const s = 0.5 + rand() * 1.1;
    mesh.scale.set(s, s * 0.7, s * 0.85);
    mesh.position.y = 0.25 * s;
    mesh.castShadow = true;
    return mesh;
  };
  const flag = () => {
    const group = new Group();
    const pole = new Mesh(poleGeom, poleMat);
    pole.position.y = 1.1;
    const cloth = new Mesh(clothGeom, clothMat);
    cloth.position.set(0.47, 1.85, 0);
    pole.castShadow = true;
    group.add(pole, cloth);
    return group;
  };

  const group = new Group();
  group.add(scatter(track, rand, 80, crater, 4.5));
  group.add(scatter(track, rand, 90, () => (rand() < 0.04 ? flag() : boulder())));
  return group;
}

/** Mars: rust-red boulders and flat-topped mesas. */
function mesas(track: TrackPath, rand: () => number): Group {
  const boulderGeom = new DodecahedronGeometry(0.6, 0);
  const boulderMat = new MeshStandardMaterial({ color: '#8f3f22', flatShading: true, roughness: 0.95 });
  const bodyGeom = new CylinderGeometry(0.8, 1, 1, 8);
  const bodyMat = new MeshStandardMaterial({ color: '#a64a28', flatShading: true, roughness: 0.95 });
  const topGeom = new CylinderGeometry(0.62, 0.7, 0.4, 8);
  const topMat = new MeshStandardMaterial({ color: '#c26a3e', flatShading: true, roughness: 0.95 });

  const boulder = () => {
    const mesh = new Mesh(boulderGeom, boulderMat);
    const s = 0.5 + rand() * 1.2;
    mesh.scale.set(s, s * 0.7, s * 0.9);
    mesh.position.y = 0.25 * s;
    mesh.castShadow = true;
    return mesh;
  };
  // A broad base with a narrower, paler step on top.
  const mesa = () => {
    const group = new Group();
    const height = 1.2 + rand() * 1.8;
    const body = new Mesh(bodyGeom, bodyMat);
    body.scale.set(1, height, 1);
    body.position.y = height / 2;
    const top = new Mesh(topGeom, topMat);
    top.position.y = height + 0.2;
    body.castShadow = top.castShadow = true;
    group.add(body, top);
    group.scale.set(2.2 + rand() * 1.6, 1, 2.2 + rand() * 1.6);
    return group;
  };

  const group = new Group();
  group.add(scatter(track, rand, 26, mesa, 4.5));
  group.add(scatter(track, rand, 100, boulder));
  return group;
}

/** Io: squat volcano cones with a glowing vent, and clusters of pale sulphur spikes. */
function volcanoes(track: TrackPath, rand: () => number): Group {
  const coneGeom = new CylinderGeometry(0.9, 5, 3.6, 9);
  const coneMat = new MeshStandardMaterial({ color: '#7a5a22', flatShading: true, roughness: 0.95 });
  const ventGeom = new CircleGeometry(1, 9);
  ventGeom.rotateX(-Math.PI / 2);
  const ventMat = new MeshStandardMaterial({ color: '#ff7a1c', emissive: '#ff4a00', emissiveIntensity: 1 });
  const spikeGeom = new ConeGeometry(0.3, 1.6, 5);
  const spikeMat = new MeshStandardMaterial({ color: '#f4e662', flatShading: true, roughness: 0.7 });

  const volcano = () => {
    const group = new Group();
    const cone = new Mesh(coneGeom, coneMat);
    cone.position.y = 1.8;
    cone.castShadow = true;
    const vent = new Mesh(ventGeom, ventMat);
    vent.position.y = 3.62;
    group.add(cone, vent);
    group.scale.setScalar(0.8 + rand() * 0.6);
    return group;
  };
  const spikes = () => {
    const group = new Group();
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const spike = new Mesh(spikeGeom, spikeMat);
      const s = 0.6 + rand() * 1.1;
      spike.scale.set(s, s, s);
      spike.position.set((rand() - 0.5) * 1.2, 0.8 * s, (rand() - 0.5) * 1.2);
      spike.rotation.z = (rand() - 0.5) * 0.3;
      spike.castShadow = true;
      group.add(spike);
    }
    return group;
  };

  const group = new Group();
  group.add(scatter(track, rand, 20, volcano, 6));
  group.add(scatter(track, rand, 70, spikes, 1));
  return group;
}

/** Europa: tilted ice spires, and the long reddish cracks that run across its surface. */
function ice(track: TrackPath, rand: () => number): Group {
  const spireGeom = new ConeGeometry(0.6, 1, 5);
  const spireMat = new MeshStandardMaterial({ color: '#c4e5f7', flatShading: true, roughness: 0.2, metalness: 0.1 });

  const spires = () => {
    const group = new Group();
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const height = 2 + rand() * 3.2;
      const spire = new Mesh(spireGeom, spireMat);
      spire.scale.set(1, height, 1);
      spire.position.set((rand() - 0.5) * 1.6, height / 2, (rand() - 0.5) * 1.6);
      spire.rotation.set((rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 0.3);
      spire.castShadow = true;
      group.add(spire);
    }
    return group;
  };

  const group = new Group();
  group.add(scatter(track, rand, 60, spires, 1));
  group.add(cracks(track, rand));
  return group;
}

/** Thin dark-red lines lying on the ground, each a few bent segments long. A crack stops short of the road. */
function cracks(track: TrackPath, rand: () => number): Group {
  const group = new Group();
  const mat = new MeshStandardMaterial({ color: '#8a4a3c', roughness: 1 });
  const box = sceneryBox(track);
  const keepClear = track.halfWidth + CURB_WIDTH + 1.5;
  const clear = (x: number, z: number) => Math.abs(track.project(x, z).lateral) > keepClear;

  for (let made = 0, attempt = 0; made < 22 && attempt < 400; attempt++) {
    let x = box.minX + rand() * (box.maxX - box.minX);
    let z = box.minZ + rand() * (box.maxZ - box.minZ);
    if (!clear(x, z)) continue;
    let heading = rand() * Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      const length = 6 + rand() * 4;
      heading += (rand() - 0.5) * 1;
      const nx = x + Math.cos(heading) * length;
      const nz = z + Math.sin(heading) * length;
      if (!clear(nx, nz) || !clear((x + nx) / 2, (z + nz) / 2)) break;
      const geom = new PlaneGeometry(length, 0.35);
      geom.rotateX(-Math.PI / 2);
      const segment = new Mesh(geom, mat);
      segment.position.set((x + nx) / 2, POND_Y, (z + nz) / 2);
      segment.rotation.y = -heading;
      segment.receiveShadow = true;
      group.add(segment);
      x = nx;
      z = nz;
    }
    made++;
  }
  return group;
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

const POND_MATERIALS: Record<PondStyle, () => MeshStandardMaterial> = {
  water: () => new MeshStandardMaterial({ color: '#7dc8ef', roughness: 0.15, metalness: 0.1 }),
  lava: () => new MeshStandardMaterial({ color: '#ff6a1a', emissive: '#ff4500', emissiveIntensity: 0.9, roughness: 0.6 }),
};

/** Flat, irregular pools, light blue or glowing lava: some in the infield, some outside the loop. */
function ponds(track: TrackPath, rand: () => number, style: PondStyle): Group {
  const group = new Group();
  const mat = POND_MATERIALS[style]();
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
