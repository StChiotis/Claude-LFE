#!/usr/bin/env node
// Persona Path-Locking PreToolUse Hook (Block-with-Escape posture).
//
// Fires on every PreToolUse(Write|Edit) event via .claude/settings.json. Mechanically
// enforces the persona-vs-path contract defined in .docs/protocol/PERSONAS.md +
// .agents/permissions.json by reading the Active Persona from pipeline_status.md and
// matching the target file_path against that persona's write_constraints glob list.
//
// Two posture differences vs Cat D (PostToolUse):
//   1. PreToolUse CAN pre-empt the tool call — emitting
//      hookSpecificOutput.permissionDecision: "deny" prevents the Write/Edit from
//      executing at all. The educational message is load-bearing because the agent
//      sees a real failure, not a post-hoc warning.
//   2. Block-with-Escape (BE): the LFE-FORCE keyword in recent user-turn transcript
//      content forces an ALLOW + atomic append to .docs/quality/PROTOCOL_DEBT.md
//      so the next session's /lfe-boot Step 5 surfaces the unresolved debt.
//
// Asymmetric fail-safe (per ADR 85):
//   - Substrate-corruption failures (unparseable pipeline_status.md, missing persona
//     row in permissions.json) → ALLOW + stderr warning. An unparseable framework
//     substrate must not lock the user out of recovery.
//   - Detection-path failures (transcript_path read I/O error) → DENY. Allowing here
//     could silently hide an LFE-FORCE we missed. Asymmetric, deliberate.
//
// Framework-infrastructure carve-out (per ADR 84): paths in FRAMEWORK_INFRA_PATHS
// are persona-agnostic — they are the mechanical substrate of persona-locking
// itself, not domain/project content subject to persona discipline.
//
// Mission-awareness (ADR 95, extends
// ADR 84): when an IN-FLIGHT mission declares an `Authorized Scope` glob list in
// the entrance card, a target matching that scope is ALLOWED even outside the
// persona's write_constraints — so a sanctioned mission can write a second repo
// without LFE-FORCE. Empty/placeholder/absent scope or no in-flight mission →
// no extension (unchanged behavior). Speed-bump, not containment (the scope row
// lives in the agent-editable entrance card; the harness sandbox is the boundary).
//
// The BE substrate helpers (normalizePath, matchGlob,
// matchAnyGlob, extractActiveMission, extractLfeForceFromTranscript, buildDebtRow,
// insertDebtRowIntoFile) plus their canonical constants (LFE_FORCE_KEYWORD,
// LFE_FORCE_SCAN_WINDOW, PROTOCOL_DEBT_PATH) moved to `.claude/lib/be-escape.mjs`
// so plan-critique-gate.mjs can consume them without coupling to this
// hook script. This module re-exports the moved symbols so existing test imports
// (`from '../persona-path-lock.mjs'`) continue to resolve; future Hygiene may
// rewrite those test imports to point at `be-escape.mjs` directly and remove the
// re-export shim below. The `normalizePath` lifted into be-escape.mjs now applies
// `posix.normalize()` to close Sec-G1.H1 (path-traversal bypass of the framework-
// infra carve-out documented in known-issues.md).
//
// Test seam: pure main({ stdinText, readFileText, writeFileText, now, env }) with
// injected dependencies. CLI wrapper at bottom wires real I/O; tests inject mocks.
// Mirrors the proven Cat D pattern in validate-frontmatter.mjs.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { parseEntranceCard, ENTRANCE_CARD_FILENAME } from '../lib/parse-entrance-card.mjs';
import {
  LFE_FORCE_KEYWORD,
  LFE_FORCE_SCAN_WINDOW,
  PROTOCOL_DEBT_PATH,
  normalizePath,
  matchGlob,
  matchAnyGlob,
  extractActiveMission,
  extractAuthorizedScope,
  extractLfeForceFromTranscript,
  buildDebtRow,
  insertDebtRowIntoFile,
} from '../lib/be-escape.mjs';
import { readFileTail } from '../lib/read-file-tail.mjs';
import { leadingPersonaName } from '../lib/persona-name.mjs';

