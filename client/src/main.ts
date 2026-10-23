import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  Scene,
  WebGLRenderer,
} from 'three';
import './style.css';
import { createCar, speed, stepCar, type CarInput, type CarState } from './game/carPhysics';
import { CarModel } from './game/carModel';
import { collideWithWalls } from './game/collision';
import { FollowCamera } from './game/followCamera';
import { Keyboard } from './game/input';
import { formatTime, Race, type RaceEvent } from './game/race';
import { updateRecords } from './game/records';
import { buildTrackScene } from './game/trackScene';
import { DEMO_TRACK, TrackPath, type Projection } from './game/trackPath';

const STEP = 1 / 120;
const MAX_FRAME = 0.25;
const SHADOW_EXTENT = 40;
const GRID_OFFSET = 6;
const TRACK_ID = 'demo';
const NO_INPUT: CarInput = { throttle: 0, steer: 0, handbrake: false };
/** Dot product of car velocity and track direction below this means the car is going the wrong way. */
const WRONG_WAY_DOT = -3;
/** Seconds of wrong-way driving before the WRONG WAY banner shows. */
const WRONG_WAY_DELAY = 0.6;

type BannerTone = 'white' | 'green' | 'accent' | 'red';
interface Banner {
  text: string;
  tone: BannerTone;
}
interface TimedBanner extends Banner {
  seconds: number;
  onDone?: () => void;
}

const container = document.getElementById('app')!;
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color('#8fc7e8');
scene.add(new HemisphereLight('#dff1ff', '#5a7d3a', 1.6));

// The sun follows the car so its shadow map only has to cover the area on screen.
const sun = new DirectionalLight('#fff4dd', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {
  left: -SHADOW_EXTENT,
  right: SHADOW_EXTENT,
  top: SHADOW_EXTENT,
  bottom: -SHADOW_EXTENT,
  near: 1,
  far: 200,
});
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const track = new TrackPath(DEMO_TRACK, 5.5);
scene.add(buildTrackScene(track));

/** The player's grid slot, just behind the finish line, facing the way the track runs. */
function gridPosition(): CarState {
  const p = track.pointAt(track.length - GRID_OFFSET);
  return createCar(p.x, p.z, Math.atan2(p.tz, p.tx));
}

const car = gridPosition();
const carModel = new CarModel();
scene.add(carModel.root);

const followCamera = new FollowCamera();
followCamera.snapTo(car);

const keyboard = new Keyboard();
let race = new Race(track.length);
let wrongWayTime = 0;
let timedBanner: TimedBanner | null = null;
let shownBannerKey = '';

const hud = {
  lap: document.getElementById('hud-lap')!,
  time: document.getElementById('hud-time')!,
  lapTime: document.getElementById('hud-lap-time')!,
  best: document.getElementById('hud-best')!,
  speed: document.getElementById('hud-speed')!,
};

const banner = document.getElementById('banner')!;

const results = {
  root: document.getElementById('results')!,
  total: document.getElementById('results-total')!,
  totalBadge: document.getElementById('results-total-badge')!,
  totalRecord: document.getElementById('results-total-record')!,
  best: document.getElementById('results-best')!,
  bestBadge: document.getElementById('results-best-badge')!,
  bestRecord: document.getElementById('results-best-record')!,
  laps: document.getElementById('results-laps')!,
  again: document.getElementById('results-again')!,
};

/** Puts the car back on the centreline nearest to it, facing the way the track runs. */
function resetCar(): void {
  const proj = track.project(car.x, car.z);
  const p = track.points[proj.index];
  Object.assign(car, createCar(p.x, p.z, Math.atan2(proj.tz, proj.tx)));
  race.player.resetPosition();
  wrongWayTime = 0;
}

function restartRace(): void {
  Object.assign(car, gridPosition());
  race = new Race(track.length);
  wrongWayTime = 0;
  timedBanner = null;
  results.root.hidden = true;
  followCamera.snapTo(car);
}

function fixedUpdate(dt: number): void {
  const input = race.controlsLocked || race.phase === 'finished' ? NO_INPUT : keyboard.carInput();
  stepCar(car, input, dt);
  const { proj } = collideWithWalls(car, track);
  handleRaceEvents(race.update(dt, proj.distance));
  updateWrongWay(dt, proj);
}

/** Counts how long the car has been driving against the track direction. */
function updateWrongWay(dt: number, proj: Projection): void {
  if (race.phase !== 'racing') {
    wrongWayTime = 0;
    return;
  }
  const dot = car.vx * proj.tx + car.vz * proj.tz;
  wrongWayTime = dot < WRONG_WAY_DOT ? wrongWayTime + dt : 0;
}

function handleRaceEvents(events: RaceEvent[]): void {
  for (const event of events) {
    if (event === 'go') showTimedBanner({ text: 'GO!', tone: 'green' }, 1);
    if (event === 'finalLap') showTimedBanner({ text: 'FINAL LAP', tone: 'accent' }, 1.5);
    if (event === 'finish') showTimedBanner({ text: 'FINISH!', tone: 'white' }, 1.5, showResults);
  }
}

