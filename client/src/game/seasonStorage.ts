import { newSeasonState, UPGRADE_KINDS, type SeasonState } from './season';

// Keeps the season in localStorage so a refresh doesn't lose progress. Storage can throw
// (private windows, blocked site data), so every read and write falls back quietly.

const KEY = 'rc-racer:season';
const STATUSES = new Set(['racing', 'shop', 'failed', 'gameOver', 'champion']);

export function loadSeason(): SeasonState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<SeasonState>;
    const valid =
      Number.isInteger(s.round) &&
      typeof s.money === 'number' &&
      Number.isInteger(s.continuesLeft) &&
      Array.isArray(s.results) &&
      STATUSES.has(s.status as string) &&
      UPGRADE_KINDS.every((k) => Number.isInteger(s.levels?.[k]));
    return valid ? { ...newSeasonState(), ...s } : null;
  } catch {
    return null;
  }
}

export function saveSeason(state: SeasonState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage is unavailable, so progress just isn't kept across reloads.
  }
}

export function clearSeason(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
