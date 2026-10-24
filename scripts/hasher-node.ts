import { createHash } from 'node:crypto';
import type { Hasher } from '../src/core/hash';
export const hasherNode: Hasher = { async sha256Hex(data) { return createHash('sha256').update(data).digest('hex'); } };
