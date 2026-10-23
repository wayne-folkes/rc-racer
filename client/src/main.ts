import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PCFSoftShadowMap,
  Scene,
  type Sprite,
  WebGLRenderer,
} from 'three';
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';
import './style.css';
import { distanceVolume, engineNote, Sound, type SoundName } from './game/audio';
import { DEFAULT_TUNING, speed } from './game/carPhysics';
import { CarModel } from './game/carModel';
import { Controls } from './game/controls';
import { FollowCamera } from './game/followCamera';
import { GamepadInput } from './game/gamepad';
import { Keyboard } from './game/input';
import type { ItemKind } from './game/items';
import { ItemScene } from './game/itemScene';
import { formatTime, type RaceEvent } from './game/race';
import { buildRamps } from './game/rampScene';
import { updateRecords } from './game/records';
import { QUALIFYING_POSITION, Season, type SeasonStatus } from './game/season';
import { loadSeason, saveSeason } from './game/seasonStorage';
import { TRACKS, type TrackDef } from './game/tracks';
import { TrackPath, type Projection } from './game/trackPath';
import { buildTrackScene, disposeScene } from './game/trackScene';
import { buildGridLabel } from './game/gridLabel';
import { TouchControls } from './game/touch';
import type { VehicleId } from './game/vehicles';
import { createWeather, type WeatherScene } from './game/weatherScene';
import { NO_INPUT, RaceWorld, type Racer } from './game/world';
import { BackCard, type MenuCard } from './ui/card';
import { Garage } from './ui/garage';
import { PauseCard } from './ui/pause';
import { SettingsCard } from './ui/settings';
import { RecordsCard, TitleCard, type TitleInfo } from './ui/title';
import { VehicleCard, type SeasonModes } from './ui/vehicle';

const STEP = 1 / 120;
const MAX_FRAME = 0.25;
const SHADOW_EXTENT = 40;
const ORDINAL_SUFFIXES = ['th', 'st', 'nd', 'rd'];
/** Dot product of car velocity and track direction below this means the car is going the wrong way. */
const WRONG_WAY_DOT = -3;
/** Seconds of wrong-way driving before the WRONG WAY banner shows. */
const WRONG_WAY_DELAY = 0.6;
/** The title's attract demo: the AI drives every car, a touch under race pace. */
const DEMO_SKILL = { pace: 0.92, steerGain: 2.4 };
/** Demo races skip the countdown, so the cars are moving as soon as the title shows. */
const DEMO_COUNTDOWN = 0.01;
/** Seconds the demo waits after its leader finishes before moving on to the next track. */
const DEMO_NEXT_DELAY = 3;
/** Item sound effects in the demo are quieter, so the title stays calm. */
const DEMO_SOUND_VOLUME = 0.3;
/** How far a left or right press moves a focused slider (percent). */
const SLIDER_NUDGE = 5;
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
/**
 * How a race scene is built: 'idle' sits on the grid with nothing moving (behind the garage and
 * summary cards), 'racing' is a live race, and 'demo' is the title screen's attract race.
 */
type BuildMode = 'idle' | 'racing' | 'demo';

// Initialize Vercel Web Analytics and Speed Insights
inject();
injectSpeedInsights();

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
let rampScene: Group | null = null;
let carViews: CarView[] = [];
/** The "4TH" over the player's car on the grid. It lives under that car's model, so it's freed with it. */
let gridLabel: Sprite | null = null;
/** False while the garage or a summary card is up: the scene is built but nothing moves. */
let live = true;
/** True during the title screen's attract demo: the AI drives every car and nothing is recorded. */
let demo = false;
/** True while the pause menu has the race frozen. */
let paused = false;
/** Which track the demo is on, and the time left before it moves on once its leader has finished. */
let demoIndex = 0;
let demoTimer = 0;
let raceCount = 0;
/** Round label for the HUD and the countdown banner. */
let roundHud = '';
let roundBanner = '';

const followCamera = new FollowCamera();
const keyboard = new Keyboard();
const gamepad = new GamepadInput();
const touch = new TouchControls();
const controls = new Controls([keyboard, gamepad, touch]);
const sound = new Sound();
/** The countdown number last beeped for, so each one beeps once. */
let lastBeep = 0;
// Until a key or button is used, a touch device gets the on-screen hints (none) rather than keyboard ones.
if (touch.touchDevice) controls.lastUsed = 'touch';
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