// --- Constants ----------------------------------------------------------------

// Two carve-out categories, both persona-agnostic (per ADR 84):
//   Category I  — Mechanical wiring (Claude Code substrate — both project-local
//                 AND harness-managed — git hooks, setup/sync scripts, plugin
//                 manifest). These ARE the mechanism that enforces persona-locking;
//                 subjecting them to persona discipline would prevent the framework
//                 from being maintained. Harness-managed paths covered:
//                 `~/.claude/plans/**` (Claude Code's plan-mode file storage,
//                 absolute, outside project root; see
//                 LLM_AGENT_GUIDE.md §10 Constraint #12), `~/.claude/projects/**`
//                 (Claude Code's auto-memory store — a mirror of the
//                 plan-store carve-out pattern). ADR 90 extends Cat I
//                 with adopter-facing project-infrastructure globs:
//
//                 `.agents/skills/**` (LFE-SOURCE skill protocol),
//                 `.gitattributes` / `.gitignore` (repo-wide config metadata),
//                 `.github/**` (PR templates + future CI/CD workflows).
//   Category II — Coordination-state files (entrance card + operator manuals). The
//                 file determining "who is the active persona" cannot itself be
//                 persona-locked — the lock would deadlock the Archivist's
//                 end-of-mission state transition. Same architectural truth as
//                 /etc/passwd being root-owned regardless of the current user.
//                 LLM_AGENT_GUIDE.md §10 is the project-specific binding registry
//                 the Archivist must append to per the same end-of-mission cycle.
//                 ADR 90 extends Cat II with `CLAUDE.md` (Claude
//                 Code adapter pointer stub) and `USER_MANUAL.md` (framework
//                 operator manual for adopters) — both are framework documentation
//                 only, never adopter-product content.
export const FRAMEWORK_INFRA_PATHS = [
  // Category I — mechanical wiring (project-local + harness-managed)
  '.claude/**',
  '.githooks/**',
  'scripts/setup-*.mjs',
  'scripts/sync-*.mjs',
  '.claude-plugin/**',
  '**/.claude/plans/**',
  '**/.claude/projects/**',
  // Category I — adopter-facing project infrastructure (ADR 90)
  '.agents/skills/**',
  '.gitattributes',
  '.gitignore',
  '.github/**',
  // Category I — package manifest: defines the mechanical npm scripts
  // (sync:lfe-skills, postinstall, test); sibling of scripts/setup-*.mjs / sync-*.mjs above.
  'package.json',
  // Category II — coordination-state files (substrate of persona-locking itself)
  'pipeline_status.md',
  'LLM_AGENT_GUIDE.md',
  // Category II — framework operator manuals (ADR 90; README.md added per the ADR 90 amendment)
  'CLAUDE.md',
  'USER_MANUAL.md',
  'README.md',
];

export const PERMISSIONS_PATH = '.agents/permissions.json';
export const GATED_TOOLS = ['Write', 'Edit'];
export const SCHEMA_REFERENCE = '.docs/protocol/PERSONAS.md + .agents/permissions.json';

// Named invariant (ADR 101): the product-code lane is writable ONLY under the
// Builder persona. An IN-FLIGHT mission's Authorized Scope may widen reach to
// docs or a second repo, but it must never hand a non-Builder persona
// (Inspector/Archivist) write access to src/** — that is the "patch-in-place at
// the finalization step" door the human-rejection rework loop closes. Scoped to
// the Authorized-Scope extension only; the persona's own write_constraints
// (Step 5) and the LFE-FORCE escape (Step 6) are unaffected.
export const SRC_LANE_GLOB = 'src/**';
export const SRC_LANE_PERSONA = 'builder';

