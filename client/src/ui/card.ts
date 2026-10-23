// The cards that sit over the game: the title screen, the pause menu and their panels. main.ts
// keeps them in a stack, shows only the top one, and lets Esc or pause back out of it. Markup
// lives in index.html; these classes wire up the buttons.

export interface MenuCard {
  readonly root: HTMLElement;
  /** The button Enter presses when nothing on the card has focus. */
  primary(): HTMLButtonElement | null;
  /** Called whenever the card comes to the top of the stack, so it can show current values. */
  refresh?(): void;
  /** Esc or pause: closes a confirmation the card is showing and returns true. Otherwise false. */
  dismiss?(): boolean;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

/** A card whose only button is Back. */
export class BackCard implements MenuCard {
  readonly root: HTMLElement;
  private readonly back: HTMLButtonElement;

  constructor(rootId: string, backId: string, onBack: () => void) {
    this.root = byId(rootId);
    this.back = byId<HTMLButtonElement>(backId);
    this.back.addEventListener('click', onBack);
  }

  primary(): HTMLButtonElement {
    return this.back;
  }
}

/** A button that flips between "Label: Off" and "Label: On". */
export class Toggle {
  on = false;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly label: string,
  ) {
    button.addEventListener('click', () => this.set(!this.on));
  }

  set(on: boolean): void {
    this.on = on;
    this.button.textContent = `${this.label}: ${on ? 'On' : 'Off'}`;
    this.button.setAttribute('aria-pressed', String(on));
  }
}