const garageCard = document.getElementById('garage')!;
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

/**
 * The cards that open over the game: the title screen, the pause menu and their panels. Only the
 * top of the stack shows. Esc or pause backs out of it (see pauseKey).
 */
const cardStack: MenuCard[] = [];
const titleCard = new TitleCard(titleInfo, {
  continueSeason: resumeSeason,
  newSeason,
  records: () => pushCard(recordsCard),
  settings: () => openSettings(true),
  howToPlay: () => pushCard(howtoCard),
});
const recordsCard = new RecordsCard(popCard, () => season.state);
const howtoCard = new BackCard('howto', 'howto-back', popCard);
const settingsCard = new SettingsCard(sound, {
  back: popCard,
  soundChanged: showMuted,
  progressReset: () => season.restart(),
});
const pauseCard = new PauseCard(canRestart, {
  resume: resumeRace,
  restart: () => {
    if (canRestart()) startRace();
  },
  settings: () => openSettings(false),
  quit: quitToTitle,
});
const vehicleCard = new VehicleCard({ choose: startSeason, back: backFromVehicle }, () => season.state);
const allCards: MenuCard[] = [titleCard, recordsCard, howtoCard, settingsCard, pauseCard, vehicleCard];

/** Takes the current race's scene, cars and item effects out of the scene and frees them. */
function clearRace(): void {
  if (!trackScene) return;
  const objects = [trackScene, itemScene.root, ...carViews.map((view) => view.model.root)];
  if (rampScene) objects.push(rampScene);
  for (const object of objects) {
    scene.remove(object);
    disposeScene(object);
  }
  rampScene = null;
  if (weather) {
    scene.remove(weather.root);
    disposeScene(weather.root);
    weather.dispose();
    weather = null;
  }
  carViews = [];
  gridLabel = null;
  trackScene = null;
}

/**
 * Builds a race on a track: the scene, the cars and the race itself. A race that isn't 'racing'
 * sits on the grid, with nothing moving, until something starts it.
 */
function buildRace(def: TrackDef, mode: BuildMode): void {
  clearRace();
  track = new TrackPath(def.controlPoints, def.halfWidth);
  // A new seed on every build, so a retry doesn't replay the same item boxes.
  raceCount++;
  world = new RaceWorld(track, {
    layout: def.layout,
    vehicle: season.state.vehicle,
    easy: season.state.easy,
    playerTuning: season.playerTuning,
    opponentPace: season.opponentPace,
    seed: raceCount,
    autopilot: mode === 'demo' ? DEMO_SKILL : undefined,
  });
  if (mode === 'demo') world.race.countdown = DEMO_COUNTDOWN;

  trackScene = buildTrackScene(track, def.theme);
  scene.add(trackScene);
  rampScene = buildRamps(world.ramps);
  scene.add(rampScene);
  itemScene = new ItemScene(world.items);
  scene.add(itemScene.root);
  // One model per racer, in the same order as world.racers, so index 0 is the player. Everyone drives
  // the same vehicle.
  carViews = world.racers.map((racer) => {
    const model = new CarModel(racer.info.color, season.state.vehicle);
    scene.add(model.root);
    return { racer, model };
  });
  // The place is the grid slot, not race.position(): before the first frame every car is level at zero
  // progress, which would read as 1st.
  gridLabel = buildGridLabel(ordinal(world.racers[0].info.gridSlot + 1));
  carViews[0].model.root.add(gridLabel);
  weather = createWeather(def.theme.weather, raceCount);
  if (weather) scene.add(weather.root);
  scene.background = new Color(def.theme.sky);

  const number = season.tracks.indexOf(def) + 1;
  roundHud = `Round ${number}/${season.tracks.length} · ${def.name}`;
  roundBanner = `Round ${number} · ${def.name}`;
  lastBeep = 0;
  hud.round.textContent = roundHud;
  hud.positionTotal.textContent = `/ ${world.racers.length}`;

  live = mode !== 'idle';
  demo = mode === 'demo';
  paused = false;
  demoTimer = DEMO_NEXT_DELAY;
  document.body.classList.toggle('is-idle', mode !== 'racing');
  wrongWayTime = 0;
  timedBanner = null;
  standingsKey = '';
  followCamera.snapTo(world.player);
}

