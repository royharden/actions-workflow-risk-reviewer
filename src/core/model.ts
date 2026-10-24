import type { Node as YamlNode, Pair } from 'yaml';
import type { Span } from './finding';
import { MAX_JOBS, MAX_STEPS_PER_FILE } from './limits';
import { stepKeysFor } from './identity';

// ---------------------------------------------------------------------------
// Source positions (computed on the LF-normalized text the parser saw)
// ---------------------------------------------------------------------------

export interface SourceInfo {
  text: string;
  lines: string[];
  lineStarts: number[]; // offset of the first character of each line
}

export function makeSource(text: string): SourceInfo {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  return { text, lines: text.split('\n'), lineStarts };
}

/** 1-based line and column of a character offset. */
export function position(source: SourceInfo, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, source.text.length));
  let lo = 0;
  let hi = source.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (source.lineStarts[mid] <= clamped) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: clamped - source.lineStarts[lo] + 1 };
}

/** Span of [start, end) with trailing whitespace/newlines dropped, so a block scalar ends on its last content line. */
export function spanOf(source: SourceInfo, start: number, end: number): Span {
  let e = Math.min(end, source.text.length);
  while (e > start && /\s/.test(source.text[e - 1])) e--;
  const s = position(source, start);
  const last = position(source, Math.max(start, e - 1));
  return { startLine: s.line, startCol: s.col, endLine: last.line, endCol: e > start ? last.col : s.col };
}

export function joinSpans(a: Span, b: Span): Span {
  const aFirst = a.startLine < b.startLine || (a.startLine === b.startLine && a.startCol <= b.startCol);
  const aLast = a.endLine > b.endLine || (a.endLine === b.endLine && a.endCol >= b.endCol);
  const first = aFirst ? a : b;
  const last = aLast ? a : b;
  return { startLine: first.startLine, startCol: first.startCol, endLine: last.endLine, endCol: last.endCol };
}

// ---------------------------------------------------------------------------
// Located tree: the YAML AST with every alias resolved (aliases.ts builds it).
// `yaml` is the resolved AST node (M2 fixers edit by its range); `span` is where a
// finding about this node is reported: its own range, or the alias use site when
// the node was reached through an alias (`aliased: true`; fixers must refuse it).
// ---------------------------------------------------------------------------

interface LBase {
  span: Span;
  aliased: boolean;
  yaml: YamlNode | null; // null only for an absent pair value
}

export interface LScalar extends LBase {
  kind: 'scalar';
  value: unknown;
  /** String form: strings as-is, numbers/booleans stringified, null → ''. */
  text: string;
  style: 'plain' | 'single' | 'double' | 'literal' | 'folded';
}

export interface LSeq extends LBase {
  kind: 'seq';
  items: LNode[];
}

export interface LEntry {
  key: string;
  keySpan: Span;
  /** Key start to value end (alias use site when aliased). */
  span: Span;
  value: LNode;
  aliased: boolean;
  pair: Pair<unknown, unknown>;
}

export interface LMap extends LBase {
  kind: 'map';
  entries: LEntry[];
}

export type LNode = LScalar | LSeq | LMap;

export function getEntry(map: LMap | null | undefined, key: string): LEntry | null {
  if (!map) return null;
  for (const entry of map.entries) if (entry.key === key) return entry;
  return null;
}

export function asMap(node: LNode | null | undefined): LMap | null {
  return node && node.kind === 'map' ? node : null;
}

export function asSeq(node: LNode | null | undefined): LSeq | null {
  return node && node.kind === 'seq' ? node : null;
}

/** Text of a non-null scalar, else null. */
export function scalarText(node: LNode | null | undefined): string | null {
  if (!node || node.kind !== 'scalar' || node.value === null || node.value === undefined) return null;
  return node.text;
}

export function isNullValue(node: LNode): boolean {
  return node.kind === 'scalar' && (node.value === null || node.value === undefined);
}

/** Thrown while building the model when the file parses but uses a shape the app refuses (file status `unsupported`). */
export class UnsupportedShape extends Error {
  readonly line: number | undefined;
  constructor(reason: string, line?: number) {
    super(reason);
    this.name = 'UnsupportedShape';
    this.line = line;
  }
}

// ---------------------------------------------------------------------------
// Workflow / Job / Step views over the located tree
// ---------------------------------------------------------------------------

export const FORK_REACHABLE_TRIGGERS: readonly string[] = ['pull_request', 'pull_request_target', 'issue_comment', 'workflow_run'];
export const PRIVILEGED_TRIGGERS: readonly string[] = ['pull_request_target', 'workflow_run', 'issue_comment'];

