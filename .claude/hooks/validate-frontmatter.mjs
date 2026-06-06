#!/usr/bin/env node
// Cat D base frontmatter validator — fires on PostToolUse Write events scoped
// to .plans/*.md via the harness `if: "Write(.plans/*)"` filter in
// .claude/settings.json. Enforces the universal frontmatter schema from
// .docs/protocol/COORDINATION_FILES.md (5 mandatory base fields + `slice` on
// execution-tier files + `status` allowed-value enum) and dispatches to a
// per-filename specialist when one matches.
//
// Posture: signal-strict per ADR 82. The hook does NOT roll back the file on
// validation failure — it exits 2 with educational stderr and leaves the
// malformed file on disk for the agent to self-correct on its next action.
// Infrastructure failures (malformed stdin, file-read I/O error) exit 0 silent.
//
// Parser: imports from ../lib/parse-frontmatter.mjs per ADR 83 (zero-dep
// custom parser scoped to the closed LFE coordination-file schema).
//
// Cat D validator — the base frontmatter validator.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import process from 'node:process';
import { parseFrontmatter } from '../lib/parse-frontmatter.mjs';
import { stripControl } from '../lib/text-format.mjs';

const PLANS_PREFIX = '.plans/';
const MANDATORY_FIELDS = ['phase', 'step', 'status', 'timestamp', 'source'];
const STATUS_ALLOWED = ['complete', 'failed', 'passed', 'escalated'];
const EXECUTION_TIER_FILENAMES = [
  'active_plan.md',
  'builder_done.md',
  'tdd_report.md',
  'inspection_report.md',
  'diagnosis_report.md',
];
const EXECUTION_TIER_CHECKS_PATTERN = /^\.plans\/checks\/[^/]+_findings\.md$/;
const SCHEMA_REFERENCE = 'COORDINATION_FILES.md:5-23';

// Filename → specialist module map. Slices 2-4 add modules at these paths;
// missing modules trigger graceful degradation (informational breadcrumb).
const SPECIALIST_MAP = {
  'plan_critique.md': './validate-plan-critique.mjs',
  'tdd_report.md': './validate-tdd-report.mjs',
  '03_slices.md': './validate-slices.mjs',
};

export function normalizePath(p) {
  return String(p ?? '').replace(/\\/g, '/');
}

export function isExecutionTier(normalizedPath) {
  const filename = basename(normalizedPath);
  if (EXECUTION_TIER_FILENAMES.includes(filename)) return true;
  if (EXECUTION_TIER_CHECKS_PATTERN.test(normalizedPath)) return true;
  return false;
}

function isMissingValue(v) {
  return v === undefined || v === null || v === '';
}

// stripControl (ESC-introducer defang) is imported from ../lib/text-format.mjs.
// Promoted to the shared lib once the rule-of-three was met
// (this validator + the two BE-consumer deny-message builders); the local copy
// the earlier comment foreshadowed extracting is now that shared function.

function formatError(filePath, detailLines) {
  const header = `[LFE Cat D] Frontmatter validation failed on ${stripControl(filePath)}:`;
  const details = detailLines.map((l) => `  ${stripControl(l)}`).join('\n');
  const footer =
    `  Expected schema per ${SCHEMA_REFERENCE}: phase, step, status, timestamp, source [+ slice for execution-tier files].\n` +
    `  The malformed file is on disk. Before proceeding:\n` +
    `    - Rewrite with valid frontmatter, OR\n` +
    `    - Delete the file if the write was a mistake.`;
  return `${header}\n${details}\n${footer}\n`;
}

// Envelope helper for dispatchSpecialist's exit-2 error branches: wraps a
// single detail line in the standard educational stderr (via formatError, so
// it inherits the ANSI defang above) plus the exit-2 result shape. Extracted
// to collapse the
// near-identical error-return blocks in dispatchSpecialist, dropping it below
// the LOC guideline. Exported for direct unit testing.
export function formatSpecialistError(filePath, detail) {
  return { exitCode: 2, stderr: formatError(filePath, [detail]) };
}

function isModuleNotFound(err) {
  if (!err) return false;
  if (err.code === 'ERR_MODULE_NOT_FOUND') return true;
  return /Cannot find module/i.test(String(err.message ?? ''));
}

// Pure base-field validation. Returns null on pass, { message } on first
// violation. Extracted from main() to keep it unit-testable — moves
// the mandatory-field + status-enum + execution-tier-slice checks out of
// main's body and lets the validation logic be unit-tested independently.
// The plan_critique specialist (validate-plan-critique.mjs) does NOT call this
// directly; specialists receive fields already base-validated by main().
export function validateBase(fields, filePath) {
  for (const field of MANDATORY_FIELDS) {
    if (isMissingValue(fields[field])) {
      return { message: `Missing required field: ${field}` };
    }
  }
  if (!STATUS_ALLOWED.includes(fields.status)) {
    return {
      message: `Invalid value for status: got "${fields.status}", expected one of ${STATUS_ALLOWED.join(', ')}`,
    };
  }
  if (isExecutionTier(filePath) && isMissingValue(fields.slice)) {
    return {
      message: `Missing required field: slice (required on execution-tier files: ${EXECUTION_TIER_FILENAMES.join(', ')} and .plans/checks/*_findings.md)`,
    };
  }
  return null;
}

