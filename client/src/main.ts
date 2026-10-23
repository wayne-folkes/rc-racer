import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Group,
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
import { QUALIFYING_POSITION, Season, type SeasonStatus } from './game/season';
import { loadSeason, saveSeason } from './game/seasonStorage';
import { TRACKS, type TrackDef } from './game/tracks';
import { TrackPath, type Projection } from './game/trackPath';
import { buildTrackScene, disposeScene } from './game/trackScene';
import { createWeather, type WeatherScene } from './game/weatherScene';
import { RaceWorld, type Racer } from './game/world';
import { Garage } from './ui/garage';

const STEP = 1 / 120;
const MAX_FRAME = 0.25;
const SHADOW_EXTENT = 40;
const ORDINAL_SUFFIXES = ['th', 'st', 'nd', 'rd'];
/** Dot product of car velocity and track direction below this means the car is going the wrong way. */
const WRONG_WAY_DOT = -3;
/** Seconds of wrong-way driving before the WRONG WAY banner shows. */
const WRONG_WAY_DELAY = 0.6;
/** Starts the race over from the grid while a race is on. */
const RESTART_KEY = 'KeyN';
/** Keys that use the held item. */
const FIRE_KEYS = ['KeyX', 'ShiftLeft', 'ShiftRight'];
const ITEM_LABELS: Record<ItemKind, { icon: string; name: string }> = {
  missile: { icon: '🚀', name: 'Missile' },
  bomb: { icon: '💣', name: 'Bomb' },
};

