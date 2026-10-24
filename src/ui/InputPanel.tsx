import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { InputFile } from '../core/scan';
import { loadDemoSet } from '../lib/demo-fixtures';

interface InputPanelProps {
  files: InputFile[];
  errors: string[];
  scanning: boolean;
  disabled?: boolean;
  onFilesChange(files: InputFile[]): void;
  onScan(): void;
}

function nextPasteName(files: InputFile[]): string {
  let n = 1;
  while (files.some((f) => f.name === `pasted-${n}.yml`)) n += 1;
  return `pasted-${n}.yml`;
}

export function InputPanel({ files, errors, scanning, disabled = false, onFilesChange, onScan }: InputPanelProps) {
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const active = useRef(true);
  const locked = disabled || uploading;

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  function addPasted() {
    if (pasteText === '') return;
    const name = pasteName.trim() === '' ? nextPasteName(files) : pasteName.trim();
    onFilesChange([...files, { name, text: pasteText }]);
    setPasteName('');
    setPasteText('');
  }

  async function addUploads(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const list = input.files ? Array.from(input.files) : [];
    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await Promise.all(list.map(async (file) => ({ name: file.name, text: await file.text() })));
      if (active.current && uploaded.length > 0) onFilesChange([...files, ...uploaded]);
    } catch (err) {
      if (active.current) setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      input.value = '';
      if (active.current) setUploading(false);
    }
  }

  return (
    <section className="panel">
      <h2>Workflows</h2>
      <div className="row">
        <button type="button" disabled={locked} onClick={() => onFilesChange(loadDemoSet())}>
          Load demo set
        </button>
        <label className="button-like">
          Upload .yml / .yaml
          <input
            type="file"
            accept=".yml,.yaml"
            multiple
            className="visually-hidden"
            disabled={locked}
            onChange={(e) => void addUploads(e)}
          />
        </label>
        <button type="button" onClick={() => onFilesChange([])} disabled={locked || files.length === 0}>
          Clear
        </button>
      </div>

      <div className="paste">
        <label>
          File name (optional)
          <input
            type="text"
            disabled={locked}
            value={pasteName}
            placeholder={nextPasteName(files)}
            onChange={(e) => setPasteName(e.target.value)}
          />
        </label>
        <label>
          Paste workflow YAML
          <textarea rows={8} disabled={locked} spellCheck={false} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
        </label>
        <button type="button" onClick={addPasted} disabled={locked || pasteText === ''}>
          Add pasted file
        </button>
      </div>

      {files.length > 0 && (
        <ul className="input-files">
          {files.map((file, index) => (
            <li key={`${index}:${file.name}`}>
              <code>{file.name}</code>
              <span className="muted small"> {new TextEncoder().encode(file.text).byteLength} bytes</span>
              <button
                type="button"
                className="link"
                disabled={locked}
                onClick={() => onFilesChange(files.filter((_, i) => i !== index))}
              >
                remove
              </button>
              <details className="workflow-editor">
                <summary>Edit workflow</summary>
                <label className="small">
                  YAML for {file.name}
                  <textarea
                    rows={10}
                    disabled={locked}
                    spellCheck={false}
                    value={file.text}
                    onChange={(event) => onFilesChange(files.map((existing, i) => i === index ? { ...existing, text: event.target.value } : existing))}
                  />
                </label>
                <p className="small muted">Edits clear the current results. Scan again; prior rulings for a changed file need review.</p>
              </details>
            </li>
          ))}
        </ul>
      )}

      {uploadError !== null && <p role="alert">Could not read upload: {uploadError}</p>}

      {errors.length > 0 && (
        <ul className="input-errors" role="alert">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}

      <button type="button" className="primary" onClick={onScan} disabled={locked || files.length === 0 || scanning}>
        {scanning ? 'Scanning…' : 'Scan'}
      </button>
    </section>
  );
}
