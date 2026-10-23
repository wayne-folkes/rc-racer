import { OrthographicCamera, Vector3 } from 'three';
import type { CarState } from './carPhysics';

/** World units visible vertically on screen. */
const VIEW_HEIGHT = 36;
/** Direction from the target to the camera: a fixed 3/4 view from the south-west. */
const OFFSET = new Vector3(-0.55, 1.1, 1).normalize().multiplyScalar(120);
/** Y rotation that turns an object's +Z face towards the camera. */
export const FACE_CAMERA_YAW = Math.atan2(OFFSET.x, OFFSET.z);
/** Seconds of velocity to look ahead, so you see more of the road you're heading into. */
const LOOK_AHEAD = 0.45;
const FOLLOW_RATE = 5;

export class FollowCamera {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 1, 400);
  private readonly target = new Vector3();

  constructor() {
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(width: number, height: number): void {
    const aspect = width / height;
    // Keep at least VIEW_HEIGHT units across the shorter side, so phones in portrait still see the road.
    const halfH = (aspect >= 1 ? VIEW_HEIGHT : VIEW_HEIGHT / aspect) / 2;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.left = -halfH * aspect;
    this.camera.right = halfH * aspect;
    this.camera.updateProjectionMatrix();
  }

  snapTo(car: CarState): void {
    this.target.set(car.x, 0, car.z);
    this.apply();
  }

  update(car: CarState, dt: number): void {
    const goalX = car.x + car.vx * LOOK_AHEAD;
    const goalZ = car.z + car.vz * LOOK_AHEAD;
    const k = 1 - Math.exp(-FOLLOW_RATE * dt);
    this.target.x += (goalX - this.target.x) * k;
    this.target.z += (goalZ - this.target.z) * k;
    this.apply();
  }

  private apply(): void {
    this.camera.position.copy(this.target).add(OFFSET);
    this.camera.lookAt(this.target);
  }
}
