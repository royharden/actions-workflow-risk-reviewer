import type { Finding } from '../finding';
import type { ParseOk } from '../parse';
import { validateOps } from './editops';
import { propose as pin } from './pin';
import { propose as permissions } from './permissions';
import { propose as injectionEnv } from './injection-env';
import type { FixContext, FixerId, Proposal } from './types';
export type { FixContext, FixerId, Proposal, RefusalReason, Pin } from './types';
export function fixerFor(finding: Finding): FixerId | null {
  if (finding.rule === 'unpinned-uses') return 'pin';
  if (finding.rule === 'excessive-permissions') return 'permissions';
  if (finding.rule === 'template-injection') return 'injection-env';
  return null;
}
export function proposeFix(parsed: ParseOk, finding: Finding, ctx: FixContext): Proposal {
  const fixer = fixerFor(finding);
  const result = fixer === 'pin' ? pin(parsed, finding, ctx) : fixer === 'permissions' ? permissions(parsed, finding, ctx) : fixer === 'injection-env' ? injectionEnv(parsed, finding, ctx) : { ok: false as const, reason: 'no_fixer' as const };
  if (result.ok && validateOps(parsed.normalizedText, result.ops)) return { ok: false, reason: 'oversized' };
  return result;
}
