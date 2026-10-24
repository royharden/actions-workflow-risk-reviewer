// The UI's single seam onto the M2 core (gates, fixers, checker, rulings, exports). Every call into package C's modules is
// made here so a signature change is reconciled in one file; components only see the view types below.
import type { Finding, RuleId } from '../core/finding';
import type { Hasher } from '../core/hash';
import { parseWorkflow, type ParseOk } from '../core/parse';
import type { FileResult, InputFile, ScanResult } from '../core/scan';
import { applyGates, gatesOnlyTriage } from '../core/gates';
import { proposeFix } from '../core/fixers/index';
import { check } from '../core/patchcheck/check';
import { latestRulings, type RulingEvent } from '../core/rulings';
import { buildAggregatePatch, buildFindingsJson, buildReport, buildSinglePatch } from '../core/export';
import type { AppMode } from './mode';
import pinsFile from '../../fixtures/pins.json';

export type FixContext = Parameters<typeof proposeFix>[2];
export type FixerId = Parameters<typeof check>[3];
export type RulingsMap = ReturnType<typeof latestRulings>;
export type RulingDecision = RulingEvent['decision'];
export type AggregateResult = Awaited<ReturnType<typeof buildAggregatePatch>>;

/** Rules that have a fixer (PLAN D19, D20, D33); the other three rules never get a proposed fix. */
const FIXER_BY_RULE: Partial<Record<RuleId, FixerId>> = {
  'unpinned-uses': 'pin',
  'excessive-permissions': 'permissions',
  'template-injection': 'injection-env',
};

export interface FixSetup {
  ctx: FixContext;
  /** True when pin SHAs come from the fabricated fixture-only table; the diff then carries a warning. */
  fixtureOnlyPins: boolean;
}

/** Demo mode uses the fixture-only pin table; any other mode has no pin table yet, so pin fixes report "needs lookup". */
export function fixSetupFor(mode: AppMode): FixSetup {
  if (mode.kind === 'demo') return { ctx: { pins: pinsFile.pins }, fixtureOnlyPins: true };
  return { ctx: { pins: [] }, fixtureOnlyPins: false };
}

export type FixView =
  | { kind: 'refused'; reason: string }
  | { kind: 'rejected'; reasons: string[] }
  | {
      kind: 'passed';
      fixer: FixerId;
      description: string;
      /** The exact text of `fix-<findingId>.patch`, also what DiffView shows. */
      patch: string;
      /** SHA-256 of `patch`; fix rulings bind it (accept/reject return to review when it changes). */
      digest: string;
      fixtureOnlyPin: boolean;
    };

export interface ReviewedScan {
  /** The scan with gate evidence filled into every complete file's findings. */
  scan: ScanResult;
  /** Keyed by finding id; only findings whose rule has a fixer appear. */
  fixes: Map<string, FixView>;
  /** Finding ids whose gates-only triage is `likely_benign`. */
  likelyBenign: Set<string>;
}

export type RulingStatus = { kind: 'unreviewed' } | { kind: 'needs_review' } | { kind: 'ruled'; event: RulingEvent };

export interface ResolvedRulings {
  /** Same shape as latestRulings' result, with stale fix decisions turned back into `needs_review`; passed to the exports. */
  latest: RulingsMap;
  status: Map<string, RulingStatus>;
}

/** Core reason values may be plain codes or small objects; the UI only ever shows them as text. */
export function reasonText(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason !== null && typeof reason === 'object') {
    const record = reason as { code?: unknown; message?: unknown; detail?: unknown };
    const code = typeof record.code === 'string' ? record.code : '';
    const message = typeof record.message === 'string' ? record.message : typeof record.detail === 'string' ? record.detail : '';
    if (code !== '' && message !== '') return `${code}: ${message}`;
    if (code !== '' || message !== '') return code || message;
  }
  return String(reason);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fixFor(
  source: InputFile,
  parsed: ParseOk,
  finding: Finding,
  fixer: FixerId,
  setup: FixSetup,
  hasher: Hasher,
): Promise<FixView> {
  try {
    const proposal = proposeFix(parsed, finding, setup.ctx);
    if (!proposal.ok) return { kind: 'refused', reason: reasonText(proposal.reason) };
    const result = await check(source.text, proposal.ops, finding, fixer, hasher, setup.ctx);
    if (!result.ok || result.patched === undefined) {
      const reasons = result.reasons.map(reasonText);
      return { kind: 'rejected', reasons: reasons.length > 0 ? reasons : ['checker returned no patched text'] };
    }
    // Ops and the patched text are on the LF-normalized text, so the diff is taken against that, not the raw upload.
    const patch = buildSinglePatch(finding.file, parsed.normalizedText, result.patched);
    const digest = await hasher.sha256Hex(patch);
    return {
      kind: 'passed',
      fixer,
      description: proposal.description,
      patch,
      digest,
      fixtureOnlyPin: fixer === 'pin' && setup.fixtureOnlyPins,
    };
  } catch (err) {
    // A crashing fixer or checker is a refusal for that finding, never a passing fix and never a failed review.
    return { kind: 'refused', reason: `internal fixer error: ${errorText(err)}` };
  }
}

