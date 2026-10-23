import { MAX_UPGRADE_LEVEL, UPGRADE_KINDS, UPGRADES, type Season, type UpgradeKind } from '../game/season';

// The garage between races. The card's markup lives in index.html; this builds one row per upgrade
// once and updates them in place, so keyboard focus stays put after a purchase.

export interface GarageActions {
  /** Buys the next level of an upgrade. The garage refreshes itself afterwards. */
  buy(kind: UpgradeKind): void;
  /** Leaves the garage for the next race. */
  nextRace(): void;
}

interface UpgradeRow {
  pips: HTMLElement;
  button: HTMLButtonElement;
}

export class Garage {
  private readonly root = document.getElementById('garage')!;
  private readonly money = document.getElementById('garage-money')!;
  private readonly rows = new Map<UpgradeKind, UpgradeRow>();
  readonly next = document.getElementById('garage-next') as HTMLButtonElement;

  constructor(
    private readonly season: Season,
    private readonly actions: GarageActions,
  ) {
    const list = document.getElementById('garage-upgrades')!;
    for (const kind of UPGRADE_KINDS) {
      const item = document.createElement('li');
      item.className = 'upgrade';

      const head = document.createElement('div');
      head.className = 'upgrade-head';
      const name = document.createElement('span');
      name.className = 'upgrade-name';
      name.textContent = UPGRADES[kind].name;
      const pips = document.createElement('span');
      pips.className = 'upgrade-pips';
      pips.setAttribute('role', 'img');
      head.append(name, pips);

      const effect = document.createElement('p');
      effect.className = 'upgrade-effect';
      effect.textContent = UPGRADES[kind].effect;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'upgrade-buy';
      button.addEventListener('click', () => {
        this.actions.buy(kind);
        this.render();
      });

      item.append(head, effect, button);
      list.append(item);
      this.rows.set(kind, { pips, button });
    }
    this.next.addEventListener('click', () => this.actions.nextRace());
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.render();
    this.root.hidden = false;
    this.next.focus();
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Brings the money, level pips, prices and next-race label up to date with the season. */
  render(): void {
    const { state } = this.season;
    this.money.textContent = `$${state.money}`;

    for (const kind of UPGRADE_KINDS) {
      const { pips, button } = this.rows.get(kind)!;
      const level = state.levels[kind];
      pips.textContent = '●'.repeat(level) + '○'.repeat(MAX_UPGRADE_LEVEL - level);
      pips.setAttribute('aria-label', `Level ${level} of ${MAX_UPGRADE_LEVEL}`);

      const price = this.season.price(kind);
      button.disabled = !this.season.canBuy(kind);
      button.textContent = price === null ? 'Maxed' : `Buy · $${price}`;
    }

    const upcoming = this.season.tracks[state.round + 1];
    this.next.textContent = upcoming
      ? `Next race: Round ${state.round + 2} · ${upcoming.name}`
      : 'Next race';
  }
}
