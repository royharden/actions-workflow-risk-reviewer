import { useMemo, useState } from 'react';
import { scan, validateInputs, type InputFile, type ScanResult } from '../core/scan';
import { webCryptoHasher } from '../lib/hasher-webcrypto';
import { getMode } from '../lib/mode';
import { SetupBanner } from './SetupBanner';
import { InputPanel } from './InputPanel';
import { FileStatusList } from './FileStatusList';
import { FindingList } from './FindingList';

export function App() {
  const mode = useMemo(() => getMode(), []);
  const [files, setFiles] = useState<InputFile[]>([]);
  const [inputErrors, setInputErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanFailure, setScanFailure] = useState<string | null>(null);

  function updateFiles(next: InputFile[]) {
    setFiles(next);
    setInputErrors([]);
    setResult(null);
    setScanFailure(null);
  }

  async function runScan() {
    const errors = validateInputs(files);
    setInputErrors(errors);
    setResult(null);
    setScanFailure(null);
    if (errors.length > 0) return;
    setScanning(true);
    try {
      const scanned = await scan(files, webCryptoHasher);
      setResult(scanned);
      setInputErrors(scanned.inputErrors);
    } catch (err) {
      setScanFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
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
        <InputPanel
          files={files}
          errors={inputErrors}
          scanning={scanning}
          onFilesChange={updateFiles}
          onScan={() => void runScan()}
        />
        {scanFailure !== null && (
          <section className="panel error-panel" role="alert">
            <h2>Scan failed</h2>
            <p>{scanFailure}</p>
          </section>
        )}
        {result !== null && (
          <>
            <FileStatusList files={result.files} />
            <FindingList files={result.files} />
            <footer className="muted small">
              App {result.appVersion} · rules{' '}
              {Object.entries(result.ruleVersions)
                .map(([rule, version]) => `${rule}@${version}`)
                .join(', ')}
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
