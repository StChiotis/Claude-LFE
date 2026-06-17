#!/usr/bin/env node
// Visual gate — the hard visual-confirmation floor (ADR 102).
//
// The Inspector can assert a *technical* pass (logic/baselines/tests) on its own
// authority, but it has no eyes — a UI change can pass mechanically while the
// rendered result is wrong. This gate makes a human visual sign-off MANDATORY
// before a UI-touching slice can close: it denies the Inspector→Archivist
// transition for a *visual slice* unless inspection_report.md carries both the
// `visual_confirmed` timestamp and the `visual_signoff` token (agent-transcribed,
// same trust model as brain_confirmation — no new non-forgeable mechanism).
//
// FLOOR semantics (the deliberate departure from the ADR-95 warn-first family):
// the deny is UNCONDITIONAL — it fires even under `warn` posture, exactly as the
// Security Floor ignores an `lfe-security-check: false` override. A warn-only
// visual gate would let the very anti-pattern it exists to kill (an unverified
// visual close) straight through. The `visual-gate` key in enforcement-posture.json
// is registered for gate-inventory parity; the floor does not consult it.
//
// Asymmetric fail-safe ALLOW (ADR 85 lineage) — it can never deadlock a
// legitimate close. ALLOW on EVERY ambiguous path: tool not Write/Edit; malformed
// stdin; target not the entrance card; any transition other than inspector→
// archivist; unreadable entrance card; unreadable/empty builder_done.md
// (indeterminate visual-ness); non-visual changed files; unreadable
// inspection_report.md; status escalated or failed (the debt/triage paths). The
// ONLY deny is the precise floor: visual slice + inspector→archivist + status not
// escalated/failed + confirmation or sign-off missing.
//
// "Visual slice" is derived HERE, from builder_done.md's `## Files Touched` list
// matched against UI_GLOBS — the single literal source of truth (adopter-
// extendable). inspector-config.md + the lfe-visual-check skill describe the same
// classes in prose; this constant is the mechanical authority.
//
// Test seam: pure main({ stdinText, readFileText, appendFileText, listPlans,
// now, env }) with injected I/O — its OWN seam (it reads builder_done.md +
// inspection_report.md, which the persona-transition harness's makeRead rejects).
// CLI wrapper at bottom wires real I/O.

