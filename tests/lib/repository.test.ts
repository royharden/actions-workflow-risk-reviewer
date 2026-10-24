import { expect, it } from 'vitest';
import { createSupabaseRepository, type ReviewDatabase } from '../../src/lib/storage/supabase';
import { scan } from '../../src/core/scan';
import { nodeHasher } from '../core/helpers';
import type { RulingEvent } from '../../src/core/rulings';

it('binds live rulings to an exact saved snapshot and never deletes remote history', async () => {
  const inserted: Record<string, unknown>[] = [];
  const db: ReviewDatabase = {
    async insertRun(row) { expect(row.owner).toBe('owner-a'); return 'run-a'; },
    async insertFindings(rows) { expect(rows.every((row) => row.owner === 'owner-a' && row.run_id === 'run-a')).toBe(true); },
    async insertRuling(row) { inserted.push(row); }, async listRulings() { return inserted; },
  };
  const repository = createSupabaseRepository(db, 'owner-a');
  const result = await scan([{ name: 'x.yml', text: 'on: push\npermissions: read-all\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n' }], nodeHasher);
  const f = result.files[0].findings[0];
  const event: RulingEvent = { eventId: '00000000-0000-4000-8000-000000000025', at: '2026-10-24T00:00:00Z', findingId: f.id,
    fileHash: f.fileHash, fingerprint: f.fingerprint, ruleVersion: f.ruleVersion, decision: 'confirm' };
  await expect(repository.appendRuling(event)).rejects.toThrow('Save this exact scan');
  await repository.saveScan(result);
  await expect(repository.appendRuling({ ...event, fileHash: 'changed' })).rejects.toThrow('Save this exact scan');
  await repository.appendRuling(event);
  await repository.appendRuling(event);
  expect(inserted).toHaveLength(1);
  await repository.clearAll();
  expect(await repository.listRulings()).toHaveLength(1);
});

const duplicateWorkflow = 'on: push\npermissions: read-all\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n';

it('persists identical workflow bytes under different filenames once per D6 ID and binds either label', async () => {
  const findings: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const db: ReviewDatabase = {
    async insertRun() { return 'run-duplicates'; },
    async insertFindings(rows) {
      expect(new Set(rows.map((row) => `${String(row.run_id)}:${String(row.id)}`)).size).toBe(rows.length);
      findings.push(...rows);
    },
    async insertRuling(row) { events.push(row); },
    async listRulings() { return events; },
  };
  const repository = createSupabaseRepository(db, 'owner-a');
  const result = await scan([{ name: 'a.yml', text: duplicateWorkflow }, { name: 'b.yml', text: duplicateWorkflow }], nodeHasher);
  expect(result.inputErrors).toEqual([]);
  expect(result.files[0].findings.length).toBeGreaterThan(0);
  expect(result.files[0].findings.map((finding) => finding.id)).toEqual(result.files[1].findings.map((finding) => finding.id));
  await expect(repository.saveScan(result)).resolves.toBe('run-duplicates');
  expect(findings).toHaveLength(result.files[0].findings.length);
  for (const row of findings) expect((row.payload as { fileLabels: string[] }).fileLabels).toEqual(['a.yml', 'b.yml']);
  const f = result.files[1].findings[0];
  await repository.appendRuling({ eventId: '00000000-0000-4000-8000-000000000026', at: '2026-10-24T00:00:00Z',
    findingId: f.id, fileHash: f.fileHash, fingerprint: f.fingerprint, ruleVersion: f.ruleVersion, decision: 'confirm' });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ run_id: 'run-duplicates', finding_id: f.id, owner: 'owner-a' });
});

it.each(['fingerprint', 'snippet'] as const)('rejects a duplicate ID with conflicting %s before saving or binding it', async (field) => {
  let runWrites = 0;
  let findingWrites = 0;
  let rulingWrites = 0;
  const db: ReviewDatabase = {
    async insertRun() { runWrites += 1; return 'run-conflict'; },
    async insertFindings() { findingWrites += 1; },
    async insertRuling() { rulingWrites += 1; },
    async listRulings() { return []; },
  };
  const repository = createSupabaseRepository(db, 'owner-a');
  const result = await scan([{ name: 'a.yml', text: duplicateWorkflow }, { name: 'b.yml', text: duplicateWorkflow }], nodeHasher);
  const f = result.files[1].findings[0];
  result.files[1].findings[0] = { ...f, [field]: `${f[field]} changed` };
  await expect(repository.saveScan(result)).rejects.toThrow('Conflicting snapshot data');
  expect(runWrites).toBe(0);
  expect(findingWrites).toBe(0);
  await expect(repository.appendRuling({ eventId: '00000000-0000-4000-8000-000000000027', at: '2026-10-24T00:00:00Z',
    findingId: f.id, fileHash: f.fileHash, fingerprint: f.fingerprint, ruleVersion: f.ruleVersion, decision: 'confirm' }))
    .rejects.toThrow('Save this exact scan');
  expect(rulingWrites).toBe(0);
});