/** Starts a race on the season's current track. */
function startRace(): void {
  clearCards();
  buildRace(season.track, 'racing');
  garage.hide();
  results.root.hidden = true;
}

/** Shows the garage over the scene of the next track, which stays still until the next race starts. */
function openGarage(): void {
  clearCards();
  results.root.hidden = true;
  buildRace(season.tracks[season.state.round + 1] ?? season.track, 'idle');
  garage.show();
}

function retryRace(): void {
  season.retry();
  persist();
  startRace();
}

/** Asks which vehicle to start a season in. The current season isn't touched until one is picked, so backing out keeps it. */
function newSeason(): void {
  results.root.hidden = true;
  pushCard(vehicleCard);
}

function startSeason(vehicle: VehicleId, { easy, reverse }: SeasonModes): void {
  season.restart(vehicle, easy, reverse);
  persist();
  startRace();
}

/** Backs out of the vehicle card: to the title it came from, or to the results card if it came from there. */
function backFromVehicle(): void {
  popCard();
  if (cardStack.length === 0) results.root.hidden = false;
}

/** Carries on with the saved season where it was left: the race, the garage or the summary card. */
function resumeSeason(): void {
  clearCards();
  switch (season.state.status) {
    case 'racing':
      startRace();
      break;
    case 'shop':
      openGarage();
      break;
    default:
      // Failed, game over or champion: the same card as after a race, without the race stats.
      buildRace(season.track, 'idle');
      showEndCard(false);
  }
}

/** Whether a season is saved and still going. Read from storage, so a season wiped by a reset doesn't count. */
function savedSeasonInProgress(): boolean {
  const saved = loadSeason();
  return saved !== null && (saved.status === 'racing' || saved.status === 'shop' || saved.status === 'failed');
}

/** The round Continue would take up: the current one, or the next after a visit to the garage. */
function upcomingRound(): number {
  return season.state.status === 'shop' ? season.state.round + 1 : season.state.round;
}

function titleInfo(): TitleInfo {
  const inProgress = savedSeasonInProgress();
  if (!inProgress) return { continueLabel: null, inProgress };
  const index = upcomingRound();
  return { continueLabel: `Continue · Round ${index + 1} · ${season.tracks[index].name}`, inProgress };
}

/** Starts the title's attract demo on the track at this index. No season, records or banners are involved. */
function startDemo(index: number): void {
  demoIndex = index;
  buildRace(season.tracks[index], 'demo');
}

/** Moves the demo on to the next track in the list, so the title cycles through them all. */
function nextDemo(): void {
  startDemo((demoIndex + 1) % season.tracks.length);
}

/** Shows the title screen over an attract demo. Nothing here changes the season or the records. */
function showTitle(): void {
  clearCards();
  results.root.hidden = true;
  startDemo(savedSeasonInProgress() ? upcomingRound() : 0);
  pushCard(titleCard);
}

/** Leaves the race for the title. The season is saved as it stands; the race in progress is abandoned, not recorded. */
function quitToTitle(): void {
  persist();
  showTitle();
}

/** Freezes the race and opens the pause menu. */
function pauseRace(): void {
  paused = true;
  pushCard(pauseCard);
}

function resumeRace(): void {
  paused = false;
  clearCards();
}

/** Opens the settings card. Reset progress is only offered from the title screen. */
function openSettings(fromTitle: boolean): void {
  settingsCard.allowReset = fromTitle;
  pushCard(settingsCard);
}

/** Restarting starts the race again on the same track without spending a continue. Only while a race is on. */
function canRestart(): boolean {
  // Once over the line the result stands, so a 4th place can't be dodged by restarting.
  return !demo && season.state.status === 'racing' && world.race.phase !== 'finished';
}

/** Puts the player's car back on the centreline nearest to it, facing the way the track runs. */
function resetCar(): void {
  world.resetCar(0);
  wrongWayTime = 0;
}

