import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import { seededRandom } from './items';
import type { Weather } from './tracks';

// Ambient weather drawn over the track: snow falling around the car, or tumbleweeds rolling across it.
// Purely visual. Nothing here reads or changes the cars or the simulation.

interface Vec2 {
  x: number;
  z: number;
}

const SNOW_COUNT = 2600;
/** The snow box is this wide and deep, centred on the car, and rolls along with it. */
const SNOW_BOX = 90;
const SNOW_HEIGHT = 30;
const SNOW_FALL_MIN = 2.5;
const SNOW_FALL_MAX = 5;
/** Light wind drift the snow is carried along by (m/s). */
const SNOW_DRIFT = 0.6;
/** Peak sideways sway of a flake (m/s), and how fast each flake cycles through it (rad/s). */
const SNOW_SWAY = 0.6;
const SNOW_SWAY_RATE = 1.2;
/** Flake size in CSS pixels. The renderer scales it by the device pixel ratio. */
const SNOW_SIZE = 7;

const TUMBLE_MIN = 2;
const TUMBLE_MAX = 4;
const TUMBLE_RADIUS = 0.8;
const TUMBLE_SPEED_MIN = 5;
const TUMBLE_SPEED_MAX = 9;
/** Sideways drift (m/s), either way. */
const TUMBLE_DRIFT = 1;
/** Spawn this far upwind of the car, and up to this far to either side of the wind line. */
const TUMBLE_SPAWN_MIN = 45;
const TUMBLE_SPAWN_MAX = 55;
const TUMBLE_SPAWN_ACROSS = 22;
/** Removed once it is this far downwind of the car. */
const TUMBLE_FAR_SIDE = 60;
/** Safety limit for one that's left far behind, e.g. after the car is moved. */
const TUMBLE_GONE_DISTANCE = 150;
/** Seconds away before a tumbleweed rolls in again. */
const TUMBLE_WAIT_MIN = 1;
const TUMBLE_WAIT_MAX = 4;
/** Height of each hop (m), and how fast the hops come (rad/s of the bounce phase). */
const TUMBLE_HOP_MIN = 0.3;
const TUMBLE_HOP_MAX = 0.6;
const TUMBLE_HOP_RATE = 7;

export interface WeatherScene {
  root: Object3D;
  /** Moves the weather one frame. The focus is the point the camera follows, the player's car. */
  update(dt: number, focusX: number, focusZ: number): void;
  /** Frees what disposeScene can't reach: the snow's buffers and sprite. */
  dispose(): void;
}

interface Tumbleweed {
  root: Group;
  active: boolean;
  /** Seconds until it rolls in again, while it's away. */
  wait: number;
  x: number;
  z: number;
  speed: number;
  drift: number;
  hop: number;
  bouncePhase: number;
  spin: number;
}

/** Builds the weather for a track theme, or returns null when the theme has none. The seed sets its pattern. */
export function createWeather(kind: Weather | undefined, seed: number): WeatherScene | null {
  if (kind === 'snow') return createSnow(seed);
  if (kind === 'tumbleweeds') return createTumbleweeds(seed);
  return null;
}

/** A random horizontal wind direction, as a unit vector. */
function randomWind(rand: () => number): Vec2 {
  const angle = rand() * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

/** The direction across the wind, to the right of it. */
function acrossWind(wind: Vec2): Vec2 {
  return { x: -wind.z, z: wind.x };
}

/** Keeps a coordinate inside the snow box centred on the focus, wrapping it to the far side. */
function wrapToBox(value: number, focus: number): number {
  const offset = value - focus;
  return focus + ((((offset + SNOW_BOX / 2) % SNOW_BOX) + SNOW_BOX) % SNOW_BOX) - SNOW_BOX / 2;
}

/** A small round white sprite that fades to transparent at the edge. */
function flakeTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  // A white core with a faint cool-grey rim, so flakes still show against snowy ground.
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.95)');
  gradient.addColorStop(0.62, 'rgba(150, 168, 196, 0.55)');
  gradient.addColorStop(1, 'rgba(150, 168, 196, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  return new CanvasTexture(canvas);
}

