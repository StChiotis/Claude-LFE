// plan-linter.mjs — mechanical pre-build lint of .plans/active_plan.md for the
// LFE plan-critique step.
//
// Why this exists: the pipeline kept rediscovering four plan-quality defect
// classes LATE (Inspector Cycle 1 / Builder pre-verification), where they are
// most expensive to fix. The framework's own history (checkpoint-flip.mjs)
// proves honor-system "remember to check" instructions get skipped — so these
// checks are mechanized into tested code that the plan-critique skill runs
// deterministically, with the irreducibly-semantic remainder handled by the
// (skill-level) Lens 5 "Coherence Simulation".
//
// Resolved defect classes:
//   - glob-count  (M2-PI.3): resolve each AC glob, ALWAYS surface its reach,
//                  WARN only on an explicit stated-count contradiction, and emit
//                  a soft INFO cross-check vs the declared affected-file count.
//                  ("Resolve and surface", never guess — an AC glob may
//                  legitimately target a SUBSET of affected files, so a blind
//                  glob-vs-declaredCount equality would false-positive.)
//   - test-path   (M2-PI.6): flag the Get-ChildItem | ForEach-Object { Test-Path }
//                  existence antipattern (iterates children instead of testing the path).
//   - line-count  (M2-PI.5): flag narrow/exact line-count ACs (false-positive-prone
//                  when bullets render single- vs multi-line).
//   - orphan-word (M2-PI.1+4): high-recall surfacing of orphan-prone words in plan
//                  text as candidates for the Lens-5 semantic coherence judgment.
//                  The linter surfaces; it does not adjudicate.
//
// Contract: ADVISORY + FAIL-SOFT. lintPlan() never throws; on internal error it
// returns { findings: [...partial], parseError: true } plus one info finding.
// The CLI always exits 0. Pure core (lintPlan) + injected globResolver for
// FS-free unit testing — same DI seam as be-escape.mjs / parse-frontmatter.mjs.
//
// ADR 94: plan-critique mechanization via this tested linter.

import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { matchGlob } from './be-escape.mjs';

// --- Stable surfaces (tests + Lens consumers key off these) -------------------

export const CHECKS = {
  GLOB_COUNT: 'glob-count',
  TEST_PATH: 'test-path',
  LINE_COUNT: 'line-count',
  ORPHAN_WORD: 'orphan-word',
  LINT: 'lint', // meta: emitted only on internal error (fail-soft)
};

export const SEVERITY = { WARN: 'warn', INFO: 'info' };

// Orphan-prone words: temporal/state-relative markers that often signal text
// referring to something an edit removed or changed elsewhere (M2-PI.1+4).
export const ORPHAN_WORDS = ['unchanged', 'was always', 'previously', 'now', 'still', 'no longer'];

// A line-count range whose span is below this is "narrow" → false-positive-prone.
export const NARROW_LINE_SPAN = 10;

const ORPHAN_RE = /\b(unchanged|was always|previously|now|still|no longer)\b/gi;
// A token is a "glob" if it is backtick-wrapped and contains a '*'. But a
// backtick span in plan prose frequently contains markdown-bold `**` or other
// asterisks without being a path (e.g. a sentence quoted in code-font). To
// avoid false-positiving on prose, a glob token must additionally be
// PATH-SHAPED: no whitespace, and containing a '/' or a '.ext' segment. Real
// globs (`.claude/**`, `src/*.mjs`, `*.test.mjs`) pass; prose spans (which
// contain spaces, and rarely a slash/extension) do not.
const GLOB_TOKEN_RE = /`([^`]*\*[^`]*)`/g;
const PATH_SHAPED_RE = /^[^\s]*(?:\/|\.[A-Za-z0-9]+)[^\s]*$/;

function isPathShapedGlob(token) {
  return token.includes('*') && !/\s/.test(token) && PATH_SHAPED_RE.test(token);
}
// Indicators that a line is asserting a line count (avoids flagging unrelated -eq N).
const LINE_COUNT_INDICATOR_RE = /\.Length\b|\.Count\b|Get-Content|Measure-Object\s+-Line|wc\s+-l|\blines\b/i;
const AFFECTED_SECTION_HEADERS = ['## Affected Documents', '## Affected Code Files'];

// --- Pure helpers -------------------------------------------------------------

function finding(check, severity, line, message, detail = '') {
  return { check, severity, line, message, detail };
}

// Count the file-referencing bullets in the ## Affected Documents/Code Files
// sections. Returns null if neither section is present (→ no soft cross-check).
// A "file bullet" is a `- ` line containing a backtick token with a '.' or '/'.
export function extractAffectedFileCount(lines) {
  let total = null;
  for (let i = 0; i < lines.length; i++) {
    if (!AFFECTED_SECTION_HEADERS.includes(lines[i].trim())) continue;
    let count = 0;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^##\s/.test(lines[j])) break; // next section
      const t = lines[j].trim();
      if (/^[-*]\s/.test(t) && /`[^`]*[./][^`]*`/.test(t)) count++;
    }
    total = (total ?? 0) + count;
  }
  return total;
}

