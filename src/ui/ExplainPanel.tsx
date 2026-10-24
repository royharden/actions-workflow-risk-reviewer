import { useEffect, useRef, useState } from 'react';
import type { Finding } from '../core/finding';
import type { InputFile } from '../core/scan';
import { combine, type CombinedTriage } from '../core/combine';
import type { AppMode } from '../lib/mode';
import type { ExplanationOutcome, ExplanationSession } from '../lib/explanations';
import { ConsentDialog, readExplanationConsent, type ConsentReceipt } from './ConsentDialog';
import { CitationView } from './CitationView';

export interface ExplainPanelProps {
  finding: Finding;
  source: InputFile;
  mode: AppMode;
  userId: string | null;
  /** A real owned run, created once for the scan before enabling live Explain. Demo uses null. */
  runId: string | null;
  /** Share one controller across the screen; its queue serializes all finding requests. */
  explanations: ExplanationSession;
  disabled?: boolean;
  onTriage?(findingId: string, triage: CombinedTriage): void;
}

export function ExplainPanel({ finding, source, mode, userId, runId, explanations, disabled = false, onTriage }: ExplainPanelProps) {
  const scope = JSON.stringify([finding.id, userId, runId, mode.kind]);
  const [storedAnswer, setAnswer] = useState<{ scope: string; sourceText: string; value: ExplanationOutcome } | null>(null);
  // Hide old-account/file answers during render, before the reset effect gets a chance to run.
  const answer = storedAnswer?.scope === scope && storedAnswer.sourceText === source.text ? storedAnswer.value : explanations.peek({ finding, userId, runId });
  const [busy, setBusy] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentNote, setConsentNote] = useState<string | null>(null);
  const generation = useRef(0);
  const working = useRef(false);
  const onTriageRef = useRef(onTriage);
  onTriageRef.current = onTriage;

  useEffect(() => {
    generation.current += 1;
    working.current = false;
    setAnswer(null); setBusy(false); setConsentOpen(false); setConsentNote(null);
    const replay = explanations.peek({ finding, userId, runId });
    onTriageRef.current?.(finding.id, replay?.triage ?? combine(finding, false));
    return () => { generation.current += 1; };
  }, [finding.id, finding.fileHash, source.text, userId, runId, mode.kind, explanations]);

  async function explain(consented: boolean) {
    if (disabled || working.current || answer !== null) return;
    const epoch = generation.current;
    working.current = true;
    setBusy(true); setConsentOpen(false);
    try {
      const result = await explanations.explain({ finding, source, userId, runId, consented });
      if (epoch !== generation.current) return;
      setAnswer({ scope, sourceText: source.text, value: result }); onTriageRef.current?.(finding.id, result.triage);
    } catch {
      if (epoch !== generation.current) return;
      const reason = 'explanation_failed_no_retry';
      const result: ExplanationOutcome = { status: 'unsupported', reason, origin: mode.kind === 'demo' ? 'hand-written' : 'live', triage: combine(finding, true, { supported: false, reason }) };
      setAnswer({ scope, sourceText: source.text, value: result }); onTriageRef.current?.(finding.id, result.triage);
    } finally {
      if (epoch === generation.current) { working.current = false; setBusy(false); }
    }
  }

  function requestExplanation() {
    if (mode.kind === 'demo') { void explain(false); return; }
    if (mode.kind !== 'live' || !userId || !runId) return;
    const stored = readExplanationConsent(userId);
    setConsentNote(stored.receipt.note);
    if (stored.granted) void explain(true);
    else setConsentOpen(true);
  }

  function consented(receipt: ConsentReceipt) {
    setConsentNote(receipt.note);
    void explain(true);
  }

  const triage = answer?.triage ?? combine(finding, false);
  const unavailable = mode.kind === 'setup-error' || (mode.kind === 'live' && (!userId || !runId));
  return (
    <div className="explain-panel">
      <p className="small"><strong>Triage: {triage.final.replace('_', ' ')}</strong> · source: {triage.source}{answer !== null && ` · ${answer.origin === 'hand-written' ? 'hand-written simulated example' : 'live model'}`}</p>
      <button type="button" disabled={disabled || busy || unavailable || answer !== null || consentOpen} onClick={requestExplanation}>{busy ? 'Explaining…' : mode.kind === 'demo' ? 'Show example explanation' : 'Explain'}</button>
      {mode.kind === 'live' && !userId && <p className="small muted">Sign in before requesting a live explanation.</p>}
      {mode.kind === 'live' && userId && !runId && <p className="small muted">A saved review run is required before requesting a live explanation.</p>}
      {mode.kind === 'setup-error' && <p className="small" role="alert">Explanation unavailable: live configuration needs attention.</p>}
      {consentNote !== null && <p className="small" role="status">{consentNote}</p>}
      {consentOpen && userId && <ConsentDialog userId={userId} onConsent={consented} onCancel={() => setConsentOpen(false)} />}
      {answer?.status === 'unsupported' && <p className="small" role="status">Unsupported → unsure: <code>{answer.reason}</code>. The explanation is hidden.</p>}
      {answer?.status === 'supported' && <><p className="small muted">{answer.model} · prompt {answer.promptVersion}{answer.origin === 'live' ? ` · price-table date ${answer.priceVerifiedOn}` : ' · simulated example; no cost measurement'}</p><CitationView output={answer.output} excerptLines={answer.excerptLines} /></>}
    </div>
  );
}
