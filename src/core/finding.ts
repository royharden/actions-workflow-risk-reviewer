export type RuleId =
  | 'unpinned-uses'
  | 'excessive-permissions'
  | 'privileged-trigger-checkout'
  | 'template-injection'
  | 'secrets-exposure'
  | 'self-hosted-on-untrusted-trigger';

export const RULE_IDS: readonly RuleId[] = [
  'unpinned-uses',
  'excessive-permissions',
  'privileged-trigger-checkout',
  'template-injection',
  'secrets-exposure',
  'self-hosted-on-untrusted-trigger',
];

export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** 1-based lines and columns; lines inclusive. endCol is the column of the last character. */
export interface Span {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface GateEvidence {
  gate: string;
  line: number;
  text: string;
}

export interface Facts {
  triggers: string[];
  forkReachable: boolean;
  privileged: boolean;
  refClass?: 'pr_head' | 'base' | 'unknown'; // privileged-trigger-checkout
  executesCheckedOutCode?: boolean;
  contextClass?: 'attacker_controlled' | 'maintainer_controlled'; // template-injection
  expression?: string;
  sink?: 'run' | 'github-script';
  usesRef?: string;
  refKind?: 'tag_or_branch' | 'short_sha' | 'non_hex' | 'docker_tag';
  permissionCause?: 'missing' | 'write-all' | 'write-scope';
  scope?: string;
  secretsCause?: 'inherit' | 'workflow-env' | 'persisted-checkout-upload';
  callee?: string;
  runnerLabels?: string[];
  gateEvidence: GateEvidence[]; // filled by M2 gates; M1 leaves []
  aliased?: boolean; // finding reached through an alias
  detail: string; // one human sentence
}

export interface Finding {
  id: string;
  fingerprint: string;
  occurrence: string;
  rule: RuleId;
  ruleVersion: string;
  severity: Severity;
  file: string;
  fileHash: string;
  jobId: string | null;
  stepKey: string | null;
  stepIndex: number | null;
  span: Span;
  snippet: string;
  facts: Facts;
}