// Extract an explicit expected count from an AC line, or null. Tries the most
// specific forms first; -in N..M uses the upper bound as the stated count.
export function extractStatedCount(line) {
  let m;
  if ((m = line.match(/-in\s+\d+\.\.(\d+)/))) return Number.parseInt(m[1], 10);
  if ((m = line.match(/-eq\s+(\d+)/))) return Number.parseInt(m[1], 10);
  if ((m = line.match(/\ball\s+(\d+)\b/i))) return Number.parseInt(m[1], 10);
  if ((m = line.match(/\b(\d+)\s+files?\b/i))) return Number.parseInt(m[1], 10);
  return null;
}

function extractGlobs(line) {
  const globs = [];
  let m;
  GLOB_TOKEN_RE.lastIndex = 0;
  while ((m = GLOB_TOKEN_RE.exec(line))) {
    if (isPathShapedGlob(m[1])) globs.push(m[1]);
  }
  return globs;
}

// --- Check A: glob-count (M2-PI.3) — "resolve and surface" --------------------

export function checkGlobCounts(lines, declaredCount, globResolver) {
  const findings = [];
  const hasResolver = typeof globResolver === 'function';
  for (let i = 0; i < lines.length; i++) {
    const globs = extractGlobs(lines[i]);
    if (globs.length === 0) continue;
    const stated = extractStatedCount(lines[i]);
    for (const pattern of globs) {
      if (!hasResolver) {
        findings.push(finding(CHECKS.GLOB_COUNT, SEVERITY.INFO, i + 1,
          `Glob \`${pattern}\` present but no resolver was available to verify its reach.`));
        continue;
      }
      let resolved;
      try { resolved = globResolver(pattern) || []; } catch { resolved = []; }
      const n = resolved.length;
      // (1) Always surface the resolved reach — the load-bearing signal.
      findings.push(finding(CHECKS.GLOB_COUNT, SEVERITY.INFO, i + 1,
        `Glob \`${pattern}\` resolves to ${n} file(s).`, resolved.join(', ')));
      // (2) WARN only on an explicit stated-count contradiction (zero false positives).
      if (stated !== null && stated !== n) {
        findings.push(finding(CHECKS.GLOB_COUNT, SEVERITY.WARN, i + 1,
          `Glob \`${pattern}\` resolves to ${n} file(s) but the AC states ${stated}. Fix the glob or the stated count.`,
          resolved.join(', ')));
      }
      // (3) Soft INFO cross-check vs declared affected-file count (subset may be legitimate).
      if (declaredCount !== null && n !== declaredCount) {
        findings.push(finding(CHECKS.GLOB_COUNT, SEVERITY.INFO, i + 1,
          `Glob \`${pattern}\` reach (${n}) differs from the declared affected-file count (${declaredCount}). Confirm the glob targets the intended set (a subset may be legitimate).`));
      }
    }
  }
  return findings;
}

// --- Check B: test-path antipattern (M2-PI.6) ---------------------------------

export function checkTestPathAntipattern(lines) {
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/Get-ChildItem/.test(l) && /ForEach-Object/.test(l) && /Test-Path/.test(l)) {
      findings.push(finding(CHECKS.TEST_PATH, SEVERITY.WARN, i + 1,
        'PowerShell existence-check antipattern: `Get-ChildItem … | ForEach-Object { Test-Path … }` iterates a directory\'s children. Use `Test-Path \'path/to/file\'` to test existence; reserve `Get-ChildItem | ForEach-Object` for iterating multiple files.',
        l.trim()));
    }
  }
  return findings;
}

// --- Check C: line-count soft-bound (M2-PI.5) ---------------------------------

