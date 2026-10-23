import { VEHICLE_IDS, VEHICLES, type VehicleId } from '../game/vehicles';
import { byId, type MenuCard } from './card';

// The pick screen shown when a season starts: one row per vehicle. The card's markup lives in
// index.html; the rows are built once here, in the garage's style.

export interface VehicleActions {
  /** Starts a season in this vehicle. */
  choose(id: VehicleId): void;
  /** Backs out to wherever the card was opened from, without touching the current season. */
  back(): void;
}

export class VehicleCard implements MenuCard {
  readonly root = byId('vehicle');
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(private readonly actions: VehicleActions) {
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
      button.addEventListener('click', () => actions.choose(id));

      item.append(head, text, button);
      list.append(item);
      this.buttons.push(button);
    }
    byId('vehicle-back').addEventListener('click', () => actions.back());
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
