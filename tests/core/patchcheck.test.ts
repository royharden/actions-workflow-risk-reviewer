import { describe, expect, it } from 'vitest';
import type { EditOp } from '../../src/core/fixers/editops';
import { proposeFix } from '../../src/core/fixers';
import { check, introducedFindings } from '../../src/core/patchcheck/check';
import { applyOps } from '../../src/core/fixers/editops';
import { findingsOf, nodeHasher, parseOk, readRepoFile, yaml } from './helpers';
import pinsFile from '../../fixtures/pins.json';
const ctx = { pins: pinsFile.pins };
const base = yaml('on: pull_request', 'permissions:', '  contents: read', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - run: |', '          echo ${{ github.event.pull_request.title }}');
const whole = (text: string, replacement: string): EditOp[] => [{ startLine: 1, endLine: text.trimEnd().split('\n').length, replacement: replacement.trimEnd() }];
async function target(text = base) { return (await findingsOf(text, 'template-injection'))[0]; }
async function good(text = base) { const finding = await target(text); const proposal = proposeFix(parseOk(text), finding, ctx); if (!proposal.ok) throw new Error(proposal.reason); return { finding, proposal }; }
describe('fail-closed full checker', () => {
  it.each([
    ['d05-unpinned-checkout.yml', 'unpinned-uses', 'pin'],
    ['d03-pr-title-body-injection.yml', 'template-injection', 'injection-env'],
    ['d19-permissions-missing.yml', 'excessive-permissions', 'permissions'],
  ] as const)('passes the declared fixer for %s', async (name, rule, fixer) => {
    const text = readRepoFile(`fixtures/workflows/dev/${name}`);
    const finding = (await findingsOf(text, rule))[0], proposal = proposeFix(parseOk(text), finding, ctx);
    expect(proposal.ok).toBe(true);
    if (proposal.ok) expect(await check(text, proposal.ops, finding, fixer, nodeHasher, ctx)).toMatchObject({ ok: true, reasons: [], introduced: [] });
  });
  it('binds the original source hash', async () => {
    const { finding, proposal } = await good();
    expect((await check(`${base}\n`, proposal.ops, finding, 'injection-env', nodeHasher, ctx)).reasons).toContain('source_hash_mismatch');
  });
  it('rejects a still-flagged target', async () => {
    expect((await check(base, [{ startLine: 1, endLine: 1, replacement: 'on: pull_request' }], await target(), 'injection-env', nodeHasher, ctx)).reasons).toContain('target_still_flagged');
  });
  it('rejects an introduced finding and an extra occurrence', async () => {
    const { finding, proposal } = await good();
    const changed = proposal.ops.map((op) => op.replacement.includes('echo ') ? { ...op, replacement: op.replacement + '\n          echo ${{ github.event.pull_request.body }}' } : op);
    const result = await check(base, changed, finding, 'injection-env', nodeHasher, ctx);
    expect(result.reasons).toContain('introduced_finding');
    expect(result.introduced).toHaveLength(1);
    expect(introducedFindings([finding], [finding, { ...finding, id: 'duplicate' }])).toHaveLength(1);
  });
  it('rejects an unrelated command change inside the allowed run scalar', async () => {
    const { finding, proposal } = await good();
    const ops = proposal.ops.map((op) => ({ ...op, replacement: op.replacement.replace('echo ', 'printf ') }));
    expect((await check(base, ops, finding, 'injection-env', nodeHasher, ctx)).reasons).toContain('unrelated_command_change');
  });
  it.each([
    ['disabled_job', (text: string) => text.replace('  test:\n', '  test:\n    if: false\n')],
    ['continue_on_error', (text: string) => text.replace('  test:\n', '  test:\n    continue-on-error: true\n')],
    ['suppressed_failure', (text: string) => text.replace('echo "$AWR_TITLE"', 'echo "$AWR_TITLE" || true')],
    ['removed_trigger', (text: string) => text.replace('on: pull_request\n', '')],
    ['removed_job', (text: string) => text.slice(0, text.indexOf('jobs:')) + 'jobs: {}\n'],
    ['removed_step', (text: string) => text.slice(0, text.indexOf('    steps:')) + '    steps: []\n'],
  ] as const)('rejects disable-instead-of-fix: %s', async (reason, mutate) => {
    const { finding, proposal } = await good();
    const patched = mutate(applyOps(base, proposal.ops));
    expect((await check(base, whole(base, patched), finding, 'injection-env', nodeHasher, ctx)).reasons).toContain(reason);
  });
  it('rejects removal of uses and a trigger substitution out of scope', async () => {
    const text = yaml('on: push', 'permissions:', '  contents: read', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@v4');
    const finding = (await findingsOf(text, 'unpinned-uses'))[0];
    const deleted = text.replace('      - uses: actions/checkout@v4', '      - run: echo ok');
    expect((await check(text, whole(text, deleted), finding, 'pin', nodeHasher, ctx)).reasons).toContain('removed_uses');
    const pinned = text.replace('actions/checkout@v4', `actions/checkout@${pinsFile.pins[0].sha}`).replace('on: push', 'on: workflow_dispatch');
    expect((await check(text, whole(text, pinned), finding, 'pin', nodeHasher, ctx)).reasons).toContain('out_of_scope');
  });
  it('rejects invalid YAML, overlapping ranges, out-of-range lines and >40 line edits', async () => {
    const finding = await target();
    expect((await check(base, [{ startLine: 1, endLine: 1, replacement: 'on: [' }], finding, 'injection-env', nodeHasher, ctx)).reasons).toContain('invalid_yaml');
    expect((await check(base, [{ startLine: 1, endLine: 2, replacement: '' }, { startLine: 2, endLine: 3, replacement: '' }], finding, 'injection-env', nodeHasher, ctx)).reasons).toContain('overlapping_ops');
    expect((await check(base, [{ startLine: 999, endLine: 999, replacement: '' }], finding, 'injection-env', nodeHasher, ctx)).reasons).toContain('invalid_range');
    expect((await check(base, [{ startLine: 1, endLine: 1, replacement: Array(41).fill('# x').join('\n') }], finding, 'injection-env', nodeHasher, ctx)).reasons).toContain('oversized');
  });
  it('rejects another action SHA, a SHA absent from the table, and an aliased/anchored target', async () => {
    const text = yaml('on: push', 'permissions:', '  contents: read', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@v4');
    const finding = (await findingsOf(text, 'unpinned-uses'))[0];
    for (const [sha, reason] of [[pinsFile.pins[1].sha, 'pin_key_mismatch'], ['f'.repeat(40), 'pin_not_in_table']]) {
      const patched = text.replace('actions/checkout@v4', `actions/checkout@${sha}`);
      expect((await check(text, whole(text, patched), finding, 'pin', nodeHasher, ctx)).reasons).toContain(reason);
    }
    const anchored = text.replace('actions/checkout@v4', '&pin actions/checkout@v4');
    const af = (await findingsOf(anchored, 'unpinned-uses'))[0];
    expect((await check(anchored, whole(anchored, anchored.replace('actions/checkout@v4', `actions/checkout@${pinsFile.pins[0].sha}`)), af, 'pin', nodeHasher, ctx)).reasons).toContain('aliased_target');
  });
  it('refuses an identity/rule-version mismatch and unchanged ordinals that would remap twins', async () => {
    const { finding, proposal } = await good();
    expect((await check(base, proposal.ops, { ...finding, ruleVersion: 'stale' }, 'injection-env', nodeHasher, ctx)).reasons).toContain('identity_ambiguous');
    const text = base.replace('echo ${{ github.event.pull_request.title }}', 'echo ${{ github.event.pull_request.title }} ${{ github.event.pull_request.title }}');
    const result = await good(text);
    expect((await check(text, result.proposal.ops, result.finding, 'injection-env', nodeHasher, ctx)).ok).toBe(false);
  });
});
