#!/usr/bin/env node
// SessionStart hook — state-aware boot reminder.
// Reads pipeline_status.md + .plans/ listing and emits an
// additionalContext payload that orients the operator. Warn-and-log posture:
// always exits 0. render() also emits a hygiene-due banner when due.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { parseEntranceCard, ENTRANCE_CARD_FILENAME } from '../lib/parse-entrance-card.mjs';
import { ELLIPSIS, ELLIPSIS_LEN } from '../lib/text-format.mjs';
import { readStdinAll } from '../lib/stdin-reader.mjs';

// Re-export so the existing test import (from '../session-start-reminder.mjs')
// continues to resolve unchanged after the session-5 Hygiene extraction.
export { parseEntranceCard };

const MAX_CONTEXT_CHARS = 400;

// Entrance-card contract warn threshold (ADR 103) — boot-time self-report tier.
// Mirrors BUDGET_WARN_CHARS in pipeline-status-narrative-check.mjs (kept as a
// local literal so this load-bearing SessionStart hook stays dependency-light,
// same rationale as SESSION_ID_PATH below).
export const BUDGET_WARN_CHARS = 10_000;
const FALLBACK_TEXT =
  '[LFE] Mission state could not be read from pipeline_status.md. Run /lfe-boot to re-orient.';

// C2a (ADR 95): per-session id marker the boot-precondition gate keys off.
// Mirrors BOOT_SESSION_ID_PATH in .claude/lib/enforcement-context.mjs (kept as a
// local literal so this load-bearing SessionStart hook stays dependency-light).
const SESSION_ID_PATH = '.plans/.session-id';

// Coordination-file resume ladder — canonical mapping per LOOP_ARCHITECTURE.md §4.
// Order matters: most-recent-stage first. Each entry's template is filled with
// (missionState, activePersona, sessionCount) at render time.
export const RESUME_LADDER = [
  {
    file: 'inspection_report.md',
    template: (s, p, n) =>
      `[LFE] Mission State: ${s}. inspection_report.md present — standard next: /lfe-archivist. If file shows status: failed → /lfe-diagnose; status: escalated → Brain triage. Persona: ${p}. Session #${n}.`,
  },
  {
    file: 'tdd_report.md',
    template: (s, p, n) =>
      `[LFE] Mission State: ${s}. tdd_report.md present — resume at /lfe-inspector (Phase 3 starts with zoom-out internally; Cycle Guard runs first). Persona: ${p}. Session #${n}.`,
  },
  {
    file: 'builder_done.md',
    template: (s, p, n) =>
      `[LFE] Mission State: ${s}. builder_done.md present — resume at /lfe-tdd. Persona: ${p}. Session #${n}.`,
  },
  {
    file: 'plan_critique.md',
    template: (s, p, n) =>
      `[LFE] Mission State: ${s}. plan_critique.md present — consult LOOP_ARCHITECTURE §4 sub-states: PASS or WARN+confirmed → /lfe-builder; WARN-unconfirmed → /lfe-plan-critique; BLOCK rev1 → revise; BLOCK rev2 → Brain triage. Persona: ${p}. Session #${n}.`,
  },
  {
    file: 'active_plan.md',
    template: (s, p, n) =>
      `[LFE] Mission State: ${s}. active_plan.md present — resume at /lfe-plan-critique (4-lens auto-gate). Persona: ${p}. Session #${n}.`,
  },
  {
    file: '03_slices.md',
    template: (s, p, n) =>
      `[LFE] Mission State: ${s}. 03_slices.md present — resume at /lfe-architect to draft next slice's active_plan. Persona: ${p}. Session #${n}.`,
  },
  {
    file: '02_prd.md',
    template: (s, p, n) =>
      `[LFE] Mission State: ${s}. 02_prd.md present — resume at /lfe-to-issues to break PRD into vertical slices. Persona: ${p}. Session #${n}.`,
  },
  {
    file: '01_grill_summary.md',
    template: (s, p, n) =>
      `[LFE] Mission State: ${s}. 01_grill_summary.md present — resume at /lfe-to-prd to synthesize the PRD. Persona: ${p}. Session #${n}.`,
  },
];

