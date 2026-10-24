import { describe, expect, it } from 'vitest';
import { MAX_ALIAS_RESOLUTIONS } from '../../src/core/limits';
import { parseWorkflow } from '../../src/core/parse';
import { findingsOf, parseOk, yaml } from './helpers';

describe('alias walker', () => {
  it('resolves a scalar alias and locates it at the use site', () => {
    const { workflow } = parseOk(
      yaml(
        'on: push',
        'jobs:',
        '  a:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: &co actions/checkout@v4',
        '  b:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: *co',
      ),
    );
    const [a, b] = workflow.jobs;
    expect(a.steps[0].usesValue).toBe('actions/checkout@v4');
    expect(a.steps[0].uses?.aliased).toBe(false);
    expect(a.steps[0].uses?.span.startLine).toBe(6);
    expect(b.steps[0].usesValue).toBe('actions/checkout@v4');
    expect(b.steps[0].uses?.aliased).toBe(true);
    expect(b.steps[0].uses?.span.startLine).toBe(10);
  });

  it('reports a finding at the anchor definition site and at each alias use site', async () => {
    const findings = await findingsOf(
      yaml(
        'on: push',
        'permissions: {}',
        'jobs:',
        '  a:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - &step',
        '        run: echo "${{ github.event.head_commit.message }}"',
        '  b:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - *step',
        '  c:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - *step',
      ),
      'template-injection',
    );
    expect(findings.map((f) => [f.jobId, f.span.startLine, f.facts.aliased])).toEqual([
      ['a', 8, false],
      ['b', 12, true],
      ['c', 16, true],
    ]);
  });

  it('refuses an alias cycle as unsupported', () => {
    const result = parseWorkflow(yaml('on: push', 'x: &loop', '  - *loop', 'jobs: {}'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('unsupported');
      expect(result.reason).toContain('cycle');
      expect(result.line).toBe(3);
    }
  });

  it('refuses expansion beyond the alias budget (billion laughs)', () => {
    const result = parseWorkflow(
      yaml(
        'on: push',
        'a: &a [x, x, x, x, x, x, x, x, x, x]',
        'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]',
        'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]',
        'jobs: {}',
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('unsupported');
      expect(result.reason).toContain(String(MAX_ALIAS_RESOLUTIONS));
    }
  });

  it('accepts aliases within the budget', () => {
    expect(parseWorkflow(yaml('on: push', 'a: &a [x]', 'b: [*a, *a, *a]', 'jobs: {}')).ok).toBe(true);
  });
});
