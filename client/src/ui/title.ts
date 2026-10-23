import { formatTime } from '../game/race';
import { loadRecords } from '../game/records';
import { TRACKS } from '../game/tracks';
import { VEHICLE_IDS, VEHICLES, type VehicleId } from '../game/vehicles';
import { BackCard, byId, type MenuCard } from './card';

// The title screen, and the Records panel it opens. Records are read from storage each time the
// panel opens, so they're always current. How to play is static text, so it's a plain BackCard.

export interface TitleInfo {
  /** Label for the Continue button, or null when there's no season to carry on with. */
  continueLabel: string | null;
  /** A season is saved and not over, so starting a new one asks first. */
  inProgress: boolean;
}

export interface TitleActions {
  continueSeason(): void;
  newSeason(): void;
  records(): void;
  settings(): void;
  howToPlay(): void;
}

export class TitleCard implements MenuCard {
  readonly root = byId('title');
  private readonly menu = byId('title-menu');
  private readonly continueButton = byId<HTMLButtonElement>('title-continue');
  private readonly newButton = byId<HTMLButtonElement>('title-new');
  private readonly confirmBox = byId('title-confirm');
  private readonly cancelButton = byId<HTMLButtonElement>('title-confirm-no');
  private inProgress = false;

  constructor(
    private readonly info: () => TitleInfo,
    actions: TitleActions,
  ) {
    this.continueButton.addEventListener('click', () => actions.continueSeason());
    this.newButton.addEventListener('click', () => {
      if (this.inProgress) this.askConfirm(true);
      else actions.newSeason();
    });
    byId('title-confirm-yes').addEventListener('click', () => actions.newSeason());
    this.cancelButton.addEventListener('click', () => this.askConfirm(false));
    byId('title-records-open').addEventListener('click', () => actions.records());
    byId('title-settings-open').addEventListener('click', () => actions.settings());
    byId('title-howto-open').addEventListener('click', () => actions.howToPlay());
  }

  refresh(): void {
    const { continueLabel, inProgress } = this.info();
    this.inProgress = inProgress;
    this.continueButton.hidden = continueLabel === null;
    this.continueButton.textContent = continueLabel ?? '';
    // With Continue on the card, New season steps back to a secondary button.
    this.newButton.classList.toggle('results-button-secondary', continueLabel !== null);
    this.askConfirm(false);
  }

  primary(): HTMLButtonElement {
    if (!this.confirmBox.hidden) return this.cancelButton;
    return this.continueButton.hidden ? this.newButton : this.continueButton;
  }

  dismiss(): boolean {
    if (this.confirmBox.hidden) return false;
    this.askConfirm(false);
    return true;
  }

  private askConfirm(on: boolean): void {
    this.menu.hidden = on;
    this.confirmBox.hidden = !on;
  }
}

/**
 * One row per track: the best race and best lap in the chosen vehicle, or a dash where there's no
 * time yet. A button per vehicle switches between them.
 */
export class RecordsCard extends BackCard {
  private readonly list = byId('records-list');
  private readonly tabs = new Map<VehicleId, HTMLButtonElement>();

  constructor(
    onBack: () => void,
    /** The vehicle being driven this season, which the card opens on. */
    private readonly currentVehicle: () => VehicleId,
  ) {
    super('records', 'records-back', onBack);
    const tabs = byId('records-tabs');
    for (const id of VEHICLE_IDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'records-tab';
      button.textContent = VEHICLES[id].name;
      button.addEventListener('click', () => this.show(id));
      tabs.append(button);
      this.tabs.set(id, button);
    }
  }

  refresh(): void {
    this.show(this.currentVehicle());
  }

  private show(vehicle: VehicleId): void {
    for (const [id, button] of this.tabs) button.setAttribute('aria-pressed', String(id === vehicle));
    const rows = TRACKS.map((def) => {
      const { bestRace, bestLap } = loadRecords(vehicle, def.id);
      return recordRow(def.name, bestRace === null ? '—' : formatTime(bestRace), bestLap === null ? '—' : formatTime(bestLap));
    });
    this.list.replaceChildren(recordRow('Track', 'Race', 'Lap', true), ...rows);
  }
}

function recordRow(name: string, race: string, lap: string, head = false): HTMLLIElement {
  const row = document.createElement('li');
  row.className = head ? 'record-row is-head' : 'record-row';
  const cells = [name, race, lap].map((text, i) => {
    const cell = document.createElement('span');
    cell.className = i === 0 ? 'record-name' : 'record-time';
    cell.textContent = text;
    return cell;
  });
  row.append(...cells);
  return row;
}
