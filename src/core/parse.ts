import { LineCounter, isMap, parseDocument } from 'yaml';
import type { Document } from 'yaml';
import { expandDocument } from './aliases';
import { UnsupportedShape, buildWorkflow, makeSource, position } from './model';
import type { Workflow } from './model';

export interface ParseOk {
  ok: true;
  workflow: Workflow;
  doc: Document;
  lineCounter: LineCounter;
  /** The text the parser saw: CRLF/CR normalized to LF. Line numbers refer to it (and to the original, line for line). */
  normalizedText: string;
}

export interface ParseFail {
  ok: false;
  status: 'error' | 'unsupported';
  reason: string;
  line?: number;
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * YAML 1.2 core schema (so `on` is a string key), unique keys enforced, one document whose
 * root is a mapping. Parse errors → `error`; shapes the model refuses (alias cycle, alias
 * budget, merge key, caps) → `unsupported`. Never a silent clean result.
 */
export function parseWorkflow(text: string): ParseOk | ParseFail {
  const normalizedText = normalizeNewlines(text);
  const source = makeSource(normalizedText);
  const lineCounter = new LineCounter();
  let doc: Document;
  try {
    doc = parseDocument(normalizedText, {
      version: '1.2',
      schema: 'core',
      keepSourceTokens: true,
      uniqueKeys: true,
      prettyErrors: false,
      lineCounter,
    });
  } catch (err) {
    return { ok: false, status: 'error', reason: `YAML parse failure: ${messageOf(err)}` };
  }

  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    return {
      ok: false,
      status: 'error',
      reason: `YAML parse error: ${firstLine(first.message)}`,
      line: position(source, first.pos[0]).line,
    };
  }
  if (doc.contents === null || doc.contents === undefined) {
    return { ok: false, status: 'error', reason: 'empty document: no workflow mapping found' };
  }
  if (!isMap(doc.contents)) {
    return { ok: false, status: 'error', reason: 'document root is not a mapping', line: 1 };
  }

  try {
    const root = expandDocument(doc, source);
    const workflow = buildWorkflow(root, source);
    return { ok: true, workflow, doc, lineCounter, normalizedText };
  } catch (err) {
    if (err instanceof UnsupportedShape) {
      return err.line === undefined
        ? { ok: false, status: 'unsupported', reason: err.message }
        : { ok: false, status: 'unsupported', reason: err.message, line: err.line };
    }
    throw err;
  }
}

function firstLine(message: string): string {
  const line = message.split('\n')[0].trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? firstLine(err.message) : 'unknown error';
}
