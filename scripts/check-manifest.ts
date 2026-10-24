// Validates fixtures/manifest.json (both splits, after the dev part is merged) against
// docs/FIXTURES.md and fixtures/heldout.lock.json. Run from the repo root:
//   npx tsx scripts/check-manifest.ts
// Exits 1 and lists every violation; exits 0 with a one-line summary otherwise.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const FIXTURES = join(ROOT, "fixtures");
const WORKFLOWS = join(FIXTURES, "workflows");
const MANIFEST_PATH = join(FIXTURES, "manifest.json");
const LOCK_PATH = join(FIXTURES, "heldout.lock.json");

const SPLITS = ["heldout", "dev"] as const;
const STATUSES = ["complete", "error", "unsupported"] as const;
const RULES = [
  "unpinned-uses",
  "excessive-permissions",
  "privileged-trigger-checkout",
  "template-injection",
  "secrets-exposure",
  "self-hosted-on-untrusted-trigger",
] as const;
const LABELS = ["positive", "lookalike_excluded", "lookalike_flagged_benign"] as const;
const GATE_RULE: Record<string, (typeof RULES)[number]> = {
  "fork-if": "privileged-trigger-checkout",
  "author-association": "privileged-trigger-checkout",
  label: "privileged-trigger-checkout",
  environment: "privileged-trigger-checkout",
  "dispatch-only": "template-injection",
  "same-repo-callee": "secrets-exposure",
};
const GATES = Object.keys(GATE_RULE);

const FILES_PER_SPLIT = 24;
const MIN_POSITIVE_PER_RULE = 3;
const MIN_LOOKALIKE_PER_RULE = 3;
const MIN_FLAGGED_BENIGN = 6;
const MIN_FLAGGED_BENIGN_PTC = 4;

const MANIFEST_KEYS = ["schemaVersion", "seed", "freezeDate", "files", "items"];
const FILE_KEYS = ["file", "split", "expectedStatus"];
const ITEM_KEYS = ["file", "split", "rule", "jobId", "stepIndex", "span", "label", "trap", "gate", "note"];
const SPAN_KEYS = ["startLine", "endLine"];

type Split = (typeof SPLITS)[number];
interface FileEntry {
  file: string;
  split: Split;
  expectedStatus: (typeof STATUSES)[number];
}
interface Item {
  file: string;
  split: Split;
  rule: (typeof RULES)[number];
  jobId: string | null;
  stepIndex: number | null;
  span: { startLine: number; endLine: number };
  label: (typeof LABELS)[number];
  trap: string;
  gate: string | null;
  note: string;
}
interface Lock {
  version: number;
  seed: number;
  freezeDate: string;
  files: { file: string; sha256: string }[];
  manifestHeldoutSha256: string;
  note: string;
}

const violations: string[] = [];
let summary = "";
const fail = (msg: string): void => {
  violations.push(msg);
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkKeys(where: string, v: Record<string, unknown>, keys: string[]): void {
  const got = Object.keys(v);
  if (got.join(",") !== keys.join(",")) fail(`${where}: keys must be exactly [${keys.join(", ")}] in that order, got [${got.join(", ")}]`);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`${relative(ROOT, path)}: cannot read or parse (${(e as Error).message})`);
    return undefined;
  }
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Canonical order and key order are fixed by docs/FIXTURES.md ("Held-out lock"); the lock's
// manifestHeldoutSha256 was computed with exactly this function. A null jobId sorts as "".
function canonicalHeldout(items: Item[]): string {
  const sorted = items
    .filter((i) => i.split === "heldout")
    .map((i) => ({
      file: i.file,
      split: i.split,
      rule: i.rule,
      jobId: i.jobId,
      stepIndex: i.stepIndex,
      span: { startLine: i.span.startLine, endLine: i.span.endLine },
      label: i.label,
      trap: i.trap,
      gate: i.gate,
      note: i.note,
    }))
    .sort(
      (a, b) =>
        cmp(a.file, b.file) ||
        a.span.startLine - b.span.startLine ||
        cmp(a.rule, b.rule) ||
        cmp(a.jobId ?? "", b.jobId ?? "") ||
        cmp(a.label, b.label),
    );
  return JSON.stringify(sorted);
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? [p, ...walk(p)] : [p];
  });
}

