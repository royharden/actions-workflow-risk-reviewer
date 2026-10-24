import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/core/finding';
import { scan } from '../../src/core/scan';
import type { FileResult } from '../../src/core/scan';
import { nodeHasher, readRepoFile } from './helpers';

// Table-driven over the labelled DEV split only (never the sealed held-out files).
// positive / lookalike_flagged_benign ⇒ a finding of that rule, same jobId (and stepIndex when
// labelled), overlapping lines; lookalike_excluded ⇒ none; an item noted "expected miss" is a named
// false negative and must stay absent; and no dev file has a finding that no item accounts for.

interface ManifestItem {
  file: string;
  split: string;
  rule: Finding['rule'];
  jobId: string | null;
  stepIndex: number | null;
  span: { startLine: number; endLine: number };
  label: 'positive' | 'lookalike_excluded' | 'lookalike_flagged_benign';
  trap: string;
  gate: string | null;
  note: string;
}

interface ManifestFile {
  file: string;
  split: string;
  expectedStatus: 'complete' | 'error' | 'unsupported';
}

interface Manifest {
  files: ManifestFile[];
  items: ManifestItem[];
}

function loadDevManifest(): Manifest {
  // Filtered to split === 'dev': held-out items are never used here.
  const raw = JSON.parse(readRepoFile('fixtures/manifest.json')) as Manifest;
  return {
    files: raw.files.filter((f) => f.split === 'dev'),
    items: raw.items.filter((i) => i.split === 'dev'),
  };
}

const manifest = loadDevManifest();

function overlaps(f: Finding, item: ManifestItem): boolean {
  return f.span.startLine <= item.span.endLine && item.span.startLine <= f.span.endLine;
}

function matches(f: Finding, item: ManifestItem): boolean {
  if (f.rule !== item.rule || f.jobId !== item.jobId) return false;
  if (item.stepIndex !== null && f.stepIndex !== null && f.stepIndex !== item.stepIndex) return false;
  return overlaps(f, item);
}

const isExpectedMiss = (item: ManifestItem) => item.note.toLowerCase().startsWith('expected miss');

async function scanAll(): Promise<Map<string, FileResult>> {
  const inputs = manifest.files.map((f) => ({ name: f.file, text: readRepoFile(`fixtures/workflows/${f.file}`) }));
  const result = await scan(inputs, nodeHasher);
  expect(result.inputErrors).toEqual([]);
  return new Map(result.files.map((r) => [r.name, r]));
}

let cached: Promise<Map<string, FileResult>> | undefined;
const scanned = (): Promise<Map<string, FileResult>> => (cached ??= scanAll());

describe('dev fixtures', () => {
  it('has 24 dev files', () => {
    expect(manifest.files).toHaveLength(24);
  });

  it.each(manifest.files.map((f) => [f.file, f.expectedStatus]))('%s has status %s', async (file, status) => {
    const results = await scanned();
    expect(results.get(file as string)?.status).toBe(status);
  });

  it.each(manifest.items.map((item, i) => [`${item.file} ${item.rule} ${item.jobId ?? '-'} L${item.span.startLine}-${item.span.endLine} ${item.label}`, i]))(
    '%s',
    async (_title, index) => {
      const item = manifest.items[index as number];
      const results = await scanned();
      const file = results.get(item.file);
      expect(file?.status).toBe('complete');
      const hits = (file?.findings ?? []).filter((f) => matches(f, item));
      if (item.label === 'lookalike_excluded' || isExpectedMiss(item)) {
        expect(hits).toEqual([]);
      } else {
        expect(hits.length).toBeGreaterThanOrEqual(1);
      }
    },
  );

  it('produces no finding that no positive / flagged-benign item accounts for', async () => {
    const results = await scanned();
    const unlabelled: string[] = [];
    for (const [name, file] of results) {
      const firing = manifest.items.filter((i) => i.file === name && i.label !== 'lookalike_excluded' && !isExpectedMiss(i));
      for (const f of file.findings) {
        if (!firing.some((item) => matches(f, item))) unlabelled.push(`${name} ${f.rule} ${f.jobId ?? '-'} L${f.span.startLine}`);
      }
    }
    expect(unlabelled).toEqual([]);
  });

  it('each firing item is matched by exactly one finding (no duplicates)', async () => {
    const results = await scanned();
    const duplicated: string[] = [];
    for (const item of manifest.items) {
      if (item.label === 'lookalike_excluded' || isExpectedMiss(item)) continue;
      const hits = (results.get(item.file)?.findings ?? []).filter((f) => matches(f, item));
      if (hits.length > 1) duplicated.push(`${item.file} ${item.rule} L${item.span.startLine}`);
    }
    expect(duplicated).toEqual([]);
  });
});