/** Journey steps 5–6: gates annotate (never remove or reorder), then each fixable finding gets a proposal checked by the checker. */
export async function reviewScan(sources: InputFile[], scanned: ScanResult, setup: FixSetup, hasher: Hasher): Promise<ReviewedScan> {
  const fixes = new Map<string, FixView>();
  const likelyBenign = new Set<string>();
  const files: FileResult[] = [];
  for (const file of scanned.files) {
    const source = sources.find((candidate) => candidate.name === file.name);
    if (file.status !== 'complete' || file.findings.length === 0 || source === undefined) {
      files.push(file);
      continue;
    }
    const parsed = parseWorkflow(source.text);
    if (!parsed.ok) {
      files.push(file);
      continue;
    }
    const findings = applyGates(parsed.workflow, file.findings);
    files.push({ ...file, findings });
    for (const finding of findings) {
      if (gatesOnlyTriage(finding) === 'likely_benign') likelyBenign.add(finding.id);
      const fixer = FIXER_BY_RULE[finding.rule];
      if (fixer !== undefined) fixes.set(finding.id, await fixFor(source, parsed, finding, fixer, setup, hasher));
    }
  }
  return { scan: { ...scanned, files }, fixes, likelyBenign };
}

export function allFindings(reviewed: ReviewedScan): Finding[] {
  return reviewed.scan.files.flatMap((file) => file.findings);
}

/**
 * Journey step 7: latest event per finding replays; a changed file hash or rule version comes back from latestRulings as
 * `needs_review`, and a fix decision whose patch digest no longer matches the current proposal is turned into `needs_review` here.
 */
export function resolveRulings(events: RulingEvent[], reviewed: ReviewedScan): ResolvedRulings {
  const findings = allFindings(reviewed);
  const latest = new Map(latestRulings(events, findings));
  for (const [findingId, value] of latest) {
    if (value === 'needs_review') continue;
    if (value.decision !== 'accept_fix' && value.decision !== 'reject_fix') continue;
    const fix = reviewed.fixes.get(findingId);
    if (fix === undefined || fix.kind !== 'passed' || fix.digest !== value.patchDigest) latest.set(findingId, 'needs_review');
  }
  const status = new Map<string, RulingStatus>();
  for (const finding of findings) {
    const value = latest.get(finding.id);
    if (value === undefined) status.set(finding.id, { kind: 'unreviewed' });
    else if (value === 'needs_review') status.set(finding.id, { kind: 'needs_review' });
    else status.set(finding.id, { kind: 'ruled', event: value });
  }
  return { latest, status };
}

export function acceptedFixIds(rulings: ResolvedRulings): string[] {
  const ids: string[] = [];
  for (const [findingId, value] of rulings.latest) {
    if (value !== 'needs_review' && value.decision === 'accept_fix') ids.push(findingId);
  }
  return ids;
}

export function makeRulingEvent(
  eventId: string,
  finding: Finding,
  decision: RulingDecision,
  fix: FixView | undefined,
  reason: string | undefined,
): RulingEvent {
  const patchDigest =
    (decision === 'accept_fix' || decision === 'reject_fix') && fix !== undefined && fix.kind === 'passed' ? fix.digest : undefined;
  return {
    eventId,
    at: new Date().toISOString(),
    fileHash: finding.fileHash,
    fingerprint: finding.fingerprint,
    ruleVersion: finding.ruleVersion,
    findingId: finding.id,
    decision,
    ...(patchDigest !== undefined ? { patchDigest } : {}),
    ...(reason !== undefined && reason !== '' ? { reason } : {}),
  };
}

// Journey step 8 exports. Text only; ExportBar turns each into a text Blob.

export function findingsJsonText(reviewed: ReviewedScan, rulings: ResolvedRulings): string {
  return buildFindingsJson(reviewed.scan, rulings.latest);
}

/** D21: re-runs each accepted fix on the current virtual text with a full check after each, then a final whole-file check. */
export function aggregatePatch(
  sources: InputFile[],
  reviewed: ReviewedScan,
  rulings: ResolvedRulings,
  setup: FixSetup,
  hasher: Hasher,
): Promise<AggregateResult> {
  return buildAggregatePatch(sources, reviewed.scan, acceptedFixIds(rulings), setup.ctx, hasher);
}

export async function reportMarkdown(
  sources: InputFile[],
  reviewed: ReviewedScan,
  rulings: ResolvedRulings,
  setup: FixSetup,
  hasher: Hasher,
): Promise<string> {
  const aggregate = await aggregatePatch(sources, reviewed, rulings, setup, hasher);
  return buildReport(reviewed.scan, rulings.latest, aggregate);
}

/** Use the same checked aggregate for the report and its visible exclusion list. */
export function reportWithAggregate(reviewed: ReviewedScan, rulings: ResolvedRulings, aggregate: AggregateResult): string {
  return buildReport(reviewed.scan, rulings.latest, aggregate);
}

export function singlePatchFileName(findingId: string): string {
  return `fix-${findingId}.patch`;
}
