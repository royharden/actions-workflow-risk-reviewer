// Downloads are always plain-text Blobs built from strings (never HTML, never a data: URL of workflow text).

const MIME_BY_EXTENSION: Record<string, string> = {
  md: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
  patch: 'text/x-diff;charset=utf-8',
};

export function downloadText(fileName: string, text: string): void {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1);
  const blob = new Blob([text], { type: MIME_BY_EXTENSION[extension] ?? 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after the click has been handled so the download is not cancelled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Client-generated ruling event id (D31): a v4 UUID. */
export function newEventId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
