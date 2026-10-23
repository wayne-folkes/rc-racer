import { DEFAULT_TUNING, type CarTuning } from './carPhysics';
import { TRACKS, type TrackDef } from './tracks';
import { DEFAULT_VEHICLE, VEHICLES, type VehicleId } from './vehicles';

// A season: one race per track, prize money by finishing position, upgrades bought between
// races, opponents getting quicker each round, and top three or it's game over. Pure state, so
// the game can save and restore it and tests can play it through.

export type UpgradeKind = 'engine' | 'tires' | 'battery';
export const UPGRADE_KINDS: UpgradeKind[] = ['engine', 'tires', 'battery'];

export const UPGRADES: Record<UpgradeKind, { name: string; effect: string }> = {
  engine: { name: 'Engine', effect: 'Higher top speed' },
  tires: { name: 'Tires', effect: 'More grip, sharper steering' },
  battery: { name: 'Battery', effect: 'Faster acceleration' },
};

export const MAX_UPGRADE_LEVEL = 3;
/** Price of each level: the first upgrade of a kind costs the first price, and so on. */
export const UPGRADE_PRICES = [150, 250, 400];
/** Prize money by finishing position (1st, 2nd, 3rd, 4th). */
export const PRIZE_MONEY = [300, 200, 120, 0];
/** Finish at or above this position to go through to the next round. */
export const QUALIFYING_POSITION = 3;
/** Retries of a failed race before the season is over. */
export const CONTINUES = 2;
/** Opponents start a little easier than a single race and get quicker each round, so upgrades
 * are needed to keep up. */
const FIRST_ROUND_PACE = 0.9;
const PACE_PER_ROUND = 0.05;
/** Easy mode takes this off the opponents' pace every round. */
const EASY_PACE_DROP = 0.06;

/** Per-level handling gains. */
const ENGINE_SPEED = 0.05;
const TIRES_GRIP = 0.12;
const TIRES_TURN = 0.05;
const BATTERY_ACCEL = 0.12;

export type SeasonStatus = 'racing' | 'shop' | 'failed' | 'gameOver' | 'champion';

export interface RaceResult {
  trackId: string;
  position: number;
  time: number;
  prize: number;
}

export interface SeasonState {
  /** Index into the season's tracks of the race being run or about to be run. */
  round: number;
  money: number;
  /** What the player drives all season. */
  vehicle: VehicleId;
  /** Easy mode: the player starts 2nd and the opponents are a little slower. */
  easy: boolean;
  levels: Record<UpgradeKind, number>;
  continuesLeft: number;
  results: RaceResult[];
  status: SeasonStatus;
}

export function newSeasonState(vehicle: VehicleId = DEFAULT_VEHICLE, easy = false): SeasonState {
  return {
    round: 0,
    money: 0,
    vehicle,
    easy,
    levels: { engine: 0, tires: 0, battery: 0 },
    continuesLeft: CONTINUES,
    results: [],
    status: 'racing',
  };
}

/** The player's handling with the given upgrades. */
export function upgradedTuning(levels: Record<UpgradeKind, number>, base: CarTuning = DEFAULT_TUNING): CarTuning {
  return {
    ...base,
    maxSpeed: base.maxSpeed * (1 + ENGINE_SPEED * levels.engine),
    grip: base.grip * (1 + TIRES_GRIP * levels.tires),
    driftGrip: base.driftGrip * (1 + TIRES_GRIP * levels.tires),
    maxTurnRate: base.maxTurnRate * (1 + TIRES_TURN * levels.tires),
    accel: base.accel * (1 + BATTERY_ACCEL * levels.battery),
  };
}

export class Season {
  state: SeasonState;

  constructor(
    readonly tracks: TrackDef[] = TRACKS,
    saved?: SeasonState,
  ) {
    this.state = saved && saved.round < tracks.length ? saved : newSeasonState();
  }

  get track(): TrackDef {
    return this.tracks[this.state.round];
  }

  /** 1-based round number, for display. */
  get roundNumber(): number {
    return this.state.round + 1;
  }

  get isFinalRound(): boolean {
    return this.state.round === this.tracks.length - 1;
  }

  /** Multiplier on opponents' pace for the current round. */
  get opponentPace(): number {
    return FIRST_ROUND_PACE + PACE_PER_ROUND * this.state.round - (this.state.easy ? EASY_PACE_DROP : 0);
  }

  get playerTuning(): CarTuning {
    return upgradedTuning(this.state.levels, VEHICLES[this.state.vehicle].tuning);
  }

  /** Price of the next level of an upgrade, or null when it's maxed out. */
  price(kind: UpgradeKind): number | null {
    const level = this.state.levels[kind];
    return level >= MAX_UPGRADE_LEVEL ? null : UPGRADE_PRICES[level];
  }

  canBuy(kind: UpgradeKind): boolean {
    const price = this.price(kind);
    return this.state.status === 'shop' && price !== null && this.state.money >= price;
  }

  buy(kind: UpgradeKind): boolean {
    if (!this.canBuy(kind)) return false;
    this.state.money -= this.price(kind)!;
    this.state.levels[kind]++;
    return true;
  }

  /**
   * Records the player's finish. Qualifying pays out and moves on to the shop (or wins the
   * season after the last round); missing out leaves the season 'failed' until the player
   * retries with a continue or starts over.
   */
  finishRace(position: number, time: number): SeasonStatus {
    const s = this.state;
    if (s.status !== 'racing') return s.status;
    const qualified = position <= QUALIFYING_POSITION;
    const prize = qualified ? PRIZE_MONEY[position - 1] ?? 0 : 0;
    s.money += prize;
    s.results.push({ trackId: this.track.id, position, time, prize });
    if (!qualified) s.status = s.continuesLeft > 0 ? 'failed' : 'gameOver';
    else s.status = this.isFinalRound ? 'champion' : 'shop';
    return s.status;
  }

  /** Leaves the shop for the next race. */
  nextRace(): void {
    if (this.state.status !== 'shop') return;
    this.state.round++;
    this.state.status = 'racing';
  }

  /** Spends a continue to run the failed race again. */
  retry(): boolean {
    if (this.state.status !== 'failed') return false;
    this.state.continuesLeft--;
    this.state.status = 'racing';
    return true;
  }

  /** Starts a fresh season from the first track, in the chosen vehicle and mode. */
  restart(vehicle: VehicleId = DEFAULT_VEHICLE, easy = false): void {
    this.state = newSeasonState(vehicle, easy);
  }
}
