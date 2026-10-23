# Contributing to RC Racer

Thanks for wanting to help! RC Racer is a small, friendly project, and bug fixes, new tracks, polish and
ideas are all welcome. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before you jump in.

## Run it

```bash
cd client
npm install
npm run dev
```

## Before you open a PR

Run these three checks from `client/`. CI runs the same ones on Node 22 and 24.

```bash
npm test          # unit tests (Vitest)
npm run typecheck # TypeScript, no emit
npm run build     # type-check and production build
```

## Where things live

The [Layout section of the README](README.md#layout) lists every file. The key idea:

- **The game logic in `client/src/game/` is deliberately kept free of rendering and the DOM.** Handling,
  track maths, AI, race rules and items are plain TypeScript, so they are unit-tested with Vitest. Put
  game logic there and test it.
- **`trackScene.ts`, `carModel.ts`, `main.ts` and `client/src/ui/`** are the visual and UI layers. They
  are checked by eye, so include a screenshot or clip (see below).

## What makes a good PR

- **Small and focused.** One change per PR is easiest to review.
- **Tests for logic changes.** Add or update tests whenever you touch `client/src/game/`.
- **A screenshot or short clip for visual changes**, so reviewers can see it without running it.
- **Match the existing code style.** There is no formatter yet, so follow the files around your change.

## Bigger ideas

Want to add a vehicle, a mechanic or something that reshapes the game? Please
[open an issue](https://github.com/wayne-folkes/rc-racer/issues/new/choose) first so we can talk it
through before you spend time on it. Small fixes can go straight to a PR.

## License

By contributing, you agree that your contributions are licensed under the repo's [MIT License](LICENSE).

## Previews and CI

Every PR runs CI automatically. Preview deployments on Vercel for PRs from forks need the maintainer to
authorize them first, so a missing preview link is normal and nothing to worry about.
