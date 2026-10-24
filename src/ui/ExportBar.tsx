import { useEffect, useRef, useState } from 'react';
import type { Hasher } from '../core/hash';
import type { InputFile } from '../core/scan';
import { downloadText } from '../lib/download';
import {
  acceptedFixIds, aggregatePatch, findingsJsonText, reasonText, reportWithAggregate, singlePatchFileName,
  type AggregateResult, type FixSetup, type ReviewedScan, type ResolvedRulings,
} from '../lib/review';
import { FIX_PASSED_LABEL } from './DiffView';

interface ExportBarProps {
  sources: InputFile[];
  reviewed: ReviewedScan;
  rulings: ResolvedRulings;
  setup: FixSetup;
  hasher: Hasher;
  disabled: boolean;
  onBusyChange(busy: boolean): void;
}

export function ExportBar({ sources, reviewed, rulings, setup, hasher, disabled, onBusyChange }: ExportBarProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<AggregateResult | null>(null);
  const active = useRef(true);
  const working = useRef(false);
  const passed = [...reviewed.fixes].filter(([, fix]) => fix.kind === 'passed');
  const accepted = acceptedFixIds(rulings);
  const fixturePinsAccepted = accepted.some((id) => {
    const fix = reviewed.fixes.get(id);
    return fix?.kind === 'passed' && fix.fixtureOnlyPin;
  });

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; onBusyChange(false); };
  }, [onBusyChange]);

  useEffect(() => { setAggregate(null); setFailure(null); }, [reviewed, rulings]);

  async function exportFile(kind: 'report' | 'findings' | 'patch') {
    if (disabled || working.current) return;
    working.current = true;
    setBusy(true);
    onBusyChange(true);
    setFailure(null);
    try {
      if (kind === 'findings') {
        downloadText('findings.json', findingsJsonText(reviewed, rulings));
      } else {
        // D21: always reconstruct and re-check from these sources and current accepted rulings.
        const checked = await aggregatePatch(sources, reviewed, rulings, setup, hasher);
        if (!active.current) return;
        setAggregate(checked);
        if (kind === 'report') downloadText('report.md', reportWithAggregate(reviewed, rulings, checked));
        else downloadText('fixes.patch', checked.patch);
      }
    } catch (err) {
      if (active.current) setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      working.current = false;
      if (active.current) { setBusy(false); onBusyChange(false); }
    }
  }

  return (
    <section className="panel export-bar">
      <h2>Exports</h2>
      <p className="small muted">{accepted.length} accepted fix{accepted.length === 1 ? '' : 'es'}. The aggregate re-runs each fixer and checker in sequence before download. Review every patch before applying it.</p>
      {fixturePinsAccepted && <p className="small fix-warning">Accepted pin fixes use fabricated fixture-only SHAs. These downloads are demo artifacts and must not be applied to a real workflow.</p>}
      <div className="row">
        <button type="button" disabled={disabled || busy} onClick={() => void exportFile('report')}>Download report.md</button>
        <button type="button" disabled={disabled || busy} onClick={() => void exportFile('findings')}>Download findings.json</button>
        <button type="button" disabled={disabled || busy} onClick={() => void exportFile('patch')}>Download fixes.patch</button>
      </div>
      {busy && <p className="small" role="status">Preparing export…</p>}
      {failure !== null && <p role="alert">Export failed: {failure}</p>}
      {aggregate !== null && (
        <div className="aggregate-result small" role="status">
          <p>{aggregate.included.length} fix{aggregate.included.length === 1 ? '' : 'es'} included; {aggregate.excluded.length} excluded.</p>
          {aggregate.patch === '' && <p>No aggregate patch was produced.</p>}
          {aggregate.excluded.length > 0 && (
            <>
              <p>Excluded fixes remain available individually below when their original proposal passed the checker.</p>
              <ul>{aggregate.excluded.map((item) => <li key={item.findingId}><code>{item.findingId}</code>: {reasonText(item.reason)}</li>)}</ul>
            </>
          )}
        </div>
      )}
      {passed.length > 0 && (
        <details>
          <summary>Individual checked patches ({passed.length})</summary>
          <p className="small muted">Each individual patch {FIX_PASSED_LABEL}. Independent patches may conflict; do not concatenate them.</p>
          <ul className="single-patches">
            {passed.map(([id, fix]) => fix.kind === 'passed' && (
              <li key={id}>
                <button type="button" className="link small" disabled={disabled || busy} onClick={() => downloadText(singlePatchFileName(id), fix.patch)}>{singlePatchFileName(id)}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
