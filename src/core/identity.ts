import type { Hasher } from './hash';
import type { RuleId, Span } from './finding';

// PLAN D6. Fingerprints carry no line number and no file hash, so they survive line
// shifts and the three allowed fixes; `id` adds the file hash and rule version and keys rulings.

export const FIELD_SEPARATOR = '\u001f';

/** stepKey per step: its `id` when present and unique within the job, else `#<index>`. `name` is never used. */
export function stepKeysFor(ids: ReadonlyArray<string | null>): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) if (id !== null && id !== '') counts.set(id, (counts.get(id) ?? 0) + 1);
  return ids.map((id, index) => (id !== null && id !== '' && counts.get(id) === 1 ? id : `#${index}`));
}

/** Expression text as used in identity: inner text of `${{ … }}`, trimmed, whitespace runs collapsed. */
export function normalizeExpression(inner: string): string {
  return inner.trim().replace(/\s+/g, ' ');
}

/**
 * Occurrence before the ordinal: AST key path inside the step (or job, or workflow root for
 * workflow-level findings), sink class, normalized expression text. Rules emit this; scan.ts
 * appends `#<ordinal>` among identical (rule, jobId, stepKey, base) groups in document order.
 */
export function occurrenceBase(path: string, sink: string, text: string): string {
  return JSON.stringify([path, sink, text]);
}

export interface OccurrenceSubject {
  rule: RuleId;
  jobId: string | null;
  stepKey: string | null;
  occurrence: string;
  span: Span;
}

/** Appends the ordinal to every occurrence base; returns new objects, input order kept. */
export function assignOrdinals<T extends OccurrenceSubject>(items: readonly T[]): T[] {
  const order = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.span.startLine - b.item.span.startLine || a.item.span.startCol - b.item.span.startCol || a.index - b.index);
  const counters = new Map<string, number>();
  const result: T[] = new Array<T>(items.length);
  for (const { item, index } of order) {
    const group = [item.rule, item.jobId ?? '', item.stepKey ?? '', item.occurrence].join(FIELD_SEPARATOR);
    const n = counters.get(group) ?? 0;
    counters.set(group, n + 1);
    result[index] = { ...item, occurrence: `${item.occurrence}#${n}` };
  }
  return result;
}

export function fingerprintOf(hasher: Hasher, rule: RuleId, jobId: string | null, stepKey: string | null, occurrence: string): Promise<string> {
  return hasher.sha256Hex([rule, jobId ?? '', stepKey ?? '', occurrence].join(FIELD_SEPARATOR));
}

export function findingIdOf(hasher: Hasher, fingerprint: string, fileHash: string, ruleVersion: string): Promise<string> {
  return hasher.sha256Hex([fingerprint, fileHash, ruleVersion].join(FIELD_SEPARATOR));
}
