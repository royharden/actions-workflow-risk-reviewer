import type { AppMode } from '../lib/mode';

export const DEMO_BANNER_TEXT =
  'Demo mode — fixtures and hand-written example answers (simulated, not model output); nothing leaves this browser.';

export function SetupBanner({ mode }: { mode: AppMode }) {
  switch (mode.kind) {
    case 'demo':
      return (
        <div className="banner banner-demo" role="status">
          <strong>{DEMO_BANNER_TEXT}</strong>
          <span className="small">
            {mode.reason === 'explicit'
              ? ' Set by VITE_APP_MODE=demo.'
              : ' No Supabase configuration found; set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable live mode.'}
          </span>
        </div>
      );
    case 'live':
      return (
        <div className="banner banner-live" role="status">
          <strong>Live mode.</strong>
          <span className="small"> Scanning runs in this browser. Sign-in and Explain arrive in a later build.</span>
        </div>
      );
    case 'setup-error':
      return (
        <div className="banner banner-error" role="alert">
          <strong>Setup error: live mode is requested but not configured.</strong>
          <span className="small"> Missing: {mode.missing.join(', ')}. Explain and save are disabled; this is not demo mode.</span>
        </div>
      );
  }
}
