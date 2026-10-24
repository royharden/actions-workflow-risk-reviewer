import type { Finding, RuleId } from '../core/finding';
import type { FileResult } from '../core/scan';
import { FindingCard } from './FindingCard';

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

export function FindingList({ files }: { files: FileResult[] }) {
  const withFindings = files.filter((file) => file.findings.length > 0);
  return (
    <section className="panel">
      <h2>Findings</h2>
      {withFindings.length === 0 && <p className="muted">No findings in the reviewed files.</p>}
      {withFindings.map((file) => (
        <div key={file.name} className="group-file">
          <h3>
            <code>{file.name}</code>
          </h3>
          {[...groupByJobAndRule(file.findings)].map(([jobKey, rules]) => (
            <div key={jobKey} className="group-job">
              <h4>{jobKey === WORKFLOW_LEVEL ? jobKey : `job: ${jobKey}`}</h4>
              {[...rules].map(([rule, findings]) => (
                <div key={rule} className="group-rule">
                  <h5>
                    {rule} <span className="muted">({findings.length})</span>
                  </h5>
                  {findings.map((finding) => (
                    <FindingCard key={finding.id} finding={finding} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
