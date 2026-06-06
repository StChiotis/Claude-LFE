#!/usr/bin/env node
// C2a — Boot-precondition gate (ADR 95).
//
// Orientation is advisory: refuse substantive mutations until
// /lfe-boot has run for THIS session. Fires on PreToolUse(Write|Edit). Terminal
// (Bash) coverage is layered across the terminal-gate family.
//
// Session handshake (no skill-visible session_id needed): the SessionStart hook
// writes .plans/.session-id = session_id (rotates per session); /lfe-boot copies
// it to .plans/.session-booted; this gate treats the session as booted iff the
// two files exist and match (computed in enforcement-context as ctx.booted).
//
// Posture: WARN-AND-LOG first (ADR 87 family); flips to DENY only when
// .claude/enforcement-posture.json sets "boot-precondition": "block".
//
// Decision tree — ALLOW immediately when ANY of:
//   1. target is substrate (SUBSTRATE_CARVE_OUT — incl. .plans/** so the boot's
//      own marker write and all coordination writes pass);
//   2. an active Scout session (scout-activation path must not be gated);
//   3. the boot mechanism is NOT primed (no .session-id yet — e.g. a session
//      predating this feature) → fail-safe ALLOW, silent (no warn noise);
//   4. context unreadable → fail-safe ALLOW (ADR 85);
//   5. the session IS booted (markers match).
// Otherwise (primed + not booted + substantive + not scout) → warn (or deny).
//
// Test seam: pure main({ stdinText, readFileText, appendFileText, listPlans,
// now, env }) with injected I/O. CLI wrapper at bottom wires real I/O.

import { readFile, appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { matchAnyGlob } from '../lib/be-escape.mjs';
import { readEnforcementContext, readPosture, SUBSTRATE_CARVE_OUT } from '../lib/enforcement-context.mjs';
import { buildRecord, recordWarn, TELEMETRY_PATH } from '../lib/enforcement-telemetry.mjs';

// --- Constants ----------------------------------------------------------------

export const GATE_NAME = 'boot-precondition';
export const GATED_TOOLS = ['Write', 'Edit'];

export function buildWarnMessage({ target }) {
  return [
    `[LFE C2a] Session not booted — run /lfe-boot before changing files.`,
    ``,
    `  Target: ${target}`,
    ``,
    `  This session has started but /lfe-boot has not run, so the framework is`,
    `  not oriented to the current state. Run /lfe-boot first (it reads state,`,
    `  detects interrupted sessions, and routes the Complexity Gate).`,
  ].join('\n');
}

// --- main() — pure decision tree, injected dependencies -----------------------

export async function main({ stdinText, readFileText, appendFileText, listPlans, now, env }) {
  let payload;
  try {
    payload = JSON.parse(String(stdinText ?? ''));
  } catch {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const toolName = payload?.tool_name;
  const cwd = payload?.cwd;

  if (!GATED_TOOLS.includes(toolName)) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const rawFilePath = payload?.tool_input?.file_path;
  if (typeof rawFilePath !== 'string' || rawFilePath === '') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const projectRoot = String((env && env.CLAUDE_PROJECT_DIR) ?? cwd ?? '').replace(/\\/g, '/');

  const ctx = await readEnforcementContext({ payload, readFileText, listPlans, projectRoot });

  // Fail-safe ALLOW on unreadable substrate (ADR 85).
  if (ctx.unreadable) {
    return { exitCode: 0, stdout: '', stderr: '[LFE C2a] entrance card unreadable — fail-safe ALLOW.\n' };
  }

  // Carve-outs / not-applicable → ALLOW silently.
  if (matchAnyGlob(ctx.target, SUBSTRATE_CARVE_OUT)) return { exitCode: 0, stdout: '', stderr: '' };
  if (ctx.scoutActive) return { exitCode: 0, stdout: '', stderr: '' };
  // Mechanism not primed (no .session-id rotated yet) → cannot determine boot
  // state → fail-safe ALLOW, silent (avoids warn noise in sessions predating the feature).
  if (!ctx.bootMechanismPrimed) return { exitCode: 0, stdout: '', stderr: '' };
  if (ctx.booted) return { exitCode: 0, stdout: '', stderr: '' };

  // Trigger: primed + not booted + substantive + not scout.
  const message = buildWarnMessage({ target: ctx.target });
  const posture = await readPosture(GATE_NAME, { readFileText, projectRoot });
  const decision = posture === 'block' ? 'deny' : 'warn';

  const record = buildRecord({
    now,
    gate: GATE_NAME,
    decision,
    reason: 'session-not-booted',
    target: ctx.target,
    sessionId: ctx.sessionId,
    persona: ctx.activePersona,
    missionState: ctx.missionState,
  });
  const telemetryPath = projectRoot ? join(projectRoot, TELEMETRY_PATH) : TELEMETRY_PATH;
  await recordWarn({ appendFileText, path: telemetryPath, record });

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

  return { exitCode: 0, stdout: '', stderr: `[LFE C2a warn-and-log] ${message}\n` };
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
  /boot-precondition-gate\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    process.stderr.write(`[LFE C2a] hook infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