// --- Re-exports from be-escape.mjs (backward-compat shim) -------

export {
  LFE_FORCE_KEYWORD,
  LFE_FORCE_SCAN_WINDOW,
  PROTOCOL_DEBT_PATH,
  normalizePath,
  matchGlob,
  matchAnyGlob,
  extractActiveMission,
  extractAuthorizedScope,
  extractLfeForceFromTranscript,
  buildDebtRow,
  insertDebtRowIntoFile,
};

// --- Persona-lock-specific helper (deny-message template) ---------------------------

export function buildDenyMessage({ persona, target, allowedList, missionName }) {
  const allowed = Array.isArray(allowedList) && allowedList.length > 0
    ? allowedList.join(', ')
    : '(none — persona has no write_constraints)';
  const missionTag = missionName && missionName !== 'n/a' ? ` (mission: ${missionName})` : '';
  return [
    `[LFE Path-Lock] Persona path-lock denied write${missionTag}.`,
    ``,
    `  Persona:  ${persona}`,
    `  Target:   ${target}`,
    `  Allowed:  ${allowed}`,
    `  Schema:   ${SCHEMA_REFERENCE}`,
    ``,
    `  To bypass once with documentation: type ${LFE_FORCE_KEYWORD} in your next prompt;`,
    `  a PROTOCOL_DEBT.md row will be filed automatically and the next session's`,
    `  /lfe-boot will surface the unresolved debt before any new work.`,
    ``,
    `  To suppress this hook locally (last resort): comment out the PreToolUse`,
    `  entry in .claude/settings.local.json (gitignored override) and file an issue.`,
  ].join('\n');
}

// --- main() — pure decision tree, injected dependencies ------------------------

