import type { CarInput } from './carPhysics';
import type { Action, InputSource } from './controls';

const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];
const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const HANDBRAKE = ['Space'];
const GAME_KEYS = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, ...HANDBRAKE]);

const ACTION_KEYS: Record<Action, string[]> = {
  fire: ['KeyX', 'ShiftLeft', 'ShiftRight'],
  reset: ['KeyR'],
  restart: ['KeyN'],
  confirm: ['Enter'],
  pause: ['Escape', 'KeyP'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
};

export class Keyboard implements InputSource {
  readonly kind = 'keyboard';
  private readonly down = new Set<string>();
  private readonly justPressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.justPressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    // Releasing keys while the window is unfocused never fires keyup.
    target.addEventListener('blur', () => this.down.clear());
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  carInput(): CarInput {
    return {
      throttle: (this.any(UP) ? 1 : 0) - (this.any(DOWN) ? 1 : 0),
      steer: (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0),
      handbrake: this.any(HANDBRAKE),
    };
  }

  /** True once per key press; cleared by endFrame(). */
  wasPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  pressed(action: Action): boolean {
    return ACTION_KEYS[action].some((code) => this.justPressed.has(code));
  }

  active(): boolean {
    return this.justPressed.size > 0 || this.down.size > 0;
  }

  endFrame(): void {
    this.justPressed.clear();
  }
}
