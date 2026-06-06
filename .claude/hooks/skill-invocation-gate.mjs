#!/usr/bin/env node
// UserPromptSubmit Skill Invocation Gate (Block-strict posture).
//
// Fires on every UserPromptSubmit event via .claude/settings.json. Mechanically
// enforces LLM_AGENT_GUIDE.md §8.8 — the 5 Brain-typeable skills pass through
// unconditionally; the 17 agent-only skills are gated by predecessor coordination
// file presence + frontmatter state in .plans/.
//
// Posture: Block-strict (BS). No LFE-FORCE escape — cold agent-only invocations
// have no legitimate use case worth escaping. The 5 Brain-typeable directives
// ARE the legitimate manual-invocation set per §8.8. Documented in op-manual
// §10.4 row 2 posture audit. (LFE-FORCE keyword pass-through is for the keyword
// itself in a non-/lfe-* prompt, not an escape from this gate's denials.)
//
// Asymmetric fail-safe (per ADR 85 family):
//   - Stdin parse failure → ALLOW. No parseable directive to gate; blocking on
//     Claude Code infrastructure issues would harm normal conversation.
//   - Predecessor file read I/O error → treat as MISSING and DENY. Allowing
//     could silently let a missing-state skill invocation through.
//   - Predecessor frontmatter parse error → treat as malformed and DENY.
//   - Entry-point absent-when read failure → ALLOW (any read failure on the
//     absent-when path is consistent with the "no output yet" entry-point state).
//
// Test seam: pure main({ stdinText, readFileText, env }) with injected
// dependencies. CLI wrapper at bottom wires real I/O; tests inject mocks.
// Mirrors the proven persona-lock / Cat D dependency-injection pattern.

