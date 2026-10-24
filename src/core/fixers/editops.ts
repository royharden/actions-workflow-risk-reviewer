import { normalizeNewlines } from '../parse';

/** Inclusive full-line replacements. Insertion before line N uses endLine=N-1. */
export interface EditOp { startLine: number; endLine: number; replacement: string }
export type EditProblem = 'invalid_range' | 'overlapping_ops' | 'too_many_ops' | 'oversized';
function replacementLines(value: string): string[] { return value === '' ? [] : value.replace(/\n$/, '').split('\n'); }
export function validateOps(text: string, ops: EditOp[]): EditProblem | null {
  if (ops.length === 0 || ops.length > 3) return 'too_many_ops';
  const lines = normalizeNewlines(text).split('\n');
  let cost = 0;
  const sorted = [...ops].sort((a, b) => a.startLine - b.startLine);
  for (let i = 0; i < sorted.length; i++) {
    const op = sorted[i];
    if (!Number.isInteger(op.startLine) || !Number.isInteger(op.endLine) || op.startLine < 1 || op.endLine < op.startLine - 1 || op.endLine > lines.length || op.startLine > lines.length || op.replacement.includes('\r')) return 'invalid_range';
    const previous = sorted[i - 1];
    if (previous && op.startLine <= Math.max(previous.startLine, previous.endLine)) return 'overlapping_ops';
    cost += Math.max(0, op.endLine - op.startLine + 1) + replacementLines(op.replacement).length;
  }
  return cost > 40 ? 'oversized' : null;
}
export function applyOps(text: string, ops: EditOp[]): string {
  const normalized = normalizeNewlines(text);
  const problem = validateOps(normalized, ops);
  if (problem) throw new Error(problem);
  const lines = normalized.split('\n');
  for (const op of [...ops].sort((a, b) => b.startLine - a.startLine)) lines.splice(op.startLine - 1, Math.max(0, op.endLine - op.startLine + 1), ...replacementLines(op.replacement));
  return lines.join('\n');
}
