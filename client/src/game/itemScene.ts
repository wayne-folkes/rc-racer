import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
} from 'three';
import { FACE_CAMERA_YAW } from './followCamera';
import {
  ITEM_KINDS,
  seededRandom,
  type BoostPad,
  type Hazard,
  type ItemEvent,
  type ItemKind,
  type ItemSystem,
  type Pickup,
} from './items';

// Draws what the item system simulates: hazards, boost pads, item pickups, missiles, bombs and short effects.
// Missiles and bombs are matched to the sim by id, so meshes come and go with the sim's arrays.

const HAZARD_Y = 0.025;
/** Height of the bob line that pickups float around. */
const BOX_Y = 0.9;
/** Height of the lowest point of a pickup's model, so bombs hover just above the road. */
const PICKUP_FLOOR = 0.35;
/** Pickups are drawn at 1.6x the size of the fired missile and bomb. */
const PICKUP_SCALE = 1.6;
/** The missile is slim, so its pickup is drawn bigger still to read at a glance. */
const MISSILE_PICKUP_SCALE = 2.3;
/** How far pickups sway either side of facing the camera (radians). */
const PICKUP_SWAY = 0.35;
/** Nose-up tilt for the missile pickup, so it reads from the high camera. */
const MISSILE_PICKUP_TILT = 0.35;
/** Boost pads: a flat strip on the road, built along +X and turned to the pad's heading. */
const BOOST_PAD_Y = 0.028;
const BOOST_PAD_LENGTH = 3.6;
const BOOST_PAD_WIDTH = 2.6;
const BOOST_PAD_BORDER = 0.22;
const BOOST_ARROW_COUNT = 3;
const BOOST_ARROW_SPACING = 1.1;
/** Seconds for one chase along the arrows, and how far each arrow lags the one behind it (share of a chase). */
const CHASE_PERIOD = 1;
const CHASE_LAG = 0.15;
/** Seconds the streak lasts when a car boosts over a pad. */
const BOOST_FLASH_LIFE = 0.3;
/** Ground rings sit just above the road and just inside the sim's pickup radius (1.7). */
const PICKUP_RING_Y = 0.03;
const PICKUP_RING_INNER = 1.25;
const PICKUP_RING_OUTER = 1.55;
const MISSILE_Y = 0.5;
const BOMB_Y = 0.45;
/** Matches the sim's arming time: bombs blink slowly until then, and faster after. */
const BOMB_ARM_AGE = 0.5;
const BOMB_BLINK_SLOW = 2;
const BOMB_BLINK_FAST = 8;
/** Seconds for a pickup to pop back in after respawning. */
const POP_TIME = 0.35;
const DEBRIS_GRAVITY = 12;

/** One short-lived effect. `step` gets progress from 0 to 1 over `life` seconds. */
interface Effect {
  root: Group;
  life: number;
  age: number;
  step: (t: number) => void;
  /** Materials made for this effect alone, disposed when it ends. */
  materials: Material[];
}

interface BoxView {
  pickup: Pickup;
  /** Floats, spins and pops. */
  holder: Group;
  /** Ground ring under the pickup. Pops with it, but doesn't float. */
  base: Group;
  phase: number;
  ready: boolean;
  popAge: number;
}

interface MissileView {
  root: Group;
  flame: Mesh;
}

interface BombView {
  root: Group;
  tip: Mesh;
}

