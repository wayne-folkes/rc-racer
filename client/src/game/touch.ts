import type { CarInput } from './carPhysics';
import type { Action, InputSource } from './controls';

// On-screen controls for touch screens. A steering pad sits under the left thumb; gas, brake,
// drift and item sit under the right, with reset and pause small in the top-right corner.
// Every pointer is tracked by its id, so a thumb can slide across the steering pad and several
// buttons can be held at once. The overlay only shows on touch devices.

type Hold = 'left' | 'right' | 'gas' | 'brake' | 'drift';
type Tap = Extract<Action, 'fire' | 'reset' | 'pause'>;

interface Press {
  el: HTMLElement;
  /** On the steering pad: which half the pointer is over. */
  side?: 'left' | 'right';
}

const MARKUP = `
<div class="touch-steer" data-steer aria-label="Steer">
  <span class="touch-half" data-side="left" aria-hidden="true">◀</span>
  <span class="touch-half" data-side="right" aria-hidden="true">▶</span>
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
    return {
      throttle: (held.has('gas') ? 1 : 0) - (held.has('brake') ? 1 : 0),
      steer: (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0),
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
    const el = target.closest<HTMLElement>('[data-steer]') ?? target.closest<HTMLElement>('[data-hold],[data-tap]');
    if (!el) return;
    e.preventDefault();
    // Keep receiving this pointer's moves and release even when it slides off the button.
    el.setPointerCapture(e.pointerId);
    const press: Press = { el };
    if (el.hasAttribute('data-steer')) press.side = this.sideAt(el, e.clientX);
    this.presses.set(e.pointerId, press);
    const tap = el.dataset.tap as Tap | undefined;
    if (tap) this.tapped.add(tap);
    this.used = true;
    this.paint();
  }

  private onMove(e: PointerEvent): void {
    const press = this.presses.get(e.pointerId);
    if (!press?.el.hasAttribute('data-steer')) return;
    const side = this.sideAt(press.el, e.clientX);
    if (side === press.side) return;
    press.side = side;
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

  private sideAt(el: HTMLElement, x: number): 'left' | 'right' {
    const rect = el.getBoundingClientRect();
    return x < rect.left + rect.width / 2 ? 'left' : 'right';
  }

  private holds(): Set<Hold> {
    const held = new Set<Hold>();
    for (const press of this.presses.values()) {
      const hold = press.side ?? (press.el.dataset.hold as Hold | undefined);
      if (hold) held.add(hold);
    }
    return held;
  }

  /** Shows each control as pressed while a pointer is on it. */
  private paint(): void {
    const held = this.holds();
    const touched = new Set([...this.presses.values()].map((press) => press.el));
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-hold],[data-side],[data-tap]')) {
      const on = el.dataset.tap ? touched.has(el) : held.has((el.dataset.hold ?? el.dataset.side) as Hold);
      el.classList.toggle('is-pressed', on);
    }
  }
}
