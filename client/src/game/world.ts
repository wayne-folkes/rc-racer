import { AiDriver, rubberBand, type AiSkill, type Obstacle } from './aiDriver';
import {
  createCar,
  stepCar,
  type CarInput,
  type CarState,
  type CarTuning,
} from './carPhysics';
import { collideCars, collideWithWalls } from './collision';
import { airTuning, buildRamps, updateHeight, type JumpEvent, type Ramp } from './jumps';
import { BOOST_PAD_RADIUS, DEMO_LAYOUT, ItemSystem, SPIN_TIME, type RacerStatus, type TrackLayout } from './items';
import { Race, TOTAL_LAPS, type RaceEvent } from './race';
import { buildRacingLine, type RacingLine } from './racingLine';
import { gridPosition, OPPONENTS, startingGrid, type Opponent, type RacerInfo } from './racers';
import type { Projection, TrackPath } from './trackPath';
import { DEFAULT_VEHICLE, VEHICLES, type VehicleId } from './vehicles';

// Everything that happens in a race, without rendering: cars, AI, collisions and race rules.
// The game renders it; tests run it directly.

export const NO_INPUT: CarInput = { throttle: 0, steer: 0, handbrake: false };

/** Peak spin rate (rad/s) when hit; it winds down over the spin. */
const SPIN_RATE = 11;
const BOOST_SPEED = 1.35;
const BOOST_ACCEL = 1.8;
const SLICK_TURN = 0.6;
/** AI fires missiles at cars this far ahead along the track (m)... */
const AI_MISSILE_RANGE: [number, number] = [4, 35];
/** ...and drops bombs on cars this far behind, if they're in its lane (within this many metres). */
const AI_BOMB_RANGE: [number, number] = [2, 9];
const AI_BOMB_LANE = 1.8;
/** Handling for a car right now, with boosts and oil taken into account. */
export function effectiveTuning(base: CarTuning, status: RacerStatus): CarTuning {
  let t = base;
  if (status.boost > 0) t = { ...t, maxSpeed: t.maxSpeed * BOOST_SPEED, accel: t.accel * BOOST_ACCEL };
  if (status.slick > 0) {
    t = {
      ...t,
      grip: t.grip * t.slickGrip,
      driftGrip: t.driftGrip * t.slickGrip,
      maxTurnRate: t.maxTurnRate * SLICK_TURN,
    };
  }
  return t;
}

export interface Racer {
  info: RacerInfo;
  car: CarState;
  /** Null for a human-driven car. */
  driver: AiDriver | null;
}

export interface WorldOptions {
  opponents?: Opponent[];
  totalLaps?: number;
  /** Let an AI drive the player's car too (for tests). */
  autopilot?: AiSkill;
  layout?: TrackLayout;
  /** Seed for item boxes and oil, so races are repeatable. */
  seed?: number;
  /** What every car on the track drives: the baseline handling for the player, the opponents and the racing line. */
  vehicle?: VehicleId;
  /** The player's car handling, e.g. with upgrades bought between races. Defaults to the vehicle's own. */
  playerTuning?: CarTuning;
  /** Multiplier on every opponent's pace; the season raises it round by round. */
  opponentPace?: number;
  /** Easy mode: the player starts 2nd, and cars that get well ahead ease off more. */
  easy?: boolean;
}

export class RaceWorld {
  readonly line: RacingLine;
  readonly racers: Racer[];
  race: Race;
  readonly items: ItemSystem;
  readonly ramps: Ramp[];
  /** Jumps and landings since the last drainJumps(), for sounds and dust. */
  private jumps: { type: JumpEvent; racer: number; x: number; z: number }[] = [];
  private readonly playerTuning: CarTuning;
  /** The player's projection onto the track after the last step. */
  playerProj: Projection;
  /** Every car's projection after the last step. */
  private projs: Projection[];
  /** Item uses requested since the last step. */
  private readonly useRequested: boolean[];
  private hazardObstacles: Obstacle[] | null = null;
  private padTargets: Obstacle[] | null = null;

  constructor(
    readonly track: TrackPath,
    private readonly options: WorldOptions = {},
  ) {
    const vehicleTuning = VEHICLES[options.vehicle ?? DEFAULT_VEHICLE].tuning;
    this.line = buildRacingLine(track, vehicleTuning);
    const grid = startingGrid(options.opponents ?? OPPONENTS, options.easy ?? false);
    this.playerTuning = options.playerTuning ?? vehicleTuning;
    const playerDriver = options.autopilot
      ? new AiDriver(track, this.line, options.autopilot, this.playerTuning)
      : null;
    const opponentPace = options.opponentPace ?? 1;
    this.racers = [
      { info: grid.player, car: gridPosition(track, grid.player.gridSlot), driver: playerDriver },
      ...grid.opponents.map((o) => ({
        info: o,
        car: gridPosition(track, o.gridSlot),
        driver: new AiDriver(track, this.line, { ...o.skill, pace: o.skill.pace * opponentPace }, vehicleTuning),
      })),
    ];
    this.race = this.newRace();
    const layout = options.layout ?? DEMO_LAYOUT;
    this.items = new ItemSystem(track, this.racers.length, layout, options.seed);
    this.ramps = buildRamps(track, layout.ramps ?? []);
    this.useRequested = this.racers.map(() => false);
    this.projs = this.racers.map((r) => track.project(r.car.x, r.car.z));
    this.playerProj = this.projs[0];
  }

  get player(): CarState {
    return this.racers[0].car;
  }

  private newRace(): Race {
    return new Race(this.track.length, this.racers.length, this.options.totalLaps ?? TOTAL_LAPS);
  }

