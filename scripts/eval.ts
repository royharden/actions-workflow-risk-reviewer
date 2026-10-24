// Offline by default. Source prepared under Dirty Mode; no measurements have been executed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { RULE_IDS } from '../src/core/finding';
import { APP_VERSION } from '../src/core/version';
import { RULE_VERSIONS } from '../src/core/rules';
import { scanText, type FileResult } from '../src/core/scan';
import { parseWorkflow } from '../src/core/parse';
import { applyGates } from '../src/core/gates';
import { combine } from '../src/core/combine';
import { buildExplainRequest, explanationCacheKey } from '../src/core/cited/prompt';
import { fixerFor, proposeFix } from '../src/core/fixers';
import { check } from '../src/core/patchcheck/check';
import { manifestSchema, type Manifest, type Split } from '../src/core/evalkit/manifest';
import { match, type Prediction } from '../src/core/evalkit/match';
import { metrics, triageMetrics } from '../src/core/evalkit/metrics';
import { canonicalJson, baselineConfigSchema, validateBaseline } from '../src/core/evalkit/provenance';
import { mappingSchema, type Adapted, type Tool } from '../src/core/evalkit/adapters/types';
import { adaptZizmor } from '../src/core/evalkit/adapters/zizmor';
import { adaptPoutine } from '../src/core/evalkit/adapters/poutine';
import { effectiveCharge, validateLiveCache, wasAttempted, type LiveCache } from '../src/core/evalkit/live';
import { pairedLiveTriage } from '../src/core/evalkit/triage';
import { renderReport, type EvaluationReport } from '../src/core/evalkit/report';
import { PRICES, lookupVerifiedPrice } from '../supabase/functions/explain-finding/pricing';
import { PROMPT_VERSION } from '../supabase/functions/explain-finding/prompt';
import pins from '../fixtures/pins.json';
import { hasherNode } from './hasher-node';
import { runLive } from './live-client';

const splits: Split[] = ['dev', 'heldout'];
const baselineSpecs: { tool: Tool; persona: string; name: string }[] = [
  { tool: 'zizmor', persona: 'regular', name: 'zizmor (regular)' },
  { tool: 'zizmor', persona: 'pedantic', name: 'zizmor (pedantic)' },
  { tool: 'poutine', persona: 'default', name: 'poutine' },
];
const metadataSchema = z.object({ schemaVersion: z.literal(1), status: z.enum(['pending', 'recorded']), note: z.string(), runs: z.array(z.object({
  tool: z.enum(['zizmor', 'poutine']), split: z.enum(['dev', 'heldout']), persona: z.string(), config: z.unknown().nullable(), receipt: z.unknown().nullable(),
}).strict()) }).strict();
function jsonFile(path: string): unknown { return JSON.parse(readFileSync(resolve(path), 'utf8')); }
function increment(counts: Record<string, number>, reason: string): void { counts[reason] = (counts[reason] ?? 0) + 1; }
function canonicalHeldout(manifest: Manifest): string {
  const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  // Exactly the committed heldout.lock/check-manifest key and sort order; never includes workflow contents.
  return JSON.stringify(manifest.items.filter((item) => item.split === 'heldout').map((item) => ({
    file: item.file, split: item.split, rule: item.rule, jobId: item.jobId, stepIndex: item.stepIndex,
    span: { startLine: item.span.startLine, endLine: item.span.endLine }, label: item.label, trap: item.trap, gate: item.gate, note: item.note,
  })).sort((a, b) => cmp(a.file, b.file) || a.span.startLine - b.span.startLine || cmp(a.rule, b.rule) || cmp(a.jobId ?? '', b.jobId ?? '') || cmp(a.label, b.label)));
}
function pendingTriage(report: EvaluationReport, split: Split, status: string, ids: string[]): void {
  for (const method of ['gates (paired)', 'model only (cached)', 'gates+model (cached)']) report.triage.push({ split, method, provenance: 'cached-live', status, metrics: null });
  report.citations.push({ split, source: 'cached-live', status, supported: null, unsupported: null, omittedFindingIds: ids });
  report.costs.push({ split, status, runId: null, model: null, priceVerifiedOn: null, priceSource: 'server-response paired with ledger',
    effectiveUsd: null, perFindingUsd: null, chargedFindingCount: null, omitted: ids.map((findingId) => ({ findingId, state: 'not_measured', reason: status })) });
}

