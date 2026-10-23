import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
} from 'three';
import { forwardSpeed, type CarState } from './carPhysics';
import type { VehicleId } from './vehicles';

const MAX_WHEEL_TURN = 0.5;
/** The most the nose can tip up or down (rad) on a ramp, a jump or a landing. */
const MAX_PITCH = 0.35;
/** How quickly the nose follows the tilt it's aiming for (1/s). */
const PITCH_RATE = 8;

interface Paints {
  paint: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  lamp: MeshStandardMaterial;
}

/** Adds one box to the body: size, material, then centre. */
type AddPart = (w: number, h: number, d: number, mat: MeshStandardMaterial, x: number, y: number, z: number) => Mesh;

/** What makes one vehicle look different from another. Everything else about the model is shared. */
interface Shape {
  wheelRadius: number;
  wheelWidth: number;
  /** Wheel centres: the front and rear axles (x) and how far out the wheels sit (z). */
  frontX: number;
  rearX: number;
  halfTrack: number;
  /** Where the boost flame trails from. */
  flameX: number;
  flameY: number;
  /** Adds the body's boxes. */
  build(add: AddPart, m: Paints): void;
}

const SHAPES: Record<VehicleId, Shape> = {
  buggy: {
    wheelRadius: 0.34,
    wheelWidth: 0.32,
    frontX: 0.72,
    rearX: -0.72,
    halfTrack: 0.68,
    flameX: -1.45,
    flameY: 0.45,
    build(add, { paint, dark, glass }) {
      add(2.2, 0.32, 1.1, paint, 0, 0.42, 0); // chassis
      add(0.6, 0.22, 1.0, paint, 0.95, 0.38, 0); // nose
      add(1.0, 0.36, 0.86, dark, -0.15, 0.74, 0); // cabin
      add(0.5, 0.3, 0.8, glass, 0.3, 0.72, 0).rotation.z = -0.35; // windscreen
      add(0.12, 0.42, 0.12, dark, -0.95, 0.8, 0.35); // wing struts
      add(0.12, 0.42, 0.12, dark, -0.95, 0.8, -0.35);
      add(0.5, 0.06, 1.4, paint, -1.0, 1.03, 0); // rear wing
    },
  },
  // Tall, with big wheels outside a narrow body. It's no wider than the buggy where it counts: the
  // wheels' outer edge sits at the cars' collision radius.
  truck: {
    wheelRadius: 0.5,
    wheelWidth: 0.4,
    frontX: 0.82,
    rearX: -0.82,
    halfTrack: 0.7,
    flameX: -1.3,
    flameY: 0.9,
    build(add, { paint, dark, glass, lamp }) {
      add(2.5, 0.2, 0.8, dark, 0, 0.62, 0); // frame between the wheels
      add(2.2, 0.44, 1.0, paint, 0, 0.98, 0); // body
      add(0.8, 0.2, 0.96, paint, 0.78, 1.3, 0); // hood
      add(0.95, 0.44, 0.92, paint, -0.2, 1.42, 0); // cab
      add(0.4, 0.34, 0.86, glass, 0.3, 1.42, 0).rotation.z = -0.35; // windscreen
      add(0.12, 0.3, 1.0, dark, -1.08, 1.3, 0); // tailgate
      add(0.14, 0.22, 1.0, dark, 1.24, 0.82, 0); // front bumper
      add(0.14, 0.08, 0.8, dark, -0.05, 1.7, 0); // roof light bar
      for (const z of [-0.28, 0, 0.28]) add(0.1, 0.1, 0.14, lamp, -0.05, 1.78, z);
      for (const z of [-0.3, 0.3]) add(0.06, 0.14, 0.22, lamp, 1.12, 1.0, z); // headlights
    },
  },
};

// A low-poly RC car built from boxes and cylinders: a buggy or a monster truck. The model faces +X.
export class CarModel {
  readonly root = new Group();
  private readonly frontPivots: Group[] = [];
  private readonly wheels: Mesh[] = [];
  private readonly wheelRadius: number;
  private readonly body = new Group();
  /** Body and wheels together, so they tip as one when the car pitches. */
  private readonly chassis = new Group();
  private readonly boostFlame: Mesh;
  private pitch = 0;
  /** Height at the last frame, to work out how fast the car is rising or falling. */
  private lastY = 0;

