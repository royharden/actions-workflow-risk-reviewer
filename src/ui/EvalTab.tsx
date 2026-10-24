import pendingResults from '../../results/results.json';
import { formatRate, type EvaluationReport } from '../core/evalkit/report';

/** Renders committed evaluator artifacts only; opening this tab never runs scans or makes model calls. */
export function EvalTab({ report = pendingResults as unknown as EvaluationReport }: { report?: EvaluationReport }) {
  return <section aria-labelledby="evaluation-heading">
    <h2 id="evaluation-heading">Evaluation</h2>
    <p>{report.status === 'pending' ? 'Not yet measured. Source prepared; runtime unverified.' : `Generated ${report.generatedAt ?? '(date unavailable)'}.`}</p>
    <p>Small fixture sets do not establish real-world accuracy. Mapped rules differ in granularity. Triage preserves findings and severity.</p>
    <div className="table-scroll"><table><caption>Separate dev and held-out detection rows</caption>
      <thead><tr><th>Split</th><th>Method</th><th>Rule</th><th>TP / FP / FN</th><th>Precision</th><th>Recall</th><th>F1</th><th>Unmapped</th><th>Status</th></tr></thead>
      <tbody>{report.rows.map((row) => <tr key={`${row.split}:${row.tool}:${row.rule}`}>
        <td>{row.split}</td><td>{row.tool}</td><td>{row.rule}</td><td>{row.metrics ? `${row.metrics.tp} / ${row.metrics.fp} / ${row.metrics.fn}` : 'not yet measured'}</td>
        <td>{row.metrics ? formatRate(row.metrics.precision) : 'not yet measured'}</td><td>{row.metrics ? formatRate(row.metrics.recall) : 'not yet measured'}</td>
        <td>{row.metrics?.f1 === null || row.metrics?.f1 === undefined ? 'N/A' : row.metrics.f1.toFixed(3)}</td><td>{row.unmapped ?? '—'}</td><td>{row.status}</td>
      </tr>)}</tbody></table></div>
    <div className="table-scroll"><table><caption>Triage: k/n benign demoted; j/m positives wrongly demoted</caption>
      <thead><tr><th>Split</th><th>Method</th><th>Source</th><th>k/n</th><th>j/m</th><th>Omitted</th><th>Status</th></tr></thead>
      <tbody>{report.triage.map((row) => <tr key={`${row.split}:${row.method}`}><td>{row.split}</td><td>{row.method}</td><td>{row.provenance}</td>
        <td>{row.metrics ? formatRate(row.metrics.benignDemoted) : 'not yet measured'}</td><td>{row.metrics ? formatRate(row.metrics.positivesWronglyDemoted) : 'not yet measured'}</td>
        <td>{row.metrics?.omittedPredictionIds.join(', ') || '—'}</td><td>{row.status}</td></tr>)}</tbody></table></div>
    <details><summary>Fixes, citations, costs and named failures</summary>
      <p>{report.fixes.length ? report.fixes.map((row) => `${row.split}: ${row.produced} produced; ${row.passed} passed; rejected by checker ${JSON.stringify(row.rejectedByCheckerReason)}`).join(' · ') : 'Fixes produced / rejected by checker reason / passed: not yet measured.'}</p>
      {report.citations.map((row) => <p key={row.split}>{row.split} citations: {row.supported ?? 'not yet measured'} supported; {row.unsupported ?? 'not yet measured'} unsupported. {row.status}</p>)}
      {report.costs.map((row) => <p key={row.split}>{row.split} cost: {row.effectiveUsd ?? 'not yet measured'} USD/run; {row.perFindingUsd ?? 'not yet measured'} USD/charged finding (n={row.chargedFindingCount ?? 'not yet measured'}). Model {row.model ?? 'not yet measured'}; price date {row.priceVerifiedOn ?? 'unavailable'}. {row.status}</p>)}
      {report.namedFailures.length ? <ul>{report.namedFailures.map((row, index) => <li key={index}>{row.split} / {row.method} / {row.kind}: {row.ids.join(', ')}</li>)}</ul> : <p>{report.status === 'pending' ? 'Named failures: not yet measured.' : 'No named failures observed by this run.'}</p>}
    </details>
    <p>Separate human check: {report.humanCheck.status}. Inspect up to 20 passing fixes; keep human judgments out of automated counts.</p>
    <p>Hand-written examples and handmade baseline samples are excluded from measured rows. Citation support establishes lexical anchoring only. Passing fixes pass the six rules; behaviour remains unverified.</p>
  </section>;
}