function fixedUpdate(dt: number): void {
  if (!live) return;
  if (demo) {
    // The AI drives every car, the player's included, and nothing is recorded.
    world.step(dt, NO_INPUT);
    return;
  }
  handleRaceEvents(world.step(dt, controls.carInput()));
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
  // The final lap also reports a plain lap; play only its own jingle.
  if (events.includes('go')) sound.play('go');
  if (events.includes('finish')) sound.play('finish');
  else if (events.includes('finalLap')) sound.play('finalLap');
  else if (events.includes('lap')) sound.play('lap');
}

const ITEM_SOUNDS: Partial<Record<string, SoundName>> = {
  pickup: 'pickup',
  boost: 'boost',
  explode: 'explode',
  fire: 'fire',
  drop: 'drop',
  splash: 'splash',
  slick: 'skid',
};

/** Plays item sounds, quieter the further from the player they happen. */
function playItemSounds(events: ReturnType<typeof world.items.drainEvents>): void {
  for (const e of events) {
    const name = ITEM_SOUNDS[e.type];
    if (!name) continue;
    const distance = Math.hypot(e.x - world.player.x, e.z - world.player.z);
    sound.play(name, distanceVolume(distance) * (demo ? DEMO_SOUND_VOLUME : 1));
  }
}

/** Plays jump and landing sounds, quieter the further from the player they happen. A landing also raises dust. */
function playJumpEvents(events: ReturnType<typeof world.drainJumps>): void {
  for (const e of events) {
    if (e.type === 'land') itemScene.landed(e.x, e.z);
    const distance = Math.hypot(e.x - world.player.x, e.z - world.player.z);
    sound.play(e.type, distanceVolume(distance) * (demo ? DEMO_SOUND_VOLUME : 1));
  }
}

/** Beeps for 3, 2, 1 (GO comes with the race's own 'go' event). */
function updateCountdownBeeps(): void {
  if (!live || demo || world.race.phase !== 'countdown') return;
  const n = Math.ceil(world.race.countdown);
  if (n !== lastBeep && n <= 3) sound.play('beep');
  lastBeep = n;
}

/** The player's engine, plus the nearest opponent's, fading with distance. Silent in menus and the demo. */
function updateEngines(): void {
  if (!live || demo || menuCard()) {
    sound.silenceEngines();
    return;
  }
  const me = world.player;
  // Lets the player rev on the grid during the countdown.
  const mine = engineNote(speed(me), controls.carInput().throttle, DEFAULT_TUNING.maxSpeed);
  sound.engine('player', mine.freq, mine.gain);

  let nearest: Racer | null = null;
  let nearestDistance = Infinity;
  for (const racer of world.racers.slice(1)) {
    const d = Math.hypot(racer.car.x - me.x, racer.car.z - me.z);
    if (d < nearestDistance) {
      nearest = racer;
      nearestDistance = d;
    }
  }
  if (!nearest) return;
  const theirs = engineNote(speed(nearest.car), 1, DEFAULT_TUNING.maxSpeed);
  // Detuned a little from the player's, so the two don't merge into one note.
  sound.engine('rival', theirs.freq * 1.07, theirs.gain * 0.6 * Math.max(0, 1 - nearestDistance / 40));
}

const muteButton = document.getElementById('hud-mute')!;
function showMuted(): void {
  muteButton.textContent = sound.muted ? '🔇' : '🔊';
  muteButton.setAttribute('aria-label', sound.muted ? 'Unmute sound' : 'Mute sound');
  muteButton.setAttribute('aria-pressed', String(sound.muted));
}
muteButton.addEventListener('click', () => {
  sound.toggleMuted();
  showMuted();
});
showMuted();

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

/** A timed message wins, then the countdown, then WRONG WAY. Nothing shows while the scene is idle or in the demo. */
function currentBanner(): Banner | null {
  if (!live || demo) return null;
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
  const { previous, records, newRaceRecord, newLapRecord } = updateRecords(
    season.state.vehicle,
    season.track.id,
    raceTime,
    bestLap,
  );

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
      setButton(results.secondary, 'Title screen', showTitle);
  }
  results.root.hidden = false;
}

