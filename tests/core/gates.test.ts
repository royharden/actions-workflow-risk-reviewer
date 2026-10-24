import { describe, expect, it } from 'vitest';
import { applyGates, gatesOnlyTriage } from '../../src/core/gates';
import { findingsOf, parseOk, readRepoFile } from './helpers';

async function gated(text: string) { return applyGates(parseOk(text).workflow, await findingsOf(text)); }
describe('six annotate-only gates', () => {
  it.each([
    ['d02-prt-label-gated.yml', 'label'], ['d11-issue-comment-author-assoc.yml', 'author-association'],
    ['d12-prt-environment-gated.yml', 'environment'], ['d13-prt-fork-if.yml', 'fork-if'],
    ['d04-dispatch-input-injection.yml', 'dispatch-only'], ['d08-reusable-and-inherit.yml', 'same-repo-callee'],
  ])('demotes named dev fixture %s with %s', async (file, gate) => {
    const text = readRepoFile(`fixtures/workflows/dev/${file}`), before = await findingsOf(text), after = applyGates(parseOk(text).workflow, before);
    expect(after.some((finding) => finding.facts.gateEvidence.some((item) => item.gate === gate))).toBe(true);
    expect(after.map((finding) => [finding.id, finding.severity])).toEqual(before.map((finding) => [finding.id, finding.severity]));
    expect(before.every((finding) => finding.facts.gateEvidence.length === 0)).toBe(true);
  });
  it('does not demote unguarded checkout, inverted fork check or later-step label check', async () => {
    const text = readRepoFile('fixtures/workflows/dev/d13-prt-fork-if.yml');
    const findings = (await gated(text)).filter((finding) => finding.rule === 'privileged-trigger-checkout');
    expect(findings.find((finding) => finding.jobId === 'same-repo')?.facts.gateEvidence[0].gate).toBe('fork-if');
    for (const job of ['lint', 'forks-only', 'docs-preview']) expect(gatesOnlyTriage(findings.find((finding) => finding.jobId === job)!)).toBe('confirmed');
  });
  it('does not let another job environment or later author check guard the target', async () => {
    const env = await gated(readRepoFile('fixtures/workflows/dev/d12-prt-environment-gated.yml'));
    expect(env.find((finding) => finding.jobId === 'smoke' && finding.rule === 'privileged-trigger-checkout')?.facts.gateEvidence).toEqual([]);
    const author = await gated(readRepoFile('fixtures/workflows/dev/d11-issue-comment-author-assoc.yml'));
    expect(author.find((finding) => finding.jobId === 'test-anyone' && finding.rule === 'privileged-trigger-checkout')?.facts.gateEvidence).toEqual([]);
  });
  it('does not demote mixed dispatch/call inputs or attacker-controlled dispatch expressions', async () => {
    const mixed = await gated(readRepoFile('fixtures/workflows/dev/d14-dispatch-and-call-inputs.yml'));
    expect(mixed.filter((finding) => finding.rule === 'template-injection').every((finding) => gatesOnlyTriage(finding) === 'confirmed')).toBe(true);
    const text = readRepoFile('fixtures/workflows/dev/d04-dispatch-input-injection.yml').replace(/inputs\.\w+/g, 'github.event.pull_request.title');
    expect((await gated(text)).filter((finding) => finding.rule === 'template-injection').every((finding) => gatesOnlyTriage(finding) === 'confirmed')).toBe(true);
  });
  it('does not demote a remote SHA-pinned secrets-inherit callee', async () => {
    const findings = await gated(readRepoFile('fixtures/workflows/dev/d08-reusable-and-inherit.yml'));
    expect(findings.find((finding) => finding.jobId === 'publish' && finding.rule === 'secrets-exposure')?.facts.gateEvidence).toEqual([]);
  });
  it.each([
    "contains(github.event.pull_request.labels.*.name, 'safe-to-test') == false",
    "contains(github.event.pull_request.labels.*.name, 'safe-to-test') || true",
    "!contains(github.event.pull_request.labels.*.name, 'safe-to-test')",
  ])('does not read a contradictory predicate as a label gate: %s', async (condition) => {
    const text = readRepoFile('fixtures/workflows/dev/d02-prt-label-gated.yml').replace("contains(github.event.pull_request.labels.*.name, 'safe-to-test')", condition);
    expect((await gated(text)).find((finding) => finding.rule === 'privileged-trigger-checkout')?.facts.gateEvidence).toEqual([]);
  });
  it('accepts a label condition on the checkout itself', async () => {
    const text = readRepoFile('fixtures/workflows/dev/d02-prt-label-gated.yml').replace("    if: contains(github.event.pull_request.labels.*.name, 'safe-to-test')\n", '').replace('        uses: actions/checkout', "        if: contains(github.event.pull_request.labels.*.name, 'safe-to-test')\n        uses: actions/checkout");
    expect((await gated(text)).find((finding) => finding.rule === 'privileged-trigger-checkout')?.facts.gateEvidence[0].gate).toBe('label');
  });
});
