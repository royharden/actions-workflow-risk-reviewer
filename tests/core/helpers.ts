import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Hasher } from '../../src/core/hash';
import type { Finding } from '../../src/core/finding';
import { parseWorkflow } from '../../src/core/parse';
import type { ParseOk } from '../../src/core/parse';
import { scan } from '../../src/core/scan';
import type { FileResult } from '../../src/core/scan';

export const nodeHasher: Hasher = {
  async sha256Hex(data: string | Uint8Array): Promise<string> {
    return createHash('sha256').update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data).digest('hex');
  },
};

export const repoRoot = new URL('../../', import.meta.url);

export function readRepoFile(relative: string): string {
  return readFileSync(new URL(relative, repoRoot), 'utf8');
}

/** Joins lines with LF and a final newline, so tests can write workflows as arrays of lines. */
export function yaml(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

export function parseOk(text: string): ParseOk {
  const result = parseWorkflow(text);
  if (!result.ok) throw new Error(`expected a parse, got ${result.status}: ${result.reason}`);
  return result;
}

export async function scanOne(text: string, name = 'test.yml'): Promise<FileResult> {
  const result = await scan([{ name, text }], nodeHasher);
  if (result.inputErrors.length > 0) throw new Error(result.inputErrors.join('; '));
  return result.files[0];
}

export async function findingsOf(text: string, rule?: Finding['rule']): Promise<Finding[]> {
  const file = await scanOne(text);
  if (file.status !== 'complete') throw new Error(`file not reviewed: ${file.status} ${file.reason ?? ''}`);
  return rule ? file.findings.filter((f) => f.rule === rule) : file.findings;
}

export function lines(findings: Finding[]): number[] {
  return findings.map((f) => f.span.startLine);
}
