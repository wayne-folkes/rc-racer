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
import { speed } from './game/carPhysics';
import { CarModel } from './game/carModel';
import { FollowCamera } from './game/followCamera';
import { Keyboard } from './game/input';
import type { ItemKind } from './game/items';
import { ItemScene } from './game/itemScene';
import { formatTime, type RaceEvent } from './game/race';
import { updateRecords } from './game/records';
import { buildTrackScene } from './game/trackScene';
import { DEMO_TRACK, TrackPath, type Projection } from './game/trackPath';
import { RaceWorld } from './game/world';

const STEP = 1 / 120;
const MAX_FRAME = 0.25;
const SHADOW_EXTENT = 40;
const TRACK_ID = 'demo';
const ORDINAL_SUFFIXES = ['th', 'st', 'nd', 'rd'];
/** Dot product of car velocity and track direction below this means the car is going the wrong way. */
const WRONG_WAY_DOT = -3;
/** Seconds of wrong-way driving before the WRONG WAY banner shows. */
const WRONG_WAY_DELAY = 0.6;
/** Keys that use the held item. */
const FIRE_KEYS = ['KeyX', 'ShiftLeft', 'ShiftRight'];
const ITEM_LABELS: Record<ItemKind, { icon: string; name: string }> = {
  missile: { icon: '🚀', name: 'Missile' },
  bomb: { icon: '💣', name: 'Bomb' },
  boost: { icon: '⚡', name: 'Boost' },
};

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

const world = new RaceWorld(track);
// One model per racer, in the same order as world.racers, so index 0 is the player.
const carViews = world.racers.map((racer) => {
  const model = new CarModel(racer.info.color);
  scene.add(model.root);
  return { racer, model };
});

const itemScene = new ItemScene(world.items);
scene.add(itemScene.root);

const followCamera = new FollowCamera();
followCamera.snapTo(world.player);

const keyboard = new Keyboard();
let wrongWayTime = 0;
let timedBanner: TimedBanner | null = null;
let shownBannerKey = '';
let standingsKey = '';
let shownItem: ItemKind | null = null;

const hud = {
  lap: document.getElementById('hud-lap')!,
  time: document.getElementById('hud-time')!,
  lapTime: document.getElementById('hud-lap-time')!,
  best: document.getElementById('hud-best')!,
  position: document.getElementById('hud-position')!,
  positionTotal: document.getElementById('hud-position-total')!,
  speed: document.getElementById('hud-speed')!,
};
hud.positionTotal.textContent = `/ ${world.racers.length}`;

const itemSlot = {
  root: document.getElementById('hud-item')!,
  icon: document.getElementById('hud-item-icon')!,
  name: document.getElementById('hud-item-name')!,
};

const banner = document.getElementById('banner')!;

const results = {
  root: document.getElementById('results')!,
  title: document.getElementById('results-title')!,
  total: document.getElementById('results-total')!,
  totalBadge: document.getElementById('results-total-badge')!,
  totalRecord: document.getElementById('results-total-record')!,
  best: document.getElementById('results-best')!,
  bestBadge: document.getElementById('results-best-badge')!,
  bestRecord: document.getElementById('results-best-record')!,
  standings: document.getElementById('results-standings')!,
  laps: document.getElementById('results-laps')!,
  again: document.getElementById('results-again')!,
};

/** Puts the player's car back on the centreline nearest to it, facing the way the track runs. */
function resetCar(): void {
  world.resetCar(0);
  wrongWayTime = 0;
}

function restartRace(): void {
  world.restart();
  itemScene.reset();
  wrongWayTime = 0;
  timedBanner = null;
  results.root.hidden = true;
  followCamera.snapTo(world.player);
}

function fixedUpdate(dt: number): void {
  handleRaceEvents(world.step(dt, keyboard.carInput()));
  updateWrongWay(dt, world.playerProj);
}

/** Counts how long the player's car has been driving against the track direction. */
function updateWrongWay(dt: number, proj: Projection): void {
  // A spinning car is out of control, so it isn't counted as going the wrong way.
  if (world.race.phase !== 'racing' || world.items.status[0].spin > 0) {
    wrongWayTime = 0;
    return;
  }
  const car = world.player;
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
  if (world.race.phase === 'countdown') return { text: String(Math.ceil(world.race.countdown)), tone: 'white' };
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
  const laps = world.race.player.lapTimes;
  return laps[laps.length - 1] ?? 0;
}

/** 1 becomes "1st", 2 "2nd", 3 "3rd", 4 "4th", and 11 to 13 always take "th". */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen || n % 10 > 3 ? 'th' : ORDINAL_SUFFIXES[n % 10];
  return `${n}${suffix}`;
}