/** Shows the top card of the stack and hides the rest. */
function syncCards(): void {
  const top = topCard();
  for (const card of allCards) card.root.hidden = card !== top;
  top?.refresh?.();
  clearMenuFocus();
}

function topCard(): MenuCard | undefined {
  return cardStack[cardStack.length - 1];
}

function pushCard(card: MenuCard): void {
  cardStack.push(card);
  syncCards();
}

function popCard(): void {
  cardStack.pop();
  syncCards();
}

function clearCards(): void {
  cardStack.length = 0;
  syncCards();
}

/** The card on screen, if one is open: the garage, the results card, or the top of the menu stack. */
function menuCard(): HTMLElement | null {
  if (garage.open) return garageCard;
  if (!results.root.hidden) return results.root;
  return topCard()?.root ?? null;
}

/** The card's main button: the garage's next race, the results card's primary, or the menu's. */
function primaryButton(): HTMLButtonElement | null {
  if (garage.open) return garage.next;
  if (!results.root.hidden) return results.primary;
  return topCard()?.primary() ?? null;
}

/**
 * Esc or pause: closes a prompt or steps back out of a panel, resumes a paused race, or pauses a
 * live one. The garage and results cards ignore it.
 */
function pauseKey(): void {
  if (garage.open || !results.root.hidden) return;
  const top = topCard();
  if (!top) {
    if (live && !demo && world.race.phase !== 'finished') pauseRace();
    return;
  }
  if (top.dismiss?.()) return;
  if (top === pauseCard) resumeRace();
  // The title is the bottom of the stack, so backing out of it does nothing.
  else if (cardStack.length > 1) popCard();
}

/** Takes the menu focus ring off every button. */
function clearMenuFocus(): void {
  for (const el of document.querySelectorAll('.is-menu-focus')) el.classList.remove('is-menu-focus');
}

/** Moves the focus ring to a control. Gamepad and touch players don't trigger focus-visible, so it's marked too. */
function focusMenuButton(el: HTMLElement): void {
  clearMenuFocus();
  el.classList.add('is-menu-focus');
  el.focus();
}

/** Moves a slider a step left or right, the same as a drag or an arrow key would. */
function nudgeSlider(slider: HTMLInputElement, direction: number): void {
  slider.value = String(Number(slider.value) + direction * SLIDER_NUDGE);
  slider.dispatchEvent(new Event('input'));
}

/**
 * Arrows, d-pad or stick move focus round the open card. Confirm (Enter, or the gamepad's A) presses
 * the focused control, or the primary one if nothing is focused. A focused slider takes left and
 * right to change its value. Each press is read once per frame, so Enter can't fire twice (which
 * would spend two continues or skip a round).
 */
function handleMenuInput(): void {
  const card = menuCard();
  const primary = primaryButton();
  if (!card || !primary) {
    clearMenuFocus();
    return;
  }
  // The buttons, links and sliders that are showing, in order. Anything inside a hidden block is skipped.
  // (A link has no `disabled`, so it always passes that check.)
  const items = [...card.querySelectorAll<HTMLElement>('button, a[href], input[type="range"]')].filter(
    (el) => !(el as HTMLButtonElement | HTMLInputElement).disabled && !el.closest('[hidden]'),
  );
  if (items.length === 0) return;

  const focused = document.activeElement;
  const slider = focused instanceof HTMLInputElement && focused.type === 'range' ? focused : null;
  if (slider) {
    const direction = (controls.pressed('right') ? 1 : 0) - (controls.pressed('left') ? 1 : 0);
    if (direction !== 0) nudgeSlider(slider, direction);
  }
  const forward = controls.pressed('down') || (!slider && controls.pressed('right'));
  const back = controls.pressed('up') || (!slider && controls.pressed('left'));
  if (forward !== back) {
    const index = items.indexOf(focused as HTMLButtonElement);
    const from = index === -1 ? Math.max(0, items.indexOf(primary)) : index;
    const step = forward ? 1 : -1;
    focusMenuButton(items[(from + step + items.length) % items.length]);
  }
  if (controls.pressed('confirm')) {
    const focusedItem = items.find((el) => el === focused);
    (focusedItem ?? primary).click();
  }
}