/** A flat, irregular blob on the ground with radius about 1, so it can be scaled to a hazard. */
function blobGeometry(seed: number): BufferGeometry {
  const rand = seededRandom(seed);
  const sides = 20;
  const positions: number[] = [0, 0, 0];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const r = 0.8 + rand() * 0.25;
    positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  const indices: number[] = [];
  for (let i = 0; i < sides; i++) {
    // Wound so the faces point up (+Y).
    indices.push(0, ((i + 1) % sides) + 1, i + 1);
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/** A flat rectangle lying on the ground, facing up, centred on the origin. */
function flatRect(w: number, h: number): PlaneGeometry {
  const geom = new PlaneGeometry(w, h);
  geom.rotateX(-Math.PI / 2);
  return geom;
}

/** A rectangle in the XY plane, centred on the origin. */
function rectShape(w: number, h: number): Shape {
  const shape = new Shape();
  shape.moveTo(-w / 2, -h / 2);
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(w / 2, h / 2);
  shape.lineTo(-w / 2, h / 2);
  shape.closePath();
  return shape;
}

/** The yellow frame round a boost pad: a rectangle with a smaller one cut out. Lies flat, facing up. */
function boostBorderGeometry(): ShapeGeometry {
  const shape = rectShape(BOOST_PAD_LENGTH, BOOST_PAD_WIDTH);
  shape.holes.push(rectShape(BOOST_PAD_LENGTH - 2 * BOOST_PAD_BORDER, BOOST_PAD_WIDTH - 2 * BOOST_PAD_BORDER));
  const geom = new ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
  return geom;
}

/** A chunky ">" pointing along +X, lying flat on the ground. */
function chevronGeometry(): ShapeGeometry {
  const shape = new Shape();
  shape.moveTo(-0.38, 0.7);
  shape.lineTo(0.4, 0);
  shape.lineTo(-0.38, -0.7);
  shape.lineTo(-0.38, -0.46);
  shape.lineTo(0.12, 0);
  shape.lineTo(-0.38, 0.46);
  shape.closePath();
  const geom = new ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
  return geom;
}

/** A flat, additive ring of colour for marking a pickup on the road. */
function glowMaterial(color: string): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** Geometries and materials shared by every mesh of a kind. */
function createAssets() {
  const sphere = new SphereGeometry(1, 16, 12);
  const ring = new RingGeometry(0.85, 1, 32);
  ring.rotateX(-Math.PI / 2);
  const pickupRing = new RingGeometry(PICKUP_RING_INNER, PICKUP_RING_OUTER, 48);
  pickupRing.rotateX(-Math.PI / 2);

  const missileBody = new CylinderGeometry(0.12, 0.12, 0.6, 8);
  missileBody.rotateZ(-Math.PI / 2); // Along +X, the way the car model faces.
  const missileNose = new ConeGeometry(0.12, 0.3, 8);
  missileNose.rotateZ(-Math.PI / 2);
  const missileFlame = new ConeGeometry(0.13, 0.5, 8);
  missileFlame.rotateZ(Math.PI / 2); // Tip points back along -X.

  const bombBall = new SphereGeometry(0.45, 16, 12);

  return {
    blobs: [1, 2, 3].map(blobGeometry),
    oil: new MeshStandardMaterial({ color: '#17171f', roughness: 0.18, metalness: 0.5 }),
    puddle: new MeshStandardMaterial({
      color: '#5fb8e6',
      roughness: 0.05,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    }),
    puddleRim: new MeshStandardMaterial({
      color: '#e6f7ff',
      roughness: 0.05,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    }),

    missileBody,
    missileNose,
    missileFin: new BoxGeometry(0.2, 0.22, 0.02),
    missileFlame,
    missileBodyMat: new MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.4 }),
    missileNoseMat: new MeshStandardMaterial({ color: '#e63946', roughness: 0.4 }),
    flameMat: new MeshStandardMaterial({
      color: '#ff8c1a',
      emissive: '#ff6a00',
      emissiveIntensity: 2,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),

    bombBall,
    fuse: new CylinderGeometry(0.05, 0.05, 0.25, 6),
    spark: new SphereGeometry(0.08, 8, 6),
    bombMat: new MeshStandardMaterial({ color: '#15151a', roughness: 0.5, metalness: 0.2 }),
    fuseMat: new MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.8 }),
    sparkOn: new MeshBasicMaterial({ color: '#ff3b3b' }),
    sparkOff: new MeshBasicMaterial({ color: '#5a1212' }),

    padBase: flatRect(BOOST_PAD_LENGTH, BOOST_PAD_WIDTH),
    padBorder: boostBorderGeometry(),
    padBaseMat: new MeshStandardMaterial({ color: '#1b1b22', roughness: 0.6 }),
    padBorderMat: new MeshStandardMaterial({
      color: '#facc15',
      emissive: '#f59e0b',
      emissiveIntensity: 0.6,
      roughness: 0.4,
    }),
    chevron: chevronGeometry(),
    // One material per arrow, shared by every pad, so the chase runs along all of them together.
    chevronMats: Array.from(
      { length: BOOST_ARROW_COUNT },
      () =>
        new MeshStandardMaterial({
          color: '#fde047',
          emissive: '#facc15',
          emissiveIntensity: 0.2,
          roughness: 0.4,
        }),
    ),
    flashQuad: flatRect(1, 1),

    sphere,
    chunk: new BoxGeometry(0.28, 0.28, 0.28),
    ring,
    pickupRing,
    ringMats: {
      missile: glowMaterial('#ff5a36'),
      bomb: glowMaterial('#a855f7'),
    },
    star: new OctahedronGeometry(0.35),
  };
}

