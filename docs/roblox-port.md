# Porting RC Racer to Roblox

Status: **idea, not started.** This is the plan for a first spike, to be picked up another day.

## Why a spike first

A Roblox port is mostly a rewrite of everything the player sees and hears, but the game logic
should carry over. Before committing to the full port, a small spike answers "how hard is it,
really?" by getting one car driving on one track in Roblox with the real handling code.

## What carries over and what doesn't

Roblox runs its own engine, scripted in Luau (typed Lua). The browser code doesn't run there, but
the game logic in `client/src/game/` is deliberately kept separate from rendering, the DOM and the
browser, so most of it can be ported, ideally compiled with roblox-ts rather than retyped.

| Part of the game | Today (web) | On Roblox | Port effort |
|---|---|---|---|
| Handling, race rules, season, AI, racing line, items, ramps (`carPhysics`, `race`, `season`, `racingLine`, `aiDriver`, `items`, `jumps`, `collision`, `world`, `tracks`) | Pure TypeScript, 113 vitest tests | Compile with roblox-ts, or translate to Luau | Low–medium: the reusable core |
| Tracks (`trackPath`) | Spline control points; samples with Three.js `CatmullRomCurve3` | Same control points; replace the Three.js curve with a small Catmull-Rom of our own; build road, kerbs and walls as Parts/WedgeParts or EditableMesh at runtime | Medium |
| 3D look (`carModel`, `trackScene`, `itemScene`, `rampScene`, `weatherScene`) | Three.js meshes | Parts, MeshParts, ParticleEmitters; the low-poly style suits Roblox | Rewrite |
| Camera (`followCamera`) | Orthographic 3/4 view | Scriptable camera; no true orthographic, so a narrow FOV from far away | Low |
| Menus and HUD (`main.ts`, `ui/`) | HTML and CSS | ScreenGui | Rewrite |
| Input (`controls`, `input`, `gamepad`, `touch`) | Custom keyboard, gamepad and touch code | ContextActionService / UserInputService; mobile and console controls come built in | Easier than today |
| Sound (`audio`) | Synthesized live with Web Audio | Sound objects need uploaded audio assets: record the synth sounds to files and upload them (they go through moderation) | Medium |
| Saving (`seasonStorage`, `records`) | localStorage | DataStoreService; OrderedDataStore gives global leaderboards | Low–medium |
| Tests | Vitest | Jest-Lua or TestEZ; Lune can run Luau outside Studio | Medium |

## The big decision: multiplayer

Roblox players expect multiplayer. A single-player port against AI is the smaller job; online
races are the real prize and the real cost:

- the server owns the true race (positions, laps, results);
- each player's car responds instantly on their own device (client-side prediction / network
  ownership) while other cars are smoothed over the network;
- missiles, bombs and bumps have to resolve fairly despite lag;
- lobbies and matchmaking, with AI filling empty grid slots.

Rough size: a single-player port is about the effort of building steps 1–5 of the web game
(somewhat less, since the design and tuning numbers are settled). Multiplayer adds a similar amount
again.

## Recommended tooling

- **roblox-ts** (TypeScript → Luau compiler), so the pure modules can be reused largely as-is.
- **Rojo** to sync source files from the repo into Roblox Studio, keeping the code in git.
- A **new project folder**, `rc-racer-roblox/`, beside this one. This repo stays
  the reference.

Practicalities: Roblox Studio (a desktop app) is needed to play and test; code can be written and
built from the editor, but someone has to open it in Studio. Publishing needs a Roblox account and
the content maturity questionnaire (cartoon missiles and bombs are fine).

## The spike

**Goal:** one drivable car on Meadow Loop in Roblox, with the same arcade feel, using roblox-ts +
Rojo and the ported handling code.

1. **Toolchain.** In `rc-racer-roblox/`: roblox-ts (`rbxtsc`), a Rojo project
   file, and `src/` with `client/`, `server/` and `shared/`. Pin tool versions (mise or npm, as the
   sibling projects do). `git init`; don't create a GitHub repo or push without asking.
2. **Port the pure logic** to `src/shared/` with as few changes as possible: `carPhysics.ts`
   (`stepCar`, `DEFAULT_TUNING`), `trackPath.ts` (with our own Catmull-Rom instead of Three.js),
   `collision.ts`, and Meadow Loop's control points (`DEMO_TRACK`). Write down anything that
   doesn't compile under roblox-ts and how it was fixed: that's one of the main things the spike
   is for.
3. **Build the track at runtime** from the centreline: road, kerbs and low walls as Parts or
   WedgeParts (or EditableMesh if simpler) on a flat green baseplate.
4. **A player car:** a simple low-poly model driven by the ported `stepCar` each frame on the
   client (Heartbeat or RenderStepped), with keyboard, gamepad and touch through
   ContextActionService, and a fixed 3/4 scriptable camera like `followCamera.ts`.
5. **`NOTES.md`** in the new project: what transferred cleanly, what had to be rewritten, the
   mapping above filled in with what was actually found, and a firmer estimate for the rest (AI
   racers, items, ramps, season and garage, UI) plus what multiplayer would add.

**Done means:** `rbxtsc` and `rojo build -o spike.rbxlx` succeed, the place file opens in Studio
with a car you can drive round Meadow Loop, and `NOTES.md` exists. Ask before installing anything
globally or signing in to Roblox.

## After the spike

If it goes well, a sensible order: AI opponents and the race (positions, laps, results) → items,
boost pads, hazards and ramps → the season, garage and saving with DataStoreService → sound assets
→ multiplayer lobbies. Revisit the multiplayer decision with the spike's numbers in hand.
