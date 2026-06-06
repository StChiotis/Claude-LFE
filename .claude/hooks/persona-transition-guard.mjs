#!/usr/bin/env node
// C3 (light) — Persona-transition guard (ADR 95).
//
// Self-attested-persona guard: a free-hand agent edit must not
// silently elevate the Active Persona in pipeline_status.md. Fires on
// PreToolUse(Write|Edit) but acts ONLY on pipeline_status.md — every other
// target is allowed untouched. The entrance card and its Active Persona field
// are PRESERVED (the Brain's explicit LIGHT-fix decision);
// only the *act of changing the persona value* is guarded.
//
// Official vs free-hand: an official skill-dispatched transition drops a marker
// (.plans/.persona-transition = the new persona name) immediately before editing
// the row. When the marker is present and matches the incoming persona, the
// change is official → ALLOW. Otherwise → warn (or, once promoted, deny).
//
// "Persona" = the leading persona NAME only (Architect/Builder/Inspector/
// Archivist/Scout); the trailing *(...)* note is ignored, so re-noting the same
// persona is NOT a transition.
//
// before/after model: "before" = the persona currently on disk (parsed by
// readEnforcementContext from the live entrance card). "after" = the persona in
// the incoming change — new_string for Edit, content for Write. This is more
// authoritative than parsing old_string and unifies the two tool branches.
//
// Posture: WARN-AND-LOG first (ADR 87 family); flips to DENY only when
// .claude/enforcement-posture.json sets "persona-transition": "block".
//
// Decision tree — ALLOW immediately when ANY of:
//   1. target is not pipeline_status.md (the gate's sole subject);
//   2. context unreadable → fail-safe ALLOW (ADR 85);
//   3. before/after persona indeterminate (the incoming change does not touch a
//      known persona name, or the live card has none) → no detectable change;
//   4. before === after (same leading name — a *(...)*-note-only re-write);
//   5. an official marker is present and matches the new persona.
// Otherwise (persona changed, marker absent/mismatched) → warn (or deny).
//
// Residual (noted for the Inspector per plan_critique Lens 4): the marker is not
// auto-consumed — it persists in .plans/ and is overwritten on each official
// transition. A later change BACK to the marked persona could spuriously pass.
// Acceptable for warn-first; the marker is single-purpose per transition.
//
// Test seam: pure main({ stdinText, readFileText, appendFileText, listPlans,
// now, env }) with injected I/O. CLI wrapper at bottom wires real I/O.

