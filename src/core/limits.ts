// PLAN D5 caps. Inputs beyond them are refused with a visible reason, never scanned partially.
export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 256 * 1024; // UTF-8 bytes, not string length
export const MAX_NAME_LENGTH = 255;
export const MAX_JOBS = 100;
export const MAX_STEPS_PER_FILE = 500;
export const MAX_DEPTH = 64;
export const MAX_NODES = 50_000;
export const MAX_ALIAS_RESOLUTIONS = 100;

/** UTF-8 byte length without TextEncoder (keeps the core free of host globals). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3; // lone high surrogate encodes as U+FFFD (3 bytes)
      }
    } else bytes += 3;
  }
  return bytes;
}

/** Display names are labels only; this is the key used to detect duplicates. */
export function normalizeName(name: string): string {
  let n = name.normalize('NFC').replace(/\\/g, '/');
  while (n.startsWith('./')) n = n.slice(2);
  return n.toLowerCase();
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** Returns a reason when the display name is unsafe, else null. */
export function nameProblem(name: string): string | null {
  if (name.length === 0) return 'name is empty';
  if (name.length > MAX_NAME_LENGTH) return `name is longer than ${MAX_NAME_LENGTH} characters`;
  if (CONTROL_CHARS.test(name)) return 'name contains control characters';
  const slashed = name.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) return 'name is an absolute path';
  if (slashed.split('/').some((segment) => segment === '..')) return 'name contains a ".." path segment';
  if (!/\.ya?ml$/i.test(slashed)) return 'name must end in .yml or .yaml';
  return null;
}

export function validateInputFiles(files: ReadonlyArray<{ name: string; text: string }>): string[] {
  const errors: string[] = [];
  if (files.length === 0) errors.push('No files: add between 1 and 20 workflow files.');
  if (files.length > MAX_FILES) errors.push(`Too many files: ${files.length} given, at most ${MAX_FILES} allowed.`);
  const seen = new Map<string, string>();
  for (const file of files) {
    const problem = nameProblem(file.name);
    if (problem) errors.push(`"${printable(file.name)}": ${problem}.`);
    const key = normalizeName(file.name);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      errors.push(`"${printable(file.name)}": duplicate of "${printable(earlier)}" after normalization.`);
    } else {
      seen.set(key, file.name);
    }
    const bytes = utf8ByteLength(file.text);
    if (bytes > MAX_FILE_BYTES) {
      errors.push(`"${printable(file.name)}": ${bytes} bytes exceeds the ${MAX_FILE_BYTES}-byte (256 KiB) limit.`);
    }
  }
  return errors;
}

function printable(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 80);
}
