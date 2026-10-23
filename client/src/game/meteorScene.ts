import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  DodecahedronGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { seededRandom } from './items';
import type { TrackPath } from './trackPath';

// Meteors for the Space Cup: now and then one streaks in near the car, hits the ground beside the track
// in a flash, a shockwave and a spray of rock, and leaves a crater behind. Purely visual. They land
// clear of the road and nothing here touches the cars or the simulation.

/** Seconds between impacts, and the wait before the first. */
const GAP_MIN = 4;
const GAP_MAX = 9;
const FIRST_MIN = 1.5;
const FIRST_MAX = 4;
/** Impacts land this far from the car, which keeps them on screen. */
const NEAR = 8;
const FAR = 28;
const CRATER_MIN = 1.6;
const CRATER_MAX = 3.4;
/** Craters keep this far clear of the road: the curb and wall, and the crater's rim. */
const ROAD_MARGIN = 0.9 + 0.6 + 1.5;
const RIM = 1.25;
const CRATER_Y = 0.02;
/** Craters from earlier impacts stay, up to this many; then the oldest goes. */
const MAX_CRATERS = 12;
const CRATER_GROW = 0.25;

const FALL_TIME = 0.7;
const FALL_HEIGHT = 40;
/** How far across the ground a meteor travels while it falls. */
const FALL_DRIFT = 16;
const TRAIL_LENGTH = 6;

const FLASH_TIME = 0.4;
const RING_TIME = 0.7;
const ROCKS = 12;
const ROCK_GRAVITY = 14;
const ROCK_LIFE = 1.4;

interface Falling {
  root: Group;
  trail: MeshBasicMaterial;
  age: number;
  from: Vector3;
  to: Vector3;
  radius: number;
}

interface Rock {
  mesh: Mesh;
  vx: number;
  vy: number;
  vz: number;
}

interface Impact {
  root: Group;
  sprite: Sprite;
  flash: SpriteMaterial;
  ring: Mesh;
  ringMaterial: MeshBasicMaterial;
  rocks: Rock[];
  age: number;
  radius: number;
}

interface Crater {
  root: Group;
  age: number;
  radius: number;
  x: number;
  z: number;
}

export interface MeteorScene {
  root: Group;
  /** Moves the meteors one frame. The focus is the point the camera follows, the player's car. */
  update(dt: number, focusX: number, focusZ: number): void;
  /** Frees the geometries, materials and textures this scene made. */
  dispose(): void;
}

function glowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 250, 225, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 190, 90, 0.8)');
  gradient.addColorStop(1, 'rgba(255, 120, 30, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/** Builds the meteors for a track. `ground` is the ground colour, which the craters are shaded from. */
export function createMeteors(track: TrackPath, ground: string, seed: number): MeteorScene {
  const rand = seededRandom(seed);
  const root = new Group();
  const base = new Color(ground);
  // Pulled towards the camera more than the scenery's flat craters, so a new crater that lands on one
  // is drawn cleanly over it instead of flickering against it.
  const flatMat = (color: Color) =>
    new MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const floorMat = flatMat(base.clone().multiplyScalar(0.55));
  const rimMat = flatMat(base.clone().lerp(new Color('#ffffff'), 0.3));
  const glow = glowTexture();

  const floorGeom = new CircleGeometry(1, 16);
  floorGeom.rotateX(-Math.PI / 2);
  const rimGeom = new RingGeometry(1, RIM, 16);
  rimGeom.rotateX(-Math.PI / 2);
  const ringGeom = new RingGeometry(0.85, 1, 24);
  ringGeom.rotateX(-Math.PI / 2);
  const headGeom = new SphereGeometry(0.4, 8, 6);
  const headMat = new MeshBasicMaterial({ color: '#fff1c8' });
  // The trail is a cone with its wide end at the head, tapering to a point behind it.
  const trailGeom = new ConeGeometry(0.4, TRAIL_LENGTH, 8);
  const rockGeom = new DodecahedronGeometry(0.25, 0);
  const rockMat = new MeshStandardMaterial({ color: base.clone().multiplyScalar(0.7), flatShading: true, roughness: 1 });

  const falling: Falling[] = [];
  const impacts: Impact[] = [];
  const craters: Crater[] = [];
  let wait = FIRST_MIN + rand() * (FIRST_MAX - FIRST_MIN);

  /** A spot near the focus, clear of the road and of the craters already there, or null if none turned up. */
  const pickTarget = (focusX: number, focusZ: number) => {
    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = rand() * Math.PI * 2;
      const distance = NEAR + rand() * (FAR - NEAR);
      const x = focusX + Math.cos(angle) * distance;
      const z = focusZ + Math.sin(angle) * distance;
      const radius = CRATER_MIN + rand() * (CRATER_MAX - CRATER_MIN);
      if (Math.abs(track.project(x, z).lateral) < track.halfWidth + ROAD_MARGIN + radius * RIM) continue;
      if (craters.some((c) => Math.hypot(c.x - x, c.z - z) < (c.radius + radius) * RIM + 1)) continue;
      return { x, z, radius };
    }
    return null;
  };

  const launch = (x: number, z: number, radius: number) => {
    const drift = rand() * Math.PI * 2;
    const to = new Vector3(x, 0, z);
    const from = new Vector3(x + Math.cos(drift) * FALL_DRIFT, FALL_HEIGHT, z + Math.sin(drift) * FALL_DRIFT);
    const group = new Group();
    group.add(new Mesh(headGeom, headMat));
    const trailMat = new MeshBasicMaterial({
      color: '#ff9a3c',
      transparent: true,
      opacity: 0.75,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const trail = new Mesh(trailGeom, trailMat);
    // Point the cone's tip back along the path, with its middle half a trail behind the head.
    const back = from.clone().sub(to).normalize();
    trail.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), back));
    trail.position.copy(back).multiplyScalar(TRAIL_LENGTH / 2);
    group.add(trail);
    group.position.copy(from);
    root.add(group);
    falling.push({ root: group, trail: trailMat, age: 0, from, to, radius });
  };

  const strike = (x: number, z: number, radius: number) => {
    const group = new Group();
    group.position.set(x, 0, z);

    const flash = new SpriteMaterial({ map: glow, blending: AdditiveBlending, transparent: true, depthWrite: false });
    const sprite = new Sprite(flash);
    sprite.position.y = 1;
    group.add(sprite);

    const ringMaterial = new MeshBasicMaterial({
      color: '#ffe2b0',
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const ring = new Mesh(ringGeom, ringMaterial);
    ring.position.y = CRATER_Y + 0.01;
    group.add(ring);

    const rocks: Rock[] = Array.from({ length: ROCKS }, () => {
      const mesh = new Mesh(rockGeom, rockMat);
      const heading = rand() * Math.PI * 2;
      const outward = (3 + rand() * 6) * (0.6 + radius / CRATER_MAX);
      mesh.position.y = 0.3;
      mesh.scale.setScalar(0.6 + rand() * 1.2);
      group.add(mesh);
      return { mesh, vx: Math.cos(heading) * outward, vy: 5 + rand() * 6, vz: Math.sin(heading) * outward };
    });
    root.add(group);
    impacts.push({ root: group, sprite, flash, ring, ringMaterial, rocks, age: 0, radius });

    const crater = new Group();
    const floor = new Mesh(floorGeom, floorMat);
    const rim = new Mesh(rimGeom, rimMat);
    floor.position.y = rim.position.y = CRATER_Y;
    floor.receiveShadow = rim.receiveShadow = true;
    crater.add(floor, rim);
    crater.position.set(x, 0, z);
    crater.scale.set(0.01, 1, 0.01);
    root.add(crater);
    craters.push({ root: crater, age: 0, radius, x, z });
    if (craters.length > MAX_CRATERS) root.remove(craters.shift()!.root);
  };

  const finishImpact = (impact: Impact) => {
    root.remove(impact.root);
    impact.flash.dispose();
    impact.ringMaterial.dispose();
  };

  return {
    root,
    update(dt, focusX, focusZ) {
      wait -= dt;
      if (wait <= 0) {
        wait = GAP_MIN + rand() * (GAP_MAX - GAP_MIN);
        const target = pickTarget(focusX, focusZ);
        if (target) launch(target.x, target.z, target.radius);
      }

      for (let i = falling.length - 1; i >= 0; i--) {
        const meteor = falling[i];
        meteor.age += dt;
        const t = Math.min(1, meteor.age / FALL_TIME);
        meteor.root.position.lerpVectors(meteor.from, meteor.to, t);
        if (t < 1) continue;
        strike(meteor.to.x, meteor.to.z, meteor.radius);
        root.remove(meteor.root);
        meteor.trail.dispose();
        falling.splice(i, 1);
      }

      for (let i = impacts.length - 1; i >= 0; i--) {
        const impact = impacts[i];
        impact.age += dt;
        const flashT = Math.min(1, impact.age / FLASH_TIME);
        impact.flash.opacity = 1 - flashT;
        impact.sprite.scale.setScalar(impact.radius * (3 + 6 * flashT));
        const ringT = Math.min(1, impact.age / RING_TIME);
        impact.ring.scale.set(impact.radius * (1 + 3.5 * ringT), 1, impact.radius * (1 + 3.5 * ringT));
        impact.ringMaterial.opacity = 0.8 * (1 - ringT);
        for (const rock of impact.rocks) {
          rock.vy -= ROCK_GRAVITY * dt;
          rock.mesh.position.x += rock.vx * dt;
          rock.mesh.position.y += rock.vy * dt;
          rock.mesh.position.z += rock.vz * dt;
          rock.mesh.rotation.x += rock.vz * dt;
          rock.mesh.rotation.z -= rock.vx * dt;
          // A rock that lands is gone.
          rock.mesh.visible = rock.mesh.position.y > 0.1;
        }
        if (impact.age > ROCK_LIFE) {
          finishImpact(impact);
          impacts.splice(i, 1);
        }
      }

      for (const crater of craters) {
        crater.age += dt;
        // Eased out, so it opens fast and settles.
        const t = Math.min(1, crater.age / CRATER_GROW);
        const grown = crater.radius * (1 - (1 - t) * (1 - t));
        crater.root.scale.set(Math.max(0.01, grown), 1, Math.max(0.01, grown));
      }
    },
    dispose() {
      for (const impact of impacts) finishImpact(impact);
      for (const meteor of falling) meteor.trail.dispose();
      for (const geom of [floorGeom, rimGeom, ringGeom, headGeom, trailGeom, rockGeom]) geom.dispose();
      for (const mat of [floorMat, rimMat, headMat, rockMat]) mat.dispose();
      glow.dispose();
    },
  };
}
