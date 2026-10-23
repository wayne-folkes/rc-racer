import { formatTime } from '../game/race';
import { loadRecords } from '../game/records';
import { CIRCUIT_IDS, CIRCUITS, circuitTracks, DEFAULT_CIRCUIT, type CircuitId } from '../game/tracks';
import { DEFAULT_VEHICLE, VEHICLE_IDS, VEHICLES, type VehicleId } from '../game/vehicles';
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
 * One row per track: the best race and best lap in the chosen circuit, vehicle and direction, or a dash
 * where there's no time yet. Buttons switch between circuits, vehicles, and forward and reverse.
 */
export class RecordsCard extends BackCard {
  private readonly list = byId('records-list');
  private readonly circuitTabs = new Map<CircuitId, HTMLButtonElement>();
  private readonly vehicleTabs = new Map<VehicleId, HTMLButtonElement>();
  private readonly directionTabs = new Map<boolean, HTMLButtonElement>();
  private circuit: CircuitId = DEFAULT_CIRCUIT;
  private vehicle: VehicleId = DEFAULT_VEHICLE;
  private reverse = false;

  constructor(
    onBack: () => void,
    /** The circuit, vehicle and direction of this season, which the card opens on. */
    private readonly current: () => { circuit: CircuitId; vehicle: VehicleId; reverse: boolean },
  ) {
    super('records', 'records-back', onBack);
    const tab = (group: string, label: string, onClick: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'records-tab';
      button.textContent = label;
      button.addEventListener('click', onClick);
      byId(group).append(button);
      return button;
    };
    for (const id of CIRCUIT_IDS) {
      this.circuitTabs.set(id, tab('records-circuits', CIRCUITS[id].name, () => this.show(id, this.vehicle, this.reverse)));
    }
    for (const id of VEHICLE_IDS) {
      this.vehicleTabs.set(id, tab('records-tabs', VEHICLES[id].name, () => this.show(this.circuit, id, this.reverse)));
    }
    for (const reverse of [false, true]) {
      this.directionTabs.set(reverse, tab('records-directions', reverse ? 'Reverse' : 'Forward', () => this.show(this.circuit, this.vehicle, reverse)));
    }
  }

  refresh(): void {
    const { circuit, vehicle, reverse } = this.current();
    this.show(circuit, vehicle, reverse);
  }

  private show(circuit: CircuitId, vehicle: VehicleId, reverse: boolean): void {
    this.circuit = circuit;
    this.vehicle = vehicle;
    this.reverse = reverse;
    for (const [id, button] of this.circuitTabs) button.setAttribute('aria-pressed', String(id === circuit));
    for (const [id, button] of this.vehicleTabs) button.setAttribute('aria-pressed', String(id === vehicle));
    for (const [isReverse, button] of this.directionTabs) button.setAttribute('aria-pressed', String(isReverse === reverse));
    // A reversed track keeps its name, so the rows read the same either way round.
    const forward = circuitTracks(circuit, false);
    const rows = circuitTracks(circuit, reverse).map((def, i) => {
      const { bestRace, bestLap } = loadRecords(vehicle, def.id);
      return recordRow(forward[i].name, bestRace === null ? '—' : formatTime(bestRace), bestLap === null ? '—' : formatTime(bestLap));
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
