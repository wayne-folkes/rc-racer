import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
} from 'three';
import { forwardSpeed, type CarState } from './carPhysics';

const WHEEL_RADIUS = 0.34;
const MAX_WHEEL_TURN = 0.5;

// A low-poly RC buggy built from boxes and cylinders. The model faces +X.
export class CarModel {
  readonly root = new Group();
  private readonly frontPivots: Group[] = [];
  private readonly wheels: Mesh[] = [];
  private readonly body = new Group();

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
    this.root.add(this.body);

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
        this.root.add(pivot);
        this.wheels.push(wheel);
        if (front) this.frontPivots.push(pivot);
      }
    }
  }

  sync(car: CarState, dt: number): void {
    this.root.position.set(car.x, 0, car.z);
    // Heading turns +X towards +Z; Three's Y rotation turns +X towards -Z.
    this.root.rotation.y = -car.heading;

    for (const pivot of this.frontPivots) pivot.rotation.y = -car.steer * MAX_WHEEL_TURN;
    const spin = (forwardSpeed(car) / WHEEL_RADIUS) * dt;
    for (const wheel of this.wheels) wheel.rotation.z -= spin;

    // A little body roll into corners sells the motion.
    const roll = car.steer * Math.min(1, Math.abs(forwardSpeed(car)) / 20) * 0.08;
    this.body.rotation.x += (roll - this.body.rotation.x) * Math.min(1, dt * 8);
  }
}
