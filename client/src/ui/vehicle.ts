import { VEHICLE_IDS, VEHICLES, type VehicleId } from '../game/vehicles';
import { byId, type MenuCard } from './card';

// The pick screen shown when a season starts: one row per vehicle, and an easy mode switch. The
// card's markup lives in index.html; the rows are built once here, in the garage's style.

export interface VehicleActions {
  /** Starts a season in this vehicle, in easy mode or not. */
  choose(id: VehicleId, easy: boolean): void;
  /** Backs out to wherever the card was opened from, without touching the current season. */
  back(): void;
}

export class VehicleCard implements MenuCard {
  readonly root = byId('vehicle');
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly easyButton = byId<HTMLButtonElement>('vehicle-easy');
  private easy = false;

  constructor(
    private readonly actions: VehicleActions,
    /** Whether the current season is in easy mode, which the switch starts on. */
    private readonly currentEasy: () => boolean,
  ) {
    this.easyButton.addEventListener('click', () => this.setEasy(!this.easy));
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
      button.addEventListener('click', () => actions.choose(id, this.easy));

      item.append(head, text, button);
      list.append(item);
      this.buttons.push(button);
    }
    byId('vehicle-back').addEventListener('click', () => actions.back());
  }

  refresh(): void {
    this.setEasy(this.currentEasy());
  }

  private setEasy(easy: boolean): void {
    this.easy = easy;
    this.easyButton.textContent = easy ? 'Easy mode: On' : 'Easy mode: Off';
    this.easyButton.setAttribute('aria-pressed', String(easy));
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
