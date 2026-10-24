import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScanResult } from '../core/scan';
import { getSupabase } from './supabase';

export type OwnedRunResult = { ok: true; runId: string } | { ok: false; reason: string };

/** Create one owned review run per scan, before enabling live Explain. Raw workflows never enter this row. */
export async function createOwnedReviewRun(ownerId: string, scan: ScanResult, suppliedClient?: SupabaseClient): Promise<OwnedRunResult> {
  try {
    const client = suppliedClient ?? getSupabase();
    if (!client) return { ok: false, reason: 'not_configured' };
    const { data: auth, error: authError } = await client.auth.getSession();
    if (authError || !auth.session || auth.session.user.id !== ownerId) return { ok: false, reason: 'sign_in_required' };
    if (scan.inputErrors.length > 0 || scan.files.length === 0) return { ok: false, reason: 'review_run_requires_scan' };
    const { data, error } = await client.from('runs').insert({
      owner: ownerId, kind: 'review', app_version: scan.appVersion, rule_versions: scan.ruleVersions,
      file_hashes: scan.files.map((file) => file.fileHash),
    }).select('id,owner').single();
    if (error) return { ok: false, reason: 'review_run_insert_failed' };
    if (!data || data.owner !== ownerId || typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)) {
      return { ok: false, reason: 'invalid_review_run_response' };
    }
    // A sign-out/account switch during insertion cannot authorize a later explanation in the old account.
    const { data: current, error: currentError } = await client.auth.getSession();
    if (currentError || current.session?.user.id !== ownerId) return { ok: false, reason: 'session_changed' };
    return { ok: true, runId: data.id };
  } catch {
    return { ok: false, reason: 'review_run_unavailable' };
  }
}
