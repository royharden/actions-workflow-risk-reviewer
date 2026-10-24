import type { Finding } from '../finding';
import { normalizeExpression } from '../identity';
import { asMap, getEntry, scalarText } from '../model';
import type { LMap, LNode } from '../model';
import type { ParseOk } from '../parse';
import { flow, targetStep, uneditable } from './types';
import type { FixContext, Proposal } from './types';

function defaultShell(map: LMap | null): LNode | undefined {
  return getEntry(asMap(getEntry(asMap(getEntry(map, 'defaults')?.value), 'run')?.value), 'shell')?.value;
}
/** Only the two declared shell contexts are accepted. GitHub expressions are skipped as opaque spans. */
function quoteAt(script: string, target: number): 'unquoted' | 'double' | null {
  let quote: '' | "'" | '"' = '';
  for (let i = 0; i < target; i++) {
    if (script.startsWith('${{', i)) {
      const end = script.indexOf('}}', i + 3);
      if (end < 0 || end >= target) return null;
      i = end + 1; continue;
    }
    const ch = script[i];
    if (ch === '\\' && quote !== "'") { if (i + 1 === target) return null; i++; continue; }
    if (ch === '#' && quote === '' && (i === 0 || /\s/.test(script[i - 1]))) {
      const end = script.indexOf('\n', i);
      if (end < 0 || end >= target) return null;
      i = end; continue;
    }
    if (ch === "'" && quote !== '"') quote = quote === "'" ? '' : "'";
    else if (ch === '"' && quote !== "'") quote = quote === '"' ? '' : '"';
  }
  return quote === "'" ? null : quote === '"' ? 'double' : 'unquoted';
}
export function propose(parsed: ParseOk, finding: Finding, _ctx: FixContext): Proposal {
  const wf = parsed.workflow;
  const job = wf.jobs.find((item) => item.id === finding.jobId);
  const step = targetStep(parsed, finding);
  if (!job || !step?.run || step.run.value.kind !== 'scalar' || finding.facts.sink !== 'run') return { ok: false, reason: 'manual_fix' };
  const run = step.run.value;
  const env = getEntry(step.map, 'env');
  const scopeNodes = [wf.root, job.entry.value, step.node, run, env?.value, getEntry(job.map, 'env')?.value, wf.env?.value];
  if (finding.facts.aliased || scopeNodes.some(uneditable)) return { ok: false, reason: 'aliased_target' };
  if (scopeNodes.some(flow)) return { ok: false, reason: 'flow_style' };
  if (run.style !== 'literal' && run.style !== 'folded') return { ok: false, reason: 'manual_fix' };
  const shellNode = getEntry(step.map, 'shell')?.value ?? defaultShell(job.map) ?? defaultShell(wf.root);
  if (shellNode) {
    if (uneditable(shellNode) || !['bash', 'sh'].includes(scalarText(shellNode) ?? '')) return { ok: false, reason: 'shell_unknown' };
  } else if (uneditable(job.runsOn?.value) || !/^(?:ubuntu|macos)-[A-Za-z0-9.-]+$/.test(scalarText(job.runsOn?.value) ?? '')) return { ok: false, reason: 'shell_unknown' };
  const range = run.yaml?.range;
  if (!range) return { ok: false, reason: 'manual_fix' };
  const raw = parsed.normalizedText.slice(range[0], range[1]);
  if (raw.includes('<<') || raw.includes('`') || raw.includes('$(') || /\$['"]/.test(raw)) return { ok: false, reason: 'manual_fix' };
  const offset = wf.source.lineStarts[finding.span.startLine - 1] + finding.span.startCol - 1;
  const expression = /^\$\{\{([\s\S]*?)\}\}/.exec(parsed.normalizedText.slice(offset));
  if (!expression || normalizeExpression(expression[1]) !== finding.facts.expression || offset < range[0] || offset + expression[0].length > range[1]) return { ok: false, reason: 'target_missing' };
  if (expression[0].includes('\n')) return { ok: false, reason: 'manual_fix' };
  const scriptStart = raw.indexOf('\n') + 1;
  if (scriptStart === 0) return { ok: false, reason: 'manual_fix' };
  const quote = quoteAt(raw.slice(scriptStart), offset - range[0] - scriptStart);
  if (!quote) return { ok: false, reason: 'manual_fix' };
  const names = new Set<string>();
  for (const node of [wf.env?.value, getEntry(job.map, 'env')?.value, env?.value]) {
    if (node && node.kind !== 'map') return { ok: false, reason: 'manual_fix' };
    if (node?.kind === 'map') for (const entry of node.entries) names.add(entry.key);
  }
  const tail = (finding.facts.expression ?? '').split('.').pop() ?? 'VALUE';
  const base = `AWR_${tail.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 40) || 'VALUE'}`;
  let key = base;
  for (let suffix = 2; names.has(key); suffix++) key = `${base}_${suffix}`;
  const substitution = quote === 'double' ? '${' + key + '}' : '"$' + key + '"';
  const startLine = step.run.span.startLine, endLine = step.run.span.endLine;
  const blockStart = wf.source.lineStarts[startLine - 1];
  const block = wf.source.lines.slice(startLine - 1, endLine).join('\n');
  const relative = offset - blockStart;
  const replacement = block.slice(0, relative) + substitution + block.slice(relative + expression[0].length);
  const indent = ' '.repeat(step.run.keySpan.startCol - 1);
  const envLine = `${indent}  ${key}: ${expression[0]}`;
  const envOp = env
    ? { startLine: env.span.endLine + 1, endLine: env.span.endLine, replacement: envLine }
    : { startLine: endLine + 1, endLine, replacement: `${indent}env:\n${envLine}` };
  const ops = envOp.startLine === startLine && envOp.endLine === startLine - 1
    ? [{ startLine, endLine, replacement: `${envOp.replacement}\n${replacement}` }]
    : [{ startLine, endLine, replacement }, envOp];
  return { ok: true, ops, description: `Move exactly one expression into step env ${key}; behaviour unverified.` };
}
