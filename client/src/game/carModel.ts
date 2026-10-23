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

const WHEEL_RADIUS = 0.34;
const MAX_WHEEL_TURN = 0.5;
/** The most the nose can tip up or down (rad) on a ramp, a jump or a landing. */
const MAX_PITCH = 0.35;
/** How quickly the nose follows the tilt it's aiming for (1/s). */
const PITCH_RATE = 8;

// A low-poly RC buggy built from boxes and cylinders. The model faces +X.
export class CarModel {
  readonly root = new Group();
  private readonly frontPivots: Group[] = [];
  private readonly wheels: Mesh[] = [];
  private readonly body = new Group();
  /** Body and wheels together, so they tip as one when the car pitches. */
  private readonly chassis = new Group();
  private readonly boostFlame: Mesh;
  private pitch = 0;
  /** Height at the last frame, to work out how fast the car is rising or falling. */
  private lastY = 0;

  constructor(color: ColorRepresentation = '#e63946') {
    const paint = new MeshStandardMaterial({ color, flatShading: true, roughness: 0.5 });
    const dark = new MeshStandardMaterial({ color: '#1d2430', flatShading: true, roughness: 0.8 });
    const glass = new MeshStandardMaterial({ color: '#9fd3ff', flatShading: true, roughness: 0.2 });
    const tyre = new MeshStandardMaterial({ color: '#222222', flatShading: true, roughness: 0.9 });
    const hub = new MeshStandardMaterial({ color: '#d9d9d9', flatShading: true, metalness: 0.3 });

    const part = (w: number, h: number, d: number, mat: MeshStandardMaterial, x: number, y: number, z: number) => {
      const m = new Mesh(new BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.body.add(m);
      return m;
    };

    part(2.2, 0.32, 1.1, paint, 0, 0.42, 0); // chassis
    part(0.6, 0.22, 1.0, paint, 0.95, 0.38, 0); // nose
    part(1.0, 0.36, 0.86, dark, -0.15, 0.74, 0); // cabin
    part(0.5, 0.3, 0.8, glass, 0.3, 0.72, 0).rotation.z = -0.35; // windscreen
    part(0.12, 0.42, 0.12, dark, -0.95, 0.8, 0.35); // wing struts
    part(0.12, 0.42, 0.12, dark, -0.95, 0.8, -0.35);
    part(0.5, 0.06, 1.4, paint, -1.0, 1.03, 0); // rear wing

    // Boost flame, hidden until setBoosting(true). Its tip points back along -X.
    const flameGeom = new ConeGeometry(0.22, 0.7, 8);
    flameGeom.rotateZ(Math.PI / 2);
    const flameMat = new MeshStandardMaterial({ color: '#ffb703', emissive: '#ff6b00', emissiveIntensity: 2.5 });
    this.boostFlame = new Mesh(flameGeom, flameMat);
    this.boostFlame.position.set(-1.45, 0.45, 0);
    this.boostFlame.visible = false;
    this.body.add(this.boostFlame);
    this.chassis.add(this.body);
    this.root.add(this.chassis);

    const wheelGeom = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.32, 10);
    wheelGeom.rotateX(Math.PI / 2);
    const hubGeom = new CylinderGeometry(0.16, 0.16, 0.34, 6);
    hubGeom.rotateX(Math.PI / 2);

    for (const [x, front] of [[0.72, true], [-0.72, false]] as const) {
      for (const z of [0.68, -0.68]) {
        const pivot = new Group();
        pivot.position.set(x, WHEEL_RADIUS, z);
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
    const spin = (forwardSpeed(car) / WHEEL_RADIUS) * dt;
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
