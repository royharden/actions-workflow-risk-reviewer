import type { Facts, RuleId, Severity } from './finding';

// PLAN D7: fixed policy labels. Severity never comes from a model or a gate.
export function severityFor(rule: RuleId, facts: Facts): Severity {
  switch (rule) {
    case 'unpinned-uses':
      return 'medium';
    case 'excessive-permissions':
      return 'high';
    case 'privileged-trigger-checkout':
      return 'critical';
    case 'template-injection':
      return facts.contextClass === 'maintainer_controlled' ? 'medium' : 'high';
    case 'secrets-exposure':
      return 'high';
    case 'self-hosted-on-untrusted-trigger':
      return 'high';
  }
}
