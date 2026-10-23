import type { CarInput } from './carPhysics';
import type { Action, InputSource } from './controls';

// Gamepad support through the browser Gamepad API, using the "standard" button layout that
// Xbox, PlayStation and most other controllers report:
//
//   Steer:      left stick or d-pad          Throttle: right trigger or A
//   Brake:      left trigger or X            Handbrake: either bumper
//   Fire item:  B                            Reset car: Y
//   Restart:    Back / Select                Menus: d-pad or stick to move, A or Start to press

/** The parts of a Gamepad this reads, so tests can pass plain objects. */
export interface PadSnapshot {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export const BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

/** Stick travel ignored around the centre, so a resting stick doesn't steer. */
const STICK_DEADZONE = 0.18;
/** Stick travel that counts as a d-pad press when moving around menus. */
const STICK_MENU_THRESHOLD = 0.6;

const ACTION_BUTTONS: Record<Action, number[]> = {
  fire: [BUTTON.b],
  reset: [BUTTON.y],
  restart: [BUTTON.back],
  confirm: [BUTTON.a, BUTTON.start],
  up: [BUTTON.up],
  down: [BUTTON.down],
  left: [BUTTON.left],
  right: [BUTTON.right],
};

const value = (pad: PadSnapshot, i: number) => {
  const b = pad.buttons[i];
  return b ? Math.max(b.value, b.pressed ? 1 : 0) : 0;
};
const held = (pad: PadSnapshot, i: number) => value(pad, i) > 0.5;

/** Rescales stick travel past the deadzone to 0..1, so steering starts gently from the centre. */
function deadzone(v: number): number {
  const mag = Math.abs(v);
  if (mag < STICK_DEADZONE) return 0;
  return Math.sign(v) * Math.min(1, (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE));
}

export function padCarInput(pad: PadSnapshot): CarInput {
  const dpad = (held(pad, BUTTON.right) ? 1 : 0) - (held(pad, BUTTON.left) ? 1 : 0);
  const stick = deadzone(pad.axes[0] ?? 0);
  const gas = Math.max(value(pad, BUTTON.rt), value(pad, BUTTON.a));
  const brake = Math.max(value(pad, BUTTON.lt), value(pad, BUTTON.x));
  return {
    throttle: gas - brake,
    steer: dpad !== 0 ? dpad : stick,
    handbrake: held(pad, BUTTON.lb) || held(pad, BUTTON.rb),
  };
}

/** Which actions are held right now. The stick doubles as a d-pad for menus. */
export function padActions(pad: PadSnapshot): Set<Action> {
  const actions = new Set<Action>();
  for (const [action, buttons] of Object.entries(ACTION_BUTTONS) as [Action, number[]][]) {
    if (buttons.some((b) => held(pad, b))) actions.add(action);
  }
  const [x = 0, y = 0] = pad.axes;
  if (y < -STICK_MENU_THRESHOLD) actions.add('up');
  if (y > STICK_MENU_THRESHOLD) actions.add('down');
  if (x < -STICK_MENU_THRESHOLD) actions.add('left');
  if (x > STICK_MENU_THRESHOLD) actions.add('right');
  return actions;
}

function isActive(pad: PadSnapshot): boolean {
  return pad.buttons.some((b) => b.pressed || b.value > 0.1) || pad.axes.some((a) => Math.abs(a) > STICK_DEADZONE);
}

export class GamepadInput implements InputSource {
  readonly kind = 'gamepad';
  private pad: Gamepad | null = null;
  private held = new Set<Action>();
  private justPressed = new Set<Action>();
  private used = false;

  constructor(private readonly getPads: () => (Gamepad | null)[] = () => navigator.getGamepads?.() ?? []) {}

  /** True while a controller is plugged in. */
  get connected(): boolean {
    return this.pad !== null;
  }

  poll(): void {
    // Use the first connected controller. Pads must be re-read every frame: some browsers hand
    // back a fresh snapshot each time rather than updating the old object.
    this.pad = this.getPads().find((p): p is Gamepad => p !== null && p.connected) ?? null;
    if (!this.pad) {
      this.held.clear();
      return;
    }
    const now = padActions(this.pad);
    for (const a of now) if (!this.held.has(a)) this.justPressed.add(a);
    this.held = now;
    if (isActive(this.pad)) this.used = true;
  }

  carInput(): CarInput {
    return this.pad ? padCarInput(this.pad) : { throttle: 0, steer: 0, handbrake: false };
  }

  pressed(action: Action): boolean {
    return this.justPressed.has(action);
  }

  active(): boolean {
    return this.used;
  }

  endFrame(): void {
    this.justPressed.clear();
    this.used = false;
  }

  /** A short buzz, on controllers that support it. */
  rumble(strength: number, ms: number): void {
    const actuator = (this.pad as (Gamepad & { vibrationActuator?: GamepadHapticActuator }) | null)?.vibrationActuator;
    actuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 })
      .catch(() => {
        // Not every controller or browser can rumble; it's only a nicety.
      });
  }
}
