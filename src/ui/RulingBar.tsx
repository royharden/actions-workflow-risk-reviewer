import { useState } from 'react';
import type { RulingDecision, RulingStatus } from '../lib/review';

const DECISION_TEXT: Record<RulingDecision, string> = {
  confirm: 'Confirmed',
  false_positive: 'False positive',
  accept_fix: 'Fix accepted',
  reject_fix: 'Fix rejected',
};

function statusText(status: RulingStatus): string {
  switch (status.kind) {
    case 'unreviewed':
      return 'Not reviewed yet';
    case 'needs_review':
      return 'Needs review — the file, the rule version or the proposed fix changed since the last ruling';
    case 'ruled':
      return DECISION_TEXT[status.event.decision];
  }
}

interface RulingBarProps {
  status: RulingStatus;
  /** Accept / reject fix are offered only when a fix passed the checker. */
  fixAvailable: boolean;
  disabled?: boolean;
  onRule(decision: RulingDecision, reason: string | undefined): void;
}

export function RulingBar({ status, fixAvailable, disabled = false, onRule }: RulingBarProps) {
  const [reason, setReason] = useState('');

  function rule(decision: RulingDecision) {
    const trimmed = reason.trim();
    onRule(decision, trimmed === '' ? undefined : trimmed);
    setReason('');
  }

  return (
    <div className="ruling-bar">
      <p className={`small ruling-status ruling-status-${status.kind}`}>
        <strong>{statusText(status)}</strong>
        {status.kind === 'ruled' && status.event.reason !== undefined && <span> — {status.event.reason}</span>}
        {status.kind === 'ruled' && <span className="muted"> · {status.event.at}</span>}
      </p>
      <div className="row">
        <button type="button" disabled={disabled} onClick={() => rule('confirm')}>
          Confirm
        </button>
        <button type="button" disabled={disabled} onClick={() => rule('false_positive')}>
          False positive
        </button>
        <button type="button" disabled={disabled || !fixAvailable} onClick={() => rule('accept_fix')}>
          Accept fix
        </button>
        <button type="button" disabled={disabled || !fixAvailable} onClick={() => rule('reject_fix')}>
          Reject fix
        </button>
        <label className="ruling-reason small">
          Reason (optional)
          <input type="text" value={reason} maxLength={500} disabled={disabled} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
    </div>
  );
}
