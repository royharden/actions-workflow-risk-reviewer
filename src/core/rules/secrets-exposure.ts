import { occurrenceBase } from '../identity';
import { asMap, getEntry, joinSpans, scalarText } from '../model';
import type { Step, Workflow } from '../model';
import type { RawFinding, Rule } from './types';
import { baseFacts, isCheckout, isUploadArtifact, snippetOf } from './util';

// Fires (any trigger):
//  - inherit: a reusable-workflow job with `secrets: inherit` (same-repo callees too; the M2 gate demotes those);
//  - workflow-env: a workflow-level `env:` entry whose value references `${{ secrets.* }}`;
//  - persisted-checkout-upload: actions/checkout without `persist-credentials: false` (quoted booleans normalized),
//    followed later in the same job by actions/upload-artifact whose `path` includes `.`, `./`, `**` or `${{ github.workspace }}`.
// Excluded: job- or step-level env secrets, narrower upload paths, uploads after only non-persisting checkouts.

export const BROAD_UPLOAD_PATHS: readonly string[] = ['.', './', '**', '${{ github.workspace }}'];

export function isBroadUploadPath(path: string): boolean {
  return path
    .split('\n')
    .map((line) => line.trim().replace(/\$\{\{\s*github\.workspace\s*\}\}/gi, '${{ github.workspace }}'))
    .some((line) => BROAD_UPLOAD_PATHS.includes(line));
}

export function persistsCredentials(step: Step): boolean {
  const entry = getEntry(step.with, 'persist-credentials');
  if (!entry || entry.value.kind !== 'scalar') return true;
  if (entry.value.value === false) return false;
  return (scalarText(entry.value) ?? '').trim().toLowerCase() !== 'false';
}

const SECRET_REF = /\$\{\{[^}]*\bsecrets\s*(\.|\[)/i;

export const secretsExposure: Rule = {
  id: 'secrets-exposure',
  version: '1',
  apply(wf: Workflow): RawFinding[] {
    const out: RawFinding[] = [];

    const env = asMap(wf.env?.value);
    if (env) {
      for (const entry of env.entries) {
        const text = scalarText(entry.value);
        if (text === null || !SECRET_REF.test(text)) continue;
        const span = entry.span;
        out.push({
          occurrence: occurrenceBase(`env.${entry.key}`, '', 'workflow-env'),
          rule: 'secrets-exposure',
          jobId: null,
          stepKey: null,
          stepIndex: null,
          span,
          snippet: snippetOf(wf, span),
          facts: baseFacts(wf, `Workflow-level env ${entry.key} exposes a secret to every step of every job.`, {
            secretsCause: 'workflow-env',
            aliased: entry.aliased,
          }),
        });
      }
    }

    for (const job of wf.jobs) {
      if (job.secrets && (scalarText(job.secrets.value) ?? '').trim().toLowerCase() === 'inherit') {
        const span = job.secrets.span;
        const callee = job.usesValue ? job.usesValue.trim() : '';
        out.push({
          occurrence: occurrenceBase('secrets', '', 'inherit'),
          rule: 'secrets-exposure',
          jobId: job.id,
          stepKey: null,
          stepIndex: null,
          span,
          snippet: snippetOf(wf, span),
          facts: baseFacts(wf, `Job "${job.id}" passes all repository secrets to ${callee ? `"${callee}"` : 'the called workflow'} with secrets: inherit.`, {
            secretsCause: 'inherit',
            callee,
            aliased: job.secrets.aliased,
          }),
        });
      }

      let persisted = false;
      for (const step of job.steps) {
        if (isCheckout(step.usesValue)) {
          if (persistsCredentials(step)) persisted = true;
          continue;
        }
        if (!persisted || !step.uses || !isUploadArtifact(step.usesValue)) continue;
        const pathEntry = getEntry(step.with, 'path');
        const pathText = pathEntry ? scalarText(pathEntry.value) : null;
        if (!pathEntry || pathText === null || !isBroadUploadPath(pathText)) continue;
        const span = joinSpans(step.uses.span, pathEntry.span);
        out.push({
          occurrence: occurrenceBase('uses', '', 'persisted-checkout-upload'),
          rule: 'secrets-exposure',
          jobId: job.id,
          stepKey: step.key,
          stepIndex: step.index,
          span,
          snippet: snippetOf(wf, span),
          facts: baseFacts(
            wf,
            `An earlier checkout keeps the token in .git/config (persist-credentials not false) and this step uploads the whole workspace (path: ${pathText.trim()}).`,
            { secretsCause: 'persisted-checkout-upload', aliased: step.uses.aliased || pathEntry.aliased },
          ),
        });
      }
    }
    return out;
  },
};