type Assets = ReturnType<typeof createAssets>;

/** The missile: a white body with a red nose, fins and a flame at the tail. Points along +X. */
function missileMesh(a: Assets): MissileView {
  const root = new Group();
  const body = new Mesh(a.missileBody, a.missileBodyMat);
  body.position.x = -0.15;
  const nose = new Mesh(a.missileNose, a.missileNoseMat);
  nose.position.x = 0.3;
  root.add(body, nose);
  for (const rotation of [0, Math.PI / 2]) {
    const fin = new Mesh(a.missileFin, a.missileNoseMat);
    fin.position.x = -0.36;
    fin.rotation.x = rotation;
    root.add(fin);
  }
  const flame = new Mesh(a.missileFlame, a.flameMat);
  flame.position.x = -0.7;
  root.add(flame);
  return { root, flame };
}

/** The bomb: a black ball with a fuse. The tip's material is set by the caller. */
function bombMesh(a: Assets): BombView {
  const root = new Group();
  const ball = new Mesh(a.bombBall, a.bombMat);
  ball.position.y = BOMB_Y;
  const fuse = new Mesh(a.fuse, a.fuseMat);
  fuse.position.y = 1.02;
  const tip = new Mesh(a.spark, a.sparkOff);
  tip.position.y = 1.18;
  root.add(ball, fuse, tip);
  return { root, tip };
}

/** The model for one pickup, centred on the bob line. Each kind looks like the item it gives. */
function pickupModel(kind: ItemKind, a: Assets): Group {
  const model = new Group();
  if (kind === 'missile') {
    const { root } = missileMesh(a);
    // Shift the missile so it's centred on its own origin before the tilt and scale apply.
    root.position.x = 0.25;
    const tilted = new Group();
    tilted.rotation.z = MISSILE_PICKUP_TILT;
    tilted.scale.setScalar(MISSILE_PICKUP_SCALE);
    tilted.add(root);
    model.add(tilted);
  } else {
    const { root, tip } = bombMesh(a);
    // A steady glow, not a blink, so it doesn't look like a live bomb.
    tip.material = a.sparkOn;
    root.scale.setScalar(PICKUP_SCALE);
    // The ball's bottom is at the origin of the model, so this lifts it to the floor line.
    root.position.y = PICKUP_FLOOR - BOX_Y;
    model.add(root);
  }
  model.traverse((o) => {
    if (o instanceof Mesh) o.castShadow = true;
  });
  return model;
}

/** Overshoots slightly past 1 on the way in, for a bouncy pop. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) ** 2;
}

/** Registers a material that belongs to one effect, so it can be disposed with it. */
function own<M extends Material>(list: Material[], material: M): M {
  list.push(material);
  return material;
}

export class ItemScene {
  readonly root = new Group();
  private readonly assets = createAssets();
  private readonly boxes: BoxView[];
  private readonly missiles = new Map<number, MissileView>();
  private readonly bombs = new Map<number, BombView>();
  private effects: Effect[] = [];
  private time = 0;

  constructor(private readonly items: ItemSystem) {
    items.hazards.forEach((hazard, i) => this.root.add(this.hazardMesh(hazard, i)));
    items.boostPads.forEach((pad) => this.root.add(this.boostPadMesh(pad)));
    this.boxes = items.pickups.map((pickup, i) => this.boxView(pickup, i));
  }

  /** Moves and animates everything for one frame. */
  update(dt: number): void {
    this.time += dt;
    this.updateBoxes(dt);
    this.updateMissiles();
    this.updateBombs();
    this.animateBoostArrows();
    this.updateEffects(dt);
  }

