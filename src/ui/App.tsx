import { useEffect, useMemo, useRef, useState } from 'react';
import { scan, validateInputs, type InputFile } from '../core/scan';
import type { RulingEvent } from '../core/rulings';
import type { Finding } from '../core/finding';
import { webCryptoHasher } from '../lib/hasher-webcrypto';
import { getMode } from '../lib/mode';
import { newEventId } from '../lib/download';
import { createLocalRepository } from '../lib/storage/local';
import { fixSetupFor, makeRulingEvent, resolveRulings, reviewScan, type ReviewedScan, type RulingDecision } from '../lib/review';
import { SetupBanner } from './SetupBanner';
import { InputPanel } from './InputPanel';
import { FileStatusList } from './FileStatusList';
import { FindingList } from './FindingList';
import { ExportBar } from './ExportBar';

export function App() {
  const mode = useMemo(() => getMode(), []);
  const repository = useMemo(() => createLocalRepository(), []);
  const fixSetup = useMemo(() => fixSetupFor(mode), [mode]);
  const [files, setFiles] = useState<InputFile[]>([]);
  const [inputEpoch, setInputEpoch] = useState(0);
  const [inputErrors, setInputErrors] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState<ReviewedScan | null>(null);
  const [events, setEvents] = useState<RulingEvent[]>([]);
  const [storageNote, setStorageNote] = useState<string | null>(repository.note());
  const [storageFailure, setStorageFailure] = useState<string | null>(null);
  const [loadingRulings, setLoadingRulings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanFailure, setScanFailure] = useState<string | null>(null);
  const revision = useRef(0);
  const storageBusy = useRef(false);
  const rulings = useMemo(() => reviewed === null ? null : resolveRulings(events, reviewed), [events, reviewed]);
  const busy = scanning || saving || exporting || loadingRulings;

  useEffect(() => {
    let active = true;
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
    setScanFailure(null);
    if (errors.length > 0) return;
    setScanning(true);
    try {
      const scanned = await scan(sources, webCryptoHasher);
      const next = await reviewScan(sources, scanned, fixSetup, webCryptoHasher);
      if (revision.current === currentRevision) {
        setReviewed(next);
        setInputErrors(scanned.inputErrors);
      }
    } catch (err) {
      if (revision.current === currentRevision) setScanFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }

  async function rule(finding: Finding, decision: RulingDecision, reason: string | undefined) {
    if (storageBusy.current || busy || reviewed === null) return;
    const fix = reviewed.fixes.get(finding.id);
    if ((decision === 'accept_fix' || decision === 'reject_fix') && fix?.kind !== 'passed') return;
    storageBusy.current = true;
    setSaving(true);
    setStorageFailure(null);
    try {
      await repository.appendRuling(makeRulingEvent(newEventId(), finding, decision, fix, reason));
      setEvents(await repository.listRulings());
      setStorageNote(repository.note());
    } catch (err) {
      setStorageFailure(err instanceof Error ? err.message : String(err));
    } finally {
      storageBusy.current = false;
      setSaving(false);
    }
  }

  async function clearLocalData() {
    if (storageBusy.current || busy) return;
    storageBusy.current = true;
    setSaving(true);
    setStorageFailure(null);
    try {
      await repository.clearAll();
      setEvents([]);
      updateFiles([]);
      setInputEpoch((epoch) => epoch + 1);
      setStorageNote(repository.note());
    } catch (err) {
      setStorageFailure(err instanceof Error ? err.message : String(err));
    } finally {
      storageBusy.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>GitHub Actions Workflow Risk Reviewer</h1>
        <p className="muted">Six deterministic rules over workflow YAML, run in this browser.</p>
      </header>
      <SetupBanner mode={mode} />
      <main>
        <section className="panel local-data">
          <div className="row">
            <span className="small muted">{loadingRulings ? 'Loading local rulings…' : 'Rulings stay in this browser until cleared.'}</span>
            <button type="button" disabled={busy} onClick={() => void clearLocalData()}>Clear local data</button>
          </div>
          <p className="small muted">Clears stored rulings and this tab’s workflow inputs and results.</p>
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
        {reviewed !== null && rulings !== null && (
          <>
            <FileStatusList files={reviewed.scan.files} />
            <FindingList
              files={reviewed.scan.files}
              fixes={reviewed.fixes}
              likelyBenign={reviewed.likelyBenign}
              rulings={rulings.status}
              disabled={busy}
              onRule={(finding, decision, reason) => void rule(finding, decision, reason)}
            />
            <ExportBar sources={files} reviewed={reviewed} rulings={rulings} setup={fixSetup} hasher={webCryptoHasher} disabled={saving || loadingRulings} onBusyChange={setExporting} />
            <footer className="muted small">
              App {reviewed.scan.appVersion} · rules{' '}
              {Object.entries(reviewed.scan.ruleVersions)
                .map(([rule, version]) => `${rule}@${version}`)
                .join(', ')}
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
