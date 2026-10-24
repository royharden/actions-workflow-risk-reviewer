import type { RuleId } from '../finding';
import { excessivePermissions } from './excessive-permissions';
import { privilegedTriggerCheckout } from './privileged-trigger-checkout';
import { secretsExposure } from './secrets-exposure';
import { selfHostedOnUntrustedTrigger } from './self-hosted-on-untrusted-trigger';
import { templateInjection } from './template-injection';
import type { Rule } from './types';
import { unpinnedUses } from './unpinned-uses';

export const RULES: readonly Rule[] = [
  unpinnedUses,
  excessivePermissions,
  privilegedTriggerCheckout,
  templateInjection,
  secretsExposure,
  selfHostedOnUntrustedTrigger,
];

export const RULE_VERSIONS: Record<RuleId, string> = {
  'unpinned-uses': unpinnedUses.version,
  'excessive-permissions': excessivePermissions.version,
  'privileged-trigger-checkout': privilegedTriggerCheckout.version,
  'template-injection': templateInjection.version,
  'secrets-exposure': secretsExposure.version,
  'self-hosted-on-untrusted-trigger': selfHostedOnUntrustedTrigger.version,
};

export type { RawFinding, Rule } from './types';