function checkFileEntry(where: string, f: unknown): f is FileEntry {
  if (!isObject(f)) {
    fail(`${where}: not an object`);
    return false;
  }
  checkKeys(where, f, FILE_KEYS);
  let ok = true;
  const bad = (msg: string): void => {
    ok = false;
    fail(`${where}: ${msg}`);
  };
  if (typeof f.file !== "string" || f.file.length === 0) bad("file must be a non-empty string");
  if (!SPLITS.includes(f.split as Split)) bad(`split must be one of ${SPLITS.join("|")}`);
  if (!STATUSES.includes(f.expectedStatus as FileEntry["expectedStatus"])) bad(`expectedStatus must be one of ${STATUSES.join("|")}`);
  return ok;
}

function checkItem(where: string, i: unknown): i is Item {
  if (!isObject(i)) {
    fail(`${where}: not an object`);
    return false;
  }
  checkKeys(where, i, ITEM_KEYS);
  let ok = true;
  const bad = (msg: string): void => {
    ok = false;
    fail(`${where}: ${msg}`);
  };
  if (typeof i.file !== "string") bad("file must be a string");
  if (!SPLITS.includes(i.split as Split)) bad(`split must be one of ${SPLITS.join("|")}`);
  if (!RULES.includes(i.rule as Item["rule"])) bad(`rule ${String(i.rule)} not in rule enum`);
  if (!(i.jobId === null || (typeof i.jobId === "string" && i.jobId.length > 0))) bad("jobId must be a non-empty string or null");
  if (!(i.stepIndex === null || (Number.isInteger(i.stepIndex) && (i.stepIndex as number) >= 0))) bad("stepIndex must be a 0-based integer or null");
  if (i.stepIndex !== null && i.jobId === null) bad("stepIndex set without jobId");
  if (!isObject(i.span)) bad("span must be an object");
  else {
    checkKeys(`${where}.span`, i.span, SPAN_KEYS);
    const { startLine, endLine } = i.span;
    if (!Number.isInteger(startLine) || (startLine as number) < 1) bad("span.startLine must be an integer >= 1");
    if (!Number.isInteger(endLine) || (endLine as number) < (startLine as number)) bad("span.endLine must be an integer >= startLine");
  }
  if (!LABELS.includes(i.label as Item["label"])) bad(`label ${String(i.label)} not in label enum`);
  if (typeof i.trap !== "string") bad("trap must be a string");
  if (typeof i.note !== "string") bad("note must be a string");
  if (i.label === "lookalike_flagged_benign") {
    if (typeof i.gate !== "string" || !GATES.includes(i.gate)) bad(`flagged-benign item needs gate in ${GATES.join("|")}`);
    else if (GATE_RULE[i.gate] !== i.rule) bad(`gate ${i.gate} applies to ${GATE_RULE[i.gate]}, not ${String(i.rule)}`);
  } else if (i.gate !== null) bad("gate must be null unless label is lookalike_flagged_benign");
  return ok;
}

