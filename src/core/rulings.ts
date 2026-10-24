import type { Finding } from './finding';
export interface RulingEvent {
  eventId: string;
  at: string;
  fileHash: string;
  fingerprint: string;
  ruleVersion: string;
  findingId: string;
  decision: 'confirm' | 'false_positive' | 'accept_fix' | 'reject_fix';
  patchDigest?: string;
  reason?: string;
}
export type RulingValue = RulingEvent | 'needs_review';
/** Replay is read-only: append order breaks equal timestamps; duplicate event IDs keep their first bytes. */
export function latestRulings(events: readonly RulingEvent[], findings: readonly Finding[], patchDigests?: ReadonlyMap<string, string>): Map<string, RulingValue> {
  const seen = new Set<string>();
  const unique = events.filter((event) => { if (seen.has(event.eventId)) return false; seen.add(event.eventId); return true; });
  const result = new Map<string, RulingValue>();
  for (const finding of findings) {
    const exact = unique.filter((event) => event.fingerprint === finding.fingerprint && event.fileHash === finding.fileHash && event.ruleVersion === finding.ruleVersion);
    const candidates = exact.length > 0 ? exact : unique.filter((event) => event.fingerprint === finding.fingerprint);
    let latest: RulingEvent | undefined;
    for (const event of candidates) if (!latest || event.at >= latest.at) latest = event;
    if (!latest) continue;
    const fixDecision = latest.decision === 'accept_fix' || latest.decision === 'reject_fix';
    const stale = latest.fileHash !== finding.fileHash || latest.ruleVersion !== finding.ruleVersion || latest.findingId !== finding.id || (fixDecision && (!latest.patchDigest || (patchDigests !== undefined && patchDigests.get(finding.id) !== latest.patchDigest)));
    result.set(finding.id, stale ? 'needs_review' : { ...latest });
  }
  return result;
}
