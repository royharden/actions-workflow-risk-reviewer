import { blankComments } from '../blank-comments';
import type { Finding } from '../finding';
import type { Hasher } from '../hash';
import type { ParseOk } from '../parse';
import { explainRequestSchema, fitsRequestBounds, SCHEMA_VERSION, type ExplainRequest } from './schema';

export type ExcerptResult = { ok: true; excerptLines: { line: number; text: string }[] } | { ok: false; reason: 'context_truncated' };

/** Include the whole finding job and top-level trigger/permission evidence; never silently truncate. */
export function buildExcerpt(parsed: ParseOk, finding: Finding): ExcerptResult {
  const wf = parsed.workflow;
  const lines = new Set<number>();
  const add = (start: number, end: number) => { for (let line = start; line <= end; line++) lines.add(line); };
  const job = wf.jobs.find((candidate) => candidate.id === finding.jobId);
  if (job) add(job.entry.span.startLine, job.entry.span.endLine);
  else add(finding.span.startLine, finding.span.endLine);
  if (wf.on) add(wf.on.span.startLine, wf.on.span.endLine);
  if (wf.permissions) add(wf.permissions.span.startLine, wf.permissions.span.endLine);
  // A workflow-level finding such as missing permissions may require job-wide context.
  if (finding.jobId === null && finding.facts.permissionCause === 'missing' && wf.jobsEntry) {
    add(wf.jobsEntry.span.startLine, wf.jobsEntry.span.endLine);
  }
  if (lines.size > 60) return { ok: false, reason: 'context_truncated' };
  const blanked = blankComments(parsed.normalizedText).split('\n');
  const excerptLines = [...lines].sort((a, b) => a - b).map((line) => ({ line, text: blanked[line - 1] ?? '' }));
  return excerptLines.length ? { ok: true, excerptLines } : { ok: false, reason: 'context_truncated' };
}

export async function buildExplainRequest(parsed: ParseOk, finding: Finding, runId: string, hasher: Hasher): Promise<
  { ok: true; request: ExplainRequest } | { ok: false; reason: 'context_truncated' }
> {
  const excerpt = buildExcerpt(parsed, finding);
  if (!excerpt.ok) return excerpt;
  const digest = await hasher.sha256Hex(JSON.stringify(excerpt.excerptLines));
  const idempotencyKey = await hasher.sha256Hex(JSON.stringify([runId, finding.fingerprint, digest, SCHEMA_VERSION]));
  const request: ExplainRequest = {
    schemaVersion: SCHEMA_VERSION, runId, findingFingerprint: finding.fingerprint, ruleId: finding.rule,
    facts: { ...finding.facts }, excerptLines: excerpt.excerptLines, idempotencyKey,
  };
  if (!explainRequestSchema.safeParse(request).success || !fitsRequestBounds(request)) return { ok: false, reason: 'context_truncated' };
  return { ok: true, request };
}

/** Context-complete cache keys; examples and live answers can never share an identity. */
export function explanationCacheKey(finding: Finding, request: ExplainRequest, promptVersion: string, provider: string, model: string, hasher: Hasher): Promise<string> {
  return hasher.sha256Hex(JSON.stringify([
    finding.fingerprint, finding.fileHash, request.excerptLines, promptVersion, request.schemaVersion, finding.ruleVersion, provider, model,
  ]));
}
