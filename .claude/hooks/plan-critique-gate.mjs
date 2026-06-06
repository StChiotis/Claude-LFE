#!/usr/bin/env node
// Plan-Critique Gate PreToolUse Hook (Block-with-Escape posture).
//
// Fires on every PreToolUse(Write) event on `src/**` paths via .claude/settings.json
// (matcher: "Write" + inner `if: "Write(src/**)"`). Mechanically gates Builder writes
// against the verdict in `.plans/plan_critique.md`:
//   - verdict: PASS                                                  → silent ALLOW
//   - verdict: WARN  + brain_confirmation: <ISO-8601 string>         → ALLOW envelope
//   - verdict: WARN  + brain_confirmation: null (or non-ISO defensive) → DENY
//   - verdict: BLOCK                                                 → DENY
//   - critique file missing                                          → silent ALLOW (FAIL-OPEN)
//     (HIGH† §10.4 row 3 mitigation (a): non-mission flows preserved)
//   - frontmatter parse failure                                      → silent ALLOW
//     (Cat D's validate-plan-critique.mjs guards write-time per HIGH† mitigation (b))
//
// LFE-FORCE escape: on DENY candidates, scan transcript_path's last 3 user messages
// for the `LFE-FORCE` keyword; if present, ALLOW envelope + atomic append to
// .docs/quality/PROTOCOL_DEBT.md (reusing the persona-lock gate's BE substrate verbatim).
//
// Asymmetric fail-safe (ADR 85, plan-critique variant):
//   - Critique file I/O error → ALLOW (HIGH† mitigation (a); non-mission src/ flows
//     must not block on a missing or unreadable critique)
//   - Transcript I/O error    → DENY (mirrors the persona-lock stance — silently hiding
//     LFE-FORCE is worse than the user retrying a Write)
//   - PROTOCOL_DEBT.md write fail → ALLOW with stderr warning (the escape signal
//     already went through; debt row just unrecorded)
//
// Scope: this hook reads `.plans/plan_critique.md` ONLY when the target Write is
// under `src/**`. Non-src writes (`.docs/**`, `.plans/**`, `.claude/**` carve-out
// per ADR 84) fall through Stage 3 and silent-ALLOW with no critique read.
//
// Two PreToolUse entries fire deterministically per Claude Code: the
// `persona-path-lock.mjs` (matcher: "Write|Edit") + this file (matcher:
// "Write" with inner `if: "Write(src/**)"`). Either DENY short-circuits. Layered
// defense: persona discipline AND plan-critique discipline both
// required.
//
// Test seam: pure main({ stdinText, readFileText, writeFileText, now, env }) with
// injected dependencies. CLI wrapper at bottom wires real I/O; tests inject mocks.
// Mirrors the persona-lock / Cat D pattern.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { parseFrontmatter } from '../lib/parse-frontmatter.mjs';
import { parseEntranceCard, ENTRANCE_CARD_FILENAME } from '../lib/parse-entrance-card.mjs';
import {
  LFE_FORCE_KEYWORD,
  LFE_FORCE_SCAN_WINDOW,
  PROTOCOL_DEBT_PATH,
  normalizePath,
  matchAnyGlob,
  extractActiveMission,
  extractLfeForceFromTranscript,
  buildDebtRow,
  insertDebtRowIntoFile,
} from '../lib/be-escape.mjs';
import { readFileTail } from '../lib/read-file-tail.mjs';
import { stripControl } from '../lib/text-format.mjs';

// --- Constants ----------------------------------------------------------------

export const PLAN_CRITIQUE_PATH = '.plans/plan_critique.md';
export const GATED_TOOL = 'Write';
export const SRC_GLOB = 'src/**';
// Matches Cat D's validate-plan-critique.mjs ISO-8601 regex byte-for-byte (strict
// UTC, no fractional seconds). Keeping the two regexes synchronized is a Hygiene
// concern (logged as informational if it ever drifts); the runtime regex is the
// load-bearing one for this gate.
export const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// --- Pure helpers (exported for unit tests) -----------------------------------

export function isUnderSrc(target) {
  return matchAnyGlob(String(target ?? ''), [SRC_GLOB]);
}

export function isIsoTimestamp(value) {
  return typeof value === 'string' && ISO_8601_RE.test(value);
}

// Classifies a plan_critique.md frontmatter into the 5 gate-decision categories.
// Defensive non-ISO `brain_confirmation` (any value that is not `null` AND not a
// string passing ISO_8601_RE) on a WARN verdict is treated as WARN_NULL per G8
// grill resolution — surfaces the protocol violation rather than silent-ALLOWing.
export function classifyVerdict(fields) {
  const verdict = fields?.verdict;
  const brainConf = fields?.brain_confirmation;

  if (verdict === 'PASS') return 'PASS';
  if (verdict === 'BLOCK') return 'BLOCK';
  if (verdict === 'WARN') {
    if (isIsoTimestamp(brainConf)) return 'WARN_CONFIRMED';
    return 'WARN_NULL';
  }
  return 'UNKNOWN';
}

