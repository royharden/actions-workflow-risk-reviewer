import type { Finding, RuleId } from '../finding';
import type { Workflow } from '../model';

/** What a rule emits; scan.ts adds id, fingerprint, fileHash, severity, ruleVersion, file and the occurrence ordinal. */
export type RawFinding = Omit<Finding, 'id' | 'fingerprint' | 'fileHash' | 'severity' | 'ruleVersion' | 'file'>;

export interface Rule {
  id: RuleId;
  version: string;
  apply(wf: Workflow): RawFinding[];
}
