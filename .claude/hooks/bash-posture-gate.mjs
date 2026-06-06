#!/usr/bin/env node
// C1 — Terminal git posture gate (ADR 95).
//
// The terminal is an unguarded escape hatch. Fires on
// PreToolUse(Bash). Classifies the command for mutating git verbs and applies a
// two-tier ceremony:
//   tier 1 (commit/reset/rebase/cherry-pick/revert/tag/push) → needs an active mission;
//   tier 2 (merge / push-to-main / force-push / legal-anchor tag) → needs an active
//           mission AND a typed human confirmation (MERGE-OK) in the recent transcript.
//
// Posture: WARN-AND-LOG first (ADR 87); flips to DENY only when
// .claude/enforcement-posture.json sets "bash-posture": "block".
//
// SPEED BUMP, NOT A SANDBOX (ADR 95): command-string parsing is bypassable
// (aliasing/indirection); general-shell file-laundering (rm/mv/sed/redirection)
// is out of scope by design. Asymmetric fail-safe (ADR 85): on classifier error
// or unreadable context → ALLOW, but LOG. A Tier-2 with an unreadable transcript
// counts as NOT confirmed (safe).
//
// Test seam: pure main({ stdinText, readFileText, appendFileText, listPlans,
// now, env }) with injected I/O.

import { readFile, appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { extractKeywordFromTranscript } from '../lib/be-escape.mjs';
import { readFileTail } from '../lib/read-file-tail.mjs';
import { classifyGitCommand, TIER_NONE, TIER_MISSION } from '../lib/git-command-classifier.mjs';
import { readEnforcementContext, readPosture } from '../lib/enforcement-context.mjs';
import { buildRecord, recordWarn, TELEMETRY_PATH } from '../lib/enforcement-telemetry.mjs';

// --- Constants ----------------------------------------------------------------

export const GATE_NAME = 'bash-posture';
export const CONFIRM_KEYWORD = 'MERGE-OK';
export const CONFIRM_SCAN_WINDOW = 5;

export function hasActiveMission(ctx) {
  return /IN-FLIGHT/i.test(String(ctx?.missionState ?? '')) || ctx?.hasCoordinationTrail === true;
}

export function buildBashMessage({ tier, verb, reason }) {
  if (reason === 'git-tier2-needs-confirmation') {
    return [
      `[LFE C1] High-blast git op (${verb}) needs explicit confirmation.`,
      ``,
      `  This touches main / force / a legal-anchor tag. With an active mission set,`,
      `  type ${CONFIRM_KEYWORD} in your next message to authorize it.`,
    ].join('\n');
  }
  if (reason === 'git-tier2-no-mission') {
    return [
      `[LFE C1] High-blast git op (${verb}) with no active mission.`,
      ``,
      `  Route a mission via /lfe-boot first, then type ${CONFIRM_KEYWORD} to authorize`,
      `  this main/force/legal-tag operation.`,
    ].join('\n');
  }
  return [
    `[LFE C1] Mutating git op (${verb}) with no active mission.`,
    ``,
    `  Run /lfe-boot to route a mission (or /lfe-scout for a minor fix) before`,
    `  committing/tagging/pushing.`,
  ].join('\n');
}

// --- main() -------------------------------------------------------------------

export async function main({ stdinText, readFileText, readFileTail, appendFileText, listPlans, now, env }) {
  let payload;
  try {
    payload = JSON.parse(String(stdinText ?? ''));
  } catch {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  if (payload?.tool_name !== 'Bash') return { exitCode: 0, stdout: '', stderr: '' };

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || command.trim() === '') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const projectRoot = String((env && env.CLAUDE_PROJECT_DIR) ?? payload?.cwd ?? '').replace(/\\/g, '/');
  const telemetryPath = projectRoot ? join(projectRoot, TELEMETRY_PATH) : TELEMETRY_PATH;

  // Classify. Asymmetric fail-safe: a classifier error → ALLOW + LOG.
  let cls;
  try {
    cls = classifyGitCommand(command);
  } catch (err) {
    await recordWarn({
      appendFileText,
      path: telemetryPath,
      record: buildRecord({ now, gate: GATE_NAME, decision: 'warn', reason: 'classifier-error-allow', target: 'bash' }),
    });
    return { exitCode: 0, stdout: '', stderr: `[LFE C1] classifier error (${err?.message ?? err}) — fail-safe ALLOW.\n` };
  }

  if (!cls || cls.tier === TIER_NONE) return { exitCode: 0, stdout: '', stderr: '' };

  // Read shared context.
  const ctx = await readEnforcementContext({ payload, readFileText, listPlans, projectRoot });
  if (ctx.unreadable) {
    return { exitCode: 0, stdout: '', stderr: '[LFE C1] entrance card unreadable — fail-safe ALLOW.\n' };
  }

  const missionActive = hasActiveMission(ctx);

  let reason;
  if (cls.tier === TIER_MISSION) {
    if (missionActive) return { exitCode: 0, stdout: '', stderr: '' };
    reason = 'git-mutation-no-mission';
  } else {
    // Tier 2 — needs mission AND confirmation.
    let confirmed = false;
    if (missionActive) {
      let transcriptText = null;
      const transcriptPath = payload?.transcript_path;
      if (typeof transcriptPath === 'string' && transcriptPath !== '') {
        // Bounded tail read (prod wires readFileTail); tests that inject
        // only readFileText fall back to the full read, unchanged.
        const readTranscript = typeof readFileTail === 'function' ? readFileTail : readFileText;
        try {
          transcriptText = await readTranscript(transcriptPath);
        } catch {
          transcriptText = null;
        }
      }
      confirmed = transcriptText
        ? extractKeywordFromTranscript(transcriptText, CONFIRM_KEYWORD, CONFIRM_SCAN_WINDOW)
        : false;
    }
    if (confirmed) return { exitCode: 0, stdout: '', stderr: '' };
    reason = missionActive ? 'git-tier2-needs-confirmation' : 'git-tier2-no-mission';
  }

  // Blocked branch — warn (default) or deny (block posture) + telemetry.
  const message = buildBashMessage({ tier: cls.tier, verb: cls.verb, reason });
  const posture = await readPosture(GATE_NAME, { readFileText, projectRoot });
  const decision = posture === 'block' ? 'deny' : 'warn';

  await recordWarn({
    appendFileText,
    path: telemetryPath,
    record: buildRecord({
      now,
      gate: GATE_NAME,
      decision,
      reason,
      target: `git ${cls.verb}`,
      sessionId: ctx.sessionId,
      persona: ctx.activePersona,
      missionState: ctx.missionState,
    }),
  });

  if (decision === 'deny') {
    const envelope = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: message,
      },
    };
    return { exitCode: 0, stdout: JSON.stringify(envelope), stderr: message + '\n' };
  }

  return { exitCode: 0, stdout: '', stderr: `[LFE C1 warn-and-log] ${message}\n` };
}

// --- CLI wrapper --------------------------------------------------------------

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
    appendFileText: (p, c) => appendFile(p, c, 'utf8'),
    listPlans: () => {
      const root = String(process.env.CLAUDE_PROJECT_DIR ?? process.cwd()).replace(/\\/g, '/');
      return readdir(join(root, '.plans'));
    },
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
  /bash-posture-gate\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    process.stderr.write(`[LFE C1] hook infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