export function buildPlanCritiqueDenyMessage({ verdict, brainConfirmation, target, criticPath, missionName }) {
  // Defang ESC from the raw interpolated values before they reach stderr /
  // permissionDecisionReason. verdict +
  // brainConfirmation reach the text via JSON.stringify, which already
  // escapes control bytes, so they need no extra strip.
  const safeTarget = stripControl(target);
  const safeCriticPath = stripControl(criticPath);
  const safeMission = stripControl(missionName);
  const missionTag = safeMission && safeMission !== 'n/a' ? ` (mission: ${safeMission})` : '';
  let reasonLine;
  let remediationLine;
  if (verdict === 'BLOCK') {
    reasonLine = `Reason:   plan_critique.md verdict=BLOCK — the pre-build review rejected this plan.`;
    remediationLine = `Re-invoke /lfe-architect to revise active_plan.md, then re-run /lfe-plan-critique. Max 2 revisions per /lfe-plan-critique Step 0 — a 2nd BLOCK escalates to Brain triage.`;
  } else if (verdict === 'WARN') {
    const confShape = brainConfirmation === null ? 'null' : JSON.stringify(brainConfirmation);
    reasonLine = `Reason:   plan_critique.md verdict=WARN with brain_confirmation: ${confShape} — Brain has not yet confirmed the WARN findings via the typed frontmatter field.`;
    remediationLine = `Have the Brain re-run /lfe-plan-critique setting brain_confirmation to an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ) — conversational confirmation is NOT a valid signal.`;
  } else {
    reasonLine = `Reason:   plan_critique.md verdict=${JSON.stringify(verdict)} — value is not one of PASS / WARN / BLOCK; the file's frontmatter is structurally broken.`;
    remediationLine = `Delete or fix .plans/plan_critique.md, then re-run /lfe-plan-critique to regenerate it.`;
  }
  return [
    `[LFE Plan-Critique] Plan-critique gate denied src/ write${missionTag}.`,
    ``,
    `  Target:   ${safeTarget}`,
    `  Source:   ${safeCriticPath}`,
    `  ${reasonLine}`,
    ``,
    `  Remediation: ${remediationLine}`,
    ``,
    `  Escape (rare): type ${LFE_FORCE_KEYWORD} in your next prompt — a PROTOCOL_DEBT.md`,
    `  row will be filed automatically and the next session's /lfe-boot will surface`,
    `  the unresolved debt before any new work.`,
    ``,
    `  Last resort: comment out the plan-critique-gate PreToolUse entry in .claude/settings.local.json`,
    `  (gitignored override) and file an issue.`,
  ].join('\n');
}

// --- main() — pure decision tree, injected dependencies ------------------------

