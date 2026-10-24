import { describe, expect, it } from 'vitest';
import { applyOps, validateOps } from '../../src/core/fixers/editops';
describe('bounded inclusive line edits', () => {
  it('normalizes CRLF and applies non-overlapping operations bottom to top', () => {
    expect(applyOps('a\r\nb\r\nc\r\n', [{ startLine: 1, endLine: 1, replacement: 'A' }, { startLine: 3, endLine: 3, replacement: 'C\nD' }])).toBe('A\nb\nC\nD\n');
  });
  it('supports insertions without deleting the following line', () => {
    expect(applyOps('a\nb\n', [{ startLine: 2, endLine: 1, replacement: 'insert' }])).toBe('a\ninsert\nb\n');
  });
  it.each([
    [[{ startLine: 0, endLine: 0, replacement: '' }], 'invalid_range'],
    [[{ startLine: 1, endLine: 2, replacement: '' }, { startLine: 2, endLine: 2, replacement: '' }], 'overlapping_ops'],
    [[{ startLine: 1, endLine: 0, replacement: 'a' }, { startLine: 1, endLine: 0, replacement: 'b' }], 'overlapping_ops'],
    [Array.from({ length: 4 }, (_, index) => ({ startLine: index + 1, endLine: index + 1, replacement: '' })), 'too_many_ops'],
    [[{ startLine: 1, endLine: 1, replacement: Array(41).fill('x').join('\n') }], 'oversized'],
  ] as const)('rejects invalid edit shape %#', (ops, reason) => {
    expect(validateOps('a\nb\nc\nd\n', [...ops])).toBe(reason);
    expect(() => applyOps('a\nb\nc\nd\n', [...ops])).toThrow(reason);
  });
});
