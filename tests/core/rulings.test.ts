import { describe, expect, it } from 'vitest';
import { latestRulings } from '../../src/core/rulings';
import type { RulingEvent } from '../../src/core/rulings';
import { findingsOf, yaml } from './helpers';
const text = yaml('on: push', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo ok');
async function seed() {
  const finding = (await findingsOf(text))[0];
  const event: RulingEvent = { eventId: 'event-1', at: '2026-10-24T12:00:00Z', findingId: finding.id, fileHash: finding.fileHash, fingerprint: finding.fingerprint, ruleVersion: finding.ruleVersion, decision: 'confirm' };
  return { finding, event };
}
describe('append-only ruling replay', () => {
  it('replays latest matching event and never mutates history', async () => {
    const { finding, event } = await seed();
    const events = [event, { ...event, eventId: 'event-2', at: '2026-10-24T12:01:00Z', decision: 'false_positive' as const }];
    expect(latestRulings(events, [finding]).get(finding.id)).toEqual(events[1]);
    expect(events[0].decision).toBe('confirm');
  });
  it('deduplicates eventId using the first bytes', async () => {
    const { finding, event } = await seed();
    expect(latestRulings([event, { ...event, decision: 'false_positive' }], [finding]).get(finding.id)).toEqual(event);
  });
  it('marks changed file hash, rule version and finding ID for review', async () => {
    const { finding, event } = await seed();
    for (const changed of [{ ...finding, fileHash: 'edited', id: 'new' }, { ...finding, ruleVersion: '2', id: 'new' }]) expect(latestRulings([event], [changed]).get(changed.id)).toBe('needs_review');
  });
  it('fix decisions bind a patch digest and reject changed or missing digests', async () => {
    const { finding, event } = await seed();
    const fix: RulingEvent = { ...event, decision: 'accept_fix', patchDigest: 'patch-v1' };
    expect(latestRulings([fix], [finding], new Map([[finding.id, 'patch-v1']])).get(finding.id)).toEqual(fix);
    expect(latestRulings([fix], [finding], new Map([[finding.id, 'patch-v2']])).get(finding.id)).toBe('needs_review');
    expect(latestRulings([{ ...fix, patchDigest: undefined }], [finding]).get(finding.id)).toBe('needs_review');
  });
});