// Enter is read through the controls in the frame loop. Stopping its default keeps a focused button
// from also clicking itself on the same press.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && menuCard()) e.preventDefault();
});

/** Shows the button hints for whichever device was used last. Touch players get on-screen buttons instead. */
const help = document.getElementById('help')!;
const itemKey = document.getElementById('hud-item-key')!;
let shownDevice = '';
function updateHints(): void {
  const device = controls.lastUsed;
  if (device === shownDevice) return;
  shownDevice = device;
  help.hidden = device === 'touch';
  for (const hint of help.querySelectorAll<HTMLElement>('[data-hint]')) {
    hint.hidden = hint.dataset.hint !== device;
  }
  itemKey.hidden = device === 'touch';
  itemKey.textContent = device === 'gamepad' ? 'B' : 'X';
}

const toast = document.getElementById('toast')!;
let toastTimer = 0;
let padWasConnected = false;
function showToast(text: string, ms: number): void {
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, ms);
}

/** Says so when a controller is plugged in (or switched on) while the game is open. */
function updateConnectToast(): void {
  if (gamepad.connected && !padWasConnected) showToast('🎮 Controller connected', 2000);
  padWasConnected = gamepad.connected;
}

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

  controls.poll();
  updateHints();
  updateConnectToast();
  // The touch buttons would sit on top of the menu cards, so they only show during a race.
  touch.setVisible(!menuCard());
  handleMenuInput();
  if (controls.pressed('pause')) pauseKey();
  // Driving only happens in a live race: not in the title's demo, and not while paused.
  const driving = live && !demo && !paused;
  if (driving && controls.pressed('reset') && world.race.phase === 'racing') resetCar();
  if (canRestart() && controls.pressed('restart')) startRace();
  if (driving && world.race.phase === 'racing' && controls.pressed('fire')) world.useItem(0);
  if (keyboard.wasPressed('KeyM')) {
    sound.toggleMuted();
    showMuted();
  }
  // Gamepad buttons don't count as the interaction browsers need before audio can start, so
  // keep asking; it only works once the page has had a click, key press or tap.
  if (controls.lastUsed === 'gamepad') sound.unlock();
  controls.endFrame();

  if (paused) {
    // Frozen: no simulation steps, and no time builds up to be run in a rush on resume.
    accumulator = 0;
  } else {
    accumulator += dt;
    while (accumulator >= STEP) {
      fixedUpdate(STEP);
      accumulator -= STEP;
    }
  }
  // The demo moves on a few seconds after its leader crosses the line.
  if (demo && world.race.phase === 'finished') {
    demoTimer -= dt;
    if (demoTimer <= 0) nextDemo();
  }

  // When paused, the effects, banners, camera and car animation stand still too.
  const simDt = paused ? 0 : dt;
  tickTimedBanner(simDt);
  updateBanner();
  itemScene.update(simDt);
  const itemEvents = world.items.drainEvents();
  // Being hit buzzes the controller, if it can.
  if (!demo && itemEvents.some((event) => event.type === 'explode' && event.victim === 0)) gamepad.rumble(0.8, 250);
  itemScene.handleEvents(itemEvents);
  playItemSounds(itemEvents);
  playJumpEvents(world.drainJumps());
  updateCountdownBeeps();
  updateEngines();
  // Ambient, so it keeps moving behind the garage and results cards too.
  weather?.update(simDt, world.player.x, world.player.z);
  // The grid label stays up until the lights go out, in a race you're driving.
  if (gridLabel) gridLabel.visible = live && !demo && world.race.phase === 'countdown';
  // carViews are in the same order as world.racers, so index i matches world.items.status[i].
  carViews.forEach(({ racer, model }, i) => {
    model.setBoosting(world.items.status[i].boost > 0);
    model.sync(racer.car, simDt);
  });
  followCamera.update(world.player, simDt);
  sun.position.set(world.player.x + 30, 60, world.player.z + 20);
  sun.target.position.set(world.player.x, 0, world.player.z);
  updateHud();
  updateItemSlot();
  if (live && !results.root.hidden) updateStandings();

  renderer.render(scene, followCamera.camera);
  requestAnimationFrame(frame);
}

// The page opens on the title screen, over the attract demo.
showTitle();

requestAnimationFrame(frame);
