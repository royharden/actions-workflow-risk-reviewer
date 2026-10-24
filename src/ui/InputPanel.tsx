import { useState, type ChangeEvent } from 'react';
import type { InputFile } from '../core/scan';
import { loadDemoSet } from '../lib/demo-fixtures';

interface InputPanelProps {
  files: InputFile[];
  errors: string[];
  scanning: boolean;
  onFilesChange(files: InputFile[]): void;
  onScan(): void;
}

function nextPasteName(files: InputFile[]): string {
  let n = 1;
  while (files.some((f) => f.name === `pasted-${n}.yml`)) n += 1;
  return `pasted-${n}.yml`;
}

export function InputPanel({ files, errors, scanning, onFilesChange, onScan }: InputPanelProps) {
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');

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
    const uploaded = await Promise.all(list.map(async (file) => ({ name: file.name, text: await file.text() })));
    input.value = '';
    if (uploaded.length > 0) onFilesChange([...files, ...uploaded]);
  }

  return (
    <section className="panel">
      <h2>Workflows</h2>
      <div className="row">
        <button type="button" onClick={() => onFilesChange(loadDemoSet())}>
          Load demo set
        </button>
        <label className="button-like">
          Upload .yml / .yaml
          <input
            type="file"
            accept=".yml,.yaml"
            multiple
            className="visually-hidden"
            onChange={(e) => void addUploads(e)}
          />
        </label>
        <button type="button" onClick={() => onFilesChange([])} disabled={files.length === 0}>
          Clear
        </button>
      </div>

      <div className="paste">
        <label>
          File name (optional)
          <input
            type="text"
            value={pasteName}
            placeholder={nextPasteName(files)}
            onChange={(e) => setPasteName(e.target.value)}
          />
        </label>
        <label>
          Paste workflow YAML
          <textarea rows={8} spellCheck={false} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
        </label>
        <button type="button" onClick={addPasted} disabled={pasteText === ''}>
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
                onClick={() => onFilesChange(files.filter((_, i) => i !== index))}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <ul className="input-errors" role="alert">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}

      <button type="button" className="primary" onClick={onScan} disabled={files.length === 0 || scanning}>
        {scanning ? 'Scanning…' : 'Scan'}
      </button>
    </section>
  );
}
