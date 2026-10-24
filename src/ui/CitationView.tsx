import type { ModelOutput } from '../core/cited/schema';

function markedSegments(text: string, quotes: string[]): { text: string; marked: boolean }[] {
  const marks = new Set<number>();
  for (const quote of quotes) {
    const start = text.indexOf(quote);
    if (start < 0 || quote.length === 0) continue;
    for (let index = start; index < start + quote.length; index += 1) marks.add(index);
  }
  const segments: { text: string; marked: boolean }[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const marked = marks.has(index);
    const last = segments[segments.length - 1];
    if (last && last.marked === marked) last.text += text[index];
    else segments.push({ text: text[index], marked });
  }
  return segments;
}

/** Only supported output reaches this view; all explanation/source/quote text is escaped by React. */
export function CitationView({ output, excerptLines }: { output: ModelOutput; excerptLines: readonly { line: number; text: string }[] }) {
  const cited = new Set(output.citations.map((citation) => citation.line));
  return (
    <div className="citation-view">
      <p>{output.explanation}</p>
      <p className="small muted">Citations match the supplied source text. This lexical check does not establish semantic truth or exploitability.</p>
      <div className="snippet" role="figure" aria-label="Cited source lines">
        {excerptLines.filter((line) => cited.has(line.line)).map((line) => (
          <div key={line.line} className="snippet-line">
            <span className="line-no">{line.line}</span>
            <code>{markedSegments(line.text, output.citations.filter((citation) => citation.line === line.line).map((citation) => citation.quote)).map((segment, index) => segment.marked ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>)}</code>
          </div>
        ))}
      </div>
      <details>
        <summary>Supplied excerpt ({excerptLines.length} lines)</summary>
        <div className="snippet">{excerptLines.map((line) => <div key={line.line} className="snippet-line"><span className="line-no">{line.line}</span><code>{line.text || ' '}</code></div>)}</div>
      </details>
    </div>
  );
}
