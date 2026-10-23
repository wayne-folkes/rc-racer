# RC Racer

A browser racing game in the spirit of RC Pro-Am: low-poly RC cars on a track seen from a fixed
3/4 camera. TypeScript + Vite + Three.js, no backend yet.

## Run it

```bash
cd client
npm install
npm run dev
```

Arrow keys or WASD to drive, Space for the handbrake (slide), X or Shift to use an item, R to reset
onto the track, N to restart the race (or Enter on the results screen).

`npm test` runs the unit tests (handling, track maths, collisions, race rules, AI, and full
four-car races on the demo track). `npm run build` type-checks and builds to `client/dist`.

## Layout

- `client/src/main.ts`: renderer, lights, fixed-timestep game loop, HUD.
- `client/src/game/carPhysics.ts`: arcade handling. All the feel lives in `DEFAULT_TUNING`.
- `client/src/game/trackPath.ts`: track centreline, projection onto it, the demo layout.
- `client/src/game/collision.ts`: walls and car-to-car bumps.
- `client/src/game/race.ts`: race rules: countdown, checkpoints, laps, standings.
- `client/src/game/world.ts`: the whole race simulation (cars, AI, collisions, rules) without rendering.
- `client/src/game/racingLine.ts`, `aiDriver.ts`, `racers.ts`: AI racing line, driving, opponents and grid.
- `client/src/game/items.ts`: item boxes, missiles, bombs, boosts, oil and puddles, and the demo layout.
- `client/src/game/carModel.ts`, `trackScene.ts`, `itemScene.ts`, `followCamera.ts`: visuals.

## Roadmap

1. One car on a track, tuned until it's fun to drive. **(done)**
2. Proper race: countdown, checkpoints, 3-lap races, results. **(done)**
3. AI opponents following the racing line, race positions. **(done)**
4. Pickups and weapons (missiles, bombs, boosts), oil slicks and puddles. **(done)**
5. Progression: several tracks, upgrades between races, top-3-or-game-over.
6. Polish: sound, menus, gamepad, ramps and jumps, track editor.
