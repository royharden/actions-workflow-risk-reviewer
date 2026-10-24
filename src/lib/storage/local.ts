// localStorage ruling repository (demo mode). Every storage access is wrapped: a private window, blocked site data or a
// full quota degrades to an in-memory list for this tab, and the repository says so through note().
import { z } from 'zod';
import type { RulingEvent } from '../../core/rulings';
import type { Persistence, RulingRepository } from './repository';

export const RULINGS_STORAGE_KEY = 'awr.rulings.v1';

const UNAVAILABLE_NOTE = 'Browser storage is unavailable: rulings are kept in memory for this tab only and are lost on reload.';
const UNREADABLE_NOTE = 'Stored rulings could not be read and were ignored; new rulings are kept in memory for this tab only.';
const WRITE_FAILED_NOTE = 'Browser storage refused a write (it may be full): rulings are now kept in memory for this tab only.';
const CLEAR_FAILED_NOTE = 'This tab was cleared, but browser storage could not be cleared. Previously saved rulings may reappear after reload.';

// Mirrors src/core/rulings.ts; invalid stored data triggers a visible memory fallback.
const eventSchema = z.object({
  eventId: z.string().min(1),
  at: z.string(),
  fileHash: z.string(),
  fingerprint: z.string(),
  ruleVersion: z.string(),
  findingId: z.string(),
  decision: z.enum(['confirm', 'false_positive', 'accept_fix', 'reject_fix']),
  patchDigest: z.string().optional(),
  reason: z.string().optional(),
});

function storageOrNull(): Storage | null {
  try {
    const storage = window.localStorage;
    const probe = `${RULINGS_STORAGE_KEY}.probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function dedup(events: RulingEvent[]): RulingEvent[] {
  const seen = new Set<string>();
  const out: RulingEvent[] = [];
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    out.push(event);
  }
  return out;
}

export function createLocalRepository(): RulingRepository {
  let storage = storageOrNull();
  let note: string | null = storage === null ? UNAVAILABLE_NOTE : null;
  let memory: RulingEvent[] = [];

  function readStored(): RulingEvent[] {
    if (storage === null) return memory;
    let raw: string | null;
    try {
      raw = storage.getItem(RULINGS_STORAGE_KEY);
    } catch {
      storage = null;
      note = UNAVAILABLE_NOTE;
      return memory;
    }
    if (raw === null) {
      memory = [];
      return memory;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      const events: RulingEvent[] = [];
      for (const item of parsed) {
        const checked = eventSchema.safeParse(item);
        if (!checked.success) throw new Error('invalid ruling event');
        events.push(checked.data);
      }
      memory = dedup(events);
      return memory;
    } catch {
      storage = null;
      note = UNREADABLE_NOTE;
      return memory;
    }
  }

  function writeStored(events: RulingEvent[]): void {
    // Keep the last known history even if a later storage read/write starts failing.
    memory = events;
    if (storage !== null) {
      try {
        storage.setItem(RULINGS_STORAGE_KEY, JSON.stringify(events));
        return;
      } catch {
        storage = null;
        note = WRITE_FAILED_NOTE;
      }
    }
  }

  return {
    async appendRuling(event) {
      const events = readStored();
      if (events.some((existing) => existing.eventId === event.eventId)) return;
      writeStored([...events, event]);
    },
    async listRulings() {
      return [...readStored()];
    },
    async clearAll() {
      memory = [];
      // Also clears a stored list that was unreadable; storage that works again is used again.
      try {
        // A full quota can refuse the write probe while still allowing removal.
        const fresh = window.localStorage;
        fresh.removeItem(RULINGS_STORAGE_KEY);
        storage = fresh;
        note = null;
      } catch {
        storage = null;
        note = CLEAR_FAILED_NOTE;
      }
    },
    persistence(): Persistence {
      return storage === null ? 'memory' : 'local';
    },
    note() {
      return note;
    },
  };
}
