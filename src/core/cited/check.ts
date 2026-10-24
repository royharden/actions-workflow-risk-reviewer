import { modelOutputSchema, type ModelOutput } from './schema';

export type CitationResult =
  | { supported: true; output: ModelOutput }
  | { supported: false; reason: string };

/** Lexical source anchoring only. This does not establish semantic truth. */
export function checkCitations(rawText: string, excerpt: readonly { line: number; text: string }[], truncated = false): CitationResult {
  if (truncated) return { supported: false, reason: 'truncated_output' };
  let decoded: unknown;
  try { decoded = JSON.parse(rawText); } catch { return { supported: false, reason: 'malformed_json' }; }
  const parsed = modelOutputSchema.safeParse(decoded);
  if (!parsed.success) return { supported: false, reason: 'invalid_model_schema' };
  const lines = new Map<number, string>();
  for (const line of excerpt) {
    if (lines.has(line.line)) return { supported: false, reason: 'ambiguous_excerpt' };
    lines.set(line.line, line.text);
  }
  for (const citation of parsed.data.citations) {
    const text = lines.get(citation.line);
    if (text === undefined) return { supported: false, reason: 'line_outside_excerpt' };
    if (!text.includes(citation.quote)) return { supported: false, reason: 'quote_not_verbatim' };
  }
  return { supported: true, output: parsed.data };
}