export async function main({ stdinText, readFileText, readFileTail, writeFileText, now, env }) {
  // Stage 1 — parse stdin tool payload. Infra-level: silent ALLOW on parse failure.
  let payload;
  try {
    payload = JSON.parse(String(stdinText ?? ''));
  } catch {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const toolName = payload?.tool_name;
  const toolInput = payload?.tool_input ?? {};
  const transcriptPath = payload?.transcript_path;
  const cwd = payload?.cwd;

  // Stage 2 — tool-matcher pre-filter (defense-in-depth; settings.json matcher
  // is primary). Gate Write only; Edit on src/** falls through to the persona-lock gate only.
  if (toolName !== GATED_TOOL) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const rawFilePath = toolInput?.file_path;
  if (typeof rawFilePath !== 'string' || rawFilePath === '') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const projectRoot = String((env && env.CLAUDE_PROJECT_DIR) ?? cwd ?? '').replace(/\\/g, '/');
  const target = normalizePath(rawFilePath, projectRoot);

  // Stage 3 — path scope check. Non-src writes silent-ALLOW (defense-in-depth vs
  // the harness `if: "Write(src/**)"` filter).
  if (!isUnderSrc(target)) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // Stage 4 — read .plans/plan_critique.md. HIGH† §10.4 row 3 mitigation (a):
  // missing or unreadable critique → silent ALLOW (FAIL-OPEN). Non-mission flows
  // (e.g. hotfix typo edits in src/ outside formal pipeline) must not block.
  let criticText;
  const criticPath = projectRoot ? join(projectRoot, PLAN_CRITIQUE_PATH) : PLAN_CRITIQUE_PATH;
  try {
    criticText = await readFileText(criticPath);
  } catch {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // Stage 5 — parse frontmatter + classify verdict.
  const { fields, error } = parseFrontmatter(criticText);
  if (error) {
    // Cat D's validate-plan-critique.mjs PostToolUse hook guards schema at
    // write-time per HIGH† mitigation (b); runtime parse-failure → silent
    // ALLOW (the file is structurally broken; the agent will self-correct on
    // its next /lfe-plan-critique run, after which the gate becomes meaningful
    // again).
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const verdictClass = classifyVerdict(fields);

  // ALLOW branches first — silent for PASS, audit-trail envelope for confirmed WARN.
  if (verdictClass === 'PASS') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  if (verdictClass === 'WARN_CONFIRMED') {
    const envelope = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `plan_critique.md verdict=WARN confirmed by Brain at ${fields.brain_confirmation}; gate opened for ${target}.`,
      },
    };
    return { exitCode: 0, stdout: JSON.stringify(envelope), stderr: '' };
  }

  // DENY candidates: WARN_NULL, BLOCK, UNKNOWN — fall through to Stage 6 escape check.

  // Stage 6 — LFE-FORCE escape detection. Asymmetric fail-safe per ADR 85:
  // transcript I/O error → DENY (silently hiding LFE-FORCE is worse than blocking
  // a write the user can retry).
  let transcriptText;
  let transcriptFailed = false;
  if (typeof transcriptPath === 'string' && transcriptPath !== '') {
    // Read only a bounded tail window (production wires readFileTail);
    // tests that inject only readFileText fall back to the full read, unchanged.
    const readTranscript = typeof readFileTail === 'function' ? readFileTail : readFileText;
    try {
      transcriptText = await readTranscript(transcriptPath);
    } catch {
      transcriptFailed = true;
    }
  } else {
    transcriptFailed = true;
  }

  const lfeForceDetected = transcriptFailed
    ? false
    : extractLfeForceFromTranscript(transcriptText, LFE_FORCE_SCAN_WINDOW);

  // For both the escape path (debt-row persona field) and the DENY path
  // (missionTag), read the entrance card. Fail-safe: substrate corruption →
  // `n/a` mission + `unknown` persona so the debt row / deny message remain
  // structurally valid.
  let personaRaw = 'unknown';
  let missionName = 'n/a';
  try {
    const entranceCardText = await readFileText(
      projectRoot ? join(projectRoot, ENTRANCE_CARD_FILENAME) : ENTRANCE_CARD_FILENAME,
    );
    const entrance = parseEntranceCard(entranceCardText);
    const parsedPersona = String(entrance.activePersona ?? '').trim();
    if (parsedPersona && parsedPersona !== 'unknown') {
      personaRaw = parsedPersona;
    }
    missionName = extractActiveMission(entranceCardText);
  } catch {
    // Substrate corruption — keep defaults. Same asymmetric fail-safe family as
    // the persona-lock gate, but the consequence here is just less-informative messages, not a
    // forced ALLOW (the verdict itself is the load-bearing signal).
  }

  if (lfeForceDetected) {
    // ESCAPE PATH — ALLOW + atomic append to PROTOCOL_DEBT.md.
    const debtPath = projectRoot ? join(projectRoot, PROTOCOL_DEBT_PATH) : PROTOCOL_DEBT_PATH;
    const nowIso = typeof now === 'function' ? now() : now;
    const row = buildDebtRow({ now: nowIso, missionName, persona: personaRaw, target });

    let writeStderr = '';
    try {
      const existing = await readFileText(debtPath);
      const updated = insertDebtRowIntoFile(existing, row);
      await writeFileText(debtPath, updated);
    } catch (err) {
      writeStderr = `[LFE Plan-Critique] LFE-FORCE detected but PROTOCOL_DEBT.md write failed (${err?.message ?? err}). Manual entry required.\n`;
    }

    const verdictTag = String(fields?.verdict ?? 'UNKNOWN');
    const envelope = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `LFE-FORCE override accepted. plan-critique gate bypassed (verdict was ${verdictTag}). PROTOCOL_DEBT.md row appended for ${target}. Next session must resolve the debt before new work.`,
      },
    };
    return {
      exitCode: 0,
      stdout: JSON.stringify(envelope),
      stderr:
        `[LFE Plan-Critique] LFE-FORCE override accepted — bypass on verdict=${verdictTag} for ${target}. Debt row appended to ${PROTOCOL_DEBT_PATH}.\n` +
        writeStderr,
    };
  }

  // Stage 7 — DENY PATH. Structured permissionDecision envelope + educational stderr.
  const message = buildPlanCritiqueDenyMessage({
    verdict: fields?.verdict,
    brainConfirmation: fields?.brain_confirmation,
    target,
    criticPath: PLAN_CRITIQUE_PATH,
    missionName,
  });
  const envelope = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: message,
    },
  };
  return {
    exitCode: 0,
    stdout: JSON.stringify(envelope),
    stderr: message + '\n',
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
    readFileTail,
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
  /plan-critique-gate\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    process.stderr.write(`[LFE Plan-Critique] hook infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