import { readFile, appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { parseEntranceCard, ENTRANCE_CARD_FILENAME } from '../lib/parse-entrance-card.mjs';
import { readEnforcementContext, readPosture } from '../lib/enforcement-context.mjs';
import { buildRecord, recordWarn, TELEMETRY_PATH } from '../lib/enforcement-telemetry.mjs';
import { PERSONA_NAMES, leadingPersonaName } from '../lib/persona-name.mjs';

// --- Constants ----------------------------------------------------------------

export const GATE_NAME = 'persona-transition';
export const GATED_TOOLS = ['Write', 'Edit'];

// The official-transition marker: a .plans/ dotfile (gitignored/transient),
// carved out of the other gates (SUBSTRATE_CARVE_OUT includes .plans/**). The
// persona-setting skills (plan-critique → Builder, inspector → Archivist,
// archivist → Architect) write it = the new persona name immediately before
// editing the Active Persona row.
export const TRANSITION_MARKER_PATH = '.plans/.persona-transition';

// --- Pure helpers (exported for unit testing) ---------------------------------

// PERSONA_NAMES + leadingPersonaName now live in the shared persona-name reader
// All four Active-Persona-cell consumers use ONE emoji-tolerant
// parser. Re-exported here so this gate's existing test imports
// (`from '../persona-transition-guard.mjs'`) keep resolving unchanged. The lib
// reader strips a leading emoji before the word-boundary match — fixing C3
// against the real decorated card (its old local copy returned null on the
// emoji prefix → indeterminate → every transition was silently allowed).
export { PERSONA_NAMES, leadingPersonaName };

// Persona name from an arbitrary text blob, located via parseEntranceCard's
// Active Persona row parser. Returns null when the blob has no parseable persona
// row — i.e. the change does not touch the persona line, so nothing to guard.
export function personaFromText(text) {
  return leadingPersonaName(parseEntranceCard(text).activePersona);
}

export function buildWarnMessage({ before, after, target }) {
  return [
    `[LFE C3] Active Persona changed without an official transition marker.`,
    ``,
    `  Target: ${target}`,
    `  From:   ${before}`,
    `  To:     ${after}`,
    ``,
    `  A persona change is "official" only when a framework skill drops`,
    `  ${TRANSITION_MARKER_PATH} = the new persona name immediately before`,
    `  editing the row. A free-hand edit that elevates the persona bypasses the`,
    `  assembly line — let the dispatched skill perform the transition instead.`,
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

  const toolInput = payload?.tool_input ?? {};
  const rawFilePath = toolInput?.file_path;
  if (typeof rawFilePath !== 'string' || rawFilePath === '') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const projectRoot = String((env && env.CLAUDE_PROJECT_DIR) ?? cwd ?? '').replace(/\\/g, '/');

  // 3. Read shared enforcement context (normalizes target, parses the live card).
  const ctx = await readEnforcementContext({ payload, readFileText, listPlans, projectRoot });

  // 4. Fail-safe ALLOW on unreadable substrate (ADR 85).
  if (ctx.unreadable) {
    return { exitCode: 0, stdout: '', stderr: '[LFE C3] entrance card unreadable — fail-safe ALLOW.\n' };
  }

  // 5. Sole subject: pipeline_status.md. Every other target → ALLOW silently.
  const isEntranceCard =
    ctx.target === ENTRANCE_CARD_FILENAME ||
    String(ctx.target).endsWith('/' + ENTRANCE_CARD_FILENAME);
  if (!isEntranceCard) return { exitCode: 0, stdout: '', stderr: '' };

  // 6. before = persona on the live card; after = persona in the incoming change.
  const before = leadingPersonaName(ctx.activePersona);
  const incomingText = toolName === 'Edit' ? toolInput?.new_string : toolInput?.content;
  const after = personaFromText(incomingText);

  // 7. Indeterminate (incoming change has no parseable persona row, or the card
  //    has none) → no detectable persona change → ALLOW.
  if (after === null || before === null) return { exitCode: 0, stdout: '', stderr: '' };

  // 8. Same leading name (re-note only — *(...)* changed, persona did not) → ALLOW.
  if (before === after) return { exitCode: 0, stdout: '', stderr: '' };

  // 9. Transition detected. Official iff the marker exists and matches `after`.
  const markerPath = projectRoot ? join(projectRoot, TRANSITION_MARKER_PATH) : TRANSITION_MARKER_PATH;
  let markerContent = null;
  try {
    markerContent = String(await readFileText(markerPath)).trim();
  } catch {
    markerContent = null;
  }
  if (markerContent !== null && markerContent.toLowerCase() === after) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // 10. Free-hand / mismatched transition → warn (or deny once promoted).
  const message = buildWarnMessage({ before, after, target: ctx.target });
  const posture = await readPosture(GATE_NAME, { readFileText, projectRoot });
  const decision = posture === 'block' ? 'deny' : 'warn';

  // Telemetry (observability only — never alters the decision).
  const record = buildRecord({
    now,
    gate: GATE_NAME,
    decision,
    reason: 'persona-transition-no-marker',
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
  return { exitCode: 0, stdout: '', stderr: `[LFE C3 warn-and-log] ${message}\n` };
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
  /persona-transition-guard\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    // Last-resort infra-error guard — never block on hook bugs.
    process.stderr.write(`[LFE C3] hook infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
