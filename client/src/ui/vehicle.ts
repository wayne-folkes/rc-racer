import { VEHICLE_IDS, VEHICLES, type VehicleId } from '../game/vehicles';
import { byId, type MenuCard } from './card';

// The pick screen shown when a season starts: one row per vehicle, and switches for easy mode and
// reverse tracks. The card's markup lives in index.html; the rows are built once here, in the
// garage's style.

export interface SeasonModes {
  easy: boolean;
  reverse: boolean;
}

export interface VehicleActions {
  /** Starts a season in this vehicle, with these modes. */
  choose(id: VehicleId, modes: SeasonModes): void;
  /** Backs out to wherever the card was opened from, without touching the current season. */
  back(): void;
}

/** A button that flips between "Label: Off" and "Label: On". */
class Toggle {
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

export class VehicleCard implements MenuCard {
  readonly root = byId('vehicle');
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly easy = new Toggle(byId<HTMLButtonElement>('vehicle-easy'), 'Easy mode');
  private readonly reverse = new Toggle(byId<HTMLButtonElement>('vehicle-reverse'), 'Reverse');

  constructor(
    private readonly actions: VehicleActions,
    /** The modes the current season is in, which the switches start on. */
    private readonly currentModes: () => SeasonModes,
  ) {
    const list = byId('vehicle-options');
    for (const id of VEHICLE_IDS) {
      const { name, blurb } = VEHICLES[id];
      const item = document.createElement('li');
      item.className = 'upgrade';

      const head = document.createElement('div');
      head.className = 'upgrade-head';
      const title = document.createElement('span');
      title.className = 'upgrade-name';
      title.textContent = name;
      head.append(title);

      const text = document.createElement('p');
      text.className = 'upgrade-effect';
      text.textContent = blurb;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'upgrade-buy';
      button.textContent = `Drive the ${name}`;
      button.addEventListener('click', () => actions.choose(id, { easy: this.easy.on, reverse: this.reverse.on }));

      item.append(head, text, button);
      list.append(item);
      this.buttons.push(button);
    }
    byId('vehicle-back').addEventListener('click', () => actions.back());
  }

  refresh(): void {
    const { easy, reverse } = this.currentModes();
    this.easy.set(easy);
    this.reverse.set(reverse);
  }

  /** Enter and the gamepad's A press the first vehicle, the buggy, when nothing has focus. */
  primary(): HTMLButtonElement {
    return this.buttons[0];
  }

  /** Esc or pause backs out of the card. */
  dismiss(): boolean {
    this.actions.back();
    return true;
  }
}
