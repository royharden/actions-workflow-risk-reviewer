import type { Facts, Finding } from '../core/finding';

interface Chip {
  label: string;
  value: string;
}

/** Facts worth showing as chips; `detail` is rendered as a sentence and `gateEvidence` arrives with M2 gates. */
function factChips(facts: Facts): Chip[] {
  const chips: Chip[] = [];
  const add = (label: string, value: string | boolean | undefined) => {
    if (value !== undefined && value !== '') chips.push({ label, value: String(value) });
  };
  if (facts.triggers.length > 0) add('triggers', facts.triggers.join(', '));
  add('fork-reachable', facts.forkReachable);
  add('privileged', facts.privileged);
  add('ref', facts.refClass);
  add('runs checked-out code', facts.executesCheckedOutCode);
  add('context', facts.contextClass);
  add('expression', facts.expression);
  add('sink', facts.sink);
  add('uses', facts.usesRef);
  add('ref kind', facts.refKind);
  add('permissions', facts.permissionCause);
  add('scope', facts.scope);
  add('secrets', facts.secretsCause);
  add('callee', facts.callee);
  if (facts.runnerLabels && facts.runnerLabels.length > 0) add('runner', facts.runnerLabels.join(', '));
  if (facts.aliased) add('via alias', true);
  return chips;
}

export function FindingCard({ finding }: { finding: Finding }) {
  const { span } = finding;
  // Assumes the snippet's first line is span.startLine (core keeps snippet = the spanned source lines).
  const lines = finding.snippet.split('\n');
  const location =
    span.startLine === span.endLine ? `line ${span.startLine}` : `lines ${span.startLine}–${span.endLine}`;
  return (
    <article className="finding-card">
      <header className="finding-head">
        <span className={`severity severity-${finding.severity}`}>{finding.severity}</span>
        <strong>{finding.rule}</strong>
        <span className="muted small">
          {location}
          {finding.stepKey !== null && ` · step ${finding.stepKey}`}
        </span>
      </header>
      <p className="finding-detail">{finding.facts.detail}</p>
      <div className="snippet" role="figure" aria-label="Source lines">
        {lines.map((text, index) => (
          <div key={index} className="snippet-line">
            <span className="line-no">{span.startLine + index}</span>
            <code>{text}</code>
          </div>
        ))}
      </div>
      <ul className="chips">
        {factChips(finding.facts).map((chip) => (
          <li key={chip.label} className="chip">
            <span className="chip-label">{chip.label}</span> {chip.value}
          </li>
        ))}
      </ul>
      <p className="muted small">fingerprint {finding.fingerprint.slice(0, 12)}</p>
    </article>
  );
}
