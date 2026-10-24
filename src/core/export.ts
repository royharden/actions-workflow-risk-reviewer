import { createTwoFilesPatch } from 'diff';
import type { Finding } from './finding';
import type { Hasher } from './hash';
import { fixerFor, proposeFix } from './fixers';
import type { FixContext } from './fixers';
import { normalizeNewlines, parseWorkflow } from './parse';
import { check, introducedFindings } from './patchcheck/check';
import { disableReasons } from './patchcheck/structure';
import type { RulingValue } from './rulings';
import { compareFindings, scanText } from './scan';
import type { InputFile, ScanResult } from './scan';

export interface ExcludedFix { findingId: string; file: string; reason: string }
export interface AggregateResult { patch: string; included: string[]; excluded: ExcludedFix[] }
/** Display names cannot create patch directives, absolute paths, traversal or control characters. */
export function patchPath(name: string): string {
  const parts = name.normalize('NFC').replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.' && part !== '..');
  const cleaned = parts.map((part) => part.replace(/[^A-Za-z0-9._-]/g, '_')).filter(Boolean).join('/');
  return cleaned || 'workflow.yml';
}
export function buildSinglePatch(name: string, original: string, patched: string): string {
  const path = patchPath(name);
  return createTwoFilesPatch(`a/${path}`, `b/${path}`, normalizeNewlines(original), normalizeNewlines(patched), '', '', { context: 3 });
}
export function singlePatchFileName(findingId: string): string { return `fix-${findingId.replace(/[^A-Za-z0-9_-]/g, '_')}.patch`; }

/** Re-propose against current virtual text. Never concatenate independent patches for one file. */
export async function buildAggregatePatch(sources: InputFile[], scan: ScanResult, acceptedIds: readonly string[], ctx: FixContext, hasher: Hasher): Promise<AggregateResult> {
  const accepted = new Set(acceptedIds);
  const result: AggregateResult = { patch: '', included: [], excluded: [] };
  const known = new Set(scan.files.flatMap((file) => file.findings.map((finding) => finding.id)));
  for (const id of accepted) if (!known.has(id)) result.excluded.push({ findingId: id, file: '', reason: 'target_missing' });
  const usedPaths = new Set<string>();
  for (const file of scan.files) {
    const targets = file.findings.filter((finding) => accepted.has(finding.id)).sort(compareFindings);
    if (targets.length === 0) continue;
    const exclude = (finding: Finding, reason: string): void => { result.excluded.push({ findingId: finding.id, file: file.name, reason }); };
    const source = sources.find((candidate) => candidate.name === file.name);
    if (!source || file.status !== 'complete' || await hasher.sha256Hex(source.text) !== file.fileHash) { for (const target of targets) exclude(target, 'source_hash_mismatch'); continue; }
    const path = patchPath(file.name);
    if (usedPaths.has(path)) { for (const target of targets) exclude(target, 'sanitized_path_collision'); continue; }
    usedPaths.add(path);
    let virtual = source.text;
    const applied: Finding[] = [];
    for (const target of targets) {
      try {
        const current = await scanText(file.name, virtual, hasher);
        if (current.status !== 'complete') { exclude(target, 'invalid_yaml'); continue; }
        const matches = current.findings.filter((finding) => finding.fingerprint === target.fingerprint);
        if (matches.length !== 1) { exclude(target, matches.length === 0 ? 'target_missing' : 'identity_ambiguous'); continue; }
        const parsed = parseWorkflow(virtual), fixer = fixerFor(matches[0]);
        if (!parsed.ok || !fixer) { exclude(target, 'no_fixer'); continue; }
        const proposal = proposeFix(parsed, matches[0], ctx);
        if (!proposal.ok) { exclude(target, proposal.reason); continue; }
        const checked = await check(virtual, proposal.ops, matches[0], fixer, hasher, ctx);
        if (!checked.ok || checked.patched === undefined) { exclude(target, checked.reasons.join(', ') || 'internal_error'); continue; }
        virtual = checked.patched;
        applied.push(target);
      } catch { exclude(target, 'internal_error'); }
    }
    if (applied.length === 0) continue;
    try {
      const final = await scanText(file.name, virtual, hasher);
      const before = parseWorkflow(source.text), after = parseWorkflow(virtual);
      const valid = final.status === 'complete' && before.ok && after.ok && introducedFindings(file.findings, final.findings).length === 0 && !applied.some((target) => final.findings.some((finding) => finding.fingerprint === target.fingerprint)) && disableReasons(before.workflow, after.workflow).length === 0;
      if (!valid) { for (const target of applied) exclude(target, 'final_whole_file_check_failed'); continue; }
      result.patch += buildSinglePatch(file.name, source.text, virtual);
      result.included.push(...applied.map((finding) => finding.id));
    } catch { for (const target of applied) exclude(target, 'final_whole_file_check_failed'); }
  }
  return result;
}
function escapeMarkdown(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}[\]()#+.!|~-])/g, '\\$1'); }
export function fenced(value: string, language = ''): string {
  const longest = Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${value}\n${fence}`;
}
export function buildFindingsJson(scan: ScanResult, rulings: ReadonlyMap<string, RulingValue> = new Map()): string {
  return `${JSON.stringify({ ...scan, rulings: [...rulings].map(([findingId, ruling]) => ({ findingId, ruling })) }, null, 2)}\n`;
}
export function buildReport(scan: ScanResult, rulings: ReadonlyMap<string, RulingValue> = new Map(), aggregate: AggregateResult = { patch: '', included: [], excluded: [] }): string {
  const lines = ['# Workflow risk review', '', 'Patches pass the six rules; behaviour unverified. Gate observed — exploitability unverified.', ''];
  for (const error of scan.inputErrors) lines.push(`Input error: ${escapeMarkdown(error)}`, '');
  for (const file of scan.files) {
    lines.push(`## ${escapeMarkdown(file.name)}`, '', `Status: ${escapeMarkdown(file.status)}${file.reason ? ` — ${escapeMarkdown(file.reason)}` : ''}`, '');
    for (const note of file.coverageNotes) lines.push(`Coverage: ${escapeMarkdown(note)}`, '');
    for (const finding of file.findings) {
      const ruling = rulings.get(finding.id);
      lines.push(`### ${escapeMarkdown(finding.rule)} · ${escapeMarkdown(finding.severity)} · line ${finding.span.startLine}`, '', escapeMarkdown(finding.facts.detail), '', `Finding: ${escapeMarkdown(finding.id)}`, '', `Ruling: ${ruling === undefined ? 'unreviewed' : ruling === 'needs_review' ? 'needs review' : escapeMarkdown(ruling.decision)}`, '');
      if (ruling && ruling !== 'needs_review' && ruling.reason) lines.push(`Reason: ${escapeMarkdown(ruling.reason)}`, '');
      for (const gate of finding.facts.gateEvidence) lines.push(`Gate: ${escapeMarkdown(gate.gate)} at line ${gate.line} — exploitability unverified`, '');
      lines.push(fenced(finding.snippet, 'yaml'), '');
    }
  }
  lines.push('## Aggregate fixes', '', `Included: ${aggregate.included.length}`, '');
  for (const fix of aggregate.excluded) lines.push(`Excluded ${escapeMarkdown(fix.findingId)}: ${escapeMarkdown(fix.reason)}. Its checked single-fix patch remains available when individually passing.`, '');
  return `${lines.join('\n')}\n`;
}