/** Flakes in one Points object, falling through a box that moves with the car. */
function createSnow(seed: number): WeatherScene {
  const rand = seededRandom(seed);
  const wind = randomWind(rand);
  const across = acrossWind(wind);

  // Positions are kept as world coordinates; the y column is height above the ground.
  const positions = new Float32Array(SNOW_COUNT * 3);
  const fallSpeed = new Float32Array(SNOW_COUNT);
  const phase = new Float32Array(SNOW_COUNT);
  for (let i = 0; i < SNOW_COUNT; i++) {
    positions[i * 3] = (rand() - 0.5) * SNOW_BOX;
    positions[i * 3 + 1] = rand() * SNOW_HEIGHT;
    positions[i * 3 + 2] = (rand() - 0.5) * SNOW_BOX;
    fallSpeed[i] = SNOW_FALL_MIN + rand() * (SNOW_FALL_MAX - SNOW_FALL_MIN);
    phase[i] = rand() * Math.PI * 2;
  }

  const attribute = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', attribute);
  const texture = flakeTexture();
  const material = new PointsMaterial({
    map: texture,
    color: '#ffffff',
    size: SNOW_SIZE,
    // Flakes are a fixed size on screen, which suits the orthographic camera.
    sizeAttenuation: false,
    transparent: true,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  // The flakes move with the car, so the bounding sphere made at creation goes stale. Don't cull them.
  points.frustumCulled = false;

  let time = 0;
  return {
    root: points,
    update(dt, focusX, focusZ) {
      time += dt;
      for (let i = 0; i < SNOW_COUNT; i++) {
        const k = i * 3;
        // Each flake sways side to side across the wind, at its own phase.
        const sway = SNOW_SWAY * Math.cos(time * SNOW_SWAY_RATE + phase[i]);
        positions[k] = wrapToBox(positions[k] + (wind.x * SNOW_DRIFT + across.x * sway) * dt, focusX);
        positions[k + 2] = wrapToBox(positions[k + 2] + (wind.z * SNOW_DRIFT + across.z * sway) * dt, focusZ);
        positions[k + 1] -= fallSpeed[i] * dt;
        // Back to the top once it reaches the ground.
        if (positions[k + 1] < 0) positions[k + 1] += SNOW_HEIGHT;
      }
      attribute.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/** A few tan low-poly balls that roll across the wind, bouncing as they go. */
function createTumbleweeds(seed: number): WeatherScene {
  const rand = seededRandom(seed);
  const wind = randomWind(rand);
  const across = acrossWind(wind);
  // Rolling about the axis across the wind turns the ball the way it travels.
  const rollAxis = new Vector3(wind.z, 0, -wind.x);

  const body = new IcosahedronGeometry(TUMBLE_RADIUS, 1);
  // A slightly larger dark wireframe over the body makes it look twiggy.
  const twigs = new IcosahedronGeometry(TUMBLE_RADIUS * 1.08, 1);
  const bodyMat = new MeshStandardMaterial({ color: '#b8925c', flatShading: true, roughness: 0.95 });
  const twigMat = new MeshStandardMaterial({ color: '#4a3220', wireframe: true, roughness: 1 });

  const root = new Group();
  const count = TUMBLE_MIN + Math.floor(rand() * (TUMBLE_MAX - TUMBLE_MIN + 1));
  const weeds: Tumbleweed[] = Array.from({ length: count }, () => {
    const group = new Group();
    const ball = new Mesh(body, bodyMat);
    ball.castShadow = true;
    group.add(ball, new Mesh(twigs, twigMat));
    group.visible = false;
    root.add(group);
    // Staggered, so they don't all come in at once.
    return {
      root: group,
      active: false,
      wait: rand() * TUMBLE_WAIT_MAX,
      x: 0,
      z: 0,
      speed: 0,
      drift: 0,
      hop: 0,
      bouncePhase: 0,
      spin: 0,
    };
  });

  /** Puts one back upwind of the focus, at a random point across the wind, and sends it on its way. */
  const spawn = (weed: Tumbleweed, focusX: number, focusZ: number) => {
    const upwind = TUMBLE_SPAWN_MIN + rand() * (TUMBLE_SPAWN_MAX - TUMBLE_SPAWN_MIN);
    const offset = (rand() * 2 - 1) * TUMBLE_SPAWN_ACROSS;
    weed.x = focusX - wind.x * upwind + across.x * offset;
    weed.z = focusZ - wind.z * upwind + across.z * offset;
    weed.speed = TUMBLE_SPEED_MIN + rand() * (TUMBLE_SPEED_MAX - TUMBLE_SPEED_MIN);
    weed.drift = (rand() * 2 - 1) * TUMBLE_DRIFT;
    weed.hop = TUMBLE_HOP_MIN + rand() * (TUMBLE_HOP_MAX - TUMBLE_HOP_MIN);
    weed.bouncePhase = rand() * Math.PI * 2;
    weed.spin = 0;
    weed.active = true;
    weed.root.visible = true;
  };

  return {
    root,
    update(dt, focusX, focusZ) {
      for (const weed of weeds) {
        if (!weed.active) {
          weed.wait -= dt;
          if (weed.wait <= 0) spawn(weed, focusX, focusZ);
          continue;
        }

        weed.x += (wind.x * weed.speed + across.x * weed.drift) * dt;
        weed.z += (wind.z * weed.speed + across.z * weed.drift) * dt;
        weed.spin += (weed.speed / TUMBLE_RADIUS) * dt;
        weed.bouncePhase += TUMBLE_HOP_RATE * dt;
        const height = TUMBLE_RADIUS + weed.hop * Math.abs(Math.sin(weed.bouncePhase));
        weed.root.position.set(weed.x, height, weed.z);
        weed.root.setRotationFromAxisAngle(rollAxis, weed.spin);

        const along = (weed.x - focusX) * wind.x + (weed.z - focusZ) * wind.z;
        const away = Math.hypot(weed.x - focusX, weed.z - focusZ);
        if (along > TUMBLE_FAR_SIDE || away > TUMBLE_GONE_DISTANCE) {
          weed.active = false;
          weed.root.visible = false;
          weed.wait = TUMBLE_WAIT_MIN + rand() * (TUMBLE_WAIT_MAX - TUMBLE_WAIT_MIN);
        }
      }
    },
    // Everything here is a mesh, which disposeScene frees.
    dispose() {},
  };
}