type BannerTone = 'white' | 'green' | 'accent' | 'red';
interface Banner {
  text: string;
  tone: BannerTone;
  /** Smaller line under the text, e.g. the round's name during the countdown. */
  sub?: string;
}
interface TimedBanner extends Banner {
  seconds: number;
  onDone?: () => void;
}
interface CarView {
  racer: Racer;
  model: CarModel;
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

const season = new Season(TRACKS, loadSeason() ?? undefined);

function persist(): void {
  saveSeason(season.state);
}

// Everything below is rebuilt for each race (see buildRace).
let track: TrackPath;
let world: RaceWorld;
let itemScene: ItemScene;
let weather: WeatherScene | null = null;
let trackScene: Group | null = null;
let carViews: CarView[] = [];
/** False while the garage or a summary card is up: the scene is built but nothing moves. */
let live = true;
let raceCount = 0;
/** Round label for the HUD and the countdown banner. */
let roundHud = '';
let roundBanner = '';

const followCamera = new FollowCamera();
const keyboard = new Keyboard();
let wrongWayTime = 0;
let timedBanner: TimedBanner | null = null;
let shownBannerKey = '';
let standingsKey = '';
let shownItem: ItemKind | null = null;

const hud = {
  round: document.getElementById('hud-round')!,
  lap: document.getElementById('hud-lap')!,
  time: document.getElementById('hud-time')!,
  lapTime: document.getElementById('hud-lap-time')!,
  best: document.getElementById('hud-best')!,
  position: document.getElementById('hud-position')!,
  positionTotal: document.getElementById('hud-position-total')!,
  speed: document.getElementById('hud-speed')!,
};

const itemSlot = {
  root: document.getElementById('hud-item')!,
  icon: document.getElementById('hud-item-icon')!,
  name: document.getElementById('hud-item-name')!,
};

const banner = document.getElementById('banner')!;
const bannerText = document.getElementById('banner-text')!;
const bannerSub = document.getElementById('banner-sub')!;

const results = {
  root: document.getElementById('results')!,
  title: document.getElementById('results-title')!,
  subtitle: document.getElementById('results-subtitle')!,
  race: document.getElementById('results-race')!,
  total: document.getElementById('results-total')!,
  totalBadge: document.getElementById('results-total-badge')!,
  totalRecord: document.getElementById('results-total-record')!,
  best: document.getElementById('results-best')!,
  bestBadge: document.getElementById('results-best-badge')!,
  bestRecord: document.getElementById('results-best-record')!,
  standings: document.getElementById('results-standings')!,
  laps: document.getElementById('results-laps')!,
  money: document.getElementById('results-money')!,
  primary: document.getElementById('results-primary') as HTMLButtonElement,
  secondary: document.getElementById('results-secondary') as HTMLButtonElement,
};

const garage = new Garage(season, {
  buy: (kind) => {
    season.buy(kind);
    persist();
  },
  nextRace: () => {
    season.nextRace();
    persist();
    startRace();
  },
});

/** Takes the current race's scene, cars and item effects out of the scene and frees them. */
function clearRace(): void {
  if (!trackScene) return;
  const objects = [trackScene, itemScene.root, ...carViews.map((view) => view.model.root)];
  for (const object of objects) {
    scene.remove(object);
    disposeScene(object);
  }
  if (weather) {
    scene.remove(weather.root);
    disposeScene(weather.root);
    weather.dispose();
    weather = null;
  }
  carViews = [];
  trackScene = null;
}

/**
 * Builds a race on a track: the scene, the cars and the race itself. A race that isn't `playing`
 * sits on the grid, with nothing moving, until something starts it.
 */
function buildRace(def: TrackDef, playing: boolean): void {
  clearRace();
  track = new TrackPath(def.controlPoints, def.halfWidth);
  // A new seed on every build, so a retry doesn't replay the same item boxes.
  raceCount++;
  world = new RaceWorld(track, {
    layout: def.layout,
    playerTuning: season.playerTuning,
    opponentPace: season.opponentPace,
    seed: raceCount,
  });

  trackScene = buildTrackScene(track, def.theme);
  scene.add(trackScene);
  itemScene = new ItemScene(world.items);
  scene.add(itemScene.root);
  // One model per racer, in the same order as world.racers, so index 0 is the player.
  carViews = world.racers.map((racer) => {
    const model = new CarModel(racer.info.color);
    scene.add(model.root);
    return { racer, model };
  });
  weather = createWeather(def.theme.weather, raceCount);
  if (weather) scene.add(weather.root);
  scene.background = new Color(def.theme.sky);

  const number = season.tracks.indexOf(def) + 1;
  roundHud = `Round ${number}/${season.tracks.length} · ${def.name}`;
  roundBanner = `Round ${number} · ${def.name}`;
  hud.round.textContent = roundHud;
  hud.positionTotal.textContent = `/ ${world.racers.length}`;

  live = playing;
  document.body.classList.toggle('is-idle', !playing);
  wrongWayTime = 0;
  timedBanner = null;
  standingsKey = '';
  followCamera.snapTo(world.player);
}

/** Starts a race on the season's current track. */
function startRace(): void {
  buildRace(season.track, true);
  garage.hide();
  results.root.hidden = true;
}

/** Shows the garage over the scene of the next track, which stays still until the next race starts. */
function openGarage(): void {
  results.root.hidden = true;
  buildRace(season.tracks[season.state.round + 1] ?? season.track, false);
  garage.show();
}

function retryRace(): void {
  season.retry();
  persist();
  startRace();
}

function newSeason(): void {
  season.restart();
  persist();
  startRace();
}

/** Puts the player's car back on the centreline nearest to it, facing the way the track runs. */
function resetCar(): void {
  world.resetCar(0);
  wrongWayTime = 0;
}

function fixedUpdate(dt: number): void {
  if (!live) return;
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

/** A timed message wins, then the countdown, then WRONG WAY. Nothing shows while the scene is idle. */
function currentBanner(): Banner | null {
  if (!live) return null;
  if (timedBanner) return { text: timedBanner.text, tone: timedBanner.tone };
  if (world.race.phase === 'countdown') {
    return { text: String(Math.ceil(world.race.countdown)), tone: 'white', sub: roundBanner };
  }
  if (wrongWayTime > WRONG_WAY_DELAY) return { text: 'WRONG WAY', tone: 'red' };
  return null;
}

/** Shows the current banner, replaying the pop animation whenever its text or colour changes. */
function updateBanner(): void {
  const next = currentBanner();
  const key = next ? `${next.tone}:${next.text}:${next.sub ?? ''}` : '';
  if (key === shownBannerKey) return;
  shownBannerKey = key;

  banner.classList.remove('pop');
  if (!next) {
    banner.hidden = true;
    return;
  }
  bannerText.textContent = next.text;
  bannerSub.textContent = next.sub ?? '';
  bannerSub.hidden = !next.sub;
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

/** Records the finished race, scores it for the season, then fills in and shows the results card. */
function showResults(): void {
  const raceTime = world.race.finishTime ?? world.race.clock;
  const bestLap = world.race.player.bestLap;
  const { previous, records, newRaceRecord, newLapRecord } = updateRecords(season.track.id, raceTime, bestLap);

  season.finishRace(world.race.position(0), raceTime);
  persist();

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

  showEndCard(true);
}

function endTitle(status: SeasonStatus, place: number | undefined): string {
  if (status === 'gameOver') return 'Game over';
  if (status === 'champion') return 'Champion!';
  if (place === undefined) return 'Race complete';
  return place === 1 ? 'You won!' : `You finished ${ordinal(place)}`;
}

function endSubtitle(status: SeasonStatus): string {
  switch (status) {
    case 'failed':
      return `Only the top ${QUALIFYING_POSITION} go through`;
    case 'gameOver':
      return `No continues left. Only the top ${QUALIFYING_POSITION} go through.`;
    case 'champion':
      return `You won all ${season.tracks.length} rounds.`;
    default:
      return '';
  }
}

/** Sets a results button's label and action, or hides it when the label is null. */
function setButton(button: HTMLButtonElement, label: string | null, action: () => void = () => {}): void {
  button.hidden = label === null;
  button.textContent = label ?? '';
  button.onclick = action;
}

/**
 * Fills the results card for the season's status. After a race it shows the race stats too; after
 * a reload it's the same buttons without them.
 */
function showEndCard(raced: boolean): void {
  const { status, results: history, money, continuesLeft } = season.state;
  const latest = history[history.length - 1];

  results.race.hidden = !raced;
  results.title.textContent = endTitle(status, latest?.position);
  results.subtitle.textContent = endSubtitle(status);
  results.subtitle.hidden = !results.subtitle.textContent;

  const prize = latest?.prize ?? 0;
  const won = raced ? `${prize > 0 ? `Prize $${prize}` : 'No prize'} · ` : '';
  results.money.textContent = `${won}Money $${money}`;

  switch (status) {
    case 'shop':
      setButton(results.primary, 'Continue to garage', openGarage);
      setButton(results.secondary, null);
      break;
    case 'failed': {
      const unit = continuesLeft === 1 ? 'continue' : 'continues';
      setButton(results.primary, `Retry race (${continuesLeft} ${unit} left)`, retryRace);
      setButton(results.secondary, 'New season', newSeason);
      break;
    }
    default:
      setButton(results.primary, 'New season', newSeason);
      setButton(results.secondary, null);
  }
  results.root.hidden = false;
}

/** The button Enter presses: the garage's next race, or the results card's primary button. */
function enterButton(): HTMLButtonElement | null {
  if (garage.open) return garage.next;
  if (!results.root.hidden) return results.primary;
  return null;
}

// Enter presses the open card's main button. Preventing the default stops a focused button firing twice.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.repeat) return;
  const button = enterButton();
  if (!button) return;
  e.preventDefault();
  button.click();
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  followCamera.resize(window.innerWidth, window.innerHeight);
});

// Dev-only handle for poking at game state from the browser console.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __game: {
      get world() {
        return world;
      },
      get track() {
        return track;
      },
      get itemScene() {
        return itemScene;
      },
      season,
    },
  });
}

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;

  if (live && keyboard.wasPressed('KeyR') && world.race.phase === 'racing') resetCar();
  // N starts the race again on the same track without spending a continue. Only while a race is on.
  // Once over the line the result stands, so a 4th place can't be dodged by restarting.
  const canRestart = season.state.status === 'racing' && world.race.phase !== 'finished';
  if (canRestart && keyboard.wasPressed(RESTART_KEY)) startRace();
  if (live && world.race.phase === 'racing' && FIRE_KEYS.some((code) => keyboard.wasPressed(code))) {
    world.useItem(0);
  }
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
  // Ambient, so it keeps moving behind the garage and results cards too.
  weather?.update(dt, world.player.x, world.player.z);
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
  if (live && !results.root.hidden) updateStandings();

  renderer.render(scene, followCamera.camera);
  requestAnimationFrame(frame);
}

// Pick up where the saved season left off.
switch (season.state.status) {
  case 'racing':
    startRace();
    break;
  case 'shop':
    openGarage();
    break;
  default:
    // Failed, game over or champion: the same card as after a race, without the race stats.
    buildRace(season.track, false);
    showEndCard(false);
}

requestAnimationFrame(frame);