export interface Step {
  index: number; // 0-based position in the job's steps
  key: string; // stepKey (identity.ts): unique `id`, else `#<index>`
  id: string | null;
  node: LNode; // the sequence item
  map: LMap | null;
  aliased: boolean; // the whole step came through an alias
  uses: LEntry | null;
  usesValue: string | null;
  run: LEntry | null;
  with: LMap | null;
}

export interface Job {
  id: string; // YAML key
  index: number;
  entry: LEntry;
  map: LMap | null;
  /** `permissions:` entry; null when absent or explicitly null (treated as inheriting). */
  permissions: LEntry | null;
  runsOn: LEntry | null;
  uses: LEntry | null; // reusable-workflow call
  usesValue: string | null;
  secrets: LEntry | null;
  steps: Step[];
}

export interface Workflow {
  source: SourceInfo;
  root: LMap;
  on: LEntry | null;
  triggers: string[]; // lowercased event names
  forkReachable: boolean;
  privileged: boolean;
  /** Workflow-level `permissions:`; null when absent or explicitly null. */
  permissions: LEntry | null;
  env: LEntry | null;
  jobsEntry: LEntry | null;
  jobs: Job[];
}

export function buildWorkflow(root: LMap, source: SourceInfo): Workflow {
  const on = getEntry(root, 'on');
  const triggers = on ? readTriggers(on.value) : [];
  const jobsEntry = getEntry(root, 'jobs');
  const jobs: Job[] = [];
  const jobsMap = jobsEntry ? asMap(jobsEntry.value) : null;
  if (jobsMap) {
    if (jobsMap.entries.length > MAX_JOBS) {
      throw new UnsupportedShape(`more than ${MAX_JOBS} jobs (${jobsMap.entries.length})`, jobsMap.span.startLine);
    }
    let totalSteps = 0;
    jobsMap.entries.forEach((entry, index) => {
      const job = buildJob(entry, index);
      totalSteps += job.steps.length;
      if (totalSteps > MAX_STEPS_PER_FILE) {
        throw new UnsupportedShape(`more than ${MAX_STEPS_PER_FILE} steps in the file`, entry.keySpan.startLine);
      }
      jobs.push(job);
    });
  }
  return {
    source,
    root,
    on,
    triggers,
    forkReachable: triggers.some((t) => FORK_REACHABLE_TRIGGERS.includes(t)),
    privileged: triggers.some((t) => PRIVILEGED_TRIGGERS.includes(t)),
    permissions: presentEntry(getEntry(root, 'permissions')),
    env: getEntry(root, 'env'),
    jobsEntry,
    jobs,
  };
}

function presentEntry(entry: LEntry | null): LEntry | null {
  return entry && !isNullValue(entry.value) ? entry : null;
}

function readTriggers(node: LNode): string[] {
  const names: string[] = [];
  if (node.kind === 'scalar') {
    const text = scalarText(node);
    if (text) names.push(text);
  } else if (node.kind === 'seq') {
    for (const item of node.items) {
      const text = scalarText(item);
      if (text) names.push(text);
    }
  } else {
    for (const entry of node.entries) names.push(entry.key);
  }
  return [...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0))];
}

function buildJob(entry: LEntry, index: number): Job {
  const map = asMap(entry.value);
  const uses = getEntry(map, 'uses');
  const stepsSeq = asSeq(getEntry(map, 'steps')?.value);
  const items = stepsSeq ? stepsSeq.items : [];
  const ids = items.map((item) => {
    const id = scalarText(getEntry(asMap(item), 'id')?.value);
    return id === null ? null : id;
  });
  const keys = stepKeysFor(ids);
  const steps: Step[] = items.map((item, i) => {
    const stepMap = asMap(item);
    const stepUses = getEntry(stepMap, 'uses');
    return {
      index: i,
      key: keys[i],
      id: ids[i],
      node: item,
      map: stepMap,
      aliased: item.aliased,
      uses: stepUses,
      usesValue: stepUses ? scalarText(stepUses.value) : null,
      run: getEntry(stepMap, 'run'),
      with: asMap(getEntry(stepMap, 'with')?.value),
    };
  });
  return {
    id: entry.key,
    index,
    entry,
    map,
    permissions: presentEntry(getEntry(map, 'permissions')),
    runsOn: getEntry(map, 'runs-on'),
    uses,
    usesValue: uses ? scalarText(uses.value) : null,
    secrets: getEntry(map, 'secrets'),
    steps,
  };
}
