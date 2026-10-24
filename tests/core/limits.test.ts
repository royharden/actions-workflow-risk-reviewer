import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_JOBS, MAX_STEPS_PER_FILE, nameProblem, utf8ByteLength } from '../../src/core/limits';
import { parseWorkflow } from '../../src/core/parse';
import { scan, validateInputs } from '../../src/core/scan';
import { nodeHasher, yaml } from './helpers';

const ok = yaml('on: push', 'permissions: {}', 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo hi');

describe('file count', () => {
  it('rejects zero files', () => {
    expect(validateInputs([])).toHaveLength(1);
  });
  it('accepts 20 and rejects 21 files', () => {
    const files = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `w${i}.yml`, text: ok }));
    expect(validateInputs(files(20))).toEqual([]);
    expect(validateInputs(files(21)).some((e) => e.includes('Too many files'))).toBe(true);
  });
  it('blocks the whole scan on any input error (nothing is reported as clean)', async () => {
    const result = await scan([], nodeHasher);
    expect(result.files).toEqual([]);
    expect(result.inputErrors.length).toBeGreaterThan(0);
  });
});

describe('byte limit (UTF-8 bytes, not string length)', () => {
  it('counts multibyte characters', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });
  it('accepts exactly 256 KiB and rejects one byte more, with multibyte padding', () => {
    // '€' is 3 bytes; build a text of exactly MAX_FILE_BYTES bytes.
    const euros = '€'.repeat(Math.floor(MAX_FILE_BYTES / 3));
    const exact = euros + 'a'.repeat(MAX_FILE_BYTES - utf8ByteLength(euros));
    expect(utf8ByteLength(exact)).toBe(MAX_FILE_BYTES);
    expect(exact.length).toBeLessThan(MAX_FILE_BYTES); // string length would wrongly accept more
    expect(validateInputs([{ name: 'big.yml', text: exact }])).toEqual([]);
    expect(validateInputs([{ name: 'big.yml', text: `${exact}a` }]).some((e) => e.includes('256 KiB'))).toBe(true);
  });
});

describe('display names are labels only', () => {
  it('rejects unsafe names', () => {
    expect(nameProblem('/etc/passwd.yml')).not.toBeNull();
    expect(nameProblem('C:\\x.yml')).not.toBeNull();
    expect(nameProblem('../up.yml')).not.toBeNull();
    expect(nameProblem('a/../b.yml')).not.toBeNull();
    expect(nameProblem('bad\u0000name.yml')).not.toBeNull();
    expect(nameProblem('line\nbreak.yml')).not.toBeNull();
    expect(nameProblem('')).not.toBeNull();
    expect(nameProblem('notes.txt')).not.toBeNull();
  });
  it('accepts ordinary names', () => {
    expect(nameProblem('ci.yml')).toBeNull();
    expect(nameProblem('.github/workflows/release.yaml')).toBeNull();
  });
  it('rejects duplicates after normalization', () => {
    const errors = validateInputs([
      { name: 'CI.yml', text: ok },
      { name: './ci.yml', text: ok },
    ]);
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true);
  });
});

describe('structure caps → unsupported', () => {
  it(`refuses more than ${MAX_JOBS} jobs`, () => {
    const jobs = (n: number) =>
      yaml('on: push', 'permissions: {}', 'jobs:', ...Array.from({ length: n }, (_, i) => `  j${i}: {runs-on: ubuntu-latest, steps: [{run: x}]}`));
    expect(parseWorkflow(jobs(MAX_JOBS)).ok).toBe(true);
    const over = parseWorkflow(jobs(MAX_JOBS + 1));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.status).toBe('unsupported');
  });
  it(`refuses more than ${MAX_STEPS_PER_FILE} steps per file`, () => {
    const steps = (n: number) => yaml('on: push', 'permissions: {}', 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps:', ...Array.from({ length: n }, () => '      - run: x'));
    expect(parseWorkflow(steps(MAX_STEPS_PER_FILE)).ok).toBe(true);
    const over = parseWorkflow(steps(MAX_STEPS_PER_FILE + 1));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.status).toBe('unsupported');
  });
  it('refuses nesting deeper than the depth cap', () => {
    const deep = `on: push\nx: ${'['.repeat(70)}1${']'.repeat(70)}\n`;
    const result = parseWorkflow(deep);
    expect(result.ok).toBe(false);
  });
});
