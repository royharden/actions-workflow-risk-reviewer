import type { Hasher } from '../core/hash';

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Browser Hasher: SHA-256 via WebCrypto; strings are hashed as UTF-8 bytes. */
export const webCryptoHasher: Hasher = {
  async sha256Hex(data: string | Uint8Array): Promise<string> {
    const source = typeof data === 'string' ? encoder.encode(data) : data;
    // Copy into a fresh ArrayBuffer so the digest input is never a view over a shared buffer.
    const bytes = new Uint8Array(source.byteLength);
    bytes.set(source);
    return toHex(await crypto.subtle.digest('SHA-256', bytes.buffer));
  },
};