  /** Puts every car back on the grid and starts a new countdown. */
  restart(): void {
    for (const r of this.racers) {
      Object.assign(r.car, gridPosition(this.track, r.info.gridSlot));
      r.driver?.reset();
    }
    this.race = this.newRace();
    this.items.reset();
    this.useRequested.fill(false);
    this.projs = this.racers.map((r) => this.track.project(r.car.x, r.car.z));
    this.playerProj = this.projs[0];
  }

  /** Asks to use a racer's held item on the next step (e.g. when the player presses fire). */
  useItem(racer: number): void {
    this.useRequested[racer] = true;
  }

  /** Puts a car back on the centreline nearest to it, facing the way the track runs. */
  resetCar(index: number): void {
    const { car, driver } = this.racers[index];
    const proj = this.track.project(car.x, car.z);
    const p = this.track.points[proj.index];
    Object.assign(car, createCar(p.x, p.z, Math.atan2(proj.tz, proj.tx)));
    this.race.racers[index].resetPosition();
    driver?.reset();
  }

  step(dt: number, playerInput: CarInput): RaceEvent[] {
    const { race, track, items } = this;
    const cars = this.racers.map((r) => r.car);
    const playerProgress = race.progress(0);
    const obstacles = this.obstacles();

    this.racers.forEach((racer, i) => {
      const status = items.status[i];
      let input = NO_INPUT;
      if (race.controlsLocked || status.spin > 0) {
        // Nobody moves before GO, and a spinning car is out of control.
      } else if (racer.driver) {
        const proj = track.project(racer.car.x, racer.car.z);
        const others = cars.filter((c) => c !== racer.car);
        // The player's own autopilot doesn't rubber-band against itself.
        const boost = i === 0 ? 1 : rubberBand(playerProgress - race.progress(i), this.options.easy);
        const decision = racer.driver.drive(racer.car, proj, others, boost, dt, obstacles, this.boostPadTargets());
        if (decision.respawn) this.resetCar(i);
        else input = decision.input;
        if (this.aiWantsItem(i, proj)) this.useRequested[i] = true;
      } else if (race.phase !== 'finished') {
        input = playerInput;
      }

      const base = racer.driver?.tuning ?? this.playerTuning;
      // In the air there's nothing to push against: no steering, throttle or grip.
      if (racer.car.airborne) stepCar(racer.car, NO_INPUT, dt, airTuning(base));
      else stepCar(racer.car, input, dt, effectiveTuning(base, status));
      if (status.spin > 0) racer.car.heading += SPIN_RATE * (status.spin / SPIN_TIME) * dt;
      if (status.inPuddle) {
        const keep = Math.exp(-base.puddleDrag * dt);
        racer.car.vx *= keep;
        racer.car.vz *= keep;
      }
    });

    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) collideCars(cars[i], cars[j]);
    }

    this.projs = cars.map((car) => collideWithWalls(car, track, dt).proj);
    this.playerProj = this.projs[0];
    cars.forEach((car, i) => {
      const jump = updateHeight(car, this.projs[i], this.ramps, track.length, dt);
      if (jump) this.jumps.push({ type: jump, racer: i, x: car.x, z: car.z });
    });

    this.useRequested.forEach((wanted, i) => {
      if (!wanted) return;
      this.useRequested[i] = false;
      const racing = race.phase === 'racing' || (race.phase === 'finished' && i !== 0);
      if (racing && race.finishTimes[i] === null) items.use(i, cars[i], this.projs[i], this.projs);
    });
    items.update(dt, cars, this.projs);

    return race.update(dt, this.projs.map((p) => p.distance));
  }

  /** Returns and clears the jumps and landings since the last call. */
  drainJumps(): { type: JumpEvent; racer: number; x: number; z: number }[] {
    const jumps = this.jumps;
    this.jumps = [];
    return jumps;
  }

  /** Oil, puddles and bombs, for the AI to steer around. */
  private obstacles(): Obstacle[] {
    const obstacle = (x: number, z: number, radius: number) => {
      const { distance, lateral } = this.track.project(x, z);
      return { distance, lateral, radius };
    };
    // Hazards never move, so they're only projected onto the track once.
    this.hazardObstacles ??= this.items.hazards.map((h) => obstacle(h.x, h.z, h.radius));
    return [...this.hazardObstacles, ...this.items.bombs.map((b) => obstacle(b.x, b.z, 1.2))];
  }

  /** Boost pads in track coordinates, for the AI to aim at. They never move, so this is cached. */
  private boostPadTargets(): Obstacle[] {
    this.padTargets ??= this.items.boostPads.map((p) => {
      const { distance, lateral } = this.track.project(p.x, p.z);
      return { distance, lateral, radius: BOOST_PAD_RADIUS };
    });
    return this.padTargets;
  }

  /** Simple tactics: fire at cars just ahead, bomb cars close behind. */
  private aiWantsItem(i: number, proj: Projection): boolean {
    const { item, holdTime } = this.items.status[i];
    // Each car waits a slightly different moment before using what it picked up.
    if (!item || holdTime < 1.2 + ((i * 0.37) % 1.2)) return false;

    const me = this.race.progress(i);
    const others = this.racers.map((_, j) => j).filter((j) => j !== i);
    const gap = (j: number) => this.race.progress(j) - me;
    if (item === 'missile') return others.some((j) => gap(j) > AI_MISSILE_RANGE[0] && gap(j) < AI_MISSILE_RANGE[1]);
    if (item === 'bomb') {
      // The leader doesn't bomb its chasers: that would make it all but impossible to catch.
      if (this.race.position(i) === 1) return false;
      return others.some(
        (j) =>
          -gap(j) > AI_BOMB_RANGE[0] &&
          -gap(j) < AI_BOMB_RANGE[1] &&
          Math.abs(this.projs[j].lateral - proj.lateral) < AI_BOMB_LANE,
      );
    }
    return false;
  }
}
