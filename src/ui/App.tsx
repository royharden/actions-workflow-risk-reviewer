import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scan, validateInputs, type InputFile } from '../core/scan';
import type { RulingEvent } from '../core/rulings';
import type { Finding } from '../core/finding';
import { webCryptoHasher } from '../lib/hasher-webcrypto';
import { getMode, type AppMode } from '../lib/mode';
import type { CombinedTriage } from '../core/combine';
import { createBrowserExplanationSession } from '../lib/explanations';
import { createOwnedReviewRun } from '../lib/runs';
import { newEventId } from '../lib/download';
import { createLocalRepository } from '../lib/storage/local';
import { fixSetupFor, makeRulingEvent, resolveRulings, reviewScan, type ReviewedScan, type RulingDecision } from '../lib/review';
import { SetupBanner } from './SetupBanner';
import { InputPanel } from './InputPanel';
import { FileStatusList } from './FileStatusList';
import { FindingList } from './FindingList';
import { ExportBar } from './ExportBar';
import { AuthGate } from './AuthGate';
import { clearExplanationConsents } from './ConsentDialog';

export function App() {
  const mode = useMemo(() => getMode(), []);
  return (
    <div className="app">
      <header className="app-header">
        <h1>GitHub Actions Workflow Risk Reviewer</h1>
        <p className="muted">Six deterministic rules over workflow YAML, run in this browser.</p>
      </header>
      <SetupBanner mode={mode} />
      <AuthGate mode={mode}>
        {(session) => <ReviewWorkbench key={mode.kind === 'demo' ? 'demo' : session?.user.id ?? 'signed-out'} mode={mode} userId={session?.user.id ?? null} />}
      </AuthGate>
    </div>
  );
}

