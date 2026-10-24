import { describe, expect, it } from 'vitest';
import { buildFindingsJson, buildReport, buildSinglePatch, fenced, patchPath, singlePatchFileName } from '../../src/core/export';
import { scan } from '../../src/core/scan';
import { nodeHasher, yaml } from './helpers';
describe('text exports', () => {
  it('sanitizes absolute/traversal/control/directive paths into relative patch labels', () => {
    expect(patchPath('../../C:\\evil\n+++ b/other.yml')).toMatch(/^[A-Za-z0-9._/-]+$/);
    expect(patchPath('../../C:\\evil\n+++ b/other.yml').split('/')).not.toContain('..');
    const patch = buildSinglePatch('../../unsafe\npath.yml', 'a\n', 'b\n');
    expect(patch).toContain('--- a/unsafe_path.yml');
    expect(patch).toContain('+++ b/unsafe_path.yml');
    expect(singlePatchFileName('abc123')).toBe('fix-abc123.patch');
  });
  it('uses fences longer than all source backtick runs', () => {
    const result = fenced('echo ````\necho ```', 'yaml');
    expect(result.startsWith('`````yaml\n')).toBe(true);
    expect(result.endsWith('\n`````')).toBe(true);
  });
  it('escapes Markdown/HTML labels and round-trips JSON facts and ruling status', async () => {
    const text = yaml('on: push', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo ok');
    const scanned = await scan([{ name: 'test.yml', text }], nodeHasher);
    scanned.files[0].name = '<img>*[bad](x).yml';
    scanned.files[0].findings[0].snippet = 'echo ````';
    const id = scanned.files[0].findings[0].id;
    const rulings = new Map([[id, 'needs_review' as const]]);
    const report = buildReport(scanned, rulings, { patch: '', included: [], excluded: [{ findingId: id, file: 'test.yml', reason: '<script>' }] });
    expect(report).toContain('&lt;img&gt;\\*\\[bad\\]\\(x\\)\\.yml');
    expect(report).toContain('`````yaml');
    expect(report).toContain('behaviour unverified');
    expect(report).not.toContain('<script>');
    expect(JSON.parse(buildFindingsJson(scanned, rulings)).rulings[0]).toEqual({ findingId: id, ruling: 'needs_review' });
  });
});
