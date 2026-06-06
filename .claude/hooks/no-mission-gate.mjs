#!/usr/bin/env node
// C4 — "No work without a mission" gate (ADR 95).
//
// Guards against substantive change at a completed/idle slate with no
// coordination trail. Fires on PreToolUse(Write|Edit). When the entrance card
// shows MISSION COMPLETE, no coordination trail exists in .plans/, and the
// target is a substantive (non-substrate) file, the agent is cowboying without
// a booted mission — warn (or, once promoted, deny) and point at /lfe-boot.
//
// Posture: WARN-AND-LOG first (ADR 87 family). Default decision is ALLOW + a
// telemetry record; flips to DENY only when .claude/enforcement-posture.json
// sets "no-mission": "block". Promotion is a deliberate human edit.
//
// Scope: Write|Edit only. The terminal (Bash) dimension is layered
// atop the shared git-command classifier rather than duplicating command
// parsing here.
//
// Self-brick guardrails — ALLOW immediately when ANY of:
//   1. target is substrate (framework-infra carve-out OR any .plans/ write —
//      writing the coordination trail is HOW a mission legitimately begins);
//   2. an active Scout session (Scout is a sanctioned no-trail lane, gated
//      separately by C2b);
//   3. a coordination trail already exists in .plans/ (mission in flight);
//   4. the entrance card does not show MISSION COMPLETE (active/other state);
//   5. the context is unreadable (asymmetric fail-safe ALLOW, ADR 85).
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

export const GATE_NAME = 'no-mission';
export const GATED_TOOLS = ['Write', 'Edit'];

// Substrate carve-out now lives in enforcement-context (shared by the whole gate
// family). Kept as a back-compat alias so existing imports/tests still resolve.
export const C4_CARVE_OUT = SUBSTRATE_CARVE_OUT;

export function buildWarnMessage({ target, missionState }) {
  return [
    `[LFE C4] No active mission — substantive change at an idle slate.`,
    ``,
    `  Target:        ${target}`,
    `  Mission State: ${missionState}`,
    ``,
    `  The project is at MISSION COMPLETE with no coordination trail in .plans/,`,
    `  yet a substantive file is being changed. Run /lfe-boot to route a new`,
    `  mission (Major Change) or declare a Minor Fix (/lfe-scout) first.`,
  ].join('\n');
}

// --- main() — pure decision tree, injected dependencies -----------------------

export async function main({ stdinText, readFileText, appendFileText, listPlans, now, env }) {
  // 1. Parse stdin. Infra-level: silent ALLOW on parse failure.
  let payload;
  try {
    payload = JSON.parse(String(stdinText ?? ''));
  } catch {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const toolName = payload?.tool_name;
  const cwd = payload?.cwd;

  // 2. Tool-matcher pre-filter (defense-in-depth; settings.json matcher is primary).
  if (!GATED_TOOLS.includes(toolName)) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const rawFilePath = payload?.tool_input?.file_path;
  if (typeof rawFilePath !== 'string' || rawFilePath === '') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const projectRoot = String((env && env.CLAUDE_PROJECT_DIR) ?? cwd ?? '').replace(/\\/g, '/');

  // 3. Read shared enforcement context.
  const ctx = await readEnforcementContext({ payload, readFileText, listPlans, projectRoot });

  // 4. Fail-safe ALLOW on unreadable substrate (ADR 85).
  if (ctx.unreadable) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: '[LFE C4] entrance card unreadable — fail-safe ALLOW.\n',
    };
  }

  // 5. Carve-outs → ALLOW silently.
  if (matchAnyGlob(ctx.target, C4_CARVE_OUT)) return { exitCode: 0, stdout: '', stderr: '' };
  if (ctx.scoutActive) return { exitCode: 0, stdout: '', stderr: '' };
  if (ctx.hasCoordinationTrail) return { exitCode: 0, stdout: '', stderr: '' };
  if (!ctx.missionCompleteIdle) return { exitCode: 0, stdout: '', stderr: '' };

  // 6. Trigger: substantive mutation + MISSION COMPLETE + no trail + not scout.
  const message = buildWarnMessage({ target: ctx.target, missionState: ctx.missionState });
  const posture = await readPosture(GATE_NAME, { readFileText, projectRoot });
  const decision = posture === 'block' ? 'deny' : 'warn';

  // Telemetry (observability only — never alters the decision).
  const record = buildRecord({
    now,
    gate: GATE_NAME,
    decision,
    reason: 'mission-complete-idle-no-trail',
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

  // WARN posture — ALLOW, but surface the warning on stderr.
  return { exitCode: 0, stdout: '', stderr: `[LFE C4 warn-and-log] ${message}\n` };
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
  /no-mission-gate\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    // Last-resort infra-error guard — never block on hook bugs.
    process.stderr.write(`[LFE C4] hook infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
