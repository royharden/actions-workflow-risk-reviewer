// Ruling storage seam (PLAN D2, D31). Demo mode uses the localStorage adapter (local.ts); the Bolt Database adapter
// arrives in M5 behind the same interface. Events are append-only: there is no update or delete of a single event.
import type { RulingEvent } from '../../core/rulings';

export type Persistence = 'local' | 'memory';

export interface RulingRepository {
  /** Appends one event; an event whose `eventId` is already stored is ignored (D31 dedup). */
  appendRuling(event: RulingEvent): Promise<void>;
  /** Every stored event in append order. */
  listRulings(): Promise<RulingEvent[]>;
  /** "Clear local data": removes every stored event. */
  clearAll(): Promise<void>;
  /** Where events currently live; `memory` means they are lost on reload. */
  persistence(): Persistence;
  /** A visible note when storage is degraded (unavailable, unreadable or full), else null. */
  note(): string | null;
}
