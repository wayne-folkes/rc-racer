import { CIRCUIT_IDS, CIRCUITS, type CircuitId } from '../game/tracks';
import { byId, Toggle, type MenuCard } from './card';

// The first pick screen when a season starts: one row per circuit, and a switch for reverse tracks. It
// is built like the vehicle card, which comes next.

export interface CircuitActions {
  /** Moves on to the vehicle pick, with this circuit and direction. */
  choose(id: CircuitId, reverse: boolean): void;
  /** Backs out to wherever the card was opened from, without touching the current season. */
  back(): void;
}

export class CircuitCard implements MenuCard {
  readonly root = byId('circuit');
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly reverse = new Toggle(byId<HTMLButtonElement>('circuit-reverse'), 'Reverse');

  constructor(
    private readonly actions: CircuitActions,
    /** Whether the current season is reversed, which the switch starts on. */
    private readonly currentReverse: () => boolean,
  ) {
    const list = byId('circuit-options');
    for (const id of CIRCUIT_IDS) {
      const { name, blurb } = CIRCUITS[id];
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
      button.textContent = `Race the ${name}`;
      button.addEventListener('click', () => actions.choose(id, this.reverse.on));

      item.append(head, text, button);
      list.append(item);
      this.buttons.push(button);
    }
    byId('circuit-back').addEventListener('click', () => actions.back());
  }

  refresh(): void {
    this.reverse.set(this.currentReverse());
  }

  /** Enter and the gamepad's A press the first circuit when nothing has focus. */
  primary(): HTMLButtonElement {
    return this.buttons[0];
  }

  /** Esc or pause backs out of the card. */
  dismiss(): boolean {
    this.actions.back();
    return true;
  }
}