import { readFile, appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { parseEntranceCard, ENTRANCE_CARD_FILENAME } from '../lib/parse-entrance-card.mjs';
import { parseFrontmatter } from '../lib/parse-frontmatter.mjs';
import { readEnforcementContext, readPosture } from '../lib/enforcement-context.mjs';
import { buildRecord, recordWarn, TELEMETRY_PATH } from '../lib/enforcement-telemetry.mjs';
import { stripControl } from '../lib/text-format.mjs';

// --- Constants ----------------------------------------------------------------

export const LFE_FORCE_KEYWORD = 'LFE-FORCE';

// Anchored to start of message (allowing leading whitespace) — avoids matching
// embedded references like "see /lfe-builder docs". Case-insensitive so typos
// like /LFE-Builder still surface as unknown-skill denies rather than passing
// through as normal conversation.
export const DIRECTIVE_REGEX = /^\s*(\/lfe-[a-z][a-z-]*)/i;

export const BRAIN_TYPEABLE_SKILLS = Object.freeze([
  'lfe-boot',
  'lfe-whats-next',
  'lfe-scout',
  'lfe-extract-domain',
]);

function makeSubSkillDescriptor() {
  // Factory so the 5 Inspector sub-skills don't duplicate config. Each sub-skill
  // is gated by BOTH builder_done.md AND tdd_report.md being complete — meaning
  // the sub-skill is only legitimate during Inspector phase (Phase 3.2 dispatch).
  return {
    kind: 'all_of',
    upstream: '/lfe-inspector (sub-skills are dispatched, not typed directly)',
    requirement: 'both .plans/builder_done.md and .plans/tdd_report.md have status=complete',
    parts: [
      {
        path: '.plans/builder_done.md',
        check: (f) => (f.status === 'complete')
          ? null
          : `.plans/builder_done.md must have status=complete; got status=${formatField(f.status)}`,
      },
      {
        path: '.plans/tdd_report.md',
        check: (f) => (f.status === 'complete')
          ? null
          : `.plans/tdd_report.md must have status=complete; got status=${formatField(f.status)}`,
      },
    ],
  };
}

// Per-skill predecessor descriptors. Hand-pinned from LLM_AGENT_GUIDE.md §8.8
// + ASSEMBLY_LINE.md. See active_plan.md §"Predecessor map" for the canonical
// shape. Drift mitigation deferred to Hygiene per RZ-2; manual re-sync on every
// LFE upstream merge is the current convention.
export const AGENT_ONLY_PREDECESSORS = Object.freeze({
  'lfe-grill-with-docs': {
    kind: 'absent_when',
    path: '.plans/01_grill_summary.md',
    upstream: '(Phase 1 entry-point — runs on clean .plans/)',
  },
  'lfe-to-prd': {
    kind: 'present_with_check',
    path: '.plans/01_grill_summary.md',
    upstream: '/lfe-grill-with-docs',
    requirement: 'step=1_grill + status=complete',
    check: (f) => (f.step === '1_grill' && f.status === 'complete')
      ? null
      : `step=1_grill + status=complete required; got step=${formatField(f.step)}, status=${formatField(f.status)}`,
  },
  'lfe-to-issues': {
    kind: 'present_with_check',
    path: '.plans/02_prd.md',
    upstream: '/lfe-to-prd',
    requirement: 'step=2_prd + status=complete',
    check: (f) => (f.step === '2_prd' && f.status === 'complete')
      ? null
      : `step=2_prd + status=complete required; got step=${formatField(f.step)}, status=${formatField(f.status)}`,
  },
  'lfe-architect': {
    kind: 'present_with_check',
    path: '.plans/03_slices.md',
    upstream: '/lfe-to-issues',
    requirement: 'step=3_slices + status=complete + approved_by_human=true',
    check: (f) => {
      if (f.step !== '3_slices' || f.status !== 'complete') {
        return `step=3_slices + status=complete required; got step=${formatField(f.step)}, status=${formatField(f.status)}`;
      }
      if (f.approved_by_human !== true) {
        return `approved_by_human=true required (Brain must approve slices before architect runs); got approved_by_human=${formatField(f.approved_by_human)}`;
      }
      return null;
    },
  },
  'lfe-plan-critique': {
    kind: 'present_with_check',
    path: '.plans/active_plan.md',
    upstream: '/lfe-architect',
    requirement: 'step=4_active_plan + status=complete',
    check: (f) => (f.step === '4_active_plan' && f.status === 'complete')
      ? null
      : `step=4_active_plan + status=complete required; got step=${formatField(f.step)}, status=${formatField(f.status)}`,
  },
  'lfe-builder': {
    kind: 'any_of',
    upstream: '/lfe-plan-critique (primary) or /lfe-diagnose (retry path)',
    requirement: '(plan_critique verdict=PASS) OR (plan_critique verdict=WARN + brain_confirmation set) OR (diagnosis_report status=complete)',
    options: [
      {
        path: '.plans/plan_critique.md',
        check: (f) => {
          if (f.verdict === 'PASS') return null;
          if (f.verdict === 'WARN' && f.brain_confirmation !== null && f.brain_confirmation !== undefined && f.brain_confirmation !== '') {
            return null;
          }
          return `verdict=PASS or (verdict=WARN + brain_confirmation set) required; got verdict=${formatField(f.verdict)}, brain_confirmation=${formatField(f.brain_confirmation)}`;
        },
      },
      {
        path: '.plans/diagnosis_report.md',
        check: (f) => (f.status === 'complete')
          ? null
          : `status=complete required; got status=${formatField(f.status)}`,
      },
    ],
  },
  'lfe-tdd': {
    kind: 'present_with_check',
    path: '.plans/builder_done.md',
    upstream: '/lfe-builder',
    requirement: 'status=complete',
    check: (f) => (f.status === 'complete')
      ? null
      : `status=complete required; got status=${formatField(f.status)}`,
  },
  'lfe-zoom-out': {
    kind: 'present_with_check',
    path: '.plans/tdd_report.md',
    upstream: '/lfe-tdd',
    requirement: 'status=complete',
    check: (f) => (f.status === 'complete')
      ? null
      : `status=complete required; got status=${formatField(f.status)}`,
  },
  'lfe-inspector': {
    kind: 'present_with_check',
    path: '.plans/tdd_report.md',
    upstream: '/lfe-tdd',
    requirement: 'status=complete',
    check: (f) => (f.status === 'complete')
      ? null
      : `status=complete required; got status=${formatField(f.status)}`,
  },
  'lfe-security-check': makeSubSkillDescriptor(),
  'lfe-perf-check': makeSubSkillDescriptor(),
  'lfe-complexity-check': makeSubSkillDescriptor(),
  'lfe-dep-audit': makeSubSkillDescriptor(),
  'lfe-mutation-verify': makeSubSkillDescriptor(),
  'lfe-diagnose': {
    kind: 'present_with_check',
    path: '.plans/inspection_report.md',
    upstream: '/lfe-inspector',
    requirement: 'status=failed (diagnose only runs after inspector reports a failure)',
    check: (f) => (f.status === 'failed')
      ? null
      : `status=failed required; got status=${formatField(f.status)}`,
  },
  'lfe-archivist': {
    kind: 'present_with_check',
    path: '.plans/inspection_report.md',
    upstream: '/lfe-inspector',
    requirement: 'status=passed',
    check: (f) => (f.status === 'passed')
      ? null
      : `status=passed required; got status=${formatField(f.status)}`,
  },
  'lfe-hygiene': {
    kind: 'absent_when',
    path: '.plans/hygiene_report.md',
    upstream: '(Phase 5 entry-point — runs on session-count trigger)',
  },
  'lfe-improve-architecture': {
    kind: 'present_with_check',
    path: '.plans/hygiene_report.md',
    upstream: '/lfe-hygiene',
    requirement: 'step=5_hygiene + status=complete',
    check: (f) => (f.step === '5_hygiene' && f.status === 'complete')
      ? null
      : `step=5_hygiene + status=complete required; got step=${formatField(f.step)}, status=${formatField(f.status)}`,
  },
});

export const ALL_KNOWN_SKILLS = Object.freeze([
  ...BRAIN_TYPEABLE_SKILLS,
  ...Object.keys(AGENT_ONLY_PREDECESSORS),
]);

// --- Pure helpers (exported for unit tests) ------------------------------------

export function formatField(value) {
  if (value === null) return '<null>';
  if (value === undefined) return '<missing>';
  if (value === '') return '<empty>';
  return String(value);
}

export function parseDirective(userMessage) {
  const text = String(userMessage ?? '');
  if (text === '') return { type: 'normal' };

  // `/lfe-<skill>` at message start (allowing leading whitespace, case-insensitive)
  // takes priority over LFE-FORCE keyword detection. Block-strict posture: combining
  // both (e.g. "LFE-FORCE /lfe-builder") still routes through the predecessor gate.
  const match = text.match(DIRECTIVE_REGEX);
  if (match) {
    const skillName = match[1].slice(1).toLowerCase();
    return { type: 'lfe-skill', skillName };
  }

  // LFE-FORCE keyword as a standalone prompt — pass-through. This gate does NOT
  // log a PROTOCOL_DEBT row here; that's the persona-lock gate's responsibility on the
  // subsequent Write/Edit. Same case-insensitive substring match as the persona-lock gate
  // (reuses the documented precision trade-off).
  if (new RegExp(LFE_FORCE_KEYWORD, 'i').test(text)) {
    return { type: 'lfe-force' };
  }

  return { type: 'normal' };
}

async function checkSingleFile(option, projectRoot, readFileText) {
  const resolvedPath = projectRoot ? join(projectRoot, option.path) : option.path;
  let text;
  try {
    text = await readFileText(resolvedPath);
  } catch {
    return { valid: false, reason: 'missing', citedPath: option.path };
  }
  const parsed = parseFrontmatter(text);
  if (parsed.error) {
    return {
      valid: false,
      reason: 'malformed_frontmatter',
      citedPath: option.path,
      detail: parsed.error.message,
    };
  }
  const checkResult = option.check(parsed.fields);
  if (checkResult === null) {
    return { valid: true };
  }
  return {
    valid: false,
    reason: 'wrong_state',
    citedPath: option.path,
    detail: checkResult,
  };
}

async function validateDispatchContext(descriptor, projectRoot, readFileText) {
  if (descriptor.kind === 'absent_when') {
    const resolvedPath = projectRoot ? join(projectRoot, descriptor.path) : descriptor.path;
    try {
      await readFileText(resolvedPath);
      return { valid: false, reason: 'already_exists', citedPath: descriptor.path };
    } catch {
      return { valid: true };
    }
  }

  if (descriptor.kind === 'present_with_check') {
    return await checkSingleFile(descriptor, projectRoot, readFileText);
  }

  if (descriptor.kind === 'any_of') {
    const failures = [];
    for (const option of descriptor.options) {
      const result = await checkSingleFile(option, projectRoot, readFileText);
      if (result.valid) return { valid: true };
      failures.push(result);
    }
    // Prefer the most-informative failure: wrong_state > malformed > missing.
    const priority = { wrong_state: 3, malformed_frontmatter: 2, missing: 1 };
    failures.sort((a, b) => (priority[b.reason] ?? 0) - (priority[a.reason] ?? 0));
    return failures[0];
  }

  if (descriptor.kind === 'all_of') {
    for (const part of descriptor.parts) {
      const result = await checkSingleFile(part, projectRoot, readFileText);
      if (!result.valid) return result;
    }
    return { valid: true };
  }

  // Defensive — should never happen if AGENT_ONLY_PREDECESSORS is well-formed.
  return { valid: false, reason: 'descriptor_unknown' };
}

async function readActivePersonaSafely(projectRoot, readFileText) {
  try {
    const path = projectRoot ? join(projectRoot, ENTRANCE_CARD_FILENAME) : ENTRANCE_CARD_FILENAME;
    const text = await readFileText(path);
    const card = parseEntranceCard(text);
    return card.activePersona || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function buildDenyMessage({ skillName, descriptor, validation, persona }) {
  // Defang ESC from the user/card-influenced + parsed-predecessor values before
  // they reach stderr / permissionDecisionReason.
  const safePersona = stripControl(persona);
  const personaTag = safePersona && safePersona !== 'unknown' ? ` (active persona: ${safePersona})` : '';
  const skillRef = `/${stripControl(skillName)}`;
  const citedPath = stripControl(validation.citedPath);
  const detail = validation.detail == null ? validation.detail : stripControl(validation.detail);

  if (descriptor.kind === 'absent_when') {
    return [
      `[LFE Skill-Gate] Skill invocation refused (re-invocation guard)${personaTag}.`,
      ``,
      `  Skill:    ${skillRef}`,
      `  Output:   ${citedPath} (already exists)`,
      ``,
      `  This skill is an assembly-line entry-point and runs only when its output`,
      `  is absent. The mission is mid-flight or has already produced this artifact.`,
      ``,
      `  If you intended to RESTART the mission, run /lfe-archivist first to clean .plans/.`,
      `  If you intended a DOWNSTREAM step, check .docs/protocol/ASSEMBLY_LINE.md.`,
    ].join('\n');
  }

  if (validation.reason === 'missing') {
    return [
      `[LFE Skill-Gate] Skill invocation refused${personaTag}.`,
      ``,
      `  Skill:        ${skillRef}`,
      `  Predecessor:  ${citedPath} (not found)`,
      `  Required:     ${descriptor.requirement ?? '(see descriptor)'}`,
      ``,
      `  Walk the assembly line — upstream skill is ${descriptor.upstream}.`,
      ``,
      `  See .docs/protocol/ASSEMBLY_LINE.md for the full pipeline order.`,
    ].join('\n');
  }

  if (validation.reason === 'wrong_state') {
    return [
      `[LFE Skill-Gate] Skill invocation refused${personaTag}.`,
      ``,
      `  Skill:        ${skillRef}`,
      `  Predecessor:  ${citedPath} (found, but wrong state)`,
      `  Detail:       ${detail ?? '(see check function)'}`,
      `  Required:     ${descriptor.requirement ?? '(see descriptor)'}`,
      ``,
      `  Resolve by re-running ${descriptor.upstream} to bring the predecessor to`,
      `  the required state, or check ASSEMBLY_LINE.md if the pipeline is in an`,
      `  unexpected state.`,
    ].join('\n');
  }

  if (validation.reason === 'malformed_frontmatter') {
    return [
      `[LFE Skill-Gate] Skill invocation refused${personaTag}.`,
      ``,
      `  Skill:        ${skillRef}`,
      `  Predecessor:  ${citedPath} (frontmatter malformed)`,
      `  Detail:       ${detail ?? '(parse error)'}`,
      ``,
      `  The predecessor file exists but its frontmatter could not be parsed.`,
      `  This usually means the upstream skill crashed mid-write. Re-run`,
      `  ${descriptor.upstream} to regenerate the file.`,
    ].join('\n');
  }

  // Fallback (descriptor_unknown or future-added reasons)
  return [
    `[LFE Skill-Gate] Skill invocation refused${personaTag}.`,
    ``,
    `  Skill:        ${skillRef}`,
    `  Reason:       ${validation.reason ?? 'unknown'}`,
    ``,
    `  See .docs/protocol/ASSEMBLY_LINE.md for guidance.`,
  ].join('\n');
}

export function buildUnknownSkillMessage({ skillName }) {
  return [
    `[LFE Skill-Gate] Unknown skill: /${stripControl(skillName)}`,
    ``,
    `  Brain-typeable (allowed unconditionally):`,
    `    /lfe-boot, /lfe-whats-next, /lfe-scout, /lfe-extract-domain, LFE-FORCE`,
    ``,
    `  Agent-only (allowed with valid predecessor in .plans/):`,
    `    /lfe-grill-with-docs, /lfe-to-prd, /lfe-to-issues, /lfe-architect,`,
    `    /lfe-plan-critique, /lfe-builder, /lfe-tdd, /lfe-zoom-out, /lfe-inspector,`,
    `    /lfe-diagnose, /lfe-archivist, /lfe-hygiene, /lfe-improve-architecture,`,
    `    and the 5 Inspector sub-skills: /lfe-security-check, /lfe-perf-check,`,
    `    /lfe-complexity-check, /lfe-dep-audit, /lfe-mutation-verify`,
    ``,
    `  Check for typos or consult LLM_AGENT_GUIDE.md §8.8 for the canonical list.`,
  ].join('\n');
}

// --- C2b: Scout-boundary guard (ADR 95) ---------------------------------------

export const SCOUT_GATE_NAME = 'scout-boundary';

export function buildScoutBoundaryMessage() {
  return [
    `[LFE C2b] /lfe-scout refused mid-mission.`,
    ``,
    `  Scout is the broadest write lane and is only for a CLEAN session boundary`,
    `  (no in-flight mission, no coordination trail in .plans/). A mission is`,
    `  currently in flight — finish or close it (Archivist cleanup) and start a`,
    `  new session before using /lfe-scout.`,
  ].join('\n');
}

export async function checkScoutBoundary({ payload, readFileText, listPlans, appendFileText, now, projectRoot }) {
  // Backward-compat + fail-safe: without listPlans we cannot determine the trail
  // → ALLOW (preserves legacy behavior; never blocks recovery).
  if (typeof listPlans !== 'function') return { exitCode: 0, stdout: '', stderr: '' };

  const ctx = await readEnforcementContext({ payload, readFileText, listPlans, projectRoot });
  if (ctx.unreadable) return { exitCode: 0, stdout: '', stderr: '' };

  const midMission = /IN-FLIGHT/i.test(String(ctx.missionState ?? '')) || ctx.hasCoordinationTrail === true;
  if (!midMission) return { exitCode: 0, stdout: '', stderr: '' }; // clean boundary → ALLOW

  const message = buildScoutBoundaryMessage();
  const posture = await readPosture(SCOUT_GATE_NAME, { readFileText, projectRoot });
  const decision = posture === 'block' ? 'deny' : 'warn';

  if (typeof appendFileText === 'function') {
    const telemetryPath = projectRoot ? join(projectRoot, TELEMETRY_PATH) : TELEMETRY_PATH;
    await recordWarn({
      appendFileText,
      path: telemetryPath,
      record: buildRecord({
        now, gate: SCOUT_GATE_NAME, decision, reason: 'scout-mid-mission',
        target: '/lfe-scout', sessionId: ctx.sessionId, persona: ctx.activePersona, missionState: ctx.missionState,
      }),
    });
  }

  if (decision === 'deny') {
    const envelope = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        permissionDecision: 'deny',
        permissionDecisionReason: message,
      },
    };
    return { exitCode: 0, stdout: JSON.stringify(envelope), stderr: message + '\n' };
  }
  return { exitCode: 0, stdout: '', stderr: `[LFE C2b warn-and-log] ${message}\n` };
}

// --- main() — pure decision tree, injected dependencies ------------------------

export async function main({ stdinText, readFileText, env, listPlans, appendFileText, now }) {
  // 1. Stdin parse — ALLOW on infra failure (no parseable directive to gate).
  let payload;
  try {
    payload = JSON.parse(String(stdinText ?? ''));
  } catch {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const userMessage = String(payload?.user_message ?? '');
  const cwd = payload?.cwd;
  const projectRoot = String((env && env.CLAUDE_PROJECT_DIR) ?? cwd ?? '').replace(/\\/g, '/');

  // 2. Directive detection. Normal conversation + bare LFE-FORCE pass-through.
  const directive = parseDirective(userMessage);
  if (directive.type === 'normal' || directive.type === 'lfe-force') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const skillName = directive.skillName;

  // 3. Brain-typeable allow-list. Scout (C2b) is additionally gated to a clean
  //    session boundary; the other Brain-typeable skills ALLOW unconditionally.
  if (BRAIN_TYPEABLE_SKILLS.includes(skillName)) {
    if (skillName === 'lfe-scout') {
      return await checkScoutBoundary({ payload, readFileText, listPlans, appendFileText, now, projectRoot });
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // 4. Agent-only predecessor check.
  const descriptor = AGENT_ONLY_PREDECESSORS[skillName];
  if (descriptor) {
    const validation = await validateDispatchContext(descriptor, projectRoot, readFileText);
    if (validation.valid) {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    const persona = await readActivePersonaSafely(projectRoot, readFileText);
    const message = buildDenyMessage({ skillName, descriptor, validation, persona });
    const envelope = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
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

  // 5. Unknown directive — DENY with skill listing.
  const message = buildUnknownSkillMessage({ skillName });
  const envelope = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
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
    env: process.env,
    listPlans: () => {
      const root = String(process.env.CLAUDE_PROJECT_DIR ?? process.cwd()).replace(/\\/g, '/');
      return readdir(join(root, '.plans'));
    },
    appendFileText: (p, c) => appendFile(p, c, 'utf8'),
    now: () => new Date().toISOString(),
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

const invokedAsCli =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /skill-invocation-gate\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    process.stderr.write(`[LFE Skill-Gate] hook infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