function showTimedBanner(message: Banner, seconds: number, onDone?: () => void): void {
  timedBanner = { ...message, seconds, onDone };
}

function tickTimedBanner(dt: number): void {
  if (!timedBanner) return;
  timedBanner.seconds -= dt;
  if (timedBanner.seconds > 0) return;
  const onDone = timedBanner.onDone;
  timedBanner = null;
  onDone?.();
}

/** A timed message wins, then the countdown, then WRONG WAY. */
function currentBanner(): Banner | null {
  if (timedBanner) return { text: timedBanner.text, tone: timedBanner.tone };
  if (race.phase === 'countdown') return { text: String(Math.ceil(race.countdown)), tone: 'white' };
  if (wrongWayTime > WRONG_WAY_DELAY) return { text: 'WRONG WAY', tone: 'red' };
  return null;
}

/** Shows the current banner, replaying the pop animation whenever its text or colour changes. */
function updateBanner(): void {
  const next = currentBanner();
  const key = next ? `${next.tone}:${next.text}` : '';
  if (key === shownBannerKey) return;
  shownBannerKey = key;

  banner.classList.remove('pop');
  if (!next) {
    banner.hidden = true;
    return;
  }
  banner.textContent = next.text;
  banner.dataset.tone = next.tone;
  banner.hidden = false;
  void banner.offsetWidth;
  banner.classList.add('pop');
}

function lastLapTime(): number {
  const laps = race.player.lapTimes;
  return laps[laps.length - 1] ?? 0;
}

function updateHud(): void {
  const finished = race.phase === 'finished';
  hud.lap.textContent = `${race.currentLap} / ${race.totalLaps}`;
  hud.time.textContent = formatTime(race.finishTime ?? race.clock);
  const lapTime = finished ? lastLapTime() : race.player.currentLapTime(race.clock);
  hud.lapTime.textContent = formatTime(lapTime);
  const best = race.player.bestLap;
  hud.best.textContent = best === null ? '--' : formatTime(best);
  hud.speed.textContent = String(Math.round(speed(car) * 3.6));
}

/** Under a time: the previous best if this one beat it, otherwise the stored record. */
function recordLine(beaten: boolean, previous: number | null, stored: number | null): string {
  if (beaten) return previous === null ? '' : `Previous ${formatTime(previous)}`;
  return stored === null ? '' : `Record ${formatTime(stored)}`;
}

function lapRow(index: number, time: number, isBest: boolean): HTMLLIElement {
  const row = document.createElement('li');
  row.className = isBest ? 'results-lap is-best' : 'results-lap';

  const label = document.createElement('span');
  label.textContent = `Lap ${index + 1}`;
  if (isBest) {
    const tag = document.createElement('span');
    tag.className = 'results-tag';
    tag.textContent = 'Best';
    label.append(tag);
  }

  const value = document.createElement('span');
  value.textContent = formatTime(time);
  row.append(label, value);
  return row;
}

/** Records the finished race, then fills in and shows the results card. */
function showResults(): void {
  const raceTime = race.finishTime ?? race.clock;
  const bestLap = race.player.bestLap;
  const { previous, records, newRaceRecord, newLapRecord } = updateRecords(TRACK_ID, raceTime, bestLap);

  results.total.textContent = formatTime(raceTime);
  results.totalBadge.hidden = !newRaceRecord;
  results.totalRecord.textContent = recordLine(newRaceRecord, previous.bestRace, records.bestRace);

  results.best.textContent = bestLap === null ? '--' : formatTime(bestLap);
  results.bestBadge.hidden = !newLapRecord;
  results.bestRecord.textContent = recordLine(newLapRecord, previous.bestLap, records.bestLap);

  const lapTimes = race.player.lapTimes;
  const bestIndex = lapTimes.indexOf(Math.min(...lapTimes));
  results.laps.replaceChildren(...lapTimes.map((time, i) => lapRow(i, time, i === bestIndex)));

  results.root.hidden = false;
}

results.again.addEventListener('click', restartRace);

// Dev-only handle for poking at game state from the browser console.
if (import.meta.env.DEV) {
  Object.assign(window, { __game: { car, track, get race() { return race; } } });
}

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;

  if (keyboard.wasPressed('KeyR') && race.phase === 'racing') resetCar();
  if (!results.root.hidden && keyboard.wasPressed('Enter')) restartRace();
  keyboard.endFrame();

  accumulator += dt;
  while (accumulator >= STEP) {
    fixedUpdate(STEP);
    accumulator -= STEP;
  }

  tickTimedBanner(dt);
  updateBanner();
  carModel.sync(car, dt);
  followCamera.update(car, dt);
  sun.position.set(car.x + 30, 60, car.z + 20);
  sun.target.position.set(car.x, 0, car.z);
  updateHud();

  renderer.render(scene, followCamera.camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  followCamera.resize(window.innerWidth, window.innerHeight);
});

requestAnimationFrame(frame);
