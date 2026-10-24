import type { Finding, RuleId } from '../core/finding';
import type { FileResult } from '../core/scan';
import type { FixView, RulingDecision, RulingStatus } from '../lib/review';
import { FindingCard, GATE_LABEL } from './FindingCard';

const WORKFLOW_LEVEL = '(workflow level)';

/** Groups an already-sorted finding list by job, then rule, keeping first-seen order. */
function groupByJobAndRule(findings: Finding[]): Map<string, Map<RuleId, Finding[]>> {
  const jobs = new Map<string, Map<RuleId, Finding[]>>();
  for (const finding of findings) {
    const jobKey = finding.jobId ?? WORKFLOW_LEVEL;
    let rules = jobs.get(jobKey);
    if (!rules) {
      rules = new Map();
      jobs.set(jobKey, rules);
    }
    const list = rules.get(finding.rule);
    if (list) list.push(finding);
    else rules.set(finding.rule, [finding]);
  }
  return jobs;
}

interface FindingListProps {
  files: FileResult[];
  fixes: Map<string, FixView>;
  likelyBenign: Set<string>;
  rulings: Map<string, RulingStatus>;
  disabled: boolean;
  onRule(finding: Finding, decision: RulingDecision, reason: string | undefined): void;
}

export function FindingList({ files, fixes, likelyBenign, rulings, disabled, onRule }: FindingListProps) {
  const count = files.reduce((sum, file) => sum + file.findings.length, 0);
  const benignCount = files.reduce((sum, file) => sum + file.findings.filter((finding) => likelyBenign.has(finding.id)).length, 0);

  function groups(benign: boolean) {
    return files.map((file) => ({ ...file, findings: file.findings.filter((finding) => likelyBenign.has(finding.id) === benign) }))
      .filter((file) => file.findings.length > 0).map((file) => (
        <div key={file.name} className="group-file">
          <h3><code>{file.name}</code></h3>
          {[...groupByJobAndRule(file.findings)].map(([jobKey, rules]) => (
            <div key={jobKey} className="group-job">
              <h4>{jobKey === WORKFLOW_LEVEL ? jobKey : `job: ${jobKey}`}</h4>
              {[...rules].map(([rule, findings]) => (
                <div key={rule} className="group-rule">
                  <h5>{rule} <span className="muted">({findings.length})</span></h5>
                  {findings.map((finding) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      fix={fixes.get(finding.id)}
                      ruling={rulings.get(finding.id)}
                      rulingDisabled={disabled}
                      onRule={onRule}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ));
  }

  return (
    <section className="panel">
      <h2>Findings ({count})</h2>
      {count === 0 && <p className="muted">No findings in the files successfully reviewed by these six rules. Check file statuses for errors or unsupported files.</p>}
      {groups(false)}
      {benignCount > 0 && (
        <details className="benign-group">
          <summary>Likely benign ({benignCount})</summary>
          <p className="muted small">{GATE_LABEL}. These findings retain their original severity.</p>
          {groups(true)}
        </details>
      )}
    </section>
  );
}
