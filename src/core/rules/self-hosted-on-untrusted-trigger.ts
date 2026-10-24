import { occurrenceBase } from '../identity';
import { asMap, asSeq, getEntry, scalarText } from '../model';
import type { Job, LNode, Workflow } from '../model';
import type { RawFinding, Rule } from './types';
import { baseFacts, snippetOf } from './util';

// Fires: a fork-reachable workflow (pull_request, pull_request_target, issue_comment, workflow_run)
// with a job whose `runs-on` label set contains `self-hosted` — scalar, array, `{labels: …}`, or
// `${{ matrix.<key> }}` resolved against a finite `strategy.matrix` (values and `include` entries).
// Excluded: non-fork-reachable triggers; hosted labels only. Dynamic labels (any other expression,
// a matrix that is itself an expression, a runner `group` without labels) → no finding, a coverage note.

interface Labels {
  labels: string[];
  dynamic: string[]; // label sources that could not be resolved
}

function addLabel(job: Job, node: LNode, result: Labels, allowMatrix = true): void {
  if (node.kind === 'seq') {
    for (const item of node.items) addLabel(job, item, result, allowMatrix);
    return;
  }
  const text = scalarText(node);
  if (text === null) return;
  const trimmed = text.trim();
  if (!trimmed.includes('${{')) {
    result.labels.push(trimmed);
    return;
  }
  const matrixRef = /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/.exec(trimmed);
  // Matrix values are resolved one level only (a matrix value that is itself an expression is dynamic).
  if (!allowMatrix || !matrixRef || !addMatrixValues(job, matrixRef[1], result)) result.dynamic.push(trimmed);
}

/** Adds the finite values of strategy.matrix.<key>; false when the matrix cannot be resolved. */
function addMatrixValues(job: Job, key: string, result: Labels): boolean {
  const matrix = asMap(getEntry(asMap(getEntry(job.map, 'strategy')?.value), 'matrix')?.value);
  if (!matrix) return false;
  const values: LNode[] = [];
  const direct = getEntry(matrix, key);
  if (direct) {
    const seq = asSeq(direct.value);
    if (!seq) return false; // e.g. os: ${{ fromJSON(...) }}
    values.push(...seq.items);
  }
  const include = asSeq(getEntry(matrix, 'include')?.value);
  if (include) {
    for (const item of include.items) {
      const value = getEntry(asMap(item), key);
      if (value) values.push(value.value);
    }
  } else if (getEntry(matrix, 'include')) {
    return false; // include given as an expression
  }
  if (values.length === 0) return false;
  const before = result.dynamic.length;
  for (const value of values) addLabel(job, value, result, false);
  return result.dynamic.length === before;
}

export function runnerLabels(job: Job): Labels | null {
  if (!job.runsOn) return null;
  const result: Labels = { labels: [], dynamic: [] };
  const value = job.runsOn.value;
  if (value.kind === 'map') {
    const labels = getEntry(value, 'labels');
    if (labels) addLabel(job, labels.value, result);
    else result.dynamic.push('runner group');
  } else {
    addLabel(job, value, result);
  }
  return result;
}

function hasSelfHosted(labels: Labels): boolean {
  return labels.labels.some((l) => l.toLowerCase() === 'self-hosted');
}

export const selfHostedOnUntrustedTrigger: Rule = {
  id: 'self-hosted-on-untrusted-trigger',
  version: '1',
  apply(wf: Workflow): RawFinding[] {
    if (!wf.forkReachable) return [];
    const out: RawFinding[] = [];
    for (const job of wf.jobs) {
      const labels = runnerLabels(job);
      if (!job.runsOn || !labels || !hasSelfHosted(labels)) continue;
      const span = job.runsOn.span;
      out.push({
        occurrence: occurrenceBase('runs-on', '', ''),
        rule: 'self-hosted-on-untrusted-trigger',
        jobId: job.id,
        stepKey: null,
        stepIndex: null,
        span,
        snippet: snippetOf(wf, span),
        facts: baseFacts(wf, `Job "${job.id}" can run on a self-hosted runner while the workflow is reachable from forks (${wf.triggers.join(', ')}).`, {
          runnerLabels: [...new Set(labels.labels)],
          aliased: job.runsOn.aliased,
        }),
      });
    }
    return out;
  },
};

/** File coverage notes for jobs whose runner labels could not be resolved on a fork-reachable workflow. */
export function selfHostedCoverageNotes(wf: Workflow): string[] {
  if (!wf.forkReachable) return [];
  const notes: string[] = [];
  for (const job of wf.jobs) {
    const labels = runnerLabels(job);
    if (!job.runsOn || !labels || hasSelfHosted(labels) || labels.dynamic.length === 0) continue;
    notes.push(
      `Job "${job.id}" (line ${job.runsOn.keySpan.startLine}): runs-on ${labels.dynamic.join(', ')} is dynamic; self-hosted coverage unknown.`,
    );
  }
  return notes;
}
