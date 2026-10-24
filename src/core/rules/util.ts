import type { Facts, Span } from '../finding';
import { normalizeExpression } from '../identity';
import { spanOf } from '../model';
import type { LScalar, Step, Workflow } from '../model';
import contextsJson from '../contexts.json';

export function baseFacts(wf: Workflow, detail: string, extra: Partial<Facts> = {}): Facts {
  return {
    triggers: [...wf.triggers],
    forkReachable: wf.forkReachable,
    privileged: wf.privileged,
    gateEvidence: [],
    ...extra,
    detail,
  };
}

export function snippetOf(wf: Workflow, span: Span): string {
  return wf.source.lines.slice(span.startLine - 1, span.endLine).join('\n');
}

function actionName(uses: string | null): string {
  if (!uses) return '';
  const at = uses.indexOf('@');
  return (at < 0 ? uses : uses.slice(0, at)).trim().toLowerCase();
}

export function isCheckout(uses: string | null): boolean {
  return actionName(uses) === 'actions/checkout';
}

export function isUploadArtifact(uses: string | null): boolean {
  return actionName(uses) === 'actions/upload-artifact';
}

export function isGithubScript(uses: string | null): boolean {
  return actionName(uses) === 'actions/github-script';
}

// ---------------------------------------------------------------------------
// `${{ … }}` expressions
// ---------------------------------------------------------------------------

export interface ExpressionHit {
  inner: string; // normalized inner text
  span: Span;
}

/**
 * Every `${{ … }}` in a scalar, located on its source line. The search runs over the raw
 * source of the scalar (block scalars map line for line). A scalar reached through an
 * alias reports every hit at the alias use site.
 */
export function findExpressions(wf: Workflow, scalar: LScalar): ExpressionHit[] {
  const node = scalar.yaml as { range?: readonly [number, number, number] | null } | null;
  const range = node?.range;
  const hits: ExpressionHit[] = [];
  if (!range) {
    for (const m of scalar.text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) hits.push({ inner: normalizeExpression(m[1]), span: scalar.span });
    return hits;
  }
  const raw = wf.source.text.slice(range[0], range[1]);
  for (const m of raw.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    const start = range[0] + (m.index ?? 0);
    const span = scalar.aliased ? scalar.span : spanOf(wf.source, start, start + m[0].length);
    hits.push({ inner: normalizeExpression(m[1]), span });
  }
  return hits;
}

/**
 * Context property paths referenced by an expression, lowercased, with `[N]`, `['x']`
 * and `[*]` indexes rewritten as `.N`, `.x`, `.*` segments. String literals are ignored.
 */
export function contextPaths(inner: string): string[] {
  const indexed = inner
    .replace(/\[\s*'((?:[^']|'')*)'\s*\]/g, (_m, name: string) => `.${name.replace(/''/g, "'")}`)
    .replace(/\[\s*(\d+|\*)\s*\]/g, '.$1');
  const withoutStrings = indexed.replace(/'(?:[^']|'')*'/g, "''");
  const paths: string[] = [];
  for (const m of withoutStrings.matchAll(/[A-Za-z_][A-Za-z0-9_-]*(?:\s*\.\s*(?:[A-Za-z_][A-Za-z0-9_-]*|\d+|\*))*/g)) {
    paths.push(m[0].replace(/\s+/g, '').toLowerCase());
  }
  return paths;
}

export type ContextClass = 'attacker_controlled' | 'maintainer_controlled';

interface ContextEntry {
  pattern: string;
  class: ContextClass;
  docAnchor: string;
}

const CONTEXTS: ContextEntry[] = (contextsJson as ContextEntry[]).map((c) => ({ ...c, pattern: c.pattern.toLowerCase() }));

/** `*` in a pattern matches exactly one path segment; segment counts must be equal. */
export function pathMatches(path: string, pattern: string): boolean {
  const p = path.split('.');
  const q = pattern.split('.');
  if (p.length !== q.length) return false;
  return q.every((segment, i) => segment === '*' || segment === p[i]);
}

export function contextEntryFor(path: string): ContextEntry | null {
  for (const entry of CONTEXTS) if (pathMatches(path, entry.pattern)) return entry;
  return null;
}

/** Attacker class wins over maintainer class when one expression mixes both. */
export function classifyExpression(inner: string): ContextClass | null {
  let result: ContextClass | null = null;
  for (const path of contextPaths(inner)) {
    const entry = contextEntryFor(path);
    if (!entry) continue;
    if (entry.class === 'attacker_controlled') return 'attacker_controlled';
    result = 'maintainer_controlled';
  }
  return result;
}

// ---------------------------------------------------------------------------
// Execution of checked-out code (fact for privileged-trigger-checkout)
// ---------------------------------------------------------------------------

const EXECUTES =
  /(?:^|&&|[;|]|\bthen\s+)\s*(?:(?:npm|npx|yarn|pnpm|bun|make|gradle|gradlew|mvn|cargo|go|pip|pip3|python|python3|node|ruby|bundle|rake|tox|pytest|composer|dotnet)(?:\s|$)|(?:bash|sh)\s+[^\n;&|]*\.sh(?:\s|$)|\.{1,2}\/[A-Za-z0-9_./-]+)/m;

export function stepExecutesCheckedOutCode(step: Step): boolean {
  if (step.usesValue && step.usesValue.trim().startsWith('./')) return true;
  const run = step.run && step.run.value.kind === 'scalar' ? step.run.value.text : '';
  return EXECUTES.test(run);
}
