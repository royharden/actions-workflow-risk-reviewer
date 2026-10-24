import type { Facts } from '../finding';
import { occurrenceBase } from '../identity';
import type { Job, LEntry, Step, Workflow } from '../model';
import type { RawFinding, Rule } from './types';
import { baseFacts, snippetOf } from './util';

// Fires: every remote step / reusable-job `uses:` not pinned to a 40-hex SHA (actions/* included):
// tag, branch, short SHA, 40-char non-hex, or `docker://` without an `@sha256:` digest.
// Excluded: local `./…` (and `../…`) references; `docker://…@sha256:<64 hex>`.

export type RefKind = NonNullable<Facts['refKind']>;

/** Null when the reference is pinned or local; else the kind of mutable reference. */
export function classifyUses(value: string): RefKind | null {
  const v = value.trim();
  if (v.startsWith('./') || v.startsWith('../')) return null;
  if (v.toLowerCase().startsWith('docker://')) {
    return /@sha256:[0-9a-f]{64}$/i.test(v) ? null : 'docker_tag';
  }
  const at = v.lastIndexOf('@');
  if (at < 0) return 'tag_or_branch'; // no ref at all
  const ref = v.slice(at + 1);
  if (/^[0-9a-f]{40}$/i.test(ref)) return null;
  if (/^[0-9a-f]{7,39}$/i.test(ref)) return 'short_sha';
  if (ref.length === 40) return 'non_hex';
  return 'tag_or_branch';
}

const DETAIL: Record<RefKind, string> = {
  tag_or_branch: 'is pinned to a tag or branch, which can be moved to different code',
  short_sha: 'is pinned to a short SHA, which is not a full immutable commit reference',
  non_hex: 'has a 40-character ref that is not a hex commit SHA',
  docker_tag: 'is a Docker image without an @sha256 digest',
};

export const unpinnedUses: Rule = {
  id: 'unpinned-uses',
  version: '1',
  apply(wf: Workflow): RawFinding[] {
    const out: RawFinding[] = [];
    for (const job of wf.jobs) {
      if (job.uses && job.usesValue) push(out, wf, job, null, job.uses, job.usesValue);
      for (const step of job.steps) {
        if (step.uses && step.usesValue) push(out, wf, job, step, step.uses, step.usesValue);
      }
    }
    return out;
  },
};

function push(out: RawFinding[], wf: Workflow, job: Job, step: Step | null, entry: LEntry, value: string): void {
  const refKind = classifyUses(value);
  if (!refKind) return;
  const span = entry.span;
  out.push({
    occurrence: occurrenceBase('uses', '', ''),
    rule: 'unpinned-uses',
    jobId: job.id,
    stepKey: step ? step.key : null,
    stepIndex: step ? step.index : null,
    span,
    snippet: snippetOf(wf, span),
    facts: baseFacts(wf, `"${value.trim()}" ${DETAIL[refKind]}.`, {
      usesRef: value.trim(),
      refKind,
      aliased: entry.aliased,
    }),
  });
}