/** Identity-keyed by AuthGate: account changes synchronously remove the old review screen. */
function ReviewWorkbench({ mode, userId }: { mode: AppMode; userId: string | null }) {
  const repository = useMemo(() => mode.kind === 'demo' ? createLocalRepository() : null, [mode]);
  const explanations = useMemo(() => {
    const controller = createBrowserExplanationSession(mode, webCryptoHasher);
    controller.setUser(userId);
    return controller;
  }, [mode, userId]);
  const fixSetup = useMemo(() => fixSetupFor(mode), [mode]);
  const [files, setFiles] = useState<InputFile[]>([]);
  const [inputEpoch, setInputEpoch] = useState(0);
  const [inputErrors, setInputErrors] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState<ReviewedScan | null>(null);
  const [events, setEvents] = useState<RulingEvent[]>([]);
  const [storageNote, setStorageNote] = useState<string | null>(repository?.note() ?? null);
  const [storageFailure, setStorageFailure] = useState<string | null>(null);
  const [loadingRulings, setLoadingRulings] = useState(repository !== null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanFailure, setScanFailure] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runFailure, setRunFailure] = useState<string | null>(null);
  const [triages, setTriages] = useState<Map<string, CombinedTriage>>(() => new Map());
  const revision = useRef(0);
  const active = useRef(true);
  const storageBusy = useRef(false);
  const rulings = useMemo(() => reviewed === null ? null : resolveRulings(events, reviewed), [events, reviewed]);
  const busy = scanning || saving || exporting || loadingRulings;

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; revision.current += 1; explanations.clear(); };
  }, [explanations]);

  const recordTriage = useCallback((findingId: string, triage: CombinedTriage) => {
    if (!active.current) return;
    setTriages((current) => {
      const old = current.get(findingId);
      if (old?.final === triage.final && old.gatesOnly === triage.gatesOnly && old.modelOnly === triage.modelOnly && old.source === triage.source) return current;
      return new Map(current).set(findingId, triage);
    });
  }, []);

  useEffect(() => {
    let active = true;
    if (repository === null) { setEvents([]); setLoadingRulings(false); return; }
    void repository.listRulings().then((stored) => {
      if (active) {
        setEvents(stored);
        setStorageNote(repository.note());
      }
    }).catch((err: unknown) => {
      if (active) setStorageFailure(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (active) setLoadingRulings(false);
    });
    return () => { active = false; };
  }, [repository]);

  function updateFiles(next: InputFile[]) {
    revision.current += 1;
    explanations.clear();
    setTriages(new Map());
    setRunId(null); setRunFailure(null);
    setScanning(false);
    setFiles(next);
    setInputErrors([]);
    setReviewed(null);
    setScanFailure(null);
  }

  async function runScan() {
    if (busy) return;
    const currentRevision = revision.current;
    const sources = files.map((file) => ({ ...file }));
    const errors = validateInputs(files);
    setInputErrors(errors);
    setReviewed(null);
    explanations.clear(); setTriages(new Map()); setRunId(null); setRunFailure(null);
    setScanFailure(null);
    if (errors.length > 0) return;
    setScanning(true);
    try {
      const scanned = await scan(sources, webCryptoHasher);
      const next = await reviewScan(sources, scanned, fixSetup, webCryptoHasher);
      if (active.current && revision.current === currentRevision) {
        setReviewed(next);
        setInputErrors(scanned.inputErrors);
        if (mode.kind === 'live' && userId !== null && scanned.inputErrors.length === 0) {
          const ownedRun = await createOwnedReviewRun(userId, next.scan);
          if (active.current && revision.current === currentRevision) {
            if (ownedRun.ok) setRunId(ownedRun.runId);
            else setRunFailure(ownedRun.reason);
          }
        }
      }
    } catch (err) {
      if (active.current && revision.current === currentRevision) setScanFailure(err instanceof Error ? err.message : String(err));
    } finally {
      if (active.current && revision.current === currentRevision) setScanning(false);
    }
  }

  async function rule(finding: Finding, decision: RulingDecision, reason: string | undefined) {
    if (storageBusy.current || busy || reviewed === null || repository === null) return;
    const fix = reviewed.fixes.get(finding.id);
    if ((decision === 'accept_fix' || decision === 'reject_fix') && fix?.kind !== 'passed') return;
    storageBusy.current = true;
    setSaving(true);
    setStorageFailure(null);
    try {
      await repository.appendRuling(makeRulingEvent(newEventId(), finding, decision, fix, reason));
      const stored = await repository.listRulings();
      if (active.current) { setEvents(stored); setStorageNote(repository.note()); }
    } catch (err) {
      if (active.current) setStorageFailure(err instanceof Error ? err.message : String(err));
    } finally {
      storageBusy.current = false;
      if (active.current) setSaving(false);
    }
  }

  async function clearLocalData() {
    if (storageBusy.current || busy) return;
    storageBusy.current = true;
    setSaving(true);
    setStorageFailure(null);
    try {
      await repository?.clearAll();
      if (!active.current) return;
      const consent = clearExplanationConsents();
      setEvents([]);
      updateFiles([]);
      setInputEpoch((epoch) => epoch + 1);
      setStorageNote([repository?.note(), consent.note].filter(Boolean).join(' ') || null);
    } catch (err) {
      if (active.current) setStorageFailure(err instanceof Error ? err.message : String(err));
    } finally {
      storageBusy.current = false;
      if (active.current) setSaving(false);
    }
  }

  return (
      <main>
        <section className="panel local-data">
          <div className="row">
            <span className="small muted">{loadingRulings ? 'Loading local rulings…' : repository !== null ? 'Rulings stay in this browser until cleared.' : 'Live rulings are currently unavailable.'}</span>
            <button type="button" disabled={busy} onClick={() => void clearLocalData()}>Clear local data</button>
          </div>
          <p className="small muted">Clears stored local rulings, explanation consent, and this tab’s workflow inputs and results.</p>
          {storageNote !== null && <p className="storage-note small" role="status">{storageNote}</p>}
          {storageFailure !== null && <p className="input-errors" role="alert">Could not save or load rulings: {storageFailure}</p>}
        </section>
        <InputPanel
          key={inputEpoch}
          files={files}
          errors={inputErrors}
          scanning={scanning}
          disabled={busy}
          onFilesChange={updateFiles}
          onScan={() => void runScan()}
        />
        {scanFailure !== null && (
          <section className="panel error-panel" role="alert">
            <h2>Scan failed</h2>
            <p>{scanFailure}</p>
          </section>
        )}
        {runFailure !== null && <section className="panel error-panel" role="alert">Live explanation is unavailable because the review run could not be saved: <code>{runFailure}</code>. No model call was made.</section>}
        {reviewed !== null && rulings !== null && (
          <>
            <FileStatusList files={reviewed.scan.files} />
            <FindingList
              files={reviewed.scan.files}
              fixes={reviewed.fixes}
              likelyBenign={reviewed.likelyBenign}
              triages={triages}
              rulings={rulings.status}
              disabled={busy}
              rulingDisabled={repository === null}
              explanation={{ sources: files, mode, userId, runId, explanations, onTriage: recordTriage, disabled: busy }}
              onRule={(finding, decision, reason) => void rule(finding, decision, reason)}
            />
            <ExportBar sources={files} reviewed={reviewed} rulings={rulings} setup={fixSetup} hasher={webCryptoHasher} disabled={scanning || saving || loadingRulings} onBusyChange={setExporting} />
            <footer className="muted small">
              App {reviewed.scan.appVersion} · rules{' '}
              {Object.entries(reviewed.scan.ruleVersions)
                .map(([rule, version]) => `${rule}@${version}`)
                .join(', ')}
            </footer>
          </>
        )}
      </main>
  );
}
