import type { FileResult } from '../core/scan';

function statusText(file: FileResult): string {
  if (file.status === 'complete') {
    const n = file.findings.length;
    return n === 0 ? 'reviewed — no findings from the six rules' : `reviewed — ${n} finding${n === 1 ? '' : 's'}`;
  }
  const line = file.errorLine !== undefined ? ` (line ${file.errorLine})` : '';
  return `not reviewed: ${file.reason ?? file.status}${line}`;
}

export function FileStatusList({ files }: { files: FileResult[] }) {
  return (
    <section className="panel">
      <h2>Files</h2>
      <ul className="file-status">
        {files.map((file) => (
          <li key={file.name} className={`status-${file.status}`}>
            <code>{file.name}</code> <span className={`status-label status-label-${file.status}`}>{statusText(file)}</span>
            <span className="muted small"> sha256 {file.fileHash.slice(0, 12)}</span>
            {file.coverageNotes.length > 0 && (
              <ul className="coverage-notes small">
                {file.coverageNotes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