export async function evaluate(args: string[] = process.argv.slice(2)): Promise<EvaluationReport> {
  let live = false; let liveSplit: Split = 'heldout'; let capUsd = 1;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--live') live = true;
    else if (args[index] === '--live-split' && ['dev', 'heldout'].includes(args[index + 1])) liveSplit = args[++index] as Split;
    else if (args[index] === '--cap-usd') capUsd = Number(args[++index]);
    else throw new Error('Unknown eval option');
  }
  if (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > 1) throw new Error('Eval cap must be positive and at most 1 USD');
  const manifestText = readFileSync(resolve('fixtures/manifest.json'), 'utf8');
  const manifest = manifestSchema.parse(JSON.parse(manifestText));
  for (const split of splits) if (manifest.files.filter((file) => file.split === split).length !== 24) throw new Error('Expected 24 files per separate split');
  const manifestSha256 = await hasherNode.sha256Hex(manifestText);
  const lock = z.object({ seed: z.number(), freezeDate: z.string(), files: z.array(z.object({ file: z.string(), sha256: z.string() })), manifestHeldoutSha256: z.string() }).passthrough().parse(jsonFile('fixtures/heldout.lock.json'));
  if (lock.seed !== manifest.seed || lock.freezeDate !== manifest.freezeDate || lock.manifestHeldoutSha256 !== await hasherNode.sha256Hex(canonicalHeldout(manifest))) throw new Error('Invalid measurement: held-out label lock changed');
  const sources = new Map<string, string>(); const hashes: Record<string, string> = {}; const scanned: FileResult[] = [];
  // One file at a time preserves the product's 20-file input cap while evaluating each 24-file split in full.
  for (const file of manifest.files) {
    const bytes = readFileSync(resolve('fixtures/workflows', file.file));
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Invalid measurement: workflow is not UTF-8');
    const digest = await hasherNode.sha256Hex(bytes); hashes[file.file] = digest;
    if (file.split === 'heldout' && lock.files.filter((entry) => entry.file === file.file && entry.sha256 === digest).length !== 1) throw new Error('Invalid measurement: held-out file lock changed');
    sources.set(file.file, text);
    const result = await scanText(file.file, text, hasherNode);
    const parsed = parseWorkflow(text);
    if (result.status === 'complete' && parsed.ok) result.findings = applyGates(parsed.workflow, result.findings);
    scanned.push(result);
  }
  if (lock.files.length !== 24 || new Set(lock.files.map((entry) => entry.file)).size !== 24) throw new Error('Invalid held-out lock scope');
  const report: EvaluationReport = { schemaVersion: 1, status: 'generated', generatedAt: new Date().toISOString(), manifestSha256,
    caveats: ['Small fixture sets do not establish real-world accuracy. n < 3 is not measurable on this set; zero denominators are N/A.',
      'Mapped rules differ in granularity. Zizmor dangerous-triggers may flag a trigger without the app\'s checkout condition.',
      'Dev and held-out, regular and pedantic personas, and simulated and live data are never pooled.',
      'Hand-written model examples and handmade baseline format samples are excluded from measured rows.',
      'Triage and citation support do not prove exploitability; patch checks do not prove behavioural equivalence.'],
    rows: [], triage: [], coverage: [], fixes: [], citations: [], costs: [], namedFailures: [],
    humanCheck: { status: 'not yet measured', limit: 20, candidateFindingIds: [], note: 'Inspect up to 20 passing fixes manually in a separate signed artifact; keep human judgments out of automated counts.' } };
  for (const file of manifest.files) {
    const result = scanned.find((item) => item.name === file.file)!;
    report.coverage.push({ split: file.split, file: file.file, expected: file.expectedStatus, actual: result.status, matchesExpected: result.status === file.expectedStatus, reason: result.reason });
    if (result.status !== file.expectedStatus) report.namedFailures.push({ split: file.split, method: 'rules', kind: 'coverage_mismatch', ids: [file.file] });
  }
  const mappingText = readFileSync(resolve('fixtures/baselines/rules_mapping.json'), 'utf8');
  const mapping = mappingSchema.parse(JSON.parse(mappingText)); const mappingSha256 = await hasherNode.sha256Hex(mappingText);
  const metadata = (() => {
    if (!existsSync(resolve('fixtures/baselines/metadata.json'))) return null;
    try { return metadataSchema.safeParse(jsonFile('fixtures/baselines/metadata.json')); }
    catch { return metadataSchema.safeParse(null); }
  })();
  const priceTableSha256 = await hasherNode.sha256Hex(canonicalJson(PRICES));
  for (const split of splits) {
    const fileHashes = Object.fromEntries(manifest.files.filter((file) => file.split === split).map((file) => [file.file, hashes[file.file]]));
    const findings = scanned.filter((file) => file.name.startsWith(`${split}/`)).flatMap((file) => file.findings);
    const labels = manifest.items.filter((item) => item.split === split);
    const base = match(findings, labels);
    const appendRows = (tool: string, predictions: Prediction[] | null, status: string, unmapped: number | null) => {
      for (const rule of RULE_IDS) {
        const result = predictions ? match(predictions.filter((item) => item.rule === rule), labels.filter((item) => item.rule === rule)) : null;
        const rowMetrics = result ? metrics(result) : null;
        report.rows.push({ split, tool, rule, status: rowMetrics ? rowMetrics.status : status, metrics: rowMetrics, unmapped,
          falseNegativeItemIds: result?.falseNegatives.map((item) => item.itemId) ?? [], falsePositivePredictionIds: result?.falsePositives.map((item) => item.id) ?? [] });
        if (result?.falseNegatives.length) report.namedFailures.push({ split, method: tool, kind: 'false_negative', ids: result.falseNegatives.map((item) => item.itemId) });
      }
    };
    appendRows('rules', findings, 'measured', 0); appendRows('rules+gates', findings, 'measured', 0);
    const gateMetrics = triageMetrics(base, findings.map((finding) => ({ predictionId: finding.id, label: combine(finding, false).gatesOnly })));
    report.triage.push({ split, method: 'gates (all)', provenance: 'gates', status: 'generated', metrics: gateMetrics });
    if (gateMetrics.wronglyDemotedItemIds.length) report.namedFailures.push({ split, method: 'gates (all)', kind: 'wrongly_demoted', ids: gateMetrics.wronglyDemotedItemIds });
    const fixResult: EvaluationReport['fixes'][number] = { split, status: 'generated', produced: 0, passed: 0, proposalRefusals: {}, rejectedByCheckerReason: {}, passingFindingIds: [] };
    for (const finding of findings) {
      const source = sources.get(finding.file)!; const parsed = parseWorkflow(source); const fixer = fixerFor(finding);
      if (!parsed.ok || !fixer) { increment(fixResult.proposalRefusals, !fixer ? 'no_fixer' : 'invalid_yaml'); continue; }
      const proposal = proposeFix(parsed, finding, { pins: pins.pins });
      if (!proposal.ok) { increment(fixResult.proposalRefusals, proposal.reason); continue; }
      fixResult.produced++;
      const checked = await check(source, proposal.ops, finding, fixer, hasherNode, { pins: pins.pins });
      if (checked.ok) { fixResult.passed++; fixResult.passingFindingIds.push(finding.id); }
      else for (const reason of checked.reasons) increment(fixResult.rejectedByCheckerReason, reason);
    }
    report.fixes.push(fixResult);
    for (const spec of baselineSpecs) {
      let adapted: Adapted | null = null; let status = 'not yet measured';
      if (metadata && !metadata.success) status = 'invalid measurement: metadata schema';
      else if (metadata?.success) {
        const entries = metadata.data.runs.filter((entry) => entry.tool === spec.tool && entry.split === split && entry.persona === spec.persona);
        if (entries.length !== 1) status = 'invalid measurement: baseline scope/config';
        else if (metadata.data.status === 'pending' && (entries[0].receipt !== null || entries[0].config !== null)) status = 'invalid measurement: pending metadata contains a receipt';
        else if (entries[0].receipt !== null || entries[0].config !== null) {
          status = 'invalid measurement: hashes/config/output format';
          const config = baselineConfigSchema.safeParse(entries[0].config);
          const receipt = entries[0].receipt;
          const outputFile = receipt && typeof receipt === 'object' && 'outputFile' in receipt ? receipt.outputFile : null;
          if (config.success && config.data.tool === spec.tool && config.data.persona === spec.persona && typeof outputFile === 'string' &&
            new RegExp(`^${spec.tool}/[A-Za-z0-9._-]+\\.json$`).test(outputFile) && existsSync(resolve('fixtures/baselines', outputFile))) {
            const output = readFileSync(resolve('fixtures/baselines', outputFile), 'utf8');
            const valid = await validateBaseline(receipt, output, { split, fileHashes, manifestSha256, mappingSha256, config: config.data }, hasherNode);
            if (valid) try {
              adapted = spec.tool === 'zizmor' ? adaptZizmor(JSON.parse(output), mapping) : adaptPoutine(JSON.parse(output), mapping);
              if ([...adapted.predictions, ...adapted.unmapped].some((item) => !Object.hasOwn(fileHashes, item.file))) { adapted = null; }
              else status = 'measured';
            } catch { adapted = null; }
          }
        }
      }
      appendRows(spec.name, adapted?.predictions ?? null, status, adapted?.unmapped.length ?? null);
    }
    const cachePath = resolve(`results/live-cache-${split}.json`);
    if (live && liveSplit === split) {
      const cache = await runLive({ split, findings, sources, manifestSha256, fileHashes, appVersion: APP_VERSION, ruleVersions: RULE_VERSIONS, capUsd });
      mkdirSync(resolve('results'), { recursive: true }); writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
    }
    let cache: LiveCache | null = null; let cacheStatus = 'not yet measured';
    if (existsSync(cachePath)) {
      cacheStatus = 'invalid measurement: cached-live provenance';
      try {
        const raw = jsonFile(cachePath); const model = raw && typeof raw === 'object' && 'model' in raw ? raw.model : null;
        const price = typeof model === 'string' ? lookupVerifiedPrice(PRICES, model) : null;
        if (price && typeof model === 'string') cache = validateLiveCache(raw, { manifestSha256, fileHashes, appVersion: APP_VERSION,
          ruleVersions: RULE_VERSIONS, model, promptVersion: PROMPT_VERSION, priceTableSha256, priceVerifiedOn: price.verifiedOn, findingIds: findings.map((finding) => finding.id) });
        if (cache?.split !== split) cache = null;
        if (cache) for (const outcome of cache.outcomes) {
          const finding = findings.find((item) => item.id === outcome.findingId)!;
          const source = sources.get(finding.file); const parsed = source === undefined ? null : parseWorkflow(source);
          if (outcome.state === 'not_attempted_after_stop') continue; // The ordered stop chain was checked by validateLiveCache.
          if (outcome.state === 'source_unavailable') { if (parsed?.ok) { cache = null; break; } continue; }
          const built = parsed?.ok ? await buildExplainRequest(parsed, finding, cache.runId, hasherNode) : null;
          if (outcome.state === 'context_refused') { if (!built || built.ok || built.reason !== outcome.reason) { cache = null; break; } continue; }
          if (!wasAttempted(outcome) || !built?.ok || canonicalJson(built.request) !== canonicalJson(outcome.request) ||
            outcome.cacheKey !== await explanationCacheKey(finding, built.request, cache.promptVersion, 'function', cache.model, hasherNode)) { cache = null; break; }
        }
      } catch { cache = null; }
    }
    if (!cache) { appendRows('rules+model (cached-live)', null, cacheStatus, null); pendingTriage(report, split, cacheStatus, findings.map((finding) => finding.id)); continue; }
    // Detection stays identical. Cached explanations only annotate the candidates; requested invalid output is unsure.
    const paired = pairedLiveTriage(findings, cache.outcomes);
    appendRows('rules+model (cached-live)', paired.cohortPredictionIds.length ? findings : null, 'not yet measured: no attempted live requests', 0);
    const nonAttempts = paired.omissions.filter((outcome) => !wasAttempted(outcome));
    const triageStatus = !paired.cohortPredictionIds.length ? 'not yet measured: no attempted live requests' :
      nonAttempts.length ? 'partial: non-attempts excluded; requested failures scored unsure' : 'generated: requested failures scored unsure';
    for (const [method, observations] of [['gates (paired)', paired.gatesOnly], ['model only (cached)', paired.modelOnly], ['gates+model (cached)', paired.final]] as const) {
      const measured = triageMetrics(base, observations);
      report.triage.push({ split, method, provenance: 'cached-live', status: triageStatus, metrics: measured });
      if (measured.wronglyDemotedItemIds.length) report.namedFailures.push({ split, method, kind: 'wrongly_demoted', ids: measured.wronglyDemotedItemIds });
    }
    report.citations.push({ split, source: 'cached-live', status: paired.omissions.length ? 'partial: missing responses listed separately from unsupported returned answers' : 'generated',
      supported: paired.supported, unsupported: paired.unsupported, omittedFindingIds: paired.omissions.map((item) => item.findingId) });
    const usd = cache.ledgerReceipts.reduce((sum, receipt) => sum + effectiveCharge(receipt), 0);
    const dateAvailable = cache.ledgerReceipts.length > 0 && cache.ledgerReceipts.every((receipt) => receipt.priceSource === 'server-response' && receipt.priceVerifiedOn === cache!.priceVerifiedOn);
    report.costs.push({ split, status: dateAvailable ? 'generated' : 'partial: price date unavailable for one or more charges', runId: cache.runId, model: cache.model,
      priceVerifiedOn: dateAvailable ? cache.priceVerifiedOn : null, priceSource: 'server response paired by ledger id', effectiveUsd: usd,
      perFindingUsd: cache.ledgerReceipts.length ? usd / cache.ledgerReceipts.length : null, chargedFindingCount: cache.ledgerReceipts.length,
      omitted: paired.omissions.map((outcome) => ({ findingId: outcome.findingId, state: outcome.state, reason: outcome.reason,
        ...(outcome.state === 'not_attempted_after_stop' ? { afterFindingId: outcome.afterFindingId } : {}) })) });
  }
  report.humanCheck.candidateFindingIds = report.fixes.flatMap((fix) => fix.passingFindingIds).slice(0, 20);
  return report;
}

async function main(): Promise<void> {
  const report = await evaluate(); mkdirSync(resolve('results'), { recursive: true });
  writeFileSync(resolve('results/results.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve('results/results.jsonl'), `${[...report.rows.map((row) => ({ kind: 'detection', ...row })), ...report.triage.map((row) => ({ kind: 'triage', ...row })),
    { kind: 'coverage', rows: report.coverage }, { kind: 'fixes', rows: report.fixes }, { kind: 'citations', rows: report.citations },
    { kind: 'costs', rows: report.costs }, { kind: 'namedFailures', rows: report.namedFailures }, { kind: 'humanCheck', ...report.humanCheck }].map((row) => JSON.stringify(row)).join('\n')}\n`);
  writeFileSync(resolve('results/results.md'), renderReport(report));
  process.stdout.write('Evaluation artifacts generated. Inspect coverage, omissions, provenance and small denominators before making claims.\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  process.stderr.write('Evaluation failed; results were not replaced with a claimed measurement.\n'); process.exitCode = 1;
});