import { readFile, appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { parseEntranceCard, ENTRANCE_CARD_FILENAME } from '../lib/parse-entrance-card.mjs';
import { parseFrontmatter } from '../lib/parse-frontmatter.mjs';
import { readEnforcementContext } from '../lib/enforcement-context.mjs';
import { buildRecord, recordWarn, TELEMETRY_PATH } from '../lib/enforcement-telemetry.mjs';
import { leadingPersonaName } from '../lib/persona-name.mjs';
import { matchGlob, normalizePath } from '../lib/be-escape.mjs';

// --- Constants ----------------------------------------------------------------

export const GATE_NAME = 'visual-gate';
export const GATED_TOOLS = ['Write', 'Edit'];

export const BUILDER_DONE_PATH = '.plans/builder_done.md';
export const INSPECTION_REPORT_PATH = '.plans/inspection_report.md';

// The transition this gate watches: Inspector → Archivist (the finalization close).
const FROM_PERSONA = 'inspector';
const TO_PERSONA = 'archivist';

// Statuses on the debt/triage paths — the floor stands down so a legitimate
// accept-as-debt / escalated close is never deadlocked.
const FAIL_SAFE_STATUSES = Object.freeze(['escalated', 'failed']);

// UI_GLOBS — the single literal source of truth for "what counts as a visual
// file" (adopter-extendable). Default web / SPA / static set. Extension-class
// globs (no `/`) are matched against the file BASENAME (so a `*.css` matches at
// any depth); path-class hints (containing `/`) are matched against the full
// normalized path. Native-mobile / game-engine classes are an adopter extension
// point (documented in inspector-config.md), deliberately out of this default set.
export const UI_GLOBS = Object.freeze([
  // stylesheets
  '*.css', '*.scss', '*.sass', '*.less', '*.styl',
  // markup & templates
  '*.html', '*.htm', '*.vue', '*.svelte', '*.astro', '*.hbs', '*.ejs', '*.pug', '*.njk',
  // components / views (JSX / TSX)
  '*.jsx', '*.tsx',
  // image assets
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.svg', '*.webp', '*.avif', '*.ico',
  // path-class hints (matched against the full path)
  '**/components/**', '**/views/**', '**/pages/**', '**/templates/**', '**/styles/**',
]);

// --- Pure helpers (exported for unit testing) ---------------------------------

// Persona name from an arbitrary text blob (the incoming change), via the shared
// entrance-card parser. null when the blob has no parseable Active-Persona row.
export function personaFromText(text) {
  return leadingPersonaName(parseEntranceCard(text).activePersona);
}

// Extract the changed-file paths from a builder_done.md body. Reads the
// `## Files Touched` section's `- <path>: <summary>` bullets; the path is the
// text before the first `:` (the summary separator), backticks stripped. Returns
// [] when the section is absent or has no bullets.
export function parseChangedFiles(builderDoneText) {
  const lines = String(builderDoneText ?? '').split(/\r?\n/);
  const files = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      inSection = /^##\s+Files\s+Touched\b/i.test(line);
      continue;
    }
    if (!inSection) continue;
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (!m) continue;
    let item = m[1].trim();
    const colon = item.indexOf(':');
    if (colon !== -1) item = item.slice(0, colon);
    item = item.replace(/`/g, '').trim();
    if (item) files.push(item);
  }
  return files;
}

// True when any changed file matches the UI_GLOBS visual file classes. Extension
// globs match the basename; path-class globs (with `/`) match the full path.
export function isVisualSlice(changedFiles) {
  if (!Array.isArray(changedFiles)) return false;
  return changedFiles.some((f) => {
    const p = normalizePath(f);
    if (!p) return false;
    const base = p.split('/').pop() || p;
    return UI_GLOBS.some((g) => (g.includes('/') ? matchGlob(p, g) : matchGlob(base, g)));
  });
}

// A typed field is "present" only when it is a non-empty, non-null value. A
// `visual_confirmed: null` / `visual_signoff:` (empty) does NOT satisfy the floor.
export function isFieldPresent(v) {
  return v !== null && v !== undefined && v !== '' && v !== false;
}

export function buildDenyMessage({ missing, target }) {
  return [
    `[LFE visual-gate] Visual confirmation required before this slice can close.`,
    ``,
    `  Target:  ${target}`,
    `  Missing: ${missing.join(' + ')}`,
    ``,
    `  This slice touched a visual file class, so a human visual sign-off is a`,
    `  hard floor — a green technical pass alone does not close a UI change.`,
    `  The sign-off ritual:`,
    `    1. Look at the rendered surface (lfe-visual-check presents it, or names`,
    `       the screen to inspect when no renderer is available).`,
    `    2. On approval, the Inspector records visual_confirmed: <ISO-8601> and`,
    `       visual_signoff: <token> in inspection_report.md (via Write).`,
    `    3. The transition to Archivist then proceeds.`,
    `  To reject instead, the finalization gate routes the defect through the`,
    `  rework loop back to the Builder.`,
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
  // 2. Tool-matcher pre-filter (defense-in-depth; settings.json matcher is primary).
  if (!GATED_TOOLS.includes(toolName)) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const toolInput = payload?.tool_input ?? {};
  const rawFilePath = toolInput?.file_path;
  if (typeof rawFilePath !== 'string' || rawFilePath === '') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const cwd = payload?.cwd;
  const projectRoot = String((env && env.CLAUDE_PROJECT_DIR) ?? cwd ?? '').replace(/\\/g, '/');
  const resolve = (rel) => (projectRoot ? join(projectRoot, rel) : rel);

  // 3. Shared enforcement context (normalizes target, parses the live card).
  const ctx = await readEnforcementContext({ payload, readFileText, listPlans, projectRoot });

  // 4. Fail-safe ALLOW on unreadable substrate (ADR 85).
  if (ctx.unreadable) {
    return { exitCode: 0, stdout: '', stderr: '[LFE visual-gate] entrance card unreadable — fail-safe ALLOW.\n' };
  }

  // 5. Sole subject: pipeline_status.md (the transition is the persona-row edit).
  const isEntranceCard =
    ctx.target === ENTRANCE_CARD_FILENAME ||
    String(ctx.target).endsWith('/' + ENTRANCE_CARD_FILENAME);
  if (!isEntranceCard) return { exitCode: 0, stdout: '', stderr: '' };

  // 6. Watch ONLY the Inspector→Archivist transition. before = live card persona;
  //    after = persona in the incoming change.
  const before = leadingPersonaName(ctx.activePersona);
  const incomingText = toolName === 'Edit' ? toolInput?.new_string : toolInput?.content;
  const after = personaFromText(incomingText);
  if (before !== FROM_PERSONA || after !== TO_PERSONA) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // 7. Visual-ness — derived from builder_done.md's changed files vs UI_GLOBS.
  //    Unreadable / no parseable files → indeterminate → fail-safe ALLOW.
  let builderDoneText;
  try {
    builderDoneText = await readFileText(resolve(BUILDER_DONE_PATH));
  } catch {
    return { exitCode: 0, stdout: '', stderr: '[LFE visual-gate] builder_done.md unreadable — fail-safe ALLOW.\n' };
  }
  const changedFiles = parseChangedFiles(builderDoneText);
  if (changedFiles.length === 0) {
    return { exitCode: 0, stdout: '', stderr: '[LFE visual-gate] no changed files parsed — fail-safe ALLOW.\n' };
  }
  if (!isVisualSlice(changedFiles)) {
    // Non-visual slice — the floor does not apply.
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // 8. Visual slice. Read inspection_report.md. Unreadable → fail-safe ALLOW.
  let reportText;
  try {
    reportText = await readFileText(resolve(INSPECTION_REPORT_PATH));
  } catch {
    return { exitCode: 0, stdout: '', stderr: '[LFE visual-gate] inspection_report.md unreadable — fail-safe ALLOW.\n' };
  }
  const { fields } = parseFrontmatter(reportText);
  const status = String(fields?.status ?? '').toLowerCase();

  // Debt / triage paths stand down — never deadlock an accept-as-debt close.
  if (FAIL_SAFE_STATUSES.includes(status)) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // The floor: both typed fields must be present.
  const hasConfirmed = isFieldPresent(fields?.visual_confirmed);
  const hasSignoff = isFieldPresent(fields?.visual_signoff);
  if (hasConfirmed && hasSignoff) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // 9. Floor DENY — unconditional (does not consult posture; ADR 102).
  const missing = [];
  if (!hasConfirmed) missing.push('visual_confirmed');
  if (!hasSignoff) missing.push('visual_signoff');
  const message = buildDenyMessage({ missing, target: ctx.target });

  // Telemetry (observability only — never alters the decision).
  const record = buildRecord({
    now,
    gate: GATE_NAME,
    decision: 'deny',
    reason: 'visual-unconfirmed',
    target: ctx.target,
    sessionId: ctx.sessionId,
    persona: ctx.activePersona,
    missionState: ctx.missionState,
  });
  await recordWarn({ appendFileText, path: resolve(TELEMETRY_PATH), record });

  const envelope = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: message,
    },
  };
  return { exitCode: 0, stdout: JSON.stringify(envelope), stderr: message + '\n' };
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
  /visual-gate\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    // Last-resort infra-error guard — never block on hook bugs.
    process.stderr.write(`[LFE visual-gate] hook infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
