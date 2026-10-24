import type { Finding } from '../finding';
import type { Hasher } from '../hash';
import type { EditOp } from '../fixers/editops';
import { applyOps, validateOps } from '../fixers/editops';
import { fixerFor } from '../fixers';
import type { FixContext, FixerId } from '../fixers';
import { parseWorkflow } from '../parse';
import { scanText } from '../scan';
import { disableReasons, structureReasons } from './structure';
import type { Reason } from './reasons';
import pinsFile from '../../../fixtures/pins.json';
export type { FixerId } from '../fixers';
export interface CheckResult { ok: boolean; reasons: Reason[]; patched?: string; introduced: Finding[] }
export function fingerprintCounts(findings: Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.fingerprint, (counts.get(finding.fingerprint) ?? 0) + 1);
  return counts;
}
export function introducedFindings(before: Finding[], after: Finding[]): Finding[] {
  const remaining = fingerprintCounts(before);
  return after.filter((finding) => {
    const count = remaining.get(finding.fingerprint) ?? 0;
    if (count > 0) { remaining.set(finding.fingerprint, count - 1); return false; }
    return true;
  });
}
export async function check(original: string, ops: EditOp[], target: Finding, fixer: FixerId, hasher: Hasher, ctx: FixContext = { pins: pinsFile.pins }): Promise<CheckResult> {
  const fail = (reasons: Reason[], introduced: Finding[] = []): CheckResult => ({ ok: false, reasons: [...new Set(reasons)], introduced });
  try {
    if (await hasher.sha256Hex(original) !== target.fileHash) return fail(['source_hash_mismatch']);
    const issue = validateOps(original, ops);
    if (issue) return fail([issue]);
    const before = await scanText(target.file, original, hasher);
    if (before.status !== 'complete') return fail(['invalid_yaml']);
    const matches = before.findings.filter((finding) => finding.fingerprint === target.fingerprint);
    if (matches.length !== 1 || matches[0].id !== target.id || matches[0].ruleVersion !== target.ruleVersion || fixerFor(matches[0]) !== fixer) return fail(['identity_ambiguous']);
    const parsed = parseWorkflow(original);
    if (!parsed.ok) return fail(['invalid_yaml']);
    const patched = applyOps(original, ops);
    const after = await scanText(target.file, patched, hasher);
    const reparsed = parseWorkflow(patched);
    if (after.status !== 'complete' || !reparsed.ok) return fail(['invalid_yaml']);
    const reasons: Reason[] = [];
    if (after.findings.some((finding) => finding.fingerprint === target.fingerprint)) reasons.push('target_still_flagged');
    const introduced = introducedFindings(before.findings, after.findings);
    if (introduced.length > 0) {
      reasons.push('introduced_finding');
      const oldCounts = fingerprintCounts(before.findings);
      if (introduced.some((finding) => oldCounts.has(finding.fingerprint) || before.findings.some((old) => old.rule === finding.rule && old.jobId === finding.jobId && old.stepKey === finding.stepKey && old.occurrence.replace(/#\d+$/, '') === finding.occurrence.replace(/#\d+$/, '')))) reasons.push('extra_occurrence');
    }
    reasons.push(...structureReasons(parsed, reparsed, matches[0], fixer, ctx), ...disableReasons(parsed.workflow, reparsed.workflow));
    if (reasons.length > 0) return fail(reasons, introduced);
    return { ok: true, reasons: [], patched, introduced: [] };
  } catch { return fail(['internal_error']); }
}
