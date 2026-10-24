import { describe, expect, it } from 'vitest';
import contexts from '../../src/core/contexts.json';
import { classifyRef } from '../../src/core/rules/privileged-trigger-checkout';
import { isBroadUploadPath } from '../../src/core/rules/secrets-exposure';
import { classifyUses } from '../../src/core/rules/unpinned-uses';
import { classifyExpression, contextPaths } from '../../src/core/rules/util';
import { severityFor } from '../../src/core/severity';
import { findingsOf, lines, scanOne, yaml } from './helpers';

const SHA = '3f1c0a9e7b2d4c6f8a1e5b9d0c7f2a4e6b8d1c3f';

function steps(trigger: string, ...stepLines: string[]): string {
  return yaml(`on: ${trigger}`, 'permissions: {}', 'jobs:', '  j:', '    runs-on: ubuntu-latest', '    steps:', ...stepLines);
}

// ---------------------------------------------------------------------------
describe('unpinned-uses', () => {
  it.each([
    ['actions/checkout@v4', 'tag_or_branch'],
    ['octo/a@main', 'tag_or_branch'],
    ['octo/a@v2.3.1', 'tag_or_branch'],
    ['octo/a/path/b@v1', 'tag_or_branch'],
    ['octo/a', 'tag_or_branch'],
    ['octo/a@a1b2c3d', 'short_sha'],
    [`octo/a@${SHA.slice(0, 39)}g`, 'non_hex'],
    ['docker://alpine:3.20', 'docker_tag'],
    ['docker://alpine', 'docker_tag'],
    ['octo/shared/.github/workflows/build.yml@v1', 'tag_or_branch'],
  ])('fires on %s (%s)', (uses, kind) => {
    expect(classifyUses(uses)).toBe(kind);
  });

  it.each([
    [`actions/checkout@${SHA}`],
    ['./.github/actions/setup'],
    ['./.github/workflows/notify.yml'],
    [`docker://alpine@sha256:${'0a'.repeat(32)}`],
  ])('does not fire on %s', (uses) => {
    expect(classifyUses(uses)).toBeNull();
  });

  it('reports step uses with stepIndex and reusable-job uses without', async () => {
    const findings = await findingsOf(
      yaml(
        'on: push',
        'permissions: {}',
        'jobs:',
        '  call:',
        '    uses: octo/shared/.github/workflows/build.yml@v1',
        '  b:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        `      - uses: actions/checkout@${SHA}`,
        '      - uses: actions/setup-node@v4',
      ),
      'unpinned-uses',
    );
    expect(findings.map((f) => [f.jobId, f.stepIndex, f.span.startLine])).toEqual([
      ['call', null, 5],
      ['b', 1, 10],
    ]);
    expect(findings[1].severity).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
describe('excessive-permissions', () => {
  it('missing everywhere → one finding on the jobs: line, not one per job', async () => {
    const findings = await findingsOf(
      yaml('on: push', 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps: [{run: x}]', '  b:', '    runs-on: ubuntu-latest', '    steps: [{run: x}]'),
      'excessive-permissions',
    );
    expect(findings.map((f) => [f.jobId, f.span.startLine, f.facts.permissionCause])).toEqual([[null, 2, 'missing']]);
    expect(findings[0].severity).toBe('high');
  });

  it('job-only permissions on every job → no missing finding', async () => {
    const findings = await findingsOf(
      yaml('on: push', 'jobs:', '  a:', '    permissions: {}', '    runs-on: ubuntu-latest', '    steps: [{run: x}]', '  b:', '    permissions:', '      contents: read', '    runs-on: x', '    steps: [{run: x}]'),
      'excessive-permissions',
    );
    expect(findings).toEqual([]);
  });

  it('permissions: {} is an explicit deny', async () => {
    expect(await findingsOf(yaml('on: pull_request', 'permissions: {}', 'jobs:', '  a:', '    runs-on: x', '    steps: [{run: x}]'), 'excessive-permissions')).toEqual([]);
  });

  it('write-all fires at workflow and job level regardless of trigger', async () => {
    const wf = await findingsOf(yaml('on: push', 'permissions: write-all', 'jobs:', '  a:', '    runs-on: x', '    steps: [{run: x}]'), 'excessive-permissions');
    expect(wf.map((f) => [f.jobId, f.span.startLine, f.facts.permissionCause])).toEqual([[null, 2, 'write-all']]);
    const job = await findingsOf(
      yaml('on: workflow_dispatch', 'permissions: {}', 'jobs:', '  a:', '    permissions: write-all', '    runs-on: x', '    steps: [{run: x}]'),
      'excessive-permissions',
    );
    expect(job.map((f) => [f.jobId, f.span.startLine])).toEqual([['a', 5]]);
  });

  it('write scope fires only on a fork-reachable trigger', async () => {
    const body = ['permissions:', '  contents: read', '  pull-requests: write', 'jobs:', '  a:', '    runs-on: x', '    steps: [{run: x}]'];
    const pr = await findingsOf(yaml('on: pull_request', ...body), 'excessive-permissions');
    expect(pr.map((f) => [f.jobId, f.span.startLine, f.facts.scope])).toEqual([[null, 4, 'pull-requests']]);
    expect(await findingsOf(yaml('on: push', ...body), 'excessive-permissions')).toEqual([]);
  });

  it('read-all does not fire', async () => {
    expect(await findingsOf(yaml('on: pull_request', 'permissions: read-all', 'jobs:', '  a:', '    runs-on: x', '    steps: [{run: x}]'), 'excessive-permissions')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('privileged-trigger-checkout', () => {
  it.each([
    ['${{ github.event.pull_request.head.sha }}', 'pr_head'],
    ['${{ github.event.pull_request.head.ref }}', 'pr_head'],
    ['${{ github.event.workflow_run.head_sha }}', 'pr_head'],
    ['${{ github.event.workflow_run.head_branch }}', 'pr_head'],
    ['${{ github.head_ref }}', 'pr_head'],
    ['refs/pull/${{ github.event.issue.number }}/merge', 'pr_head'],
    ['${{ github.event.pull_request.base.sha }}', 'base'],
    ['${{ github.sha }}', 'base'],
    ['main', 'base'],
    ['${{ steps.resolve.outputs.ref }}', 'unknown'],
  ])('classifies ref %s as %s', (ref, cls) => {
    expect(classifyRef(ref)).toBe(cls);
  });

  it('no ref → default checkout, not classified', () => {
    expect(classifyRef('')).toBeNull();
  });

  const checkout = (ref: string | null) =>
    [`      - uses: actions/checkout@${SHA}`, ...(ref === null ? [] : ['        with:', `          ref: ${ref}`]), '      - run: npm ci && npm test'];

  it('head-sha checkout on pull_request_target fires with span uses..ref and records execution', async () => {
    const findings = await findingsOf(steps('pull_request_target', ...checkout('${{ github.event.pull_request.head.sha }}')), 'privileged-trigger-checkout');
    expect(findings).toHaveLength(1);
    expect([findings[0].span.startLine, findings[0].span.endLine]).toEqual([7, 9]);
    expect(findings[0].facts.refClass).toBe('pr_head');
    expect(findings[0].facts.executesCheckedOutCode).toBe(true);
    expect(findings[0].severity).toBe('critical');
  });

  it('base-ref checkout is excluded (rule exclusion, not a gate)', async () => {
    expect(await findingsOf(steps('pull_request_target', ...checkout('${{ github.event.pull_request.base.sha }}')), 'privileged-trigger-checkout')).toEqual([]);
  });

  it('default checkout (no ref) is excluded', async () => {
    expect(await findingsOf(steps('pull_request_target', ...checkout(null)), 'privileged-trigger-checkout')).toEqual([]);
  });

  it('the same head checkout on pull_request (not privileged) is excluded', async () => {
    expect(await findingsOf(steps('pull_request', ...checkout('${{ github.event.pull_request.head.sha }}')), 'privileged-trigger-checkout')).toEqual([]);
  });

  it('unknown ref expression fires with refClass unknown', async () => {
    const findings = await findingsOf(steps('workflow_run', ...checkout('${{ steps.r.outputs.ref }}')), 'privileged-trigger-checkout');
    expect(findings.map((f) => f.facts.refClass)).toEqual(['unknown']);
    expect(findings[0].facts.detail).toContain('unknown ref');
  });

  it('ref before uses → span still runs from the first to the last line', async () => {
    const findings = await findingsOf(
      steps('pull_request_target', '      - with:', '          ref: ${{ github.event.pull_request.head.sha }}', `        uses: actions/checkout@${SHA}`),
      'privileged-trigger-checkout',
    );
    expect([findings[0].span.startLine, findings[0].span.endLine]).toEqual([8, 9]);
  });
});

// ---------------------------------------------------------------------------
describe('template-injection', () => {
  const entries = contexts as Array<{ pattern: string; class: string; docAnchor: string }>;

  it('contexts.json has exactly the M0 list with doc anchors', () => {
    expect(entries.filter((e) => e.class === 'attacker_controlled')).toHaveLength(20);
    expect(entries.filter((e) => e.class === 'maintainer_controlled').map((e) => e.pattern)).toEqual(['inputs.*', 'github.event.inputs.*']);
    for (const e of entries) expect(e.docAnchor).toMatch(/^https:\/\/docs\.github\.com\//);
  });

  // One positive (run) and one benign (env) case per contexts.json entry.
  it.each(entries.map((e) => [e.pattern, e.class]))('%s: fires in run, not via env', async (pattern, cls) => {
    const expr = (pattern as string).replace(/\*/g, '0').replace(/\.0\./g, '[0].').replace(/\.0$/, '.x');
    const positive = await findingsOf(steps('push', `      - run: echo "\${{ ${expr} }}"`), 'template-injection');
    expect(positive.map((f) => f.facts.contextClass)).toEqual([cls]);
    expect(positive[0].severity).toBe(cls === 'attacker_controlled' ? 'high' : 'medium');
    const benign = await findingsOf(steps('push', '      - env:', `          V: \${{ ${expr} }}`, '        run: echo "$V"'), 'template-injection');
    expect(benign).toEqual([]);
  });

  it.each(['github.sha', 'github.ref', 'github.run_id', 'github.repository', 'secrets.TOKEN', 'env.STAGE', 'steps.meta.outputs.subject', 'github.event.pull_request.number'])(
    'does not fire on non-listed context %s',
    (expr) => {
      expect(classifyExpression(expr)).toBeNull();
    },
  );

  it('normalizes [N] and quoted indexes and ignores string literals', () => {
    expect(contextPaths("github.event.commits[0].message")).toContain('github.event.commits.0.message');
    expect(classifyExpression('github.event.commits[0].message')).toBe('attacker_controlled');
    expect(classifyExpression("github.event['issue'].title")).toBe('attacker_controlled');
    expect(classifyExpression("format('github.event.issue.title {0}', github.sha)")).toBeNull();
  });

  it('one finding per expression; two in one step = two findings on their own lines', async () => {
    const findings = await findingsOf(
      steps('pull_request_target', '      - run: |', '          echo ${{ github.event.pull_request.title }}', '          echo "${{ github.event.pull_request.body }}"'),
      'template-injection',
    );
    expect(lines(findings)).toEqual([8, 9]);
    expect(findings.map((f) => f.facts.sink)).toEqual(['run', 'run']);
  });

  it('fires in actions/github-script script, not in another action with:', async () => {
    const script = await findingsOf(
      steps('issues', `      - uses: actions/github-script@${SHA}`, '        with:', '          script: |', '            const t = "${{ github.event.issue.title }}";'),
      'template-injection',
    );
    expect(script.map((f) => [f.span.startLine, f.facts.sink])).toEqual([[10, 'github-script']]);
    const other = await findingsOf(
      steps('issues', `      - uses: octo/comment@${SHA}`, '        with:', '          body: ${{ github.event.issue.title }}'),
      'template-injection',
    );
    expect(other).toEqual([]);
  });

  it('a context inside if: is not a sink', async () => {
    expect(await findingsOf(steps('issue_comment', "      - if: contains(github.event.comment.body, '/go')", '        run: echo go'), 'template-injection')).toEqual([]);
  });

  it('workflow_call input in run fires as maintainer class (origin unresolved)', async () => {
    const findings = await findingsOf(steps('workflow_call', '      - run: echo "${{ inputs.target }}"'), 'template-injection');
    expect(findings.map((f) => f.facts.contextClass)).toEqual(['maintainer_controlled']);
  });

  it('steps outputs laundering is a named false negative', async () => {
    expect(await findingsOf(steps('push', '      - run: echo "${{ steps.meta.outputs.subject }}"'), 'template-injection')).toEqual([]);
  });

  it('expression in a folded/plain multi-line scalar is reported on its own source line', async () => {
    const findings = await findingsOf(steps('issues', '      - run: >', '          echo first', '          echo "${{ github.event.issue.body }}"'), 'template-injection');
    expect(lines(findings)).toEqual([9]);
  });
});

// ---------------------------------------------------------------------------
describe('secrets-exposure', () => {
  it('secrets: inherit fires for external and same-repo callees', async () => {
    const findings = await findingsOf(
      yaml(
        'on: push',
        'permissions: {}',
        'jobs:',
        '  ext:',
        `    uses: octo/other/.github/workflows/x.yml@${SHA}`,
        '    secrets: inherit',
        '  local:',
        '    uses: ./.github/workflows/y.yml',
        '    secrets: inherit',
      ),
      'secrets-exposure',
    );
    expect(findings.map((f) => [f.jobId, f.span.startLine, f.facts.callee])).toEqual([
      ['ext', 6, `octo/other/.github/workflows/x.yml@${SHA}`],
      ['local', 9, './.github/workflows/y.yml'],
    ]);
  });

  it('workflow-level env secret fires; plain env and job-level env secret do not', async () => {
    const findings = await findingsOf(
      yaml(
        'on: push',
        'permissions: {}',
        'env:',
        '  STAGE: prod',
        '  TOKEN: ${{ secrets.FAKE_TOKEN_DO_NOT_USE }}',
        'jobs:',
        '  a:',
        '    runs-on: x',
        '    env:',
        '      JOB_TOKEN: ${{ secrets.FAKE_JOB_TOKEN_DO_NOT_USE }}',
        '    steps: [{run: x}]',
      ),
      'secrets-exposure',
    );
    expect(findings.map((f) => [f.jobId, f.span.startLine, f.facts.secretsCause])).toEqual([[null, 5, 'workflow-env']]);
  });

  const upload = (persist: string | null, path: string) =>
    steps(
      'push',
      `      - uses: actions/checkout@${SHA}`,
      ...(persist === null ? [] : ['        with:', `          persist-credentials: ${persist}`]),
      `      - uses: actions/upload-artifact@${SHA}`,
      '        with:',
      `          path: ${path}`,
    );

  it.each(['.', './', "'**'", '${{ github.workspace }}'])('default checkout then broad upload path %s fires', async (path) => {
    const findings = await findingsOf(upload(null, path), 'secrets-exposure');
    expect(findings.map((f) => [f.span.startLine, f.span.endLine, f.stepIndex])).toEqual([[8, 10, 1]]);
  });

  it.each([
    ['false', '.'],
    ['"false"', '.'],
    ["'FALSE'", '.'],
  ])('persist-credentials %s is excluded', async (persist, path) => {
    expect(await findingsOf(upload(persist, path), 'secrets-exposure')).toEqual([]);
  });

  it('narrow upload path is excluded', async () => {
    expect(await findingsOf(upload(null, 'dist/'), 'secrets-exposure')).toEqual([]);
  });

  it('broad path list', () => {
    expect(isBroadUploadPath('${{github.workspace}}')).toBe(true);
    expect(isBroadUploadPath('dist\n.\n')).toBe(true);
    expect(isBroadUploadPath('./dist')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('self-hosted-on-untrusted-trigger', () => {
  const job = (trigger: string, ...jobLines: string[]) =>
    yaml(`on: ${trigger}`, 'permissions: {}', 'jobs:', '  j:', ...jobLines, '    steps: [{run: x}]');

  it('scalar and array self-hosted on a fork-reachable trigger fire on the runs-on line', async () => {
    expect(lines(await findingsOf(job('pull_request', '    runs-on: self-hosted'), 'self-hosted-on-untrusted-trigger'))).toEqual([5]);
    expect(lines(await findingsOf(job('issue_comment', '    runs-on: [self-hosted, linux]'), 'self-hosted-on-untrusted-trigger'))).toEqual([5]);
  });

  it('finite matrix containing self-hosted fires; hosted-only matrix does not', async () => {
    const mixed = await findingsOf(
      job('pull_request', '    strategy:', '      matrix:', '        os: [ubuntu-latest, self-hosted]', '    runs-on: ${{ matrix.os }}'),
      'self-hosted-on-untrusted-trigger',
    );
    expect(lines(mixed)).toEqual([8]);
    const hosted = await findingsOf(
      job('pull_request', '    strategy:', '      matrix:', '        os: [ubuntu-latest, macos-latest]', '    runs-on: ${{ matrix.os }}'),
      'self-hosted-on-untrusted-trigger',
    );
    expect(hosted).toEqual([]);
  });

  it('dynamic labels → no finding, a coverage note', async () => {
    const file = await scanOne(job('pull_request', '    runs-on: ${{ inputs.runner }}'));
    expect(file.findings.filter((f) => f.rule === 'self-hosted-on-untrusted-trigger')).toEqual([]);
    expect(file.coverageNotes.some((n) => n.includes('coverage unknown'))).toBe(true);
  });

  it('non-fork-reachable trigger is excluded', async () => {
    expect(await findingsOf(job('push', '    runs-on: [self-hosted, gpu]'), 'self-hosted-on-untrusted-trigger')).toEqual([]);
  });
});

describe('severity table', () => {
  it('is fixed per rule (template-injection by class)', () => {
    const facts = { triggers: [], forkReachable: false, privileged: false, gateEvidence: [], detail: '' };
    expect(severityFor('unpinned-uses', facts)).toBe('medium');
    expect(severityFor('excessive-permissions', facts)).toBe('high');
    expect(severityFor('privileged-trigger-checkout', facts)).toBe('critical');
    expect(severityFor('template-injection', { ...facts, contextClass: 'attacker_controlled' })).toBe('high');
    expect(severityFor('template-injection', { ...facts, contextClass: 'maintainer_controlled' })).toBe('medium');
    expect(severityFor('secrets-exposure', facts)).toBe('high');
    expect(severityFor('self-hosted-on-untrusted-trigger', facts)).toBe('high');
  });
});
