// voice-census.mjs — mechanical detection of prohibitive ("negative-framed") voice
// in the agent-facing instruction surface, minus an allowlist of deliberately-
// preserved negations. Positive-Framing enforcement machinery.
//
// Why this exists: a one-time positive-framing rewrite regresses the moment a new
// prohibition is added. This census is the durable guard — each rewrite slice adds
// its surface to ENFORCED_GLOBS, and the suite then fails on any un-allowlisted
// prohibitive marker in that surface. Negation that IS the contract (load-bearing
// hard limits, deny/reject decisions) stays — recorded in voice-census-allowlist.mjs
// and reported as "allowed", never as a violation.
//
// Structure mirrors plan-linter.mjs: stable exported surfaces + pure helpers + a
// pure core (censusText/partitionFindings) behind an injected-I/O runner (runCensus)
// + an advisory --report CLI. Posture: zero-dep ESM (ADR 81/83); reuses be-escape's
// glob/normalize helpers; fail-soft — never throws on bad input or an unreadable
// file (the defensive stance of enforcement-context.mjs).

import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { matchGlob, matchAnyGlob, normalizePath } from './be-escape.mjs';
import { MARKER_LEXICON, IN_SCOPE_GLOBS, ENFORCED_GLOBS, EXCLUDED_GLOBS } from './voice-census-config.mjs';
import { ALLOWLIST } from './voice-census-allowlist.mjs';

// --- Stable surfaces ---------------------------------------------------------

export const KIND = { FLAGGED: 'flagged', ALLOWED: 'allowed' };

// Separator joining file + snippet in an allowlist key. A NUL byte cannot occur in a
// file path or a snippet, so distinct (file, snippet) pairs never collide onto one key
// (e.g. "a.md"/"b c" vs "a.md b"/"c").
const KEY_SEP = '\x00';

// Canonical key for one allowlist entry (file + snippet). Tracks which entries
// actually matched so collectUnusedAllowlist can report dead ledger rows.
export function allowlistKey(entry) {
  return `${entry?.file ?? ''}${KEY_SEP}${entry?.snippet ?? ''}`;
}

// --- Pure helpers ------------------------------------------------------------

// Scan text line-by-line; emit one finding per (line, marker) hit, 1-based lines.
// Non-global regexes + .test → no lastIndex hazard. Fail-soft: any input coerces to
// a string, so a non-string never throws.
export function findMarkers(text, lexicon = MARKER_LEXICON) {
  const out = [];
  const lines = String(text ?? '').split(/\r?\n/);
  const lex = Array.isArray(lexicon) ? lexicon : [];
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    for (const entry of lex) {
      if (entry && entry.re && entry.re.test(lineText)) {
        out.push({ line: i + 1, lineText, marker: entry.marker });
      }
    }
  }
  return out;
}

// Does an allowlist entry cover this finding? file matches (exact path or glob) AND
// the finding's line contains the entry's snippet.
function entryCovers(entry, filePath, lineText) {
  if (!entry || !entry.file || !entry.snippet) return false;
  return matchGlob(filePath, entry.file) && String(lineText).includes(entry.snippet);
}

// Partition raw markers into flagged vs allowed for one file. Allowed items carry
// the matched entry's reason + key (so the runner can union the used keys).
export function partitionFindings(findings, filePath, allowlist = ALLOWLIST) {
  const flagged = [];
  const allowed = [];
  const list = Array.isArray(allowlist) ? allowlist : [];
  for (const f of Array.isArray(findings) ? findings : []) {
    const entry = list.find((a) => entryCovers(a, filePath, f.lineText));
    if (entry) {
      allowed.push({ ...f, reason: entry.reason ?? '', kind: entry.kind ?? '', allowlistKey: allowlistKey(entry) });
    } else {
      flagged.push(f);
    }
  }
  return { flagged, allowed };
}

// Full census of one file's text: find markers, tag with the file, partition.
export function censusText(filePath, text, { lexicon = MARKER_LEXICON, allowlist = ALLOWLIST } = {}) {
  const raw = findMarkers(text, lexicon).map((f) => ({ ...f, file: filePath }));
  return partitionFindings(raw, filePath, allowlist);
}

// Allowlist entries that matched nothing across the run (dead ledger rows).
export function collectUnusedAllowlist(allowlist, usedKeys) {
  const list = Array.isArray(allowlist) ? allowlist : [];
  const used = usedKeys instanceof Set ? usedKeys : new Set(usedKeys ?? []);
  return list.filter((a) => !used.has(allowlistKey(a)));
}