  /** Starts effects for what the sim reported since the last frame. */
  handleEvents(events: ItemEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'explode':
          this.addEffect(this.explosion(e.x, e.z));
          break;
        case 'splash':
          this.addEffect(this.splash(e.x, e.z));
          break;
        case 'slick':
          this.addEffect(this.puff(e.x, e.z));
          break;
        case 'pickup':
          this.addEffect(this.sparkle(e.x, e.z));
          break;
        case 'boost': {
          const pad = this.nearestBoostPad(e.x, e.z);
          if (pad) this.addEffect(this.boostFlash(pad));
          break;
        }
      }
    }
  }

  /** Removes every missile, bomb and effect, for a new race. */
  reset(): void {
    this.prune(this.missiles, new Set());
    this.prune(this.bombs, new Set());
    for (const effect of this.effects) this.discard(effect);
    this.effects = [];
  }

  private hazardMesh(h: Hazard, index: number): Group {
    const { blobs, oil, puddle, puddleRim } = this.assets;
    const group = new Group();
    group.position.set(h.x, HAZARD_Y, h.z);
    group.rotation.y = index * 1.7;
    const geom = blobs[index % blobs.length];

    if (h.kind === 'oil') {
      const pool = new Mesh(geom, oil);
      pool.scale.set(h.radius, 1, h.radius);
      pool.receiveShadow = true;
      group.add(pool);
    } else {
      // A lighter rim shows around a slightly smaller translucent pool.
      const rim = new Mesh(geom, puddleRim);
      rim.scale.set(h.radius, 1, h.radius);
      rim.receiveShadow = true;
      const pool = new Mesh(geom, puddle);
      pool.scale.set(h.radius * 0.86, 1, h.radius * 0.86);
      pool.position.y = 0.002;
      pool.renderOrder = 1;
      pool.receiveShadow = true;
      group.add(rim, pool);
    }
    return group;
  }

  private boxView(pickup: Pickup, i: number): BoxView {
    const holder = new Group();
    holder.add(pickupModel(pickup.kind, this.assets));
    this.root.add(holder);

    const base = new Group();
    base.position.set(pickup.x, 0, pickup.z);
    const ring = new Mesh(this.assets.pickupRing, this.assets.ringMats[pickup.kind]);
    ring.position.y = PICKUP_RING_Y;
    base.add(ring);
    this.root.add(base);

    return { pickup, holder, base, phase: i * 0.9, ready: pickup.respawn === 0, popAge: POP_TIME };
  }

  private updateBoxes(dt: number): void {
    // One opacity per kind, shared by all rings of that kind, so they pulse together.
    const pulse = 0.55 + 0.25 * Math.sin(this.time * 3);
    for (const kind of ITEM_KINDS) this.assets.ringMats[kind].opacity = pulse;

    for (const box of this.boxes) {
      const ready = box.pickup.respawn === 0;
      if (ready && !box.ready) box.popAge = 0;
      box.ready = ready;
      box.holder.visible = ready;
      box.base.visible = ready;
      if (!ready) continue;

      const { pickup, phase } = box;
      box.popAge = Math.min(POP_TIME, box.popAge + dt);
      const pop = Math.max(0.001, easeOutBack(box.popAge / POP_TIME));
      box.holder.position.set(pickup.x, BOX_Y + Math.sin(this.time * 2.4 + phase) * 0.12, pickup.z);
      box.holder.scale.setScalar(pop);
      // Sway around facing the camera rather than spinning, so slim pickups never turn edge-on.
      const sway = Math.sin(this.time * 1.3 + phase) * PICKUP_SWAY;
      box.holder.rotation.set(Math.sin(this.time * 1.7 + phase) * 0.12, FACE_CAMERA_YAW + sway, 0);
      box.base.scale.setScalar(pop);
    }
  }

  private updateMissiles(): void {
    const live = new Set<number>();
    for (const m of this.items.missiles) {
      live.add(m.id);
      let view = this.missiles.get(m.id);
      if (!view) {
        view = missileMesh(this.assets);
        this.missiles.set(m.id, view);
        this.root.add(view.root);
      }
      view.root.position.set(m.x, MISSILE_Y, m.z);
      // Three's Y rotation runs the opposite way to heading (see carModel.ts).
      view.root.rotation.y = -m.heading;
      view.flame.scale.x = 0.8 + 0.35 * Math.sin(this.time * 40 + m.id);
    }
    this.prune(this.missiles, live);
  }

  private updateBombs(): void {
    const live = new Set<number>();
    for (const b of this.items.bombs) {
      live.add(b.id);
      let view = this.bombs.get(b.id);
      if (!view) {
        view = bombMesh(this.assets);
        this.bombs.set(b.id, view);
        this.root.add(view.root);
      }
      view.root.position.set(b.x, 0, b.z);
      const rate = b.age < BOMB_ARM_AGE ? BOMB_BLINK_SLOW : BOMB_BLINK_FAST;
      const lit = Math.floor(b.age * rate) % 2 === 0;
      view.tip.material = lit ? this.assets.sparkOn : this.assets.sparkOff;
    }
    this.prune(this.bombs, live);
  }

  /** A flat base, a yellow border and three arrows, turned to the pad's heading. */
  private boostPadMesh(pad: BoostPad): Group {
    const { padBase, padBorder, padBaseMat, padBorderMat, chevron, chevronMats } = this.assets;
    const group = new Group();
    group.position.set(pad.x, BOOST_PAD_Y, pad.z);
    // Built along +X, then turned to the heading. Three's Y rotation runs the opposite way (see carModel.ts).
    group.rotation.y = -pad.heading;
    const border = new Mesh(padBorder, padBorderMat);
    border.position.y = 0.003;
    group.add(new Mesh(padBase, padBaseMat), border);
    // Arrow 0 is at the back of the pad, so the chase runs back to front.
    chevronMats.forEach((mat, i) => {
      const arrow = new Mesh(chevron, mat);
      arrow.position.set((i - (BOOST_ARROW_COUNT - 1) / 2) * BOOST_ARROW_SPACING, 0.006, 0);
      group.add(arrow);
    });
    group.traverse((o) => {
      if (o instanceof Mesh) o.receiveShadow = true;
    });
    return group;
  }

  /** Each arrow lights in turn, back to front, once per chase. The materials are shared, so all pads move together. */
  private animateBoostArrows(): void {
    this.assets.chevronMats.forEach((mat, i) => {
      const wave = 0.5 + 0.5 * Math.cos(2 * Math.PI * (this.time / CHASE_PERIOD - i * CHASE_LAG));
      mat.emissiveIntensity = 0.2 + 1.8 * wave ** 4;
    });
  }

  private nearestBoostPad(x: number, z: number): BoostPad | undefined {
    let best: BoostPad | undefined;
    let bestDistance = Infinity;
    for (const pad of this.items.boostPads) {
      const distance = Math.hypot(x - pad.x, z - pad.z);
      if (distance < bestDistance) {
        best = pad;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Removes views whose sim object has gone. Their meshes use shared assets, so nothing to dispose. */
  private prune<V extends { root: Group }>(views: Map<number, V>, live: Set<number>): void {
    for (const [id, view] of views) {
      if (live.has(id)) continue;
      view.root.removeFromParent();
      views.delete(id);
    }
  }

  private explosion(x: number, z: number): Effect {
    const { sphere, chunk } = this.assets;
    const life = 0.5;
    const materials: Material[] = [];
    const root = new Group();
    root.position.set(x, 0, z);

    const fireMat = own(materials, new MeshBasicMaterial({ color: '#ffb02e', transparent: true, depthWrite: false }));
    const fire = new Mesh(sphere, fireMat);
    fire.position.y = 0.5;
    root.add(fire);

    const debrisMat = own(materials, new MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.7 }));
    const debris = Array.from({ length: 6 }, () => {
      const mesh = new Mesh(chunk, debrisMat);
      root.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 3;
      return {
        mesh,
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        vy: 3 + Math.random() * 3,
        spin: (Math.random() - 0.5) * 20,
      };
    });

    return {
      root,
      life,
      age: 0,
      materials,
      step: (t) => {
        const s = t * life;
        fire.scale.setScalar(0.5 + 2 * easeOutQuad(t));
        fireMat.opacity = 0.9 * (1 - t);
        for (const d of debris) {
          d.mesh.position.set(d.vx * s, Math.max(0.15, 0.4 + d.vy * s - 0.5 * DEBRIS_GRAVITY * s * s), d.vz * s);
          d.mesh.rotation.set(d.spin * s, d.spin * s * 0.5, 0);
        }
      },
    };
  }

  private splash(x: number, z: number): Effect {
    const materials: Material[] = [];
    const mat = own(
      materials,
      new MeshBasicMaterial({ color: '#d4f1ff', transparent: true, depthWrite: false, side: DoubleSide }),
    );
    const ring = new Mesh(this.assets.ring, mat);
    const root = new Group();
    root.position.set(x, 0.04, z);
    root.add(ring);
    return {
      root,
      life: 0.45,
      age: 0,
      materials,
      step: (t) => {
        ring.scale.setScalar(0.5 + 1.8 * t);
        mat.opacity = 0.85 * (1 - t);
      },
    };
  }

  /** A dark puff of smoke where a car slides on oil. */
  private puff(x: number, z: number): Effect {
    const materials: Material[] = [];
    const mat = own(materials, new MeshBasicMaterial({ color: '#2a2a33', transparent: true, depthWrite: false }));
    const root = new Group();
    root.position.set(x, 0.35, z);
    for (const [ox, oy, oz, r] of [
      [0, 0, 0, 0.35],
      [0.25, 0.1, 0.15, 0.28],
      [-0.2, 0.05, -0.18, 0.3],
    ]) {
      const ball = new Mesh(this.assets.sphere, mat);
      ball.position.set(ox, oy, oz);
      ball.scale.setScalar(r);
      root.add(ball);
    }
    return {
      root,
      life: 0.6,
      age: 0,
      materials,
      step: (t) => {
        root.scale.setScalar(0.6 + 1.2 * t);
        root.position.y = 0.35 + 0.3 * t;
        mat.opacity = 0.7 * (1 - t);
      },
    };
  }

  /** A quick white sparkle where a pickup was collected. */
  private sparkle(x: number, z: number): Effect {
    const materials: Material[] = [];
    const mat = own(materials, new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
    const star = new Mesh(this.assets.star, mat);
    const root = new Group();
    root.position.set(x, BOX_Y, z);
    root.add(star);
    return {
      root,
      life: 0.4,
      age: 0,
      materials,
      step: (t) => {
        star.scale.setScalar(0.4 + 1.6 * easeOutQuad(t));
        star.rotation.y = t * 6;
        mat.opacity = 1 - t;
      },
    };
  }

  /** A yellow streak that runs out past both ends of a pad when a car boosts over it. */
  private boostFlash(pad: BoostPad): Effect {
    const materials: Material[] = [];
    const mat = own(
      materials,
      new MeshBasicMaterial({ color: '#fde047', transparent: true, depthWrite: false, blending: AdditiveBlending }),
    );
    const streak = new Mesh(this.assets.flashQuad, mat);
    streak.position.y = 0.04;
    const root = new Group();
    root.position.set(pad.x, 0, pad.z);
    root.rotation.y = -pad.heading;
    root.add(streak);
    return {
      root,
      life: BOOST_FLASH_LIFE,
      age: 0,
      materials,
      step: (t) => {
        streak.scale.set(BOOST_PAD_LENGTH * (0.8 + 0.6 * easeOutQuad(t)), 1, BOOST_PAD_WIDTH * (1 - 0.6 * t));
        mat.opacity = 1 - t;
      },
    };
  }

  private addEffect(effect: Effect): void {
    this.root.add(effect.root);
    this.effects.push(effect);
  }

  private updateEffects(dt: number): void {
    this.effects = this.effects.filter((effect) => {
      effect.age += dt;
      if (effect.age < effect.life) {
        effect.step(effect.age / effect.life);
        return true;
      }
      this.discard(effect);
      return false;
    });
  }

  private discard(effect: Effect): void {
    effect.root.removeFromParent();
    for (const material of effect.materials) material.dispose();
  }
}
