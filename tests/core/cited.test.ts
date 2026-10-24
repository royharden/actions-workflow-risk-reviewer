import { describe, expect, it } from 'vitest';
import { checkCitations } from '../../src/core/cited/check';
import { buildExcerpt } from '../../src/core/cited/prompt';
import { parseWorkflow } from '../../src/core/parse';
import { scan } from '../../src/core/scan';
import { nodeHasher as hasher } from './helpers';

describe('citation boundary', () => {
  const valid = { triage: 'confirmed', explanation: 'Source anchored only.', citations: [{ line: 8, quote: '# literal' }] };
  const excerpt = [{ line: 8, text: 'echo "# literal"' }];
  it('preserves a literal # quote', () => expect(checkCitations(JSON.stringify(valid), excerpt).supported).toBe(true));
  for (const mutation of [
    { ...valid, severity: 'low' }, { ...valid, patch: 'remove job' }, { ...valid, citations: [] },
    { ...valid, citations: [{ line: 9, quote: '# literal' }] }, { ...valid, citations: [{ line: 8, quote: 'made up' }] },
  ]) it('rejects unsupported model control or citations', () => expect(checkCitations(JSON.stringify(mutation), excerpt).supported).toBe(false));
  it('rejects malformed or truncated output', () => {
    expect(checkCitations('```json {}', excerpt).supported).toBe(false);
    expect(checkCitations(JSON.stringify(valid), excerpt, true).supported).toBe(false);
  });
  it('refuses a whole job exceeding 60 lines instead of sending partial evidence', async () => {
    const text = `on: pull_request\npermissions: read-all\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          echo \${{ github.event.pull_request.title }}\n${'          echo x\n'.repeat(65)}`;
    const parsed = parseWorkflow(text);
    const result = await scan([{ name: 'x.yml', text }], hasher);
    if (!parsed.ok) throw new Error('fixture must parse');
    expect(buildExcerpt(parsed, result.files[0].findings[0])).toEqual({ ok: false, reason: 'context_truncated' });
  });
});