function updateHud(): void {
  const finished = world.race.phase === 'finished';
  hud.lap.textContent = `${world.race.currentLap} / ${world.race.totalLaps}`;
  hud.time.textContent = formatTime(world.race.finishTime ?? world.race.clock);
  const lapTime = finished ? lastLapTime() : world.race.player.currentLapTime(world.race.clock);
  hud.lapTime.textContent = formatTime(lapTime);
  const best = world.race.player.bestLap;
  hud.best.textContent = best === null ? '--' : formatTime(best);
  hud.position.textContent = ordinal(world.race.position(0));
  hud.speed.textContent = String(Math.round(speed(world.player) * 3.6));
}

/** Shows the item the player holds, popping the slot whenever a new one arrives. */
function updateItemSlot(): void {
  const item = world.items.status[0].item;
  if (item === shownItem) return;
  shownItem = item;

  itemSlot.root.classList.toggle('is-empty', item === null);
  itemSlot.icon.textContent = item ? ITEM_LABELS[item].icon : '–';
  itemSlot.name.textContent = item ? ITEM_LABELS[item].name : 'Empty';
  if (!item) return;

  itemSlot.root.classList.remove('pop');
  void itemSlot.root.offsetWidth;
  itemSlot.root.classList.add('pop');
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

/** One line of the standings: position, colour dot, name, then finish time or "Racing…". */
function standingRow(racer: number, place: number): HTMLLIElement {
  const { info } = world.racers[racer];
  const finish = world.race.finishTimes[racer];

  const row = document.createElement('li');
  row.className = racer === 0 ? 'standing is-player' : 'standing';

  const position = document.createElement('span');
  position.className = 'standing-pos';
  position.textContent = ordinal(place);

  const dot = document.createElement('span');
  dot.className = 'standing-dot';
  dot.style.backgroundColor = info.color;

  const name = document.createElement('span');
  name.className = 'standing-name';
  name.textContent = info.name;

  const time = document.createElement('span');
  time.className = finish === null ? 'standing-time is-racing' : 'standing-time';
  time.textContent = finish === null ? 'Racing…' : formatTime(finish);

  row.append(position, dot, name, time);
  return row;
}

/** Rebuilds the standings only when their order or a finish time has changed. */
function updateStandings(): void {
  const order = world.race.standings();
  const key = order.map((racer) => `${racer}:${world.race.finishTimes[racer] ?? ''}`).join('|');
  if (key === standingsKey) return;
  standingsKey = key;
  results.standings.replaceChildren(...order.map((racer, i) => standingRow(racer, i + 1)));
}

/** Records the finished race, then fills in and shows the results card. */
function showResults(): void {
  const raceTime = world.race.finishTime ?? world.race.clock;
  const bestLap = world.race.player.bestLap;
  const { previous, records, newRaceRecord, newLapRecord } = updateRecords(TRACK_ID, raceTime, bestLap);

  const place = world.race.position(0);
  results.title.textContent = place === 1 ? 'You won!' : `You finished ${ordinal(place)}`;

  results.total.textContent = formatTime(raceTime);
  results.totalBadge.hidden = !newRaceRecord;
  results.totalRecord.textContent = recordLine(newRaceRecord, previous.bestRace, records.bestRace);

  results.best.textContent = bestLap === null ? '--' : formatTime(bestLap);
  results.bestBadge.hidden = !newLapRecord;
  results.bestRecord.textContent = recordLine(newLapRecord, previous.bestLap, records.bestLap);

  standingsKey = '';
  updateStandings();

  const lapTimes = world.race.player.lapTimes;
  const bestIndex = lapTimes.indexOf(Math.min(...lapTimes));
  results.laps.replaceChildren(...lapTimes.map((time, i) => lapRow(i, time, i === bestIndex)));

  results.root.hidden = false;
}

results.again.addEventListener('click', restartRace);

// Dev-only handle for poking at game state from the browser console.
if (import.meta.env.DEV) {
  Object.assign(window, { __game: { world, track, itemScene } });
}

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;

  if (keyboard.wasPressed('KeyR') && world.race.phase === 'racing') resetCar();
  if (!results.root.hidden && keyboard.wasPressed('Enter')) restartRace();
  if (world.race.phase === 'racing' && FIRE_KEYS.some((code) => keyboard.wasPressed(code))) world.useItem(0);
  keyboard.endFrame();

  accumulator += dt;
  while (accumulator >= STEP) {
    fixedUpdate(STEP);
    accumulator -= STEP;
  }

  tickTimedBanner(dt);
  updateBanner();
  itemScene.update(dt);
  itemScene.handleEvents(world.items.drainEvents());
  // carViews are in the same order as world.racers, so index i matches world.items.status[i].
  carViews.forEach(({ racer, model }, i) => {
    model.setBoosting(world.items.status[i].boost > 0);
    model.sync(racer.car, dt);
  });
  followCamera.update(world.player, dt);
  sun.position.set(world.player.x + 30, 60, world.player.z + 20);
  sun.target.position.set(world.player.x, 0, world.player.z);
  updateHud();
  updateItemSlot();
  if (!results.root.hidden) updateStandings();

  renderer.render(scene, followCamera.camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  followCamera.resize(window.innerWidth, window.innerHeight);
});

requestAnimationFrame(frame);
