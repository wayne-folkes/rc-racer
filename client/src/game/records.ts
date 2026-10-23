// Best race and best lap times for each track and vehicle, kept in localStorage. Each vehicle has
// its own, because they don't drive alike: the truck is a few percent slower, so it could never beat
// a buggy record. Storage can throw (private windows, blocked site data), so every read and write
// falls back to "no record".

import { VEHICLE_IDS, type VehicleId } from './vehicles';

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
/**
 * The buggy was the only vehicle when records were first saved, so it keeps that key and those
 * records need no migrating. Every other vehicle has its own.
 */
const storageKey = (vehicle: VehicleId, trackId: string) =>
  vehicle === 'buggy' ? `rc-racer:records:${trackId}` : `rc-racer:records:${vehicle}:${trackId}`;

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function loadRecords(vehicle: VehicleId, trackId: string): Records {
  try {
    const raw = localStorage.getItem(storageKey(vehicle, trackId));
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

function saveRecords(vehicle: VehicleId, trackId: string, records: Records): void {
  try {
    localStorage.setItem(storageKey(vehicle, trackId), JSON.stringify(records));
  } catch {
    // Storage is unavailable, so the new record is simply not kept.
  }
}

/** Forgets the best times on the given tracks, in every vehicle. */
export function clearAllRecords(trackIds: string[]): void {
  for (const vehicle of VEHICLE_IDS) {
    for (const trackId of trackIds) {
      try {
        localStorage.removeItem(storageKey(vehicle, trackId));
      } catch {
        // Nothing to clear.
      }
    }
  }
}

/** Compares a finished race against the stored records for that vehicle and saves any improvements. */
export function updateRecords(
  vehicle: VehicleId,
  trackId: string,
  raceTime: number,
  bestLap: number | null,
): RecordUpdate {
  const previous = loadRecords(vehicle, trackId);
  // With no stored time yet, the first finished race counts as a record.
  const newRaceRecord = previous.bestRace === null || raceTime < previous.bestRace;
  const newLapRecord = bestLap !== null && (previous.bestLap === null || bestLap < previous.bestLap);
  const records: Records = {
    bestRace: newRaceRecord ? raceTime : previous.bestRace,
    bestLap: newLapRecord ? bestLap : previous.bestLap,
  };
  if (newRaceRecord || newLapRecord) saveRecords(vehicle, trackId, records);
  return { previous, records, newRaceRecord, newLapRecord };
}