// Resolve a candidate file list to the deduped in-scope set: each path normalized,
// matched by a scope glob, and not matched by an exclude glob. Pure (no I/O) — lifted
// out of runCensus so scope resolution is independently unit-testable.
export function resolveInScope(files, scopeGlobs, excludeGlobs, projectRoot = '') {
  const seen = new Set();
  const inScope = [];
  for (const raw of Array.isArray(files) ? files : []) {
    const p = normalizePath(raw, projectRoot);
    if (!p || seen.has(p)) continue;
    if (matchAnyGlob(p, scopeGlobs) && !matchAnyGlob(p, excludeGlobs)) {
      seen.add(p);
      inScope.push(p);
    }
  }
  return inScope;
}

// --- Injected-I/O runner -----------------------------------------------------

// Resolve scope → read each file → census → aggregate. I/O is injected:
//   listFiles    — async () => string[] of candidate paths (repo-relative or absolute)
//   readFileText — async (path) => string contents
// Pure-data deps default to the config. Fail-soft: a listing failure yields an empty
// run; an unreadable file is recorded in `errors` and skipped — the run never throws.
export async function runCensus({
  listFiles,
  readFileText,
  scopeGlobs = ENFORCED_GLOBS,
  excludeGlobs = EXCLUDED_GLOBS,
  lexicon = MARKER_LEXICON,
  allowlist = ALLOWLIST,
  projectRoot = '',
} = {}) {
  const result = {
    perFile: [],
    flagged: [],
    allowed: [],
    unusedAllowlist: [],
    errors: [],
    filesScanned: 0,
    flaggedTotal: 0,
    allowedTotal: 0,
  };

  let files = [];
  try {
    files = (typeof listFiles === 'function' ? await listFiles() : []) || [];
  } catch {
    files = [];
  }

  const inScope = resolveInScope(files, scopeGlobs, excludeGlobs, projectRoot);

  const usedKeys = new Set();
  for (const file of inScope) {
    let text;
    try {
      text = typeof readFileText === 'function' ? await readFileText(file) : '';
    } catch (err) {
      result.errors.push({ file, error: String(err?.message ?? err) });
      continue;
    }
    const { flagged, allowed } = censusText(file, text, { lexicon, allowlist });
    for (const a of allowed) usedKeys.add(a.allowlistKey);
    result.perFile.push({ file, flaggedCount: flagged.length, allowedCount: allowed.length });
    result.flagged.push(...flagged);
    result.allowed.push(...allowed);
    result.filesScanned += 1;
  }

  result.unusedAllowlist = collectUnusedAllowlist(allowlist, usedKeys);
  result.flaggedTotal = result.flagged.length;
  result.allowedTotal = result.allowed.length;
  return result;
}

// --- CLI boundary ------------------------------------------------------------

// Synchronous recursive repo walk → project-root-relative POSIX paths. Mirrors
// plan-linter's walkRepo / run-tests.mjs discovery.
function walkRepo(root) {
  const out = [];
  const skip = new Set(['node_modules', '.git']);
  const recurse = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) recurse(full);
      else if (e.isFile()) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  recurse(root);
  return out;
}

function formatReport(result) {
  if (result.flagged.length === 0 && result.allowed.length === 0) {
    return `[voice-census] ${result.filesScanned} file(s) scanned — no prohibitive markers.`;
  }
  const lines = [];
  for (const f of result.flagged) lines.push(`[FLAG]  ${f.file}:${f.line} (${f.marker})  ${f.lineText.trim()}`);
  for (const a of result.allowed) lines.push(`[allow] ${a.file}:${a.line} (${a.marker}) — ${a.reason}`);
  lines.push(
    `[voice-census] ${result.filesScanned} file(s); ${result.flaggedTotal} flagged, ` +
      `${result.allowedTotal} allowed, ${result.unusedAllowlist.length} unused allowlist entr(y/ies).`,
  );
  return lines.join('\n');
}

async function runCli(argv) {
  const args = argv.slice(2);
  const asJson = args.includes('--json');
  const report = args.includes('--report');
  const root = process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const listFiles = async () => walkRepo(root);
  const readFileText = async (rel) => readFile(join(root, rel), 'utf8');
  const scopeGlobs = report ? IN_SCOPE_GLOBS : ENFORCED_GLOBS;
  const result = await runCensus({ listFiles, readFileText, scopeGlobs });
  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(formatReport(result) + '\n');
  }
  process.exit(0); // advisory CLI — enforcement lives in the test suite
}

const invokedAsCli =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /voice-census\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli(process.argv).catch((err) => {
    process.stderr.write(`[voice-census] infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
