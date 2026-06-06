#!/usr/bin/env node
// PostToolUse Checkpoint-Flip Hook (state-mutator silent-ALLOW posture).
//
// Fires on every PostToolUse(Write) event scoped to .plans/* via the harness
// `if: "Write(.plans/*)"` filter in .claude/settings.json. When a known
// coordination-file is written with a terminal status, the corresponding
// checkbox in the `| **Coordination Files** |` row of pipeline_status.md is
// flipped from ⬜ to ✅. Mechanizes the honor-system flip instruction that
// kept getting skipped in practice (some sessions complied, others skipped all
// mid-mission flips).
//
// Posture: state-mutator with silent-ALLOW (proposed ADR 86, sibling to ADR 82
// signal-strict and ADR 85 asymmetric fail-safe). The hook never blocks the
// user's .plans/ write — failure modes always exit 0 with informative stderr.
// The Cat D signal-strict validator (validate-frontmatter.mjs) already gates
// schema integrity at write-time; this hook only reacts to validated writes
// by performing a coordination-state side-effect.
//
// Cat II carve-out (ADR 84): pipeline_status.md writes are persona-agnostic
// per .claude/hooks/persona-path-lock.mjs FRAMEWORK_INFRA_PATHS — this hook
// (which writes pipeline_status.md from any persona's tool flow) does not
// trigger the persona path-lock.
//
// Test seam: pure main({ stdinText, readFileText, writeFileText, now, env })
// with injected dependencies. CLI wrapper at bottom wires real I/O.

import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import process from 'node:process';
import { normalizePath } from '../lib/be-escape.mjs';
import { parseFrontmatter } from '../lib/parse-frontmatter.mjs';

// --- Constants ----------------------------------------------------------------

const PLANS_PREFIX = '.plans/';
const PIPELINE_STATUS_FILENAME = 'pipeline_status.md';

export const FLIP_ELIGIBLE_STATUSES = ['complete', 'passed', 'escalated'];

// 9-entry filename → checkbox-label map. Sourced verbatim from
// .docs/protocol/COORDINATION_FILES.md Registry × the pipeline_status.md
// Coordination Files row.
export const CHECKPOINT_MAP = {
  '01_grill_summary.md': '01',
  '02_prd.md': '02',
  '03_slices.md': '03',
  'active_plan.md': 'plan',
  'plan_critique.md': 'plan_critique',
  'builder_done.md': 'build',
  'tdd_report.md': 'tdd',
  'critique.md': 'critique',
  'inspection_report.md': 'inspect',
};

// --- Pure helpers -------------------------------------------------------------

// Atomic flip of `<label> ⬜` → `<label> ✅` inside the Coordination Files row.
// Returns { text, status } where status ∈ { 'flipped', 'already', 'no_row', 'no_label' }.
// Idempotent: 'already' on `<label> ✅` and 'no_label' on `<label> ⬚` (intentional
// invalid state preserved). The label-match regex uses a word-boundary-style
// lookbehind via `(^|\s)` to prevent `plan` from matching the `plan` prefix in
// `plan_critique` — the next character after the matched label must be a space.
export function flipCheckbox(text, label) {
  const src = String(text ?? '');
  const rowRegex = /^(\|\s*\*\*Coordination Files\*\*\s*\|\s*)(.+?)(\s*\|\s*)$/m;
  const m = rowRegex.exec(src);
  if (!m) return { text: src, status: 'no_row' };

  const head = m[1];
  const cellContent = m[2];
  const tail = m[3];

  const labelEscaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const uncheckedRe = new RegExp(`(^|\\s)${labelEscaped} ⬜`);
  const checkedRe = new RegExp(`(^|\\s)${labelEscaped} ✅`);

  if (checkedRe.test(cellContent)) {
    return { text: src, status: 'already' };
  }
  if (!uncheckedRe.test(cellContent)) {
    return { text: src, status: 'no_label' };
  }

  const newCell = cellContent.replace(uncheckedRe, (_match, prefix) => `${prefix}${label} ✅`);
  const newRow = head + newCell + tail;
  const newText = src.replace(rowRegex, newRow);
  return { text: newText, status: 'flipped' };
}

// --- main() — pure decision tree, injected dependencies ----------------------

export async function main({ stdinText, readFileText, writeFileText, now, env }) {
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

  // 2. Defensive prefix guard (Cat D-style — primary filter is the harness `if`).
  if (!target.startsWith(PLANS_PREFIX)) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // 3. Checkpoint lookup — silent no-op on unmapped files (.plans/checks/*,
  //    diagnosis_report.md, hygiene_report.md, .gitkeep, any other).
  const filename = basename(target);
  const label = CHECKPOINT_MAP[filename];
  if (!label) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // 4. Read the written file → parse frontmatter → status gate.
  let writtenText;
  try {
    writtenText = await readFileText(rawFilePath);
  } catch (err) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE C.0] checkpoint-flip: could not read ${target} (${err?.message ?? err}) — skipping flip.\n`,
    };
  }

  const { fields, error } = parseFrontmatter(writtenText);
  if (error) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE C.0] checkpoint-flip: ${filename} frontmatter parse failed (${error.message}) — skipping flip.\n`,
    };
  }

  const status = fields.status;
  if (!FLIP_ELIGIBLE_STATUSES.includes(status)) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE C.0] checkpoint-flip: ${filename} status=${status} — not eligible for flip.\n`,
    };
  }

  // 5. Read pipeline_status.md → atomic flip → write back.
  const pipelinePath = projectRoot
    ? join(projectRoot, PIPELINE_STATUS_FILENAME)
    : PIPELINE_STATUS_FILENAME;

  let pipelineText;
  try {
    pipelineText = await readFileText(pipelinePath);
  } catch (err) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE C.0] checkpoint-flip: pipeline_status.md unreadable (${err?.message ?? err}) — skipping flip.\n`,
    };
  }

  const flipResult = flipCheckbox(pipelineText, label);

  if (flipResult.status === 'no_row') {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE C.0] checkpoint-flip: Coordination Files row not found in pipeline_status.md — skipping flip.\n`,
    };
  }
  if (flipResult.status === 'no_label') {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE C.0] checkpoint-flip: label "${label}" not present in Coordination Files row — skipping flip.\n`,
    };
  }
  if (flipResult.status === 'already') {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE C.0] checkpoint-flip: ${label} already ✅ — no-op.\n`,
    };
  }

  try {
    await writeFileText(pipelinePath, flipResult.text);
  } catch (err) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE C.0] checkpoint-flip: pipeline_status.md write failed (${err?.message ?? err}) — manual flip required.\n`,
    };
  }

  return {
    exitCode: 0,
    stdout: '',
    stderr: `[LFE C.0] checkpoint-flip: ${label} ⬜ → ✅ (triggered by ${filename} status=${status}).\n`,
  };
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
    writeFileText: (p, c) => writeFile(p, c, 'utf8'),
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
  /checkpoint-flip\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    // Last-resort infra-error guard — never block on hook bugs.
    process.stderr.write(`[LFE C.0] hook infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
