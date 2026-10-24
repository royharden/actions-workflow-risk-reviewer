import type { SupabaseClient } from '@supabase/supabase-js';
import type { Finding } from '../../core/finding';
import type { ScanResult } from '../../core/scan';
import type { RulingEvent } from '../../core/rulings';
import type { RulingRepository } from './repository';

export interface ReviewDatabase {
  insertRun(row: Record<string, unknown>): Promise<string>;
  insertFindings(rows: Record<string, unknown>[]): Promise<void>;
  insertRuling(row: Record<string, unknown>): Promise<void>;
  listRulings(owner: string): Promise<Record<string, unknown>[]>;
}

/** Adapter operations remain insert/select only; RLS and composite FKs enforce the real owner boundary. */
export function reviewDatabase(client: SupabaseClient): ReviewDatabase {
  return {
    async insertRun(row) {
      const { data, error } = await client.from('runs').insert(row).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'Run was not saved.');
      return String(data.id);
    },
    async insertFindings(rows) {
      if (!rows.length) return;
      const { error } = await client.from('findings').insert(rows);
      if (error) throw new Error(error.message);
    },
    async insertRuling(row) {
      const { error } = await client.from('rulings').insert(row);
      if (error?.code === '23505') {
        // Retry is successful only when the *same event* already exists for this owner.
        const { data, error: readError } = await client.from('rulings').select('*')
          .eq('event_id', row.event_id).eq('owner', row.owner).maybeSingle();
        const same = data && ['event_id', 'owner', 'run_id', 'finding_id', 'file_hash', 'fingerprint', 'rule_version', 'decision', 'patch_digest', 'reason']
          .every((key) => (data[key] ?? null) === (row[key] ?? null));
        if (!readError && same) return;
      }
      if (error) throw new Error(error.message);
    },
    async listRulings(owner) {
      const all: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from('rulings').select('*').eq('owner', owner)
          .order('id', { ascending: true }).range(offset, offset + 499);
        if (error) throw new Error(error.message);
        all.push(...(data ?? []));
        if (!data || data.length < 500) return all;
      }
    },
  };
}

export interface RemoteRepository extends RulingRepository {
  saveScan(scan: ScanResult): Promise<string>;
}

/** D6 excludes filenames from identity. Only display labels may differ for the same ID. */
function findingsForSnapshot(scan: ScanResult): { finding: Finding; fileLabels: string[] }[] {
  const unique = new Map<string, { finding: Finding; data: string; fileLabels: Set<string> }>();
  for (const finding of scan.files.flatMap((file) => file.findings)) {
    const data = JSON.stringify({ ...finding, file: undefined }, (_key, value: unknown) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    });
    const previous = unique.get(finding.id);
    if (previous) {
      if (previous.data !== data) throw new Error(`Conflicting snapshot data for finding ${finding.id}.`);
      previous.fileLabels.add(finding.file);
    } else {
      // Copy the identity fields so later caller mutation cannot change the saved ruling binding.
      unique.set(finding.id, { finding: { ...finding }, data, fileLabels: new Set([finding.file]) });
    }
  }
  return [...unique.values()].map(({ finding, fileLabels }) => ({ finding, fileLabels: [...fileLabels].sort() }));
}

export function createSupabaseRepository(db: ReviewDatabase, owner: string): RemoteRepository {
  let runId: string | null = null;
  let snapshot = new Map<string, { fileHash: string; fingerprint: string; ruleVersion: string }>();
  const storedEvents = new Set<string>();
  return {
    async saveScan(scan) {
      runId = null;
      snapshot = new Map();
      // Validate and deduplicate before creating a run; conflicting IDs must never be bound.
      const findings = findingsForSnapshot(scan);
      const id = await db.insertRun({ owner, kind: 'review', app_version: scan.appVersion,
        rule_versions: scan.ruleVersions, file_hashes: scan.files.map((file) => file.fileHash) });
      await db.insertFindings(findings.map(({ finding, fileLabels }) => ({
        run_id: id, id: finding.id, owner, fingerprint: finding.fingerprint, rule: finding.rule,
        rule_version: finding.ruleVersion, severity: finding.severity, file_hash: finding.fileHash,
        payload: { ...finding, fileLabels }, // snippets/facts and display labels, never full uploaded files
      })));
      snapshot = new Map(findings.map(({ finding }) => [finding.id, {
        fileHash: finding.fileHash, fingerprint: finding.fingerprint, ruleVersion: finding.ruleVersion,
      }]));
      runId = id;
      return id;
    },
    async appendRuling(event) {
      if (storedEvents.has(event.eventId)) return;
      const current = snapshot.get(event.findingId);
      if (!runId || !current || current.fileHash !== event.fileHash || current.fingerprint !== event.fingerprint || current.ruleVersion !== event.ruleVersion) {
        throw new Error('Save this exact scan before recording a live ruling.');
      }
      if ((event.decision === 'accept_fix' || event.decision === 'reject_fix') && !event.patchDigest) throw new Error('Fix decisions require a patch digest.');
      await db.insertRuling({ event_id: event.eventId, owner, run_id: runId, finding_id: event.findingId,
        file_hash: event.fileHash, fingerprint: event.fingerprint, rule_version: event.ruleVersion,
        decision: event.decision, patch_digest: event.patchDigest ?? null, reason: event.reason ?? null, created_at: event.at });
      storedEvents.add(event.eventId);
    },
    async listRulings() {
      const rows = await db.listRulings(owner);
      return rows.map((row) => ({ eventId: String(row.event_id), at: String(row.created_at), findingId: String(row.finding_id),
        fileHash: String(row.file_hash), fingerprint: String(row.fingerprint), ruleVersion: String(row.rule_version),
        decision: row.decision as RulingEvent['decision'],
        ...(typeof row.patch_digest === 'string' ? { patchDigest: row.patch_digest } : {}),
        ...(typeof row.reason === 'string' ? { reason: row.reason } : {}),
      }));
    },
    async clearAll() { /* Remote append-only history is deliberately retained. */ },
    persistence() { return 'remote'; },
    note() { return 'Live rulings are append-only. Clear local data does not delete remote history.'; },
  };
}
