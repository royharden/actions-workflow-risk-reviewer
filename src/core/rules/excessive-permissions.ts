import { occurrenceBase } from '../identity';
import { scalarText } from '../model';
import type { Job, LEntry, Workflow } from '../model';
import type { RawFinding, Rule } from './types';
import { baseFacts, snippetOf } from './util';

// Effective job permissions = the job's own `permissions:` else the workflow's.
// Fires, one finding per cause:
//  - missing: no workflow `permissions:` and at least one job without its own → ONE finding at the `jobs:` key line;
//  - write-all: a `permissions: write-all` that is effective (job level always; workflow level when ≥1 job inherits it);
//  - write-scope: a `<scope>: write` entry on a fork-reachable workflow, at the scope line (same effectiveness rule).
// Excluded: `permissions: {}` (explicit deny), `read-all`, read scopes, write scopes on non-fork-reachable workflows,
// a workflow-level block that every job overrides. An explicitly null `permissions:` counts as absent.

export const excessivePermissions: Rule = {
  id: 'excessive-permissions',
  version: '1',
  apply(wf: Workflow): RawFinding[] {
    const out: RawFinding[] = [];
    const inheriting = wf.jobs.filter((job) => job.permissions === null);
    if (wf.permissions === null) {
      if (inheriting.length > 0 && wf.jobsEntry) {
        const span = wf.jobsEntry.keySpan;
        const names = inheriting.map((j) => j.id).join(', ');
        out.push({
          occurrence: occurrenceBase('jobs', '', 'missing'),
          rule: 'excessive-permissions',
          jobId: null,
          stepKey: null,
          stepIndex: null,
          span,
          snippet: snippetOf(wf, span),
          facts: baseFacts(
            wf,
            `No permissions are declared at workflow level and job(s) ${names} declare none, so they get the repository's default token permissions.`,
            { permissionCause: 'missing' },
          ),
        });
      }
    } else if (inheriting.length > 0) {
      causes(out, wf, wf.permissions, null);
    }
    for (const job of wf.jobs) {
      if (job.permissions) causes(out, wf, job.permissions, job);
    }
    return out;
  },
};

function causes(out: RawFinding[], wf: Workflow, entry: LEntry, job: Job | null): void {
  const where = job ? `job "${job.id}"` : 'the workflow';
  const value = entry.value;
  if (value.kind === 'scalar') {
    if ((scalarText(value) ?? '').trim().toLowerCase() !== 'write-all') return;
    const span = entry.span;
    out.push({
      occurrence: occurrenceBase('permissions', '', 'write-all'),
      rule: 'excessive-permissions',
      jobId: job ? job.id : null,
      stepKey: null,
      stepIndex: null,
      span,
      snippet: snippetOf(wf, span),
      facts: baseFacts(wf, `${capitalize(where)} grants write-all: every token scope is writable.`, {
        permissionCause: 'write-all',
        aliased: entry.aliased,
      }),
    });
    return;
  }
  if (value.kind !== 'map' || !wf.forkReachable) return;
  for (const scope of value.entries) {
    if ((scalarText(scope.value) ?? '').trim().toLowerCase() !== 'write') continue;
    const span = scope.span;
    out.push({
      occurrence: occurrenceBase(`permissions.${scope.key}`, '', 'write-scope'),
      rule: 'excessive-permissions',
      jobId: job ? job.id : null,
      stepKey: null,
      stepIndex: null,
      span,
      snippet: snippetOf(wf, span),
      facts: baseFacts(wf, `${capitalize(where)} grants ${scope.key}: write on a fork-reachable trigger (${wf.triggers.join(', ')}).`, {
        permissionCause: 'write-scope',
        scope: scope.key,
        aliased: scope.aliased,
      }),
    });
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
