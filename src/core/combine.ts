import type { Finding } from './finding';
import type { CitationResult } from './cited/check';
import type { TriageLabel } from './cited/schema';

export interface CombinedTriage {
  gatesOnly: TriageLabel;
  modelOnly: TriageLabel | null;
  final: TriageLabel;
  source: 'rules' | 'gate' | 'model' | 'gate+model' | 'unsupported';
}

/** PLAN D10: an invalid requested answer forces unsure, even when a gate demotes. */
export function combine(finding: Finding, requested: boolean, answer?: CitationResult): CombinedTriage {
  const gate = finding.facts.gateEvidence.length > 0;
  const gatesOnly = gate ? 'likely_benign' : 'confirmed';
  if (!requested) return { gatesOnly, modelOnly: null, final: gatesOnly, source: gate ? 'gate' : 'rules' };
  if (!answer?.supported) return { gatesOnly, modelOnly: 'unsure', final: 'unsure', source: 'unsupported' };
  const label = answer.output.triage;
  const final = gate && label === 'confirmed' ? 'unsure' : label;
  return { gatesOnly, modelOnly: label, final, source: gate ? 'gate+model' : 'model' };
}
