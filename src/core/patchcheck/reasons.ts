/** Closed machine-readable checker vocabulary; UI renders these as escaped text. */
export const REASONS = [
  'source_hash_mismatch', 'invalid_range', 'overlapping_ops', 'too_many_ops', 'oversized',
  'invalid_yaml', 'target_still_flagged', 'introduced_finding', 'extra_occurrence',
  'disabled_job', 'continue_on_error', 'suppressed_failure', 'removed_trigger', 'removed_uses',
  'removed_job', 'removed_step', 'unrelated_command_change', 'out_of_scope',
  'pin_key_mismatch', 'pin_not_in_table', 'aliased_target', 'identity_ambiguous',
  'shell_unknown', 'manual_fix', 'target_missing', 'internal_error',
] as const;
export type Reason = typeof REASONS[number];
