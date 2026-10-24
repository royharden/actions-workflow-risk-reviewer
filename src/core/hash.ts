// Hashing is injected so src/core stays free of WebCrypto/node:crypto.
// Adapters: src/lib/hasher-webcrypto.ts (browser), scripts/hasher-node.ts and tests (Node).
export interface Hasher {
  /** Lowercase hex SHA-256. Strings are hashed as their UTF-8 bytes. */
  sha256Hex(data: string | Uint8Array): Promise<string>;
}
