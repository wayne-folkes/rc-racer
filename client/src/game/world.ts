import { AiDriver, rubberBand, type AiSkill } from './aiDriver';
import { createCar, DEFAULT_TUNING, stepCar, type CarInput, type CarState } from './carPhysics';
import { collideCars, collideWithWalls } from './collision';
import { Race, TOTAL_LAPS, type RaceEvent } from './race';
import { buildRacingLine, type RacingLine } from './racingLine';
import { gridPosition, OPPONENTS, PLAYER, type Opponent, type RacerInfo } from './racers';
import type { Projection, TrackPath } from './trackPath';

// Everything that happens in a race, without rendering: cars, AI, collisions and race rules.
// The game renders it; tests run it directly.

export const NO_INPUT: CarInput = { throttle: 0, steer: 0, handbrake: false };

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
}

export class RaceWorld {
  readonly line: RacingLine;
  readonly racers: Racer[];
  race: Race;
  /** The player's projection onto the track after the last step. */
  playerProj: Projection;

  constructor(
    readonly track: TrackPath,
    private readonly options: WorldOptions = {},
  ) {
    this.line = buildRacingLine(track);
    const opponents = options.opponents ?? OPPONENTS;
    const playerDriver = options.autopilot ? new AiDriver(track, this.line, options.autopilot) : null;
    this.racers = [
      { info: PLAYER, car: gridPosition(track, PLAYER.gridSlot), driver: playerDriver },
      ...opponents.map((o) => ({
        info: o,
        car: gridPosition(track, o.gridSlot),
        driver: new AiDriver(track, this.line, o.skill),
      })),
    ];
    this.race = this.newRace();
    this.playerProj = track.project(this.player.x, this.player.z);
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
    this.playerProj = this.track.project(this.player.x, this.player.z);
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
    const { race, track } = this;
    const cars = this.racers.map((r) => r.car);
    const playerProgress = race.progress(0);

    this.racers.forEach((racer, i) => {
      let input = NO_INPUT;
      if (race.controlsLocked) {
        // Nobody moves before GO.
      } else if (racer.driver) {
        const proj = track.project(racer.car.x, racer.car.z);
        const others = cars.filter((c) => c !== racer.car);
        // The player's own autopilot doesn't rubber-band against itself.
        const boost = i === 0 ? 1 : rubberBand(playerProgress - race.progress(i));
        const decision = racer.driver.drive(racer.car, proj, others, boost, dt);
        if (decision.respawn) this.resetCar(i);
        else input = decision.input;
      } else if (race.phase !== 'finished') {
        input = playerInput;
      }
      stepCar(racer.car, input, dt, racer.driver?.tuning ?? DEFAULT_TUNING);
    });

    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) collideCars(cars[i], cars[j]);
    }

    const projs = cars.map((car) => collideWithWalls(car, track).proj);
    this.playerProj = projs[0];
    return race.update(dt, projs.map((p) => p.distance));
  }
}
