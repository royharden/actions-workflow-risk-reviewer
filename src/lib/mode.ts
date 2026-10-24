// Mode precedence (PLAN-FINAL [C] section 1 item 13):
//   1. VITE_APP_MODE=demo                          -> offline demo, whatever else is set
//   2. VITE_APP_MODE=live                          -> live if URL + anon key present, else a visible setup error
//   3. VITE_APP_MODE unset, no Supabase config     -> demo with the setup banner
//   4. VITE_APP_MODE unset, full Supabase config   -> live
//   5. VITE_APP_MODE unset, partial Supabase config, or any other VITE_APP_MODE value -> setup error
// A misconfigured live intent is never silently turned into demo.

export type AppMode =
  | { kind: 'demo'; reason: 'explicit' | 'unconfigured' }
  | { kind: 'live' }
  | { kind: 'setup-error'; missing: string[] };

export interface ModeEnv {
  readonly VITE_APP_MODE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

export function getMode(env: ModeEnv = import.meta.env): AppMode {
  const requested = (env.VITE_APP_MODE ?? '').trim().toLowerCase();
  const missing: string[] = [];
  if (!present(env.VITE_SUPABASE_URL)) missing.push('VITE_SUPABASE_URL');
  if (!present(env.VITE_SUPABASE_ANON_KEY)) missing.push('VITE_SUPABASE_ANON_KEY');

  if (requested === 'demo') return { kind: 'demo', reason: 'explicit' };

  if (requested === 'live') {
    return missing.length === 0 ? { kind: 'live' } : { kind: 'setup-error', missing };
  }

  if (requested === '') {
    if (missing.length === 2) return { kind: 'demo', reason: 'unconfigured' };
    if (missing.length === 0) return { kind: 'live' };
    return { kind: 'setup-error', missing };
  }

  return { kind: 'setup-error', missing: [`VITE_APP_MODE (unrecognised value "${requested}"; use demo or live)`, ...missing] };
}
