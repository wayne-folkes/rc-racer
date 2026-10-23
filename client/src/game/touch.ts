import type { CarInput } from './carPhysics';
import type { Action, InputSource } from './controls';

// On-screen controls for touch screens. A joystick sits under the left thumb; gas, brake,
// drift and item sit under the right, with reset and pause small in the top-right corner.
// Every pointer is tracked by its id, so a thumb can slide off the joystick or a button and
// several buttons can be held at once. The overlay only shows on touch devices.

type Hold = 'gas' | 'brake' | 'drift';
type Tap = Extract<Action, 'fire' | 'reset' | 'pause'>;

/** Pushing the stick less than this far (of full travel) steers nothing, so a resting thumb doesn't wander. */
export const STICK_DEADZONE = 0.12;

/** How hard to steer, from -1 to 1, with the knob this far to the right of centre (negative: left). */
export function stickSteer(dx: number, travel: number): number {
  const pushed = Math.max(-1, Math.min(1, dx / travel));
  const beyond = (Math.abs(pushed) - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  return beyond <= 0 ? 0 : Math.sign(pushed) * beyond;
}

/** Where the knob is drawn: the thumb's offset from the centre, held inside the stick's travel. */
export function stickKnob(dx: number, dy: number, travel: number): { x: number; y: number } {
  const length = Math.hypot(dx, dy);
  if (length <= travel) return { x: dx, y: dy };
  return { x: (dx / length) * travel, y: (dy / length) * travel };
}

interface Press {
  el: HTMLElement;
  /** On the joystick: the steering this pointer asks for. */
  steer?: number;
}

const MARKUP = `
<div class="touch-stick" data-stick aria-label="Steer">
  <span class="touch-knob" aria-hidden="true"></span>
</div>
<div class="touch-right">
  <button type="button" class="touch-btn touch-item" data-tap="fire" aria-label="Use item">ITEM</button>
  <button type="button" class="touch-btn touch-drift" data-hold="drift">DRIFT</button>
  <button type="button" class="touch-btn touch-brake" data-hold="brake">BRAKE</button>
  <button type="button" class="touch-btn touch-gas" data-hold="gas">GAS</button>
</div>
<div class="touch-utility">
  <button type="button" class="touch-mini" data-tap="reset" aria-label="Reset car" title="Reset car">↺</button>
  <button type="button" class="touch-mini" data-tap="pause" aria-label="Pause" title="Pause">⏸</button>
</div>
`;

export class TouchControls implements InputSource {
  readonly kind = 'touch';
  private readonly root: HTMLElement;
  private readonly presses = new Map<number, Press>();
  /** Taps since the last endFrame(). */
  private readonly tapped = new Set<Tap>();
  private used = false;
  /** True once a touch has been seen, or the device reports a coarse pointer. */
  private enabled: boolean;
  /** Whether the game wants the overlay up (it hides behind menu cards). */
  private wanted = true;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.hidden = true;
    this.root.innerHTML = MARKUP;
    document.body.append(this.root);

    this.enabled = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch' && !this.enabled) {
          this.enabled = true;
          this.updateVisibility();
        }
      },
      { capture: true, passive: true },
    );
    this.updateVisibility();

    this.root.addEventListener('pointerdown', (e) => this.onDown(e));
    this.root.addEventListener('pointermove', (e) => this.onMove(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.root.addEventListener(type, (e) => this.release((e as PointerEvent).pointerId));
    }
    // A long press would otherwise bring up the browser's context menu.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS Safari zooms on a pinch whatever the viewport says, and the game uses two thumbs at once.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }
    // Switching away never sends pointerup, so let go of everything.
    window.addEventListener('blur', () => this.releaseAll());
  }

  /** True on a touch device, where the overlay is (or will be) shown. */
  get touchDevice(): boolean {
    return this.enabled;
  }

  /** Hides the overlay while a menu card is open. */
  setVisible(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (!on) this.releaseAll();
    this.updateVisibility();
  }

  carInput(): CarInput {
    const held = this.holds();
    const steers = [...this.presses.values()].map((press) => press.steer ?? 0);
    return {
      throttle: (held.has('gas') ? 1 : 0) - (held.has('brake') ? 1 : 0),
      steer: steers.reduce((best, s) => (Math.abs(s) > Math.abs(best) ? s : best), 0),
      handbrake: held.has('drift'),
    };
  }

  /** True once per tap; cleared by endFrame(). */
  pressed(action: Action): boolean {
    return this.tapped.has(action as Tap);
  }

  active(): boolean {
    return this.used;
  }

  endFrame(): void {
    this.tapped.clear();
    this.used = false;
  }

  private updateVisibility(): void {
    this.root.hidden = !(this.enabled && this.wanted);
  }

  private onDown(e: PointerEvent): void {
    const target = e.target as Element;
    const el = target.closest<HTMLElement>('[data-stick]') ?? target.closest<HTMLElement>('[data-hold],[data-tap]');
    if (!el) return;
    e.preventDefault();
    // Keep receiving this pointer's moves and release even when it slides off the button.
    el.setPointerCapture(e.pointerId);
    const press: Press = { el };
    this.presses.set(e.pointerId, press);
    if (el.hasAttribute('data-stick')) this.moveStick(press, e);
    const tap = el.dataset.tap as Tap | undefined;
    if (tap) this.tapped.add(tap);
    this.used = true;
    this.paint();
  }

  private onMove(e: PointerEvent): void {
    const press = this.presses.get(e.pointerId);
    if (press?.el.hasAttribute('data-stick')) this.moveStick(press, e);
  }

  /** Steers by how far the thumb is from the stick's centre, and moves the knob under it. */
  private moveStick(press: Press, e: PointerEvent): void {
    const stick = press.el;
    const knob = stick.querySelector<HTMLElement>('.touch-knob')!;
    const rect = stick.getBoundingClientRect();
    const travel = (rect.width - knob.getBoundingClientRect().width) / 2;
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    press.steer = stickSteer(dx, travel);
    const at = stickKnob(dx, dy, travel);
    knob.style.setProperty('--knob-x', `${at.x}px`);
    knob.style.setProperty('--knob-y', `${at.y}px`);
    this.paint();
  }

  private release(pointerId: number): void {
    if (!this.presses.delete(pointerId)) return;
    this.paint();
  }

  private releaseAll(): void {
    if (this.presses.size === 0) return;
    this.presses.clear();
    this.paint();
  }

  private holds(): Set<Hold> {
    const held = new Set<Hold>();
    for (const press of this.presses.values()) {
      const hold = press.el.dataset.hold as Hold | undefined;
      if (hold) held.add(hold);
    }
    return held;
  }

  /** Shows each control as pressed while a pointer is on it. */
  private paint(): void {
    const held = this.holds();
    const touched = new Set([...this.presses.values()].map((press) => press.el));
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-hold],[data-tap],[data-stick]')) {
      const on = el.dataset.hold ? held.has(el.dataset.hold as Hold) : touched.has(el);
      el.classList.toggle('is-pressed', on);
    }
    // A knob with nothing on it springs back to the middle.
    const knob = this.root.querySelector<HTMLElement>('.touch-knob')!;
    if (![...touched].some((el) => el.hasAttribute('data-stick'))) {
      knob.style.removeProperty('--knob-x');
      knob.style.removeProperty('--knob-y');
    }
  }
}
