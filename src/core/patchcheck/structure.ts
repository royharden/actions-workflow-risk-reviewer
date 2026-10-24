import type { Finding } from '../finding';
import { applyOps } from '../fixers/editops';
import { proposeFix } from '../fixers';
import type { FixContext, FixerId } from '../fixers';
import { asMap, getEntry, scalarText } from '../model';
import type { LNode, Workflow } from '../model';
import type { ParseOk } from '../parse';
import type { Reason } from './reasons';

/** Project only semantic AST fields; positions change as lines are inserted. Anchors remain significant. */
function value(node: LNode | undefined, omit: ReadonlySet<LNode> = new Set()): unknown {
  if (!node) return undefined;
  if (omit.has(node)) return '<allowed-change>';
  const meta = { anchored: node.anchored, aliased: node.aliased };
  if (node.kind === 'scalar') return { ...meta, kind: node.kind, value: node.value };
  if (node.kind === 'seq') return { ...meta, kind: node.kind, items: node.items.map((item) => value(item, omit)) };
  return { ...meta, kind: node.kind, entries: node.entries.filter((entry) => !omit.has(entry.value)).map((entry) => [entry.key, value(entry.value, omit)]) };
}
function equivalent(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function counts(wf: Workflow): { jobs: number; steps: number; uses: number } {
  return { jobs: wf.jobs.length, steps: wf.jobs.reduce((n, job) => n + job.steps.length, 0), uses: wf.jobs.reduce((n, job) => n + Number(job.uses !== null) + job.steps.filter((step) => step.uses).length, 0) };
}
export function disableReasons(before: Workflow, after: Workflow): Reason[] {
  const reasons: Reason[] = [];
  const b = counts(before), a = counts(after);
  if (before.triggers.some((trigger) => !after.triggers.includes(trigger))) reasons.push('removed_trigger');
  if (a.jobs < b.jobs) reasons.push('removed_job');
  if (a.steps < b.steps) reasons.push('removed_step');
  if (a.uses < b.uses) reasons.push('removed_uses');
  for (const job of after.jobs) {
    const old = before.jobs.find((item) => item.id === job.id);
    if (!old) continue;
    for (const [map, prior] of [[job.map, old.map], ...job.steps.map((step) => [step.map, old.steps.find((item) => item.key === step.key)?.map] as const)] as const) {
      const condition = scalarText(getEntry(map, 'if')?.value)?.replace(/\s|\$\{\{|\}\}/g, '');
      if (condition === 'false' && scalarText(getEntry(prior, 'if')?.value)?.replace(/\s|\$\{\{|\}\}/g, '') !== 'false') reasons.push('disabled_job');
      if (scalarText(getEntry(map, 'continue-on-error')?.value) === 'true' && scalarText(getEntry(prior, 'continue-on-error')?.value) !== 'true') reasons.push('continue_on_error');
      const run = scalarText(getEntry(map, 'run')?.value) ?? '';
      const oldRun = scalarText(getEntry(prior, 'run')?.value) ?? '';
      if ((run.match(/\|\|\s*true\b/g) ?? []).length > (oldRun.match(/\|\|\s*true\b/g) ?? []).length) reasons.push('suppressed_failure');
    }
  }
  return [...new Set(reasons)];
}

/** Per-fixer semantic allowlist PLUS exact deterministic source bytes (including untouched commands/comments). */
export function structureReasons(before: ParseOk, after: ParseOk, target: Finding, fixer: FixerId, ctx: FixContext): Reason[] {
  const proposal = proposeFix(before, target, ctx);
  if (!proposal.ok) {
    if (proposal.reason === 'needs_lookup') return ['pin_not_in_table'];
    if (proposal.reason === 'no_fixer' || proposal.reason === 'flow_style') return ['out_of_scope'];
    return [proposal.reason];
  }
  const b = before.workflow, a = after.workflow;
  const bj = b.jobs.find((job) => job.id === target.jobId), aj = a.jobs.find((job) => job.id === target.jobId);
  const bs = bj?.steps.find((step) => step.key === target.stepKey), afterStep = aj?.steps.find((step) => step.key === target.stepKey);
  const omitB = new Set<LNode>(), omitA = new Set<LNode>();
  if (fixer === 'pin') {
    const be = target.stepKey === null ? bj?.uses : bs?.uses;
    const ae = target.stepKey === null ? aj?.uses : afterStep?.uses;
    if (!be || !ae) return ['out_of_scope'];
    omitB.add(be.value); omitA.add(ae.value);
    const uses = scalarText(ae.value) ?? '';
    const old = scalarText(be.value) ?? '';
    const at = old.lastIndexOf('@');
    const expected = ctx.pins.find((pin) => pin.action === old.slice(0, at) && pin.fromRef === old.slice(at + 1));
    if (!expected) return ['pin_not_in_table'];
    if (uses !== `${expected.action}@${expected.sha}`) return [ctx.pins.some((pin) => uses.endsWith(`@${pin.sha}`)) ? 'pin_key_mismatch' : 'pin_not_in_table'];
  } else if (fixer === 'permissions') {
    const be = getEntry(b.root, 'permissions'), ae = getEntry(a.root, 'permissions');
    if (!ae || target.jobId !== null || !equivalent(value(ae.value), { anchored: false, aliased: false, kind: 'map', entries: [['contents', { anchored: false, aliased: false, kind: 'scalar', value: 'read' }]] })) return ['out_of_scope'];
    if (be) omitB.add(be.value); omitA.add(ae.value);
  } else {
    if (!bs?.run || !afterStep?.run) return ['out_of_scope'];
    omitB.add(bs.run.value); omitA.add(afterStep.run.value);
    const be = getEntry(bs.map, 'env'), ae = getEntry(afterStep.map, 'env');
    const bm = asMap(be?.value), am = asMap(ae?.value);
    if (!am || (be && !bm)) return ['out_of_scope'];
    const oldKeys = new Set(bm?.entries.map((entry) => entry.key) ?? []);
    const added = am.entries.filter((entry) => !oldKeys.has(entry.key));
    if (added.length !== 1 || !added[0].key.startsWith('AWR_')) return ['out_of_scope'];
    if (be) omitB.add(be.value); if (ae) omitA.add(ae.value);
    if (!equivalent(bm?.entries.map((entry) => [entry.key, value(entry.value)]) ?? [], am.entries.filter((entry) => oldKeys.has(entry.key)).map((entry) => [entry.key, value(entry.value)]))) return ['out_of_scope'];
  }
  if (!equivalent(value(b.root, omitB), value(a.root, omitA))) return ['out_of_scope'];
  if (after.normalizedText !== applyOps(before.normalizedText, proposal.ops)) return [fixer === 'injection-env' ? 'unrelated_command_change' : 'out_of_scope'];
  return [];
}
