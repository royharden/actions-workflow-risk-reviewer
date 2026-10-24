import type { Facts } from '../finding';
import { occurrenceBase } from '../identity';
import { getEntry } from '../model';
import type { Job, LEntry, Step, Workflow } from '../model';
import type { RawFinding, Rule } from './types';
import { baseFacts, classifyExpression, findExpressions, isGithubScript, snippetOf } from './util';

// Fires: a `${{ … }}` expression referencing a contexts.json context inside a step `run:` or the
// `script:` input of actions/github-script. One finding per expression occurrence.
// Class: attacker_controlled (high) or maintainer_controlled (inputs.*, github.event.inputs.*; medium).
// Excluded: the same expression in `env:`, `if:`, or another action's `with:`; contexts not in the list
// (github.sha, secrets.*, env.*, …). steps.*.outputs laundering and workflow_call input origins are not
// resolved (named false negatives).

type Sink = NonNullable<Facts['sink']>;

export const templateInjection: Rule = {
  id: 'template-injection',
  version: '1',
  apply(wf: Workflow): RawFinding[] {
    const out: RawFinding[] = [];
    for (const job of wf.jobs) {
      for (const step of job.steps) {
        if (step.run) scanSink(out, wf, job, step, step.run, 'run', 'run');
        if (isGithubScript(step.usesValue)) {
          const script = getEntry(step.with, 'script');
          if (script) scanSink(out, wf, job, step, script, 'github-script', 'with.script');
        }
      }
    }
    return out;
  },
};

function scanSink(out: RawFinding[], wf: Workflow, job: Job, step: Step, entry: LEntry, sink: Sink, path: string): void {
  if (entry.value.kind !== 'scalar') return;
  const where = sink === 'run' ? 'a run script' : 'an actions/github-script script';
  for (const hit of findExpressions(wf, entry.value)) {
    const contextClass = classifyExpression(hit.inner);
    if (!contextClass) continue;
    const who = contextClass === 'attacker_controlled' ? 'an attacker-controlled' : 'a maintainer-controlled';
    out.push({
      occurrence: occurrenceBase(path, sink, hit.inner),
      rule: 'template-injection',
      jobId: job.id,
      stepKey: step.key,
      stepIndex: step.index,
      span: hit.span,
      snippet: snippetOf(wf, hit.span),
      facts: baseFacts(wf, `\${{ ${hit.inner} }} expands ${who} context directly into ${where}.`, {
        contextClass,
        expression: hit.inner,
        sink,
        aliased: entry.value.aliased,
      }),
    });
  }
}
