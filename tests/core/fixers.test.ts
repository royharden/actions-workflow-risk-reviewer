import { describe, expect, it } from 'vitest';
import { proposeFix } from '../../src/core/fixers';
import { applyOps } from '../../src/core/fixers/editops';
import { findingsOf, parseOk, readRepoFile, yaml } from './helpers';
import { stepExecutesCheckedOutCode } from '../../src/core/rules/util';
import pinsFile from '../../fixtures/pins.json';
const ctx = { pins: pinsFile.pins };
const injection = (command: string, runner = 'ubuntu-latest', extra: string[] = []) => yaml('on: pull_request', 'permissions:', '  contents: read', 'jobs:', '  test:', `    runs-on: ${runner}`, '    steps:', ...extra, '      - run: |', `          ${command}`);
async function propose(text: string, rule: 'template-injection' | 'unpinned-uses' | 'excessive-permissions' = 'template-injection') {
  return proposeFix(parseOk(text), (await findingsOf(text, rule))[0], ctx);
}
describe('deterministic fixers', () => {
  it('pins only an exact action/ref table key and preserves a trailing comment', async () => {
    const text = readRepoFile('fixtures/workflows/dev/d05-unpinned-checkout.yml');
    const finding = (await findingsOf(text, 'unpinned-uses')).find((item) => item.facts.usesRef === 'actions/checkout@v4')!;
    const result = proposeFix(parseOk(text), finding, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(applyOps(text, result.ops)).toContain(`actions/checkout@${pinsFile.pins[0].sha}`);
    const absent = (await findingsOf(text, 'unpinned-uses')).find((item) => item.facts.usesRef === 'actions/cache@v4')!;
    expect(proposeFix(parseOk(text), absent, ctx)).toEqual({ ok: false, reason: 'needs_lookup' });
  });
  it('refuses both anchor definitions and alias uses (d24)', async () => {
    const text = readRepoFile('fixtures/workflows/dev/d24-anchors-aliases.yml');
    for (const finding of await findingsOf(text, 'unpinned-uses')) expect(proposeFix(parseOk(text), finding, ctx)).toEqual({ ok: false, reason: 'aliased_target' });
  });
  it('inserts/replaces workflow permissions but refuses job-level and flow targets', async () => {
    for (const text of [yaml('on: push', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo ok'), yaml('on: pull_request', 'permissions: write-all', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo ok')]) {
      const result = await propose(text, 'excessive-permissions');
      expect(result.ok).toBe(true);
      if (result.ok) expect(applyOps(text, result.ops)).toContain('permissions:\n  contents: read');
    }
    const jobText = readRepoFile('fixtures/workflows/dev/d20-permissions-job-only.yml');
    expect(await propose(jobText, 'excessive-permissions')).toEqual({ ok: false, reason: 'manual_fix' });
    const flow = injection('echo ok').replace('permissions:\n  contents: read', 'permissions: {contents: write}');
    expect(await propose(flow, 'excessive-permissions')).toEqual({ ok: false, reason: 'flow_style' });
  });
  it('changes exactly one of two sibling expressions, with context-specific quoting', async () => {
    const text = readRepoFile('fixtures/workflows/dev/d03-pr-title-body-injection.yml');
    const findings = await findingsOf(text, 'template-injection');
    for (const finding of findings) {
      const result = proposeFix(parseOk(text), finding, ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const patched = applyOps(text, result.ops);
      expect(patched).toContain(finding.facts.expression?.endsWith('.title') ? 'echo Title: "$AWR_TITLE"' : 'echo "Body: ${AWR_BODY}"');
      expect(patched).toContain(findings.find((other) => other.id !== finding.id)!.snippet);
    }
  });
  it.each(['windows-latest', 'self-hosted', '${{ matrix.os }}', '[ubuntu-latest, self-hosted]'])('refuses unknown effective shell for %s', async (runner) => {
    expect(await propose(injection('echo ${{ github.event.pull_request.title }}', runner))).toEqual({ ok: false, reason: 'shell_unknown' });
  });
  it.each(['pwsh', 'powershell', 'cmd', 'python'])('refuses explicit %s shell', async (shell) => {
    const text = injection('echo ${{ github.event.pull_request.title }}').replace('      - run: |', `      - shell: ${shell}\n        run: |`);
    expect(await propose(text)).toEqual({ ok: false, reason: 'shell_unknown' });
  });
  it.each(["echo '${{ github.event.pull_request.title }}'", 'cat <<EOF ${{ github.event.pull_request.title }}', 'echo `date` ${{ github.event.pull_request.title }}', 'echo $(date) ${{ github.event.pull_request.title }}'])('refuses unsupported shell syntax %s', async (command) => {
    expect(await propose(injection(command))).toEqual({ ok: false, reason: 'manual_fix' });
  });
  it('chooses a collision-free key and appends to an env mapping before run', async () => {
    const text = injection('echo ${{ github.event.pull_request.title }}').replace('      - run: |', '      - env:\n          AWR_TITLE: existing\n        run: |');
    const result = await propose(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const patched = applyOps(text, result.ops);
      expect(patched).toContain('AWR_TITLE_2: ${{ github.event.pull_request.title }}');
      expect(parseOk(patched).workflow.jobs[0].steps[0].run?.value.kind).toBe('scalar');
    }
  });
  it('refuses github-script, flow-style steps and anchored run targets', async () => {
    const script = yaml('on: pull_request', 'permissions:', '  contents: read', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/github-script@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '        with:', '          script: console.log("${{ github.event.pull_request.title }}")');
    expect(await propose(script)).toEqual({ ok: false, reason: 'manual_fix' });
    const flow = injection('echo ok').replace('      - run: |\n          echo ok', '      - {run: "echo ${{ github.event.pull_request.title }}"}');
    expect(await propose(flow)).toEqual({ ok: false, reason: 'flow_style' });
    const anchored = injection('echo ${{ github.event.pull_request.title }}').replace('run: |', 'run: &script |');
    expect(await propose(anchored)).toEqual({ ok: false, reason: 'aliased_target' });
  });
  it('honours literal step/job/workflow shell defaults and refuses non-shell defaults', async () => {
    const text = injection('echo ${{ github.event.pull_request.title }}', 'windows-latest');
    for (const withShell of [text.replace('      - run: |', '      - shell: bash\n        run: |'), text.replace('    steps:', '    defaults:\n      run:\n        shell: sh\n    steps:'), text.replace('jobs:', 'defaults:\n  run:\n    shell: bash\njobs:')]) expect((await propose(withShell)).ok).toBe(true);
  });
  it('matches execution commands only in command position (M1 carryover)', () => {
    for (const command of ['echo make sense', 'echo npm install', 'printf python']) {
      const step = parseOk(injection(command)).workflow.jobs[0].steps[0];
      expect(stepExecutesCheckedOutCode(step)).toBe(false);
    }
    for (const command of ['npm ci', 'echo ready && make check', './scripts/test.sh', 'bash scripts/test.sh', 'python build.py']) expect(stepExecutesCheckedOutCode(parseOk(injection(command)).workflow.jobs[0].steps[0])).toBe(true);
  });
  it('has no fixer for the remaining three rules', async () => {
    const text = readRepoFile('fixtures/workflows/dev/d01-prt-head-checkout.yml');
    expect(proposeFix(parseOk(text), (await findingsOf(text, 'privileged-trigger-checkout'))[0], ctx)).toEqual({ ok: false, reason: 'no_fixer' });
  });
});
