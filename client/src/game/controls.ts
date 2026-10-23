import type { CarInput } from './carPhysics';

// One place the game reads input from, whatever it comes from: keyboard, gamepad or touch.
// Driving is merged across sources (the strongest input on each axis wins), and one-off
// actions fire if any source pressed them this frame.

export type Action =
  /** Use the held item. */
  | 'fire'
  /** Put the car back on the track. */
  | 'reset'
  /** Restart the race from the grid. */
  | 'restart'
  /** Press the focused (or main) button on a menu card. */
  | 'confirm'
  /** Open or close the pause menu. */
  | 'pause'
  /** Move focus between buttons on a menu card. */
  | 'up'
  | 'down'
  | 'left'
  | 'right';

export type SourceKind = 'keyboard' | 'gamepad' | 'touch';

export interface InputSource {
  readonly kind: SourceKind;
  /** Reads the device, once per frame, before anything asks for input. */
  poll?(): void;
  carInput(): CarInput;
  /** True if the action was pressed since the last endFrame(). */
  pressed(action: Action): boolean;
  /** True if the source was used since the last endFrame(), to tell which device is in play. */
  active(): boolean;
  endFrame(): void;
}

const strongest = (values: number[]) => values.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);

export function mergeCarInputs(inputs: CarInput[]): CarInput {
  return {
    throttle: strongest(inputs.map((i) => i.throttle)),
    steer: strongest(inputs.map((i) => i.steer)),
    handbrake: inputs.some((i) => i.handbrake),
  };
}

export class Controls {
  /** The device used most recently, for showing the right button hints. */
  lastUsed: SourceKind = 'keyboard';

  constructor(private readonly sources: InputSource[]) {}

  /** Call once at the start of each frame. */
  poll(): void {
    for (const s of this.sources) {
      s.poll?.();
      if (s.active()) this.lastUsed = s.kind;
    }
  }

  carInput(): CarInput {
    return mergeCarInputs(this.sources.map((s) => s.carInput()));
  }

  pressed(action: Action): boolean {
    return this.sources.some((s) => s.pressed(action));
  }

  /** Call once at the end of each frame, after every pressed() check. */
  endFrame(): void {
    for (const s of this.sources) s.endFrame();
  }
}
