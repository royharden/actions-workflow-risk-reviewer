import { downloadText } from '../lib/download';
import { singlePatchFileName, type FixView } from '../lib/review';

export const FIX_PASSED_LABEL = 'passes the six rules; behaviour unverified';

/** Header lines only count as headers before the first hunk, so a removed `--` line inside a hunk stays a deletion. */
function lineClasses(lines: string[]): string[] {
  let inHunk = false;
  return lines.map((line) => {
    if (line.startsWith('@@')) {
      inHunk = true;
      return 'diff-hunk';
    }
    if (!inHunk) return 'diff-file';
    if (line.startsWith('+')) return 'diff-add';
    if (line.startsWith('-')) return 'diff-del';
    if (line.startsWith('\\')) return 'diff-meta';
    return 'diff-ctx';
  });
}

/** A proposed fix: the unified diff (text rendered as React text, never HTML) or the refusal/rejection reason. */
export function DiffView({ findingId, fix }: { findingId: string; fix: FixView }) {
  if (fix.kind === 'refused') {
    return (
      <div className="fix fix-refused">
        <p className="small">
          <strong>No fix proposed</strong> — manual fix needed: <code>{fix.reason}</code>
        </p>
      </div>
    );
  }
  if (fix.kind === 'rejected') {
    return (
      <div className="fix fix-rejected">
        <p className="small">
          <strong>Candidate fix rejected by the patch checker:</strong>
        </p>
        <ul className="small">
          {fix.reasons.map((reason, index) => (
            <li key={index}>
              <code>{reason}</code>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const lines = fix.patch.replace(/\n$/, '').split('\n');
  const classes = lineClasses(lines);
  return (
    <div className="fix fix-passed">
      <p className="small">
        <span className="fix-label">{FIX_PASSED_LABEL}</span> <span className="muted">· {fix.fixer}</span>
      </p>
      {fix.description !== '' && <p className="small">{fix.description}</p>}
      {fix.fixtureOnlyPin && (
        <p className="small fix-warning">
          The pinned SHA comes from the fixture-only demo table (fabricated, never looked up); do not apply it to a real workflow.
        </p>
      )}
      <div className="diff" role="figure" aria-label="Proposed fix as a unified diff">
        {lines.map((line, index) => (
          <div key={index} className={`diff-line ${classes[index]}`}>
            <code>{line === '' ? ' ' : line}</code>
          </div>
        ))}
      </div>
      <button type="button" className="link small" onClick={() => downloadText(singlePatchFileName(findingId), fix.patch)}>
        Download {singlePatchFileName(findingId)}
      </button>
    </div>
  );
}