  constructor(color: ColorRepresentation = '#e63946', vehicle: VehicleId = 'buggy') {
    const shape = SHAPES[vehicle];
    this.wheelRadius = shape.wheelRadius;
    const paints: Paints = {
      paint: new MeshStandardMaterial({ color, flatShading: true, roughness: 0.5 }),
      dark: new MeshStandardMaterial({ color: '#1d2430', flatShading: true, roughness: 0.8 }),
      glass: new MeshStandardMaterial({ color: '#9fd3ff', flatShading: true, roughness: 0.2 }),
      lamp: new MeshStandardMaterial({ color: '#fef08a', emissive: '#fde047', emissiveIntensity: 1.2, flatShading: true }),
    };
    const tyre = new MeshStandardMaterial({ color: '#222222', flatShading: true, roughness: 0.9 });
    const hub = new MeshStandardMaterial({ color: '#d9d9d9', flatShading: true, metalness: 0.3 });

    const add: AddPart = (w, h, d, mat, x, y, z) => {
      const m = new Mesh(new BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.body.add(m);
      return m;
    };
    shape.build(add, paints);

    // Boost flame, hidden until setBoosting(true). Its tip points back along -X.
    const flameGeom = new ConeGeometry(0.22, 0.7, 8);
    flameGeom.rotateZ(Math.PI / 2);
    const flameMat = new MeshStandardMaterial({ color: '#ffb703', emissive: '#ff6b00', emissiveIntensity: 2.5 });
    this.boostFlame = new Mesh(flameGeom, flameMat);
    this.boostFlame.position.set(shape.flameX, shape.flameY, 0);
    this.boostFlame.visible = false;
    this.body.add(this.boostFlame);
    this.chassis.add(this.body);
    this.root.add(this.chassis);

    const wheelGeom = new CylinderGeometry(shape.wheelRadius, shape.wheelRadius, shape.wheelWidth, 10);
    wheelGeom.rotateX(Math.PI / 2);
    const hubGeom = new CylinderGeometry(shape.wheelRadius * 0.47, shape.wheelRadius * 0.47, shape.wheelWidth + 0.02, 6);
    hubGeom.rotateX(Math.PI / 2);

    for (const [x, front] of [[shape.frontX, true], [shape.rearX, false]] as const) {
      for (const z of [shape.halfTrack, -shape.halfTrack]) {
        const pivot = new Group();
        pivot.position.set(x, shape.wheelRadius, z);
        const wheel = new Mesh(wheelGeom, tyre);
        wheel.castShadow = true;
        wheel.add(new Mesh(hubGeom, hub));
        pivot.add(wheel);
        this.chassis.add(pivot);
        this.wheels.push(wheel);
        if (front) this.frontPivots.push(pivot);
      }
    }
  }

  /** Shows or hides the boost flame. */
  setBoosting(on: boolean): void {
    this.boostFlame.visible = on;
  }

  sync(car: CarState, dt: number): void {
    this.root.position.set(car.x, car.y, car.z);
    if (this.boostFlame.visible) {
      // Flicker the flame's length and width every frame.
      const length = 0.8 + Math.random() * 0.5;
      const width = 0.9 + Math.random() * 0.2;
      this.boostFlame.scale.set(length, width, width);
    }
    // Heading turns +X towards +Z; Three's Y rotation turns +X towards -Z.
    this.root.rotation.y = -car.heading;

    for (const pivot of this.frontPivots) pivot.rotation.y = -car.steer * MAX_WHEEL_TURN;
    const spin = (forwardSpeed(car) / this.wheelRadius) * dt;
    for (const wheel of this.wheels) wheel.rotation.z -= spin;

    // A little body roll into corners sells the motion.
    const roll = car.steer * Math.min(1, Math.abs(forwardSpeed(car)) / 20) * 0.08;
    this.body.rotation.x += (roll - this.body.rotation.x) * Math.min(1, dt * 8);

    // Nose up while climbing, nose down while falling. The tilt is the climb over the forward speed, so
    // a car on a ramp sits on its slope and a jump follows its arc. The climb comes from the change in
    // height between frames: on a ramp the sim moves the height without any vertical speed.
    if (dt > 0) {
      const climb = (car.y - this.lastY) / dt;
      this.lastY = car.y;
      const along = forwardSpeed(car);
      const aim = Math.atan2(along < 0 ? -climb : climb, Math.abs(along));
      const target = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, aim));
      this.pitch += (target - this.pitch) * Math.min(1, dt * PITCH_RATE);
    }
    // Positive rotation about Z turns the car's nose (+X) up.
    this.chassis.rotation.z = this.pitch;
  }
}