function main(): void {
  const manifest = readJson(MANIFEST_PATH);
  if (!isObject(manifest)) {
    if (manifest !== undefined) fail("manifest.json: top level must be an object");
    return;
  }
  checkKeys("manifest", manifest, MANIFEST_KEYS);
  if (manifest.schemaVersion !== 1) fail("manifest: schemaVersion must be 1");
  if (!Number.isInteger(manifest.seed)) fail("manifest: seed must be an integer");
  if (manifest.freezeDate !== "2026-10-24") fail("manifest: freezeDate must be 2026-10-24");
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.items)) {
    fail("manifest: files and items must be arrays");
    return;
  }

  // Files: shape, location, bytes.
  const files = new Map<string, FileEntry>();
  const lineCounts = new Map<string, number>();
  const bytesByFile = new Map<string, Buffer>();
  manifest.files.forEach((f, n) => {
    const where = `files[${n}]`;
    if (!checkFileEntry(where, f)) return;
    if (files.has(f.file)) fail(`${where}: duplicate file ${f.file}`);
    files.set(f.file, f);
    if (!f.file.startsWith(`${f.split}/`)) fail(`${where}: ${f.file} must live under fixtures/workflows/${f.split}/`);
    if (f.file.split("/").some((seg) => seg === ".github" || seg === ".." || seg === "")) fail(`${where}: ${f.file} has a forbidden path segment`);
    if (!/\.ya?ml$/.test(f.file)) fail(`${where}: ${f.file} must be .yml or .yaml`);
    const abs = join(WORKFLOWS, ...f.file.split("/"));
    if (!existsSync(abs)) {
      fail(`${where}: ${f.file} does not exist`);
      return;
    }
    const buf = readFileSync(abs);
    bytesByFile.set(f.file, buf);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) fail(`${f.file}: has a UTF-8 BOM`);
    if (buf.includes(0x0d)) fail(`${f.file}: contains CR bytes (must be LF-only)`);
    if (buf.length === 0 || buf[buf.length - 1] !== 0x0a) fail(`${f.file}: missing final newline`);
    lineCounts.set(f.file, buf.toString("utf8").replace(/\n$/, "").split("\n").length);
  });

  // Orphans and any .github directory in the fixture tree.
  for (const p of walk(FIXTURES)) {
    const rel = relative(FIXTURES, p).split(sep).join("/");
    if (rel.split("/").includes(".github")) fail(`fixtures/${rel}: nothing may live under a .github/ directory`);
  }
  for (const split of SPLITS) {
    for (const p of walk(join(WORKFLOWS, split))) {
      if (statSync(p).isDirectory()) continue;
      const rel = relative(WORKFLOWS, p).split(sep).join("/");
      if (!files.has(rel)) fail(`fixtures/workflows/${rel}: not listed in manifest files`);
    }
  }
  if (existsSync(join(ROOT, ".github"))) fail(".github/: must not exist in this repo during Dirty Mode (D23)");

  // Split separation: no shared path (enforced by prefix) and no byte-identical file across splits.
  const hashSplit = new Map<string, string>();
  for (const [file, buf] of bytesByFile) {
    const h = sha256(buf);
    const other = hashSplit.get(h);
    if (other && files.get(other)?.split !== files.get(file)?.split) fail(`${file} and ${other} are byte-identical across splits`);
    hashSplit.set(h, file);
  }
  for (const split of SPLITS) {
    const n = [...files.values()].filter((f) => f.split === split).length;
    if (n !== FILES_PER_SPLIT) fail(`${split}: expected ${FILES_PER_SPLIT} files, found ${n}${split === "dev" && n === 0 ? " (merge fixtures/manifest.dev-part.json first)" : ""}`);
  }

  // Items.
  const items: Item[] = [];
  manifest.items.forEach((i, n) => {
    const where = `items[${n}]`;
    if (!checkItem(where, i)) return;
    const f = files.get(i.file);
    if (!f) fail(`${where}: file ${i.file} not listed in files`);
    else {
      if (f.split !== i.split) fail(`${where}: split ${i.split} disagrees with files entry (${f.split})`);
      if (f.expectedStatus !== "complete") fail(`${where}: ${i.file} has expectedStatus ${f.expectedStatus} and must carry no items`);
      const lines = lineCounts.get(i.file);
      if (lines !== undefined && i.span.endLine > lines) fail(`${where}: span ends at line ${i.span.endLine} but ${i.file} has ${lines} lines`);
    }
    items.push(i);
  });

  // Canonical order must be total, or the lock hash depends on input order.
  const keyOf = (i: Item): string => JSON.stringify([i.file, i.span.startLine, i.rule, i.jobId ?? "", i.label]);
  const seen = new Map<string, number>();
  items.forEach((i, n) => {
    const k = keyOf(i);
    if (seen.has(k)) fail(`items[${n}] ties items[${seen.get(k)}] on (file, startLine, rule, jobId, label); split the line or the canonical hash is order-dependent`);
    else seen.set(k, n);
  });

  // Held-out minimums.
  const held = items.filter((i) => i.split === "heldout");
  for (const rule of RULES) {
    const r = held.filter((i) => i.rule === rule);
    const pos = r.filter((i) => i.label === "positive").length;
    const look = r.length - pos;
    if (pos < MIN_POSITIVE_PER_RULE) fail(`heldout ${rule}: ${pos} positive, need >= ${MIN_POSITIVE_PER_RULE}`);
    if (look < MIN_LOOKALIKE_PER_RULE) fail(`heldout ${rule}: ${look} look-alikes, need >= ${MIN_LOOKALIKE_PER_RULE}`);
  }
  const fb = held.filter((i) => i.label === "lookalike_flagged_benign");
  if (fb.length < MIN_FLAGGED_BENIGN) fail(`heldout: ${fb.length} lookalike_flagged_benign, need >= ${MIN_FLAGGED_BENIGN}`);
  const fbPtc = fb.filter((i) => i.rule === "privileged-trigger-checkout").length;
  if (fbPtc < MIN_FLAGGED_BENIGN_PTC) fail(`heldout: ${fbPtc} flagged-benign on privileged-trigger-checkout, need >= ${MIN_FLAGGED_BENIGN_PTC}`);
  for (const gate of GATES) if (!fb.some((i) => i.gate === gate)) fail(`heldout: no flagged-benign item for gate ${gate}`);
  const heldFiles = [...files.values()].filter((f) => f.split === "heldout");
  if (!heldFiles.some((f) => f.expectedStatus === "error")) fail("heldout: needs >= 1 expectedStatus error file");
  if (!heldFiles.some((f) => f.expectedStatus === "unsupported")) fail("heldout: needs >= 1 expectedStatus unsupported file");

  summary = `${files.size} files, ${items.length} items, ${held.length} held-out items`;

  // Lock.
  const lock = readJson(LOCK_PATH) as Lock | undefined;
  if (lock !== undefined) {
    if (!isObject(lock)) fail("heldout.lock.json: top level must be an object");
    else {
      checkKeys("lock", lock as unknown as Record<string, unknown>, ["version", "seed", "freezeDate", "files", "manifestHeldoutSha256", "note"]);
      if (!Number.isInteger(lock.version) || lock.version < 1) fail("lock: version must be an integer >= 1");
      if (lock.seed !== manifest.seed) fail(`lock: seed ${lock.seed} != manifest seed ${String(manifest.seed)}`);
      if (lock.freezeDate !== manifest.freezeDate) fail("lock: freezeDate differs from manifest");
      const locked = new Map((Array.isArray(lock.files) ? lock.files : []).map((e) => [e.file, e.sha256]));
      for (const f of heldFiles) {
        const want = locked.get(f.file);
        const buf = bytesByFile.get(f.file);
        if (!want) fail(`lock: ${f.file} missing`);
        else if (buf && sha256(buf) !== want) fail(`lock: ${f.file} sha256 ${sha256(buf)} != locked ${want}`);
      }
      for (const file of locked.keys()) if (!files.has(file) || files.get(file)?.split !== "heldout") fail(`lock: ${file} is not a held-out manifest file`);
      const got = sha256(canonicalHeldout(items));
      if (got !== lock.manifestHeldoutSha256) fail(`lock: manifestHeldoutSha256 ${lock.manifestHeldoutSha256} != recomputed ${got} (held-out items changed after freeze?)`);
    }
  }
}

function report(): void {
  if (violations.length > 0) {
    console.error(`check-manifest: ${violations.length} violation(s)`);
    for (const v of violations) console.error(`- ${v}`);
    process.exit(1);
  }
  console.log(`check-manifest: ok (${summary})`);
}

main();
report();
