import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { AppMode } from '../lib/mode';
import { getSupabase } from '../lib/supabase';

interface AuthGateProps {
  mode: AppMode;
  onSessionChange?(session: Session | null): void;
  children(session: Session | null): ReactNode;
}

function recoveryRoute(): boolean {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('auth') === 'recovery' || new URLSearchParams(url.hash.slice(1)).get('type') === 'recovery';
  } catch { return false; }
}

/** Live mode requires a real authenticated session. Offline demo never initializes the auth client. */
export function AuthGate({ mode, onSessionChange, children }: AuthGateProps) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(mode.kind === 'live');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<'signin' | 'signup' | 'recover'>('signin');
  const [recovery, setRecovery] = useState(recoveryRoute);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;

  useEffect(() => {
    let active = true;
    let revision = 0;
    if (mode.kind !== 'live') {
      setSession(null); setClient(null); setLoading(false);
      onSessionChangeRef.current?.(null);
      return;
    }
    setLoading(true);
    let authClient: SupabaseClient | null;
    try { authClient = getSupabase(); } catch { authClient = null; }
    if (!authClient) {
      setFailure('Live authentication is not configured.'); setLoading(false); onSessionChangeRef.current?.(null);
      return;
    }
    setClient(authClient);
    const { data: { subscription } } = authClient.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      revision += 1;
      setSession(nextSession); setLoading(false); setPassword('');
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') { setRecovery(false); setMessage(null); }
      onSessionChangeRef.current?.(nextSession);
    });
    const initialRevision = revision;
    void authClient.auth.getSession().then(({ data, error }) => {
      if (!active || initialRevision !== revision) return;
      if (error) setFailure('Could not read the authentication session.');
      const next = error ? null : data.session;
      setSession(next); setLoading(false); onSessionChangeRef.current?.(next);
    }).catch(() => {
      if (active && initialRevision === revision) {
        setFailure('Could not read the authentication session.'); setLoading(false); onSessionChangeRef.current?.(null);
      }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [mode.kind]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client || busy) return;
    setBusy(true); setFailure(null); setMessage(null);
    try {
      if (recovery && session) {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        setPassword(''); setRecovery(false); setMessage('Password updated.');
        const url = new URL(window.location.href);
        url.searchParams.delete('auth');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      } else if (form === 'recover') {
        const redirectTo = `${window.location.origin}${window.location.pathname}?auth=recovery`;
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (error) throw error;
        setMessage('If the account exists, check its email for a password recovery link.');
      } else if (form === 'signup') {
        const { error } = await client.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setPassword(''); setMessage('Sign-up submitted. Check your email if confirmation is required.');
      } else {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setPassword('');
      }
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Authentication request failed.');
    } finally { setBusy(false); }
  }

  async function signOut() {
    if (!client || busy) return;
    setBusy(true); setFailure(null);
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      setSession(null); setPassword(''); setRecovery(false); onSessionChangeRef.current?.(null);
    } catch (err) { setFailure(err instanceof Error ? err.message : 'Sign-out failed.'); }
    finally { setBusy(false); }
  }

  if (mode.kind === 'demo') return <>{children(null)}</>;
  if (mode.kind === 'setup-error') return <section className="panel error-panel" role="alert">Live mode needs valid configuration before authentication, saving, or explanations can be used.</section>;
  if (loading) return <section className="panel" role="status">Checking sign-in…</section>;

  return (
    <>
      <section className="panel auth-panel">
        <h2>{session ? recovery ? 'Choose a new password' : 'Signed in' : 'Sign in for live review'}</h2>
        {failure !== null && <p role="alert">{failure}</p>}
        {message !== null && <p role="status">{message}</p>}
        {session && <div className="row"><span>{session.user.email ?? 'Authenticated account'}</span><button type="button" disabled={busy} onClick={() => void signOut()}>Sign out</button></div>}
        {(!session || recovery) && (
          <form onSubmit={(event) => void submit(event)}>
            {!session && (
              <div className="row">
                <button type="button" disabled={busy} aria-pressed={form === 'signin'} onClick={() => { setForm('signin'); setFailure(null); }}>Sign in</button>
                <button type="button" disabled={busy} aria-pressed={form === 'signup'} onClick={() => { setForm('signup'); setFailure(null); }}>Create account</button>
                <button type="button" disabled={busy} aria-pressed={form === 'recover'} onClick={() => { setForm('recover'); setFailure(null); }}>Recover password</button>
              </div>
            )}
            {!session && <label>Email <input type="email" autoComplete="email" required disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
            {(session || form !== 'recover') && <label>{recovery && session ? 'New password' : 'Password'} <input type="password" autoComplete={form === 'signin' && !recovery ? 'current-password' : 'new-password'} minLength={8} required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
            <button type="submit" className="primary" disabled={busy || client === null}>{busy ? 'Working…' : recovery && session ? 'Update password' : form === 'recover' ? 'Send recovery link' : form === 'signup' ? 'Create account' : 'Sign in'}</button>
          </form>
        )}
        {recovery && !session && <p className="small muted">Open the recovery link from your email to establish a recovery session, then choose a new password here.</p>}
      </section>
      {session && !recovery && children(session)}
    </>
  );
}
