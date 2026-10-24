import { describe, expect, it } from 'vitest';
import { assignOrdinals, normalizeExpression, occurrenceBase, stepKeysFor } from '../../src/core/identity';
import type { Finding } from '../../src/core/finding';
import { findingsOf, yaml } from './helpers';

const header = ['on: pull_request_target', 'permissions: {}', 'jobs:', '  t:', '    runs-on: ubuntu-latest', '    steps:'];

function fingerprints(findings: Finding[]): string[] {
  return findings.map((f) => f.fingerprint);
}

function multiset(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

describe('stepKey', () => {
  it('uses a unique id, else #index; duplicate ids fall back to the index', () => {
    expect(stepKeysFor(['build', null, 'dup', 'dup', ''])).toEqual(['build', '#1', '#2', '#3', '#4']);
  });

  it('never uses the step name', async () => {
    const a = await findingsOf(yaml(...header, '      - name: First', '        run: echo "${{ github.event.pull_request.title }}"'), 'template-injection');
    const b = await findingsOf(yaml(...header, '      - name: Renamed', '        run: echo "${{ github.event.pull_request.title }}"'), 'template-injection');
    expect(a[0].stepKey).toBe('#0');
    expect(fingerprints(a)).toEqual(fingerprints(b));
  });
});

describe('occurrence and fingerprint', () => {
  it('two expressions in one step get two fingerprints', async () => {
    const findings = await findingsOf(
      yaml(...header, '      - run: |', '          echo ${{ github.event.pull_request.title }}', '          echo "${{ github.event.pull_request.body }}"'),
      'template-injection',
    );
    expect(findings).toHaveLength(2);
    expect(new Set(fingerprints(findings)).size).toBe(2);
  });

  it("fixing one expression leaves the other's fingerprint unchanged", async () => {
    const before = await findingsOf(
      yaml(...header, '      - run: |', '          echo ${{ github.event.pull_request.title }}', '          echo "${{ github.event.pull_request.body }}"'),
      'template-injection',
    );
    const after = await findingsOf(
      yaml(
        ...header,
        '      - env:',
        '          AWR_TITLE: ${{ github.event.pull_request.title }}',
        '        run: |',
        '          echo "$AWR_TITLE"',
        '          echo "${{ github.event.pull_request.body }}"',
      ),
      'template-injection',
    );
    expect(after).toHaveLength(1);
    expect(fingerprints(before)).toContain(after[0].fingerprint);
  });

  it('a line shift does not change fingerprints', async () => {
    const step = ['      - run: echo "${{ github.event.pull_request.title }}"'];
    const a = await findingsOf(yaml(...header, ...step), 'template-injection');
    const b = await findingsOf(yaml('# a new comment line', '', ...header, ...step), 'template-injection');
    expect(a[0].span.startLine + 2).toBe(b[0].span.startLine);
    expect(fingerprints(a)).toEqual(fingerprints(b));
  });

  it('identical expressions in one step are told apart by ordinal and an added occurrence shows in the multiset', async () => {
    const one = await findingsOf(yaml(...header, '      - run: |', '          echo "${{ github.event.pull_request.title }}"'), 'template-injection');
    const two = await findingsOf(
      yaml(...header, '      - run: |', '          echo "${{ github.event.pull_request.title }}"', '          echo "${{ github.event.pull_request.title }}"'),
      'template-injection',
    );
    expect(two).toHaveLength(2);
    expect(two[0].occurrence.endsWith('#0')).toBe(true);
    expect(two[1].occurrence.endsWith('#1')).toBe(true);
    const m1 = multiset(fingerprints(one));
    const m2 = multiset(fingerprints(two));
    const added = [...m2.entries()].filter(([fp, n]) => n > (m1.get(fp) ?? 0));
    expect(added).toHaveLength(1);
  });

  it('a pin fix does not change the unpinned-uses fingerprint input (the value is not part of the occurrence)', async () => {
    const base = ['on: push', 'permissions: {}', 'jobs:', '  b:', '    runs-on: ubuntu-latest', '    steps:'];
    const a = await findingsOf(yaml(...base, '      - uses: actions/checkout@v4'), 'unpinned-uses');
    const b = await findingsOf(yaml(...base, '      - uses: actions/checkout@v3'), 'unpinned-uses');
    expect(fingerprints(a)).toEqual(fingerprints(b));
  });

  it('id changes with the file hash; fingerprint does not', async () => {
    const step = '      - run: echo "${{ github.event.pull_request.title }}"';
    const a = await findingsOf(yaml(...header, step));
    const b = await findingsOf(yaml(...header, step, '      - run: echo unrelated'));
    expect(a[0].fingerprint).toBe(b[0].fingerprint);
    expect(a[0].id).not.toBe(b[0].id);
  });

  it('normalizes expression whitespace and builds deterministic occurrences', () => {
    expect(normalizeExpression('  github.event.issue.title   ')).toBe('github.event.issue.title');
    expect(normalizeExpression('a ||\n  b')).toBe('a || b');
    const span = { startLine: 1, startCol: 1, endLine: 1, endCol: 1 };
    const later = { startLine: 2, startCol: 1, endLine: 2, endCol: 1 };
    const base = occurrenceBase('run', 'run', 'x');
    const out = assignOrdinals([
      { rule: 'template-injection' as const, jobId: 'j', stepKey: '#0', occurrence: base, span: later },
      { rule: 'template-injection' as const, jobId: 'j', stepKey: '#0', occurrence: base, span },
    ]);
    expect(out.map((o) => o.occurrence)).toEqual([`${base}#1`, `${base}#0`]);
  });
});
