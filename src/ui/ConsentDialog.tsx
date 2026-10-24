import { useEffect, useId, useRef, useState } from 'react';

export interface ConsentReceipt { persisted: boolean; note: string | null }
const memoryConsent = new Set<string>();
const consentKey = (userId: string) => `awr.explanation-consent.v1:${encodeURIComponent(userId)}`;

/** Consent is per authenticated account, never a global permission shared between users. */
export function readExplanationConsent(userId: string): { granted: boolean; receipt: ConsentReceipt } {
  if (memoryConsent.has(userId)) return { granted: true, receipt: { persisted: false, note: 'Explanation consent is remembered for this tab only.' } };
  try {
    const granted = window.localStorage.getItem(consentKey(userId)) === 'granted-v1';
    return { granted, receipt: { persisted: true, note: null } };
  } catch {
    return { granted: false, receipt: { persisted: false, note: 'Browser storage is unavailable; consent can be remembered for this tab only.' } };
  }
}

function saveConsent(userId: string): ConsentReceipt {
  try {
    window.localStorage.setItem(consentKey(userId), 'granted-v1');
    return { persisted: true, note: null };
  } catch {
    memoryConsent.add(userId);
    return { persisted: false, note: 'Explanation consent is remembered for this tab only and will be requested after reload.' };
  }
}

export function forgetExplanationConsent(userId: string): ConsentReceipt {
  memoryConsent.delete(userId);
  try { window.localStorage.removeItem(consentKey(userId)); return { persisted: true, note: null }; }
  catch { return { persisted: false, note: 'Saved consent could not be cleared from browser storage.' }; }
}

/** Clear only this app's consent keys, alongside ruling/answer clearing in the review screen. */
export function clearExplanationConsents(): ConsentReceipt {
  memoryConsent.clear();
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith('awr.explanation-consent.v1:')) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return { persisted: true, note: null };
  } catch { return { persisted: false, note: 'Saved explanation consent could not be completely cleared from browser storage.' }; }
}

interface ConsentDialogProps {
  userId: string;
  onConsent(receipt: ConsentReceipt): void;
  onCancel(): void;
}

export function ConsentDialog({ userId, onConsent, onCancel }: ConsentDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const section = useRef<HTMLElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const onConsentRef = useRef(onConsent);
  onConsentRef.current = onConsent;

  useEffect(() => {
    const stored = readExplanationConsent(userId);
    if (stored.granted) { onConsentRef.current(stored.receipt); return; }
    setNote(stored.receipt.note);
    section.current?.focus();
  }, [userId]);

  return (
    <section ref={section} tabIndex={-1} className="panel consent-dialog" role="dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}>
      <h3 id={titleId}>Allow live explanations for this account?</h3>
      <p id={descriptionId}>This sends the bounded excerpt of a finding to the model provider, including its code-computed facts. The excerpt contains at most 60 source lines and the request is limited to 16 KiB. It may contain values from your workflow.</p>
      <p className="small">Calls use your account’s configured budget. Model explanations can be wrong even when their citations match the supplied source.</p>
      {note !== null && <p className="small" role="status">{note}</p>}
      <div className="row">
        <button type="button" onClick={() => onConsent(saveConsent(userId))}>Allow and explain</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
