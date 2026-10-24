import type { Finding } from '../finding';
import type { LNode, Step } from '../model';
import type { ParseOk } from '../parse';
import type { EditOp } from './editops';
export type FixerId = 'pin' | 'permissions' | 'injection-env';
export interface Pin { action: string; fromRef: string; sha: string; source?: string }
export interface FixContext { pins: readonly Pin[] }
export type RefusalReason = 'no_fixer' | 'needs_lookup' | 'pin_key_mismatch' | 'pin_not_in_table' | 'aliased_target' | 'flow_style' | 'manual_fix' | 'shell_unknown' | 'target_missing' | 'identity_ambiguous' | 'oversized';
export type Proposal = { ok: true; ops: EditOp[]; description: string } | { ok: false; reason: RefusalReason };
export function targetStep(parsed: ParseOk, finding: Finding): Step | undefined { return parsed.workflow.jobs.find((job) => job.id === finding.jobId)?.steps.find((step) => step.key === finding.stepKey); }
export function uneditable(node: LNode | null | undefined): boolean { return Boolean(node && (node.aliased || node.anchored)); }
export function flow(node: LNode | null | undefined): boolean { return Boolean((node?.yaml as { flow?: boolean } | null)?.flow); }

export function containsUneditable(node: LNode | null | undefined): boolean {
  if (!node) return false;
  return uneditable(node) || (node.kind === 'map' && node.entries.some((entry) => containsUneditable(entry.value))) || (node.kind === 'seq' && node.items.some(containsUneditable));
}
