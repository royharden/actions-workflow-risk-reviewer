// Deferred CI dogfood check. Never reads fixtures or scans a third-party repository.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanText } from '../src/core/scan';
import { hasherNode } from './hasher-node';

async function main(): Promise<void> {
  const directory = resolve('.github/workflows');
  if (!existsSync(directory)) { process.stdout.write('Not yet measured: .github/workflows is deferred by Dirty Mode.\n'); process.exitCode = 2; return; }
  const files = readdirSync(directory).filter((name) => /\.ya?ml$/i.test(name)).sort();
  if (!files.length) { process.stdout.write('Not yet measured: no dogfood workflows.\n'); process.exitCode = 2; return; }
  let failures = 0;
  for (const file of files) {
    const result = await scanText(file, readFileSync(resolve(directory, file), 'utf8'), hasherNode);
    if (result.status !== 'complete' || result.findings.length > 0) failures++;
    process.stdout.write(`${file}: ${result.status}, ${result.findings.length} findings\n`);
  }
  process.exitCode = failures > 0 ? 1 : 0;
}
main().catch(() => { process.stderr.write('Dogfood scan failed; no clean result claimed.\n'); process.exitCode = 1; });