export function checkLineCountBounds(lines) {
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!LINE_COUNT_INDICATOR_RE.test(l)) continue;
    let m;
    let reason = null;
    if ((m = l.match(/-eq\s+(\d+)/))) {
      reason = `exact equality (-eq ${m[1]})`;
    } else if ((m = l.match(/-in\s+(\d+)\.\.(\d+)/))) {
      const span = Math.abs(Number(m[2]) - Number(m[1]));
      if (span < NARROW_LINE_SPAN) reason = `narrow range -in ${m[1]}..${m[2]} (span ${span})`;
    } else if ((m = l.match(/-ge\s+(\d+)\s+-and\s+-le\s+(\d+)/))) {
      const span = Math.abs(Number(m[2]) - Number(m[1]));
      if (span < NARROW_LINE_SPAN) reason = `narrow range -ge ${m[1]} -and -le ${m[2]} (span ${span})`;
    } else if ((m = l.match(/\b(\d+)\s*[-–]\s*(\d+)\s+lines\b/i))) {
      const span = Math.abs(Number(m[2]) - Number(m[1]));
      if (span < NARROW_LINE_SPAN) reason = `narrow range ${m[1]}-${m[2]} lines (span ${span})`;
    }
    if (reason) {
      findings.push(finding(CHECKS.LINE_COUNT, SEVERITY.WARN, i + 1,
        `Fragile line-count AC (${reason}). Single- vs multi-line bullet rendering causes false-positive failures; widen the tolerance band (err high on the lower bound).`,
        l.trim()));
    }
  }
  return findings;
}

// --- Check D: orphan-word scan (M2-PI.1+4) — high-recall candidate surfacing ---

export function scanOrphanWords(lines) {
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const hits = [...lines[i].matchAll(ORPHAN_RE)].map((m) => m[0].toLowerCase());
    if (hits.length === 0) continue;
    const uniq = [...new Set(hits)];
    findings.push(finding(CHECKS.ORPHAN_WORD, SEVERITY.INFO, i + 1,
      `Orphan-prone word(s) [${uniq.join(', ')}] in plan text — Lens-5 coherence candidate: confirm this still reads correctly after the edit (no reference to deleted/changed content left behind).`,
      lines[i].trim()));
  }
  return findings;
}

// --- Core entry point ---------------------------------------------------------

export function lintPlan(planText, { globResolver } = {}) {
  const findings = [];
  let parseError = false;
  try {
    const lines = String(planText ?? '').split(/\r?\n/);
    const declaredCount = extractAffectedFileCount(lines);
    findings.push(...checkGlobCounts(lines, declaredCount, globResolver));
    findings.push(...checkTestPathAntipattern(lines));
    findings.push(...checkLineCountBounds(lines));
    findings.push(...scanOrphanWords(lines));
  } catch (err) {
    parseError = true;
    findings.push(finding(CHECKS.LINT, SEVERITY.INFO, 0,
      `plan-linter encountered an error and returned partial results (advisory, non-blocking): ${err?.message ?? err}`));
  }
  return { findings, parseError };
}

// --- CLI boundary -------------------------------------------------------------

// Synchronous recursive repo walk → project-root-relative POSIX paths.
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

export function makeRepoGlobResolver(root) {
  let cache = null;
  return (pattern) => {
    if (cache === null) cache = walkRepo(root);
    return cache.filter((p) => matchGlob(p, pattern));
  };
}

function formatFindings(findings) {
  if (findings.length === 0) return '[plan-linter] No findings.';
  return findings
    .map((f) => `[${f.severity.toUpperCase()}] ${f.check} (line ${f.line}): ${f.message}` +
      (f.detail ? `\n        ↳ ${f.detail}` : ''))
    .join('\n');
}

async function runCli(argv) {
  const args = argv.slice(2);
  const asJson = args.includes('--json');
  const planPath = args.find((a) => !a.startsWith('--'));
  if (!planPath) {
    process.stderr.write('[plan-linter] usage: node plan-linter.mjs <active_plan.md> [--json]\n');
    process.exit(0); // advisory — never non-zero
    return;
  }
  let text = '';
  try { text = await readFile(planPath, 'utf8'); } catch (err) {
    process.stderr.write(`[plan-linter] could not read ${planPath} (${err?.message ?? err}) — nothing to lint.\n`);
    process.exit(0);
    return;
  }
  const root = process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { findings, parseError } = lintPlan(text, { globResolver: makeRepoGlobResolver(root) });
  if (asJson) {
    process.stdout.write(JSON.stringify({ findings, parseError }, null, 2) + '\n');
  } else {
    process.stdout.write(formatFindings(findings) + '\n');
    const warns = findings.filter((f) => f.severity === SEVERITY.WARN).length;
    process.stderr.write(`[plan-linter] ${findings.length} finding(s), ${warns} warn(s)${parseError ? ' (partial — parse error)' : ''}.\n`);
  }
  process.exit(0); // always advisory
}

const invokedAsCli =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /plan-linter\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli(process.argv).catch((err) => {
    process.stderr.write(`[plan-linter] infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
