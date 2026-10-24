import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/core/parse';
import { nodeHasher, parseOk, scanOne, yaml } from './helpers';

describe('parseWorkflow', () => {
  it('keeps `on` as a string key (YAML 1.2 core schema)', () => {
    const { workflow } = parseOk(yaml('on: push', 'jobs: {}'));
    expect(workflow.on?.key).toBe('on');
    expect(workflow.triggers).toEqual(['push']);
  });

  it('reads scalar, list and mapping triggers', () => {
    expect(parseOk(yaml('on: pull_request_target', 'jobs: {}')).workflow.triggers).toEqual(['pull_request_target']);
    expect(parseOk(yaml('on: [push, pull_request]', 'jobs: {}')).workflow.triggers).toEqual(['push', 'pull_request']);
    const mapped = parseOk(yaml('on:', '  issue_comment:', '    types: [created]', '  gollum:', 'jobs: {}')).workflow;
    expect(mapped.triggers).toEqual(['issue_comment', 'gollum']);
    expect(mapped.forkReachable).toBe(true);
    expect(mapped.privileged).toBe(true);
  });

  it('marks fork-reachable and privileged trigger sets', () => {
    const pr = parseOk(yaml('on: pull_request', 'jobs: {}')).workflow;
    expect(pr.forkReachable).toBe(true);
    expect(pr.privileged).toBe(false);
    const push = parseOk(yaml('on: push', 'jobs: {}')).workflow;
    expect(push.forkReachable).toBe(false);
  });

  it('rejects malformed YAML with a line', () => {
    const result = parseWorkflow(yaml('on:', '  push:', '    branches: [main', '', 'jobs:', '  a:', '    runs-on: x'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('error');
      expect(result.line).toBeGreaterThan(0);
    }
  });

  it('rejects duplicate keys', () => {
    const result = parseWorkflow(yaml('on: push', 'on: pull_request', 'jobs: {}'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe('error');
  });

  it('rejects multiple documents', () => {
    const result = parseWorkflow(yaml('on: push', 'jobs: {}', '---', 'on: push', 'jobs: {}'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe('error');
  });

  it('rejects a non-mapping root and an empty document', () => {
    const list = parseWorkflow(yaml('- a', '- b'));
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.status).toBe('error');
    const empty = parseWorkflow('# only a comment\n');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.status).toBe('error');
  });

  it('refuses a merge key as unsupported', () => {
    const result = parseWorkflow(
      yaml('on: push', 'x: &base', '  run: echo hi', 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps:', '      - <<: *base', '        name: merged'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('unsupported');
      expect(result.line).toBe(8);
    }
  });

  it('maps CRLF input to the same line numbers and hashes the original text', async () => {
    const lf = yaml('on: pull_request_target', 'permissions: {}', 'jobs:', '  t:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo "${{ github.event.pull_request.title }}"');
    const crlf = lf.replace(/\n/g, '\r\n');
    const a = await scanOne(lf);
    const b = await scanOne(crlf);
    expect(a.findings.map((f) => f.span.startLine)).toEqual([7]);
    expect(b.findings.map((f) => f.span.startLine)).toEqual([7]);
    expect(a.fileHash).toBe(await nodeHasher.sha256Hex(lf));
    expect(b.fileHash).toBe(await nodeHasher.sha256Hex(crlf));
    expect(a.fileHash).not.toBe(b.fileHash);
    // Same fingerprint regardless of line endings (no file hash inside it); different id.
    expect(a.findings[0].fingerprint).toBe(b.findings[0].fingerprint);
    expect(a.findings[0].id).not.toBe(b.findings[0].id);
  });

  it('never reports an unparseable file as clean', async () => {
    const file = await scanOne('on: [push\n');
    expect(file.status).toBe('error');
    expect(file.findings).toEqual([]);
    expect(file.reason).toBeTruthy();
  });
});
