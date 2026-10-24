import type { Finding, RuleId } from './finding';
import type { Hasher } from './hash';
import { assignOrdinals, findingIdOf, fingerprintOf } from './identity';
import { validateInputFiles } from './limits';
import { parseWorkflow } from './parse';
import { RULES, RULE_VERSIONS } from './rules';
import type { RawFinding } from './rules';
import { selfHostedCoverageNotes } from './rules/self-hosted-on-untrusted-trigger';
import { severityFor } from './severity';
import { APP_VERSION } from './version';

export interface InputFile {
  name: string;
  text: string;
}

export type FileStatus = 'complete' | 'error' | 'unsupported';

export interface FileResult {
  name: string;
  fileHash: string;
  status: FileStatus;
  reason?: string;
  errorLine?: number;
  coverageNotes: string[];
  findings: Finding[];
}

export interface ScanResult {
  files: FileResult[];
  inputErrors: string[];
  appVersion: string;
  ruleVersions: Record<RuleId, string>;
}

/** Count (1–20), per-file UTF-8 bytes (≤256 KiB) and display-name safety. Any error blocks the whole scan. */
export function validateInputs(files: InputFile[]): string[] {
  return validateInputFiles(files);
}

export async function scan(files: InputFile[], hasher: Hasher): Promise<ScanResult> {
  const ruleVersions = { ...RULE_VERSIONS };
  const inputErrors = validateInputs(files);
  if (inputErrors.length > 0) return { files: [], inputErrors, appVersion: APP_VERSION, ruleVersions };
  const results: FileResult[] = [];
  for (const file of files) results.push(await scanFile(file, hasher));
  results.sort((a, b) => compareText(a.name, b.name));
  return { files: results, inputErrors: [], appVersion: APP_VERSION, ruleVersions };
}

async function scanFile(file: InputFile, hasher: Hasher): Promise<FileResult> {
  // Hash of the original text (CRLF kept); lines are mapped on the LF-normalized text.
  const fileHash = await hasher.sha256Hex(file.text);
  const parsed = parseWorkflow(file.text);
  if (!parsed.ok) {
    const result: FileResult = { name: file.name, fileHash, status: parsed.status, reason: parsed.reason, coverageNotes: [], findings: [] };
    if (parsed.line !== undefined) result.errorLine = parsed.line;
    return result;
  }

  const raw: RawFinding[] = [];
  try {
    for (const rule of RULES) raw.push(...rule.apply(parsed.workflow));
  } catch (err) {
    // A crashing rule must never look like a clean file.
    const message = err instanceof Error ? err.message : 'unknown error';
    return { name: file.name, fileHash, status: 'error', reason: `internal rule error: ${message}`, coverageNotes: [], findings: [] };
  }

  const findings: Finding[] = [];
  for (const item of assignOrdinals(raw)) {
    const ruleVersion = RULE_VERSIONS[item.rule];
    const fingerprint = await fingerprintOf(hasher, item.rule, item.jobId, item.stepKey, item.occurrence);
    const id = await findingIdOf(hasher, fingerprint, fileHash, ruleVersion);
    findings.push({
      ...item,
      id,
      fingerprint,
      ruleVersion,
      severity: severityFor(item.rule, item.facts),
      file: file.name,
      fileHash,
    });
  }
  findings.sort(compareFindings);
  return { name: file.name, fileHash, status: 'complete', coverageNotes: selfHostedCoverageNotes(parsed.workflow), findings };
}

export function compareFindings(a: Finding, b: Finding): number {
  return (
    compareText(a.file, b.file) ||
    a.span.startLine - b.span.startLine ||
    compareText(a.rule, b.rule) ||
    compareText(a.occurrence, b.occurrence) ||
    compareText(a.jobId ?? '', b.jobId ?? '')
  );
}

/** Code-unit order: deterministic across hosts, unlike localeCompare. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
