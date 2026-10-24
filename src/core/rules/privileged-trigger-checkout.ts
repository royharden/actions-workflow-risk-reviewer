import type { Facts } from '../finding';
import { occurrenceBase } from '../identity';
import { getEntry, joinSpans, scalarText } from '../model';
import type { Workflow } from '../model';
import type { RawFinding, Rule } from './types';
import { baseFacts, contextPaths, isCheckout, snippetOf, stepExecutesCheckedOutCode } from './util';

// Fires: a privileged trigger (pull_request_target / workflow_run / issue_comment) and an
// actions/checkout step whose `ref:` is a PR-head ref (head.sha, head.ref, merge_commit_sha,
// refs/pull/…/merge|head, workflow_run.head_sha/head_branch, github.head_ref) → refClass pr_head,
// or an expression the rule cannot resolve (e.g. steps.*.outputs) → refClass unknown.
// executesCheckedOutCode is recorded when a later step in the job runs repo code (npm, make, ./script, local action …).
// Excluded: no `ref:` (the default is the base/default branch for these triggers), a static literal ref,
// and base-only refs (base.sha, base.ref, github.sha, github.ref, …) — base-ref is a rule exclusion, not a gate.
// No cross-file provenance.

type RefClass = NonNullable<Facts['refClass']>;

const PR_HEAD = new Set([
  'github.event.pull_request.head.sha',
  'github.event.pull_request.head.ref',
  'github.event.pull_request.merge_commit_sha',
  'github.event.workflow_run.head_sha',
  'github.event.workflow_run.head_branch',
  'github.event.workflow_run.head_commit.id',
  'github.head_ref',
]);

const BASE = new Set([
  'github.event.pull_request.base.sha',
  'github.event.pull_request.base.ref',
  'github.event.repository.default_branch',
  'github.sha',
  'github.ref',
  'github.ref_name',
  'github.base_ref',
]);

/** Null when there is no ref (default checkout). */
export function classifyRef(ref: string): RefClass | null {
  const text = ref.trim();
  if (text.length === 0) return null;
  if (/(^|\/)refs\/pull\//i.test(text) || /^pull\//i.test(text)) return 'pr_head';
  const expressions = [...text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]);
  if (expressions.length === 0) return 'base'; // static branch, tag or SHA chosen by the maintainer
  const paths = expressions.flatMap((inner) => contextPaths(inner)).filter((p) => p.includes('.'));
  if (paths.some((p) => PR_HEAD.has(p))) return 'pr_head';
  if (paths.length > 0 && paths.every((p) => BASE.has(p))) return 'base';
  return 'unknown';
}

export const privilegedTriggerCheckout: Rule = {
  id: 'privileged-trigger-checkout',
  version: '1',
  apply(wf: Workflow): RawFinding[] {
    if (!wf.privileged) return [];
    const out: RawFinding[] = [];
    const privilegedTriggers = wf.triggers.filter((t) => t === 'pull_request_target' || t === 'workflow_run' || t === 'issue_comment');
    for (const job of wf.jobs) {
      job.steps.forEach((step, i) => {
        if (!step.uses || !isCheckout(step.usesValue)) return;
        const refEntry = getEntry(step.with, 'ref');
        const refText = refEntry ? (scalarText(refEntry.value) ?? '') : '';
        const refClass = classifyRef(refText);
        if (refClass === null || refClass === 'base') return;
        const executes = job.steps.slice(i + 1).some(stepExecutesCheckedOutCode);
        const span = refEntry ? joinSpans(step.uses.span, refEntry.span) : step.uses.span;
        const what =
          refClass === 'pr_head'
            ? `checks out pull-request head code (ref: ${refText.trim()})`
            : `checks out an unresolved ref expression (ref: ${refText.trim()}); unknown ref, provenance not resolved`;
        const detail = `Privileged trigger (${privilegedTriggers.join(', ')}) ${what}${executes ? ', and a later step runs the checked-out code' : ''}.`;
        out.push({
          occurrence: occurrenceBase('uses', '', ''),
          rule: 'privileged-trigger-checkout',
          jobId: job.id,
          stepKey: step.key,
          stepIndex: step.index,
          span,
          snippet: snippetOf(wf, span),
          facts: baseFacts(wf, detail, {
            refClass,
            executesCheckedOutCode: executes,
            aliased: step.uses.aliased || (refEntry ? refEntry.aliased : false),
          }),
        });
      });
    }
    return out;
  },
};
