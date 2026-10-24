import { checkCitations } from '../cited/check';
import { combine } from '../combine';
import type { Finding } from '../finding';
import { wasAttempted, type LiveOutcome, type LiveOmission } from './live';
import type { TriageObservation } from './metrics';

export interface PairedLiveTriage {
  cohortPredictionIds: string[]; gatesOnly: TriageObservation[]; modelOnly: TriageObservation[]; final: TriageObservation[];
  supported: number; unsupported: number; omissions: LiveOmission[];
}
/** All dispatched requests share one cohort; absent/invalid answers are requested=true and therefore unsure under D10. */
export function pairedLiveTriage(findings: Finding[], outcomes: LiveOutcome[]): PairedLiveTriage {
  if (new Set(findings.map((finding) => finding.id)).size !== findings.length || outcomes.length !== findings.length ||
    outcomes.some((outcome, index) => outcome.findingId !== findings[index].id)) throw new Error('Live triage finding scope/order mismatch');
  const paired: PairedLiveTriage = { cohortPredictionIds: [], gatesOnly: [], modelOnly: [], final: [], supported: 0, unsupported: 0, omissions: [] };
  for (let index = 0; index < outcomes.length; index++) {
    const outcome = outcomes[index]; const finding = findings[index];
    if (outcome.state !== 'returned') paired.omissions.push(outcome);
    if (!wasAttempted(outcome)) continue;
    const checked = outcome.state === 'returned' ? checkCitations(outcome.response.rawText, outcome.request.excerptLines) : undefined;
    if (checked) { if (checked.supported) paired.supported++; else paired.unsupported++; }
    const combined = combine(finding, true, checked);
    paired.cohortPredictionIds.push(finding.id);
    paired.gatesOnly.push({ predictionId: finding.id, label: combined.gatesOnly });
    paired.modelOnly.push({ predictionId: finding.id, label: combined.modelOnly ?? 'unsure' });
    paired.final.push({ predictionId: finding.id, label: combined.final });
  }
  return paired;
}