export async function main({ stdinText, readFileText, readFileTail, writeFileText, now, env }) {
  // 1. Parse stdin tool payload. Infra-level: silent ALLOW on parse failure.
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

  // Tool-matcher pre-filter (defense-in-depth; settings.json matcher is primary).
  if (!GATED_TOOLS.includes(toolName)) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const rawFilePath = toolInput?.file_path;
  if (typeof rawFilePath !== 'string' || rawFilePath === '') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const projectRoot = String((env && env.CLAUDE_PROJECT_DIR) ?? cwd ?? '').replace(/\\/g, '/');
  const target = normalizePath(rawFilePath, projectRoot);

  // 2. Framework-infrastructure carve-out (per ADR 84). Persona-agnostic.
  if (matchAnyGlob(target, FRAMEWORK_INFRA_PATHS)) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // 3. Read entrance card → Active Persona. Fail-safe ALLOW on substrate corruption.
  let entranceCardText;
  try {
    entranceCardText = await readFileText(
      projectRoot ? join(projectRoot, ENTRANCE_CARD_FILENAME) : ENTRANCE_CARD_FILENAME,
    );
  } catch (err) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE Path-Lock] pipeline_status.md unreadable (${err?.message ?? err}) — fail-safe ALLOW.\n`,
    };
  }

  const entrance = parseEntranceCard(entranceCardText);
  const personaRaw = String(entrance.activePersona ?? '').trim();
  // Extract the persona via the shared emoji-tolerant reader instead of
  // lowercasing the whole cell. The live card is decorated (`🔨 Builder`); the old
  // raw-lowercase key ('🔨 builder') missed permissions.json and fail-safe-ALLOWed,
  // silently un-enforcing the persona lane. null (emoji-only / unknown / garbage
  // cell) preserves the existing fail-safe ALLOW.
  const persona = leadingPersonaName(personaRaw);
  if (!persona) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: '[LFE Path-Lock] pipeline_status.md Active Persona unparseable — fail-safe ALLOW.\n',
    };
  }
  const missionName = extractActiveMission(entranceCardText);

  // 4. Read permissions.json → persona.write_constraints. Fail-safe ALLOW on missing.
  let permsText;
  try {
    permsText = await readFileText(
      projectRoot ? join(projectRoot, PERMISSIONS_PATH) : PERMISSIONS_PATH,
    );
  } catch (err) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE Path-Lock] permissions.json unreadable (${err?.message ?? err}) — fail-safe ALLOW.\n`,
    };
  }

  let perms;
  try {
    perms = JSON.parse(permsText);
  } catch (err) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE Path-Lock] permissions.json malformed JSON (${err?.message ?? err}) — fail-safe ALLOW.\n`,
    };
  }

  const personaEntry = perms?.personas?.[persona];
  if (!personaEntry) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[LFE Path-Lock] Persona "${persona}" not found in permissions.json — fail-safe ALLOW.\n`,
    };
  }
  const writeConstraints = Array.isArray(personaEntry.write_constraints)
    ? personaEntry.write_constraints
    : [];

  // 5. Persona allow-list match → ALLOW silent.
  if (matchAnyGlob(target, writeConstraints)) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // 5.5. Mission-aware scope extension (per
  // ADR 95, extends ADR 84). An IN-FLIGHT mission may extend the authorized write
  // scope via the entrance card's `Authorized Scope` row, so a sanctioned mission
  // can write outside the persona's write_constraints (e.g. a second repo) without
  // LFE-FORCE. No in-flight mission, or an empty/placeholder scope, means NO
  // extension — control falls through to the LFE-FORCE/deny path below, byte-for-byte
  // unchanged from before this slice. The entrance card is agent-editable (Cat II
  // carve-out), so this is a speed-bump, not containment (ADR 95 doctrine).
  const missionInFlight = /IN-FLIGHT/i.test(String(entrance.missionState ?? ''));
  if (missionInFlight) {
    const authorizedScope = extractAuthorizedScope(entranceCardText);
    if (authorizedScope.length > 0 && matchAnyGlob(target, authorizedScope)) {
      // src-lane invariant (ADR 101): Authorized Scope must NOT grant a
      // non-Builder persona write access to src/**. If the target is in the
      // product-code lane and the persona is not Builder, do NOT take the
      // mission-scope ALLOW — fall through to the LFE-FORCE escape / deny path
      // below (LFE-FORCE remains the sole documented way to patch src under a
      // non-Builder persona, and still files PROTOCOL_DEBT).
      const srcLaneUnderNonBuilder =
        matchGlob(target, SRC_LANE_GLOB) && persona !== SRC_LANE_PERSONA;
      if (!srcLaneUnderNonBuilder) {
        return {
          exitCode: 0,
          stdout: '',
          stderr: `[LFE Path-Lock] mission-authorized write — ${personaRaw} → ${target} (active-mission Authorized Scope). ALLOW.\n`,
        };
      }
    }
  }

  // 6. LFE-FORCE escape detection. Asymmetric fail-safe: DENY on transcript I/O fail.
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
      writeStderr = `[LFE Path-Lock] LFE-FORCE detected but PROTOCOL_DEBT.md write failed (${err?.message ?? err}). Manual entry required.\n`;
    }

    const envelope = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `LFE-FORCE override accepted. PROTOCOL_DEBT.md row appended for ${persona} → ${target}. Next session must resolve the debt before new work.`,
      },
    };
    return {
      exitCode: 0,
      stdout: JSON.stringify(envelope),
      stderr:
        `[LFE Path-Lock] LFE-FORCE override accepted — ${persona} → ${target}. Debt row appended to ${PROTOCOL_DEBT_PATH}.\n` +
        writeStderr,
    };
  }

  // 7. DENY PATH — structured permissionDecision + educational message.
  const message = buildDenyMessage({
    persona: personaRaw,
    target,
    allowedList: writeConstraints,
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
  /persona-path-lock\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    // Last-resort infra-error guard — never block on hook bugs.
    process.stderr.write(`[LFE Path-Lock] hook infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
