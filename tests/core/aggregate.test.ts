import { describe, expect, it } from 'vitest';
import { buildAggregatePatch } from '../../src/core/export';
import { scan } from '../../src/core/scan';
import { nodeHasher, yaml } from './helpers';
import pinsFile from '../../fixtures/pins.json';
const ctx = { pins: pinsFile.pins };
describe('sequential aggregate patch', () => {
  it('re-proposes disjoint fixes against virtual text and emits one diff per file', async () => {
    const text = yaml('on: push', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@v4');
    const sources = [{ name: 'test.yml', text }], scanned = await scan(sources, nodeHasher);
    const result = await buildAggregatePatch(sources, scanned, scanned.files[0].findings.map((finding) => finding.id), ctx, nodeHasher);
    expect(result.excluded).toEqual([]);
    expect(result.included).toHaveLength(2);
    expect(result.patch.match(/--- a\/test.yml/g)).toHaveLength(1);
    expect(result.patch).toContain('+permissions:');
    expect(result.patch).toContain(`+      - uses: actions/checkout@${pinsFile.pins[0].sha}`);
  });
  it('excludes a later target already removed by the first permissions fix', async () => {
    const text = yaml('on: pull_request', 'permissions:', '  contents: write', '  issues: write', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo ok');
    const sources = [{ name: 'test.yml', text }], scanned = await scan(sources, nodeHasher);
    const result = await buildAggregatePatch(sources, scanned, scanned.files[0].findings.map((finding) => finding.id), ctx, nodeHasher);
    expect(result.included).toHaveLength(1);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].reason).toBe('target_missing');
    expect(result.patch.match(/--- a\/test.yml/g)).toHaveLength(1);
  });
  it('withholds stale source and records unknown accepted IDs', async () => {
    const source = { name: 'test.yml', text: yaml('on: push', 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo ok') };
    const scanned = await scan([source], nodeHasher);
    const result = await buildAggregatePatch([{ ...source, text: `${source.text}\n` }], scanned, [...scanned.files[0].findings.map((finding) => finding.id), 'missing-id'], ctx, nodeHasher);
    expect(result.patch).toBe('');
    expect(result.excluded.map((item) => item.reason)).toEqual(['target_missing', 'source_hash_mismatch']);
  });
});
