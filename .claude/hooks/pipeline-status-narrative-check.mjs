#!/usr/bin/env node
// pipeline_status.md narrative guard (PostToolUse, warn-only).
//
// Why this exists: the convention "the entrance-card narrative must not
// contain dev-local personal filesystem paths" had no mechanical enforcement —
// it was caught only at per-slice Inspector time, leaving a window where an
// Archivist/Builder rewrite of pipeline_status.md could re-introduce a personal
// path with no feedback. This is the same honor-system-gets-skipped class that
// motivated checkpoint-flip.mjs (manual flips kept getting skipped). This hook
// closes the window: on every pipeline_status.md write it scans the written
// content for GENERIC personal-path shapes and warns.
//
// GENERIC, not hardcoded: the detector matches the *shape* of a home/user-profile
// path (C:\Users\<name>, /home/<name>, /Users/<name>, ~/<path>), never a specific
// username. This ships clean (no seller fingerprint to scrub) AND is
// useful to adopters — it catches THEIR local-path leaks too.
//
// Posture: PostToolUse state-observer, warn-only / silent-ALLOW (ADR 86, sibling
// of checkpoint-flip.mjs). ALWAYS exit 0. NEVER emits a permissionDecision deny
// envelope. The Cat II carve-out (ADR 84) makes pipeline_status.md persona-agnostic;
// this hook only observes + warns, never blocks the write.
//
// Test seam: pure main({ stdinText, readFileText, now, env }) with injected
// dependencies. CLI wrapper at bottom wires real I/O.

import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import process from 'node:process';
import { normalizePath } from '../lib/be-escape.mjs';

// --- Constants ----------------------------------------------------------------

const PIPELINE_STATUS_FILENAME = 'pipeline_status.md';

// Generic personal/dev-local path-shape detectors. Each entry is { label, re }.
// Matches the SHAPE (a home/user-profile root followed by a name segment), never
// a specific username. `re` is global+case-insensitive for per-line scanning.
export const PERSONAL_PATH_PATTERNS = [
  {
    label: 'Windows user-profile path (C:\\Users\\<name>)',
    re: /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'`|<>]+/gi,
  },
  {
    // Negative lookbehind is `[A-Za-z]:` (drive-letter + colon) only — NOT
    // including the slash, which is part of the match itself. This makes a
    // Windows `C:/Users/x` count once (as Windows), not also as a macOS hit.
    label: 'macOS home path (/Users/<name>)',
    re: /(?<![A-Za-z]:)\/Users\/[^\\/\s"'`|<>]+/gi,
  },
  {
    label: 'Linux home path (/home/<name>)',
    re: /\/home\/[^\\/\s"'`|<>]+/gi,
  },
  {
    label: 'home-directory shorthand (~/<path>)',
    re: /~\/[^\s"'`|<>]+/gi,
  },
];

// --- Pure helpers -------------------------------------------------------------

// Scan text line-by-line for generic personal-path shapes.
// Returns [{ label, match, line }] — empty array when clean.
export function scanForPersonalPaths(text) {
  const src = String(text ?? '');
  const lines = src.split(/\r?\n/);
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    for (const { label, re } of PERSONAL_PATH_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        findings.push({ label, match: m[0], line: i + 1 });
      }
    }
  }
  return findings;
}

function buildWarning(findings) {
  const header =
    `[LFE M5.S3] pipeline_status.md narrative-guard: ${findings.length} ` +
    `personal/dev-local path shape(s) detected (warn-only — write NOT blocked).`;
  const rows = findings.map(
    (f) => `  line ${f.line}: ${f.label} → "${f.match}"`,
  );
  const footer =
    `  Convention (O-S2.A1): the entrance-card narrative must stay free of ` +
    `dev-local personal paths. Replace with a generic placeholder ` +
    `(e.g. <project-root>) before commit.`;
  return [header, ...rows, footer].join('\n') + '\n';
}

// --- main() — pure decision tree, injected dependencies ----------------------

export async function main({ stdinText, readFileText, now, env }) {
  // 1. Parse stdin tool payload. Infra-level: silent ALLOW on parse failure.
  let payload;
  try {
    payload = JSON.parse(String(stdinText ?? ''));
  } catch {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const toolInput = payload?.tool_input ?? {};
  const rawFilePath = toolInput?.file_path;
  if (typeof rawFilePath !== 'string' || rawFilePath === '') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const projectRoot = String((env && env.CLAUDE_PROJECT_DIR) ?? payload?.cwd ?? '').replace(/\\/g, '/');
  const target = normalizePath(rawFilePath, projectRoot);

  // 2. Scope guard — only act on pipeline_status.md (defensive; harness `if`
  //    filter is the primary scope). Silent no-op otherwise.
  if (basename(target) !== PIPELINE_STATUS_FILENAME) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // 3. Read the written file. Silent-ALLOW + stderr on read error (never block).
  let writtenText;
  try {
    writtenText = await readFileText(rawFilePath);
  } catch (err) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE M5.S3] narrative-guard: could not read ${target} (${err?.message ?? err}) — skipping scan.\n`,
    };
  }

  // 4. Scan → warn on hit, silent on clean. ALWAYS exit 0; NEVER a deny envelope.
  const findings = scanForPersonalPaths(writtenText);
  if (findings.length === 0) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  return { exitCode: 0, stdout: '', stderr: buildWarning(findings) };
}

// --- CLI wrapper (production I/O wiring) --------------------------------------

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
    now: () => new Date().toISOString(),
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

const invokedAsCli =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /pipeline-status-narrative-check\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    // Last-resort infra-error guard — never block on hook bugs.
    process.stderr.write(`[LFE M5.S3] hook infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