// Specialist dispatch by filename. Resolves the specialist via injected
// resolveSpecialist (dynamic import in production; mock in tests),
// distinguishes ERR_MODULE_NOT_FOUND (graceful degradation breadcrumb +
// exit 0) from other module errors (exit 2 + educational stderr), checks
// the specialist's contract (validate function present), invokes it,
// returns the result-shaped envelope main() passes through.
// Extracted from main() to keep it unit-testable — moves ~30 LOC of
// try/catch + contract validation out of main's body. Specialists are the
// canonical "second consumer" of this dispatcher: validate-plan-critique.mjs
// validate-tdd-report.mjs, and validate-slices.mjs.
export async function dispatchSpecialist(filename, fields, resolveSpecialist, filePath) {
  const specialistRelPath = SPECIALIST_MAP[filename];
  if (!specialistRelPath) {
    return { exitCode: 0, stderr: '' };
  }

  const specialistName = specialistRelPath.replace(/^\.\//, '').replace(/\.mjs$/, '');

  let specialist;
  try {
    specialist = await resolveSpecialist(specialistRelPath);
  } catch (err) {
    if (isModuleNotFound(err)) {
      return { exitCode: 0, stderr: `[LFE Cat D] specialist ${specialistName} not yet installed — skipping typed-field checks\n` };
    }
    return formatSpecialistError(filePath, `Specialist ${specialistName} failed to load: ${err?.message ?? err}`);
  }

  if (!specialist || typeof specialist.validate !== 'function') {
    return formatSpecialistError(filePath, `Specialist ${specialistName} loaded but does not export validate(fields).`);
  }

  const result = specialist.validate(fields);
  if (!result?.ok) {
    return formatSpecialistError(filePath, result?.message ?? 'Specialist validation failed (no message provided).');
  }

  return { exitCode: 0, stderr: '' };
}

export async function main({ stdinText, readFileText, resolveSpecialist }) {
  // 1. Parse stdin tool_input JSON (infrastructure-level — silent on parse fail)
  let toolInput;
  try {
    const parsed = JSON.parse(String(stdinText ?? ''));
    toolInput = parsed?.tool_input ?? {};
  } catch {
    return { exitCode: 0, stderr: '' };
  }

  const rawFilePath = toolInput?.file_path;
  if (typeof rawFilePath !== 'string' || rawFilePath === '') {
    return { exitCode: 0, stderr: '' };
  }

  const filePath = normalizePath(rawFilePath);

  // 2. Defensive path-prefix guard (fail-safe; harness `if` filter is primary).
  // If a future settings.json misconfig drops the `if` filter, this guard
  // prevents the validator from churning on every project-wide Write.
  if (!filePath.startsWith(PLANS_PREFIX)) {
    return { exitCode: 0, stderr: '' };
  }

  // 3. Read file (infrastructure-level — silent on I/O fail; the agent's next
  // attempt produces a fresh write event and the hook re-fires).
  let text;
  try {
    text = await readFileText(rawFilePath);
  } catch {
    return { exitCode: 0, stderr: '' };
  }

  // 4. Parse frontmatter via shared parser.
  const { fields, error } = parseFrontmatter(text);
  if (error) {
    const detail =
      error.kind === 'no_frontmatter'
        ? 'No frontmatter block found. Coordination files require a `---` delimiter block at the top of the file.'
        : `Frontmatter found but malformed at line ${error.line}: ${error.message}`;
    return { exitCode: 2, stderr: formatError(filePath, [detail]) };
  }

  // 5. Base validation — delegates to validateBase helper.
  const baseErr = validateBase(fields, filePath);
  if (baseErr) {
    return { exitCode: 2, stderr: formatError(filePath, [baseErr.message]) };
  }

  // 6. Specialist dispatch — delegates to dispatchSpecialist helper.
  return await dispatchSpecialist(basename(filePath), fields, resolveSpecialist, filePath);
}

// CLI wrapper — only invoked when the script runs as the hook command.
async function readStdinAll() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function runCli() {
  const stdinText = await readStdinAll();
  const result = await main({
    stdinText,
    readFileText: (p) => readFile(p, 'utf8'),
    resolveSpecialist: async (relativePath) => {
      const url = new URL(relativePath, import.meta.url).href;
      return import(url);
    },
  });
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

const invokedAsCli =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /validate-frontmatter\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    // Last-resort infrastructure-error guard — never block on hook bugs.
    process.stderr.write(`[LFE Cat D] hook infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
