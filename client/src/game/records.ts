// Per-track best race and best lap times, kept in localStorage. Storage can throw (private
// windows, blocked site data), so every read and write falls back to "no record".

export interface Records {
  bestRace: number | null;
  bestLap: number | null;
}

export interface RecordUpdate {
  previous: Records;
  records: Records;
  newRaceRecord: boolean;
  newLapRecord: boolean;
}

const emptyRecords = (): Records => ({ bestRace: null, bestLap: null });
const storageKey = (trackId: string) => `rc-racer:records:${trackId}`;

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function loadRecords(trackId: string): Records {
  try {
    const raw = localStorage.getItem(storageKey(trackId));
    if (!raw) return emptyRecords();
    const parsed = JSON.parse(raw) as Partial<Records>;
    return {
      bestRace: isTime(parsed.bestRace) ? parsed.bestRace : null,
      bestLap: isTime(parsed.bestLap) ? parsed.bestLap : null,
    };
  } catch {
    return emptyRecords();
  }
}

function saveRecords(trackId: string, records: Records): void {
  try {
    localStorage.setItem(storageKey(trackId), JSON.stringify(records));
  } catch {
    // Storage is unavailable, so the new record is simply not kept.
  }
}

/** Forgets the best times on the given tracks. */
export function clearAllRecords(trackIds: string[]): void {
  for (const trackId of trackIds) {
    try {
      localStorage.removeItem(storageKey(trackId));
    } catch {
      // Nothing to clear.
    }
  }
}

/** Compares a finished race against the stored records and saves any improvements. */
export function updateRecords(
  trackId: string,
  raceTime: number,
  bestLap: number | null,
): RecordUpdate {
  const previous = loadRecords(trackId);
  // With no stored time yet, the first finished race counts as a record.
  const newRaceRecord = previous.bestRace === null || raceTime < previous.bestRace;
  const newLapRecord = bestLap !== null && (previous.bestLap === null || bestLap < previous.bestLap);
  const records: Records = {
    bestRace: newRaceRecord ? raceTime : previous.bestRace,
    bestLap: newLapRecord ? bestLap : previous.bestLap,
  };
  if (newRaceRecord || newLapRecord) saveRecords(trackId, records);
  return { previous, records, newRaceRecord, newLapRecord };
}