export async function listPlans(plansDir) {
  try {
    return await readdir(plansDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}

export function classifyState(entrance, plansFilenames) {
  const planFiles = plansFilenames.filter(
    (f) => f.endsWith('.md') && f !== '.gitkeep',
  );
  const state = entrance.missionState ?? '';

  if (/^\[BLANK CANVAS\]/i.test(state)) return { variant: 'A', planFiles };
  if (/^\[MISSION COMPLETE\]/i.test(state)) {
    return { variant: planFiles.length > 0 ? "D'" : 'D', planFiles };
  }
  if (/^\[IN-FLIGHT/i.test(state)) return { variant: 'C', planFiles };
  if (/^\[DOMAIN LOADED\]/i.test(state)) {
    return { variant: planFiles.length === 0 ? 'B' : 'C', planFiles };
  }
  return { variant: 'E', planFiles, rawState: state };
}

export function pickResumeTarget(planFiles) {
  for (const entry of RESUME_LADDER) {
    if (planFiles.includes(entry.file)) return entry;
  }
  return null;
}

// Hygiene-due threshold.
// GOVERNANCE.md §3.5 rule 4 — Architecture Sweep every 5 sessions.
// `Never` literal = "no sweep has ever run" = session 0.
// Returns { overdue, gapSessions } with safe defaults on any parse failure
// (warn-and-log posture: never escalate noise on unreadable input).
const HYGIENE_THRESHOLD_SESSIONS = 5;

export function computeHygieneDue(sessionCount, lastArchSweep) {
  const current = Number.parseInt(String(sessionCount ?? ''), 10);
  if (!Number.isFinite(current)) return { overdue: false, gapSessions: 0 };

  const raw = String(lastArchSweep ?? '').trim();
  let lastSweep;
  if (/^Never\b/i.test(raw)) {
    lastSweep = 0;
  } else {
    const m = raw.match(/^\s*(\d+)/);
    if (!m) return { overdue: false, gapSessions: 0 };
    lastSweep = Number.parseInt(m[1], 10);
  }

  const gap = current - lastSweep;
  return { overdue: gap >= HYGIENE_THRESHOLD_SESSIONS, gapSessions: gap };
}

function shouldShowHygieneBanner(variant) {
  return variant === 'B' || variant === 'C' || variant === 'D';
}

function capLength(text) {
  return text.length > MAX_CONTEXT_CHARS
    ? text.slice(0, MAX_CONTEXT_CHARS - ELLIPSIS_LEN) + ELLIPSIS
    : text;
}

// Per-variant orientation text. Each renderer takes the render context and
// returns its variant's message; render() applies the hygiene banner + length
// cap uniformly afterward. The template strings are the verbatim pre-extraction
// switch-arm bodies, so output stays byte-identical.
export const VARIANT_RENDERERS = {
  A: ({ p }) =>
    `[LFE] Mission State: BLANK CANVAS. Domain not yet extracted — run /lfe-extract-domain to populate CONTEXT.md + domain-knowledge.md before any other work. Active Persona: ${p}.`,
  B: ({ p, n }) =>
    `[LFE] Mission State: DOMAIN LOADED. No active mission. Run /lfe-boot to fire the Complexity Gate (Major Architectural Change vs Minor Fix / Scout). Persona: ${p}. Session #${n}.`,
  C: ({ s, p, n, planFiles }) => {
    const target = pickResumeTarget(planFiles);
    return target
      ? target.template(s, p, n)
      : `[LFE] Mission State: ${s}. .plans/ has no recognised coordination files. Run /lfe-boot to re-orient. Persona: ${p}. Session #${n}.`;
  },
  D: ({ p, n }) =>
    `[LFE] Mission State: MISSION COMPLETE. Clean slate — run /lfe-boot for the next Complexity Gate. Persona: ${p}. Session #${n}.`,
  "D'": ({ p, n, planFiles }) =>
    `[LFE] State Anomaly: pipeline_status.md says MISSION COMPLETE but .plans/ still has ${planFiles.length} file(s). Run /lfe-zoom-out to compare plans vs code (per lfe-boot SKILL.md Step 2 Scenario B). Persona: ${p}. Session #${n}.`,
};

// Fallback for the unrecognised-state variant (E) and any unknown variant id.
function renderUnparsed({ s, p, n, rawState }) {
  return `[LFE] Mission state could not be parsed from pipeline_status.md (got: "${rawState ?? s}"). Run /lfe-boot to re-orient. If this persists, inspect the entrance card for renamed row labels.`;
}

export function render(entrance, classification, cardChars) {
  const { variant, planFiles, rawState } = classification;
  const ctx = {
    s: entrance.missionState,
    p: entrance.activePersona,
    n: entrance.sessionCount,
    planFiles,
    rawState,
  };

  const renderer = VARIANT_RENDERERS[variant] ?? renderUnparsed;
  let text = renderer(ctx);

  // Append hygiene-due banner when threshold met and variant allows it.
  if (shouldShowHygieneBanner(variant)) {
    const due = computeHygieneDue(entrance.sessionCount, entrance.lastArchSweep);
    if (due.overdue) {
      text += ` ⚠️ Architecture sweep overdue by ${due.gapSessions} sessions — schedule /lfe-hygiene at the next mission boundary.`;
    }
  }

  // ADR 103 over-budget banner. `cardChars` is an OPTIONAL third param — when
  // absent (every pre-existing call site) the banner is skipped and output stays
  // byte-identical (warn-and-log posture; backward-compatible by construction).
  if (typeof cardChars === 'number' && cardChars > BUDGET_WARN_CHARS) {
    text += ` ⚠️ Entrance card over budget (${Math.round(cardChars / 1000)}k/12k hard) — verify-then-trim at the next close (ADR 103).`;
  }

  return capLength(text);
}

export async function main({ projectDir, readFileText, listPlansFn, writeFileText, sessionId }) {
  // C2a: rotate the per-session id so the boot-precondition gate can detect a
  // fresh session. Fail-safe — a marker-write failure must NEVER affect the
  // emitted orientation context or the exit code (warn-and-log posture).
  if (writeFileText && sessionId) {
    try {
      await writeFileText(join(projectDir, SESSION_ID_PATH), String(sessionId));
    } catch {
      // swallow — boot orientation must not break on a marker-write failure.
    }
  }
  try {
    const entranceText = await readFileText(join(projectDir, ENTRANCE_CARD_FILENAME));
    const entrance = parseEntranceCard(entranceText);
    const plansFilenames = await listPlansFn(join(projectDir, '.plans'));
    const classification = classifyState(entrance, plansFilenames);
    // ADR 103: card size (CRLF-normalized) feeds the over-budget boot banner.
    const cardChars = String(entranceText ?? '').replace(/\r\n/g, '\n').length;
    return render(entrance, classification, cardChars);
  } catch {
    return FALLBACK_TEXT;
  }
}

async function runCli() {
  const stdinText = await readStdinAll();
  let sessionId = null;
  try {
    sessionId = JSON.parse(stdinText)?.session_id ?? null;
  } catch {
    sessionId = null;
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const text = await main({
    projectDir,
    readFileText: (p) => readFile(p, 'utf8'),
    listPlansFn: listPlans,
    writeFileText: (p, c) => writeFile(p, c, 'utf8'),
    sessionId,
  });
  const envelope = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: text,
    },
  };
  process.stdout.write(JSON.stringify(envelope));
  process.exit(0);
}

const invokedAsCli =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /session-start-reminder\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch(() => {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: FALLBACK_TEXT,
        },
      }),
    );
    process.exit(0);
  });
}
