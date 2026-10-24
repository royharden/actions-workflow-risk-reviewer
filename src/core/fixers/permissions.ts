import type { Finding } from '../finding';
import { getEntry } from '../model';
import type { ParseOk } from '../parse';
import { flow, uneditable, containsUneditable } from './types';
import type { FixContext, Proposal } from './types';
export function propose(parsed: ParseOk, finding: Finding, _ctx: FixContext): Proposal {
  const wf = parsed.workflow;
  if (finding.jobId !== null) return { ok: false, reason: 'manual_fix' };
  const existing = getEntry(wf.root, 'permissions');
  if (finding.facts.aliased || uneditable(wf.root) || containsUneditable(existing?.value)) return { ok: false, reason: 'aliased_target' };
  if (flow(wf.root) || flow(existing?.value)) return { ok: false, reason: 'flow_style' };
  const replacement = 'permissions:\n  contents: read';
  if (existing) return { ok: true, ops: [{ startLine: existing.span.startLine, endLine: existing.span.endLine, replacement }], description: 'Replace workflow permissions with contents: read; behaviour unverified.' };
  if (!wf.jobsEntry) return { ok: false, reason: 'target_missing' };
  return { ok: true, ops: [{ startLine: wf.jobsEntry.keySpan.startLine, endLine: wf.jobsEntry.keySpan.startLine - 1, replacement }], description: 'Declare workflow permissions as contents: read; behaviour unverified.' };
}
