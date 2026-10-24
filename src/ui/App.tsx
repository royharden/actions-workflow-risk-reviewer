import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scan, validateInputs, type InputFile } from '../core/scan';
import type { RulingEvent } from '../core/rulings';
import type { Finding } from '../core/finding';
import { webCryptoHasher } from '../lib/hasher-webcrypto';
import { getMode, type AppMode } from '../lib/mode';
import type { CombinedTriage } from '../core/combine';
import { createBrowserExplanationSession } from '../lib/explanations';
import { newEventId } from '../lib/download';
import { createLocalRepository } from '../lib/storage/local';
import { createSupabaseRepository, reviewDatabase } from '../lib/storage/supabase';
import { getSupabase } from '../lib/supabase';
import { fixSetupFor, makeRulingEvent, resolveRulings, reviewScan, type ReviewedScan, type RulingDecision } from '../lib/review';
import { SetupBanner } from './SetupBanner';
import { InputPanel } from './InputPanel';
import { FileStatusList } from './FileStatusList';
import { FindingList } from './FindingList';
import { ExportBar } from './ExportBar';
import { AuthGate } from './AuthGate';
import { clearExplanationConsents } from './ConsentDialog';
import { EvalTab } from './EvalTab';

export function App() {
  const mode = useMemo(() => getMode(), []);
  const [tab, setTab] = useState<'review' | 'evaluation'>('review');
  return (
    <div className="app">
      <header className="app-header">
        <h1>GitHub Actions Workflow Risk Reviewer</h1>
        <p className="muted">Six deterministic rules over workflow YAML, run in this browser.</p>
      </header>
      <SetupBanner mode={mode} />
      <nav aria-label="Workbench views">
        <button type="button" aria-pressed={tab === 'review'} onClick={() => setTab('review')}>Review workflows</button>
        <button type="button" aria-pressed={tab === 'evaluation'} onClick={() => setTab('evaluation')}>Evaluation</button>
      </nav>
      <div hidden={tab !== 'review'}>
      <AuthGate mode={mode}>
        {(session) => <ReviewWorkbench key={mode.kind === 'demo' ? 'demo' : session?.user.id ?? 'signed-out'} mode={mode} userId={session?.user.id ?? null} />}
      </AuthGate>
      </div>
      <div hidden={tab !== 'evaluation'}><EvalTab /></div>
    </div>
  );
}

/** Identity-keyed by AuthGate: account changes synchronously remove the old review screen. */
function ReviewWorkbench({ mode, userId }: { mode: AppMode; userId: string | null }) {
  const remoteRepository = useMemo(() => {
    if (mode.kind !== 'live' || userId === null) return null;
    const client = getSupabase();
    return client === null ? null : createSupabaseRepository(reviewDatabase(client), userId);
  }, [mode, userId]);
  const repository = useMemo(() => mode.kind === 'demo' ? createLocalRepository() : remoteRepository, [mode, remoteRepository]);
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
        if (mode.kind === 'live' && scanned.inputErrors.length === 0) {
          try {
            if (remoteRepository === null) throw new Error('Live review storage is unavailable.');
            const savedRunId = await remoteRepository.saveScan(next.scan);
            if (active.current && revision.current === currentRevision) setRunId(savedRunId);
          } catch (err) {
            if (active.current && revision.current === currentRevision) setRunFailure(err instanceof Error ? err.message : String(err));
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
    if (storageBusy.current || busy || reviewed === null || repository === null || (mode.kind === 'live' && runId === null)) return;
    const currentRevision = revision.current;
    const fix = reviewed.fixes.get(finding.id);
    if ((decision === 'accept_fix' || decision === 'reject_fix') && fix?.kind !== 'passed') return;
    storageBusy.current = true;
    setSaving(true);
    setStorageFailure(null);
    try {
      await repository.appendRuling(makeRulingEvent(newEventId(), finding, decision, fix, reason));
      if (!active.current || revision.current !== currentRevision) return;
      const stored = await repository.listRulings();
      if (active.current && revision.current === currentRevision) { setEvents(stored); setStorageNote(repository.note()); }
    } catch (err) {
      if (active.current && revision.current === currentRevision) setStorageFailure(err instanceof Error ? err.message : String(err));
    } finally {
      storageBusy.current = false;
      if (active.current) setSaving(false);
    }
  }

  async function reloadRulings() {
    if (storageBusy.current || busy || repository === null) return;
    storageBusy.current = true;
    setLoadingRulings(true);
    setStorageFailure(null);
    try {
      const stored = await repository.listRulings();
      if (active.current) { setEvents(stored); setStorageNote(repository.note()); }
    } catch (err) {
      if (active.current) setStorageFailure(err instanceof Error ? err.message : String(err));
    } finally {
      storageBusy.current = false;
      if (active.current) setLoadingRulings(false);
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
      // Remote events remain server history and can replay on the next scan; no local rulings persist in live mode.
      if (repository?.persistence() !== 'remote') setEvents([]);
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
            <span className="small muted">{loadingRulings ? 'Loading rulings…' : repository?.persistence() === 'remote' ? 'Rulings are saved to your signed-in account.' : repository !== null ? 'Rulings stay in this browser until cleared.' : 'Live rulings are currently unavailable.'}</span>
            <button type="button" disabled={busy || repository === null} onClick={() => void reloadRulings()}>Reload rulings</button>
            <button type="button" disabled={busy} onClick={() => void clearLocalData()}>Clear local data</button>
          </div>
          <p className="small muted">Clears stored local rulings, explanation consent, and this tab’s workflow inputs and results. Saved live runs, findings and append-only rulings remain in your account.</p>
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
        {runFailure !== null && <section className="panel error-panel" role="alert">Live rulings and explanations are unavailable because the review snapshot could not be saved: <code>{runFailure}</code>. No model call was made. Scan again to retry saving.</section>}
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
              rulingDisabled={repository === null || (mode.kind === 'live' && runId === null)}
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
