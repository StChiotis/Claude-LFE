#!/usr/bin/env node
// Entrance-card conformance validator (Entrance-card contract — framework ADR 103).
//
// Why this exists: pipeline_status.md is the hottest read path in the repo
// (boot Step 1, statusline per debounced render, SessionStart, 4 PreToolUse
// gates) and had grown to ~96k chars of mission history duplicated from the
// CHANGELOG lane. The contract bounds it; this validator is the HARD gate
// (pre-commit + CI + the vitest product suite). The warn tier lives in the
// hooks (narrative-check >10k; SessionStart banner) — see GOVERNANCE § Retention Policy (Entrance-card row).
//
// Architecture: pure core (checkEntranceCard) + thin CLI shell — mirrors
// scripts/check-design-conformance.mjs (ADR 105)
// (ADR 81/83). Parsing truth is SHARED: this validator imports the same
// .claude/lib/parse-entrance-card.mjs every runtime consumer uses, so the
// validator and the consumers can never disagree about what parses.
//
// CLI: node scripts/check-entrance-card.mjs [path]
//   [path] defaults to the repo's pipeline_status.md; the optional arg exists
//   so planted-defect proofs run against a scratch fixture, keeping the real
//   card untouched. Exit 0 = conformant; exit 1 = violations (printed).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { parseEntranceCard } from '../.claude/lib/parse-entrance-card.mjs';

// --- Contract constants (ADR 103) ---------------------------------------------

export const BUDGET_HARD_CHARS = 12_000;
export const MAX_RECENT_MISSIONS = 3;
export const LEGAL_STATE_TOKEN_RE =
  /^\[(BLANK CANVAS|DOMAIN LOADED|IN-FLIGHT[^\]]*|MISSION COMPLETE)\]/;
// Bare names only — the emoji is statusline PRESENTATION (formatPersona adds it);
// a decorated cell renders the chip "⚙️ Unknown" (a latent statusline degradation this contract fixes).
// `Brain` is deliberately ABSENT (asymmetry-by-design): the human persona has no
// write-lane in .agents/permissions.json and is never the working Active Persona —
// the statusline's PERSONA_TABLE renders it tolerantly, but the contract rejects it.
export const PERSONA_SET = ['Architect', 'Builder', 'Inspector', 'Archivist', 'Scout'];
// The 9 canonical checkbox labels, frozen by the contract (checkpoint-flip grammar).
export const CHECKBOX_LABELS = [
  '01', '02', '03', 'plan', 'plan_critique', 'build', 'tdd', 'critique', 'inspect',
];
export const RECENT_MISSIONS_HEADER_RE = /^##\s*📜 Recent Missions/mu;
export const ROUTING_HEADER_RE = /^##\s*🧭 Navigation — where what lives/mu;

// --- Pure core ------------------------------------------------------------------

// Validate card text against the Entrance-card contract.
// Returns { violations: [{ rule, detail }] } — empty array = conformant.
// Chars are counted after \r\n → \n normalization so Windows/Unix checkouts
// measure identically (CRLF checkouts must measure identically).
export function checkEntranceCard(text) {
  const src = String(text ?? '').replace(/\r\n/g, '\n');
  const violations = [];

  // R8 — hard budget.
  if (src.length > BUDGET_HARD_CHARS) {
    violations.push({
      rule: 'R8-budget',
      detail:
        `${src.length} chars > ${BUDGET_HARD_CHARS} — history belongs in ` +
        `CHANGELOG.md, the card carries pointers only (verify-then-trim, ADR 103)`,
    });
  }

  // R1 — every consumer field resolves through the shared parser.
  const entrance = parseEntranceCard(src);
  for (const [field, value] of Object.entries(entrance)) {
    if (value === 'unknown' || String(value).trim() === '') {
      violations.push({ rule: 'R1-rows', detail: `row for "${field}" missing or unparseable` });
    }
  }

  // R2 — Mission State leads with a legal [STATE] token (classifyState anchors on it).
  if (entrance.missionState !== 'unknown' && !LEGAL_STATE_TOKEN_RE.test(entrance.missionState)) {
    violations.push({
      rule: 'R2-state-token',
      detail:
        `Mission State must START with [BLANK CANVAS] / [DOMAIN LOADED] / ` +
        `[IN-FLIGHT…] / [MISSION COMPLETE]; got "${entrance.missionState.slice(0, 48)}…"`,
    });
  }

  // R3 — numeric Session Count (contract rule).
  if (entrance.sessionCount !== 'unknown' && !/^\d+$/.test(entrance.sessionCount.trim())) {
    violations.push({
      rule: 'R3-session-numeric',
      detail: `Session Count must be numeric; got "${entrance.sessionCount}"`,
    });
  }

  // R4 — bare persona name (contract rule).
  if (entrance.activePersona !== 'unknown' && !PERSONA_SET.includes(entrance.activePersona.trim())) {
    violations.push({
      rule: 'R4-bare-persona',
      detail:
        `Active Persona cell must be a BARE name in {${PERSONA_SET.join(', ')}}; ` +
        `got "${entrance.activePersona}" — the emoji is statusline presentation, ` +
        `a decorated cell renders the chip "⚙️ Unknown"`,
    });
  }

  // R5 — Coordination Files checkbox grammar (checkpoint-flip's consumer contract).
  const rowMatch = src.match(/\|\s*\*\*Coordination Files\*\*\s*\|([^|\n]*)\|/);
  if (!rowMatch) {
    violations.push({
      rule: 'R5-checkboxes',
      detail: 'Coordination Files row missing or malformed (pipes inside the cell?)',
    });
  } else {
    for (const label of CHECKBOX_LABELS) {
      // (?:^|\s) prevents `plan` matching inside `plan_critique`.
      const re = new RegExp(`(?:^|\\s)${label}\\s+(⬜|✅)`, 'u');
      if (!re.test(rowMatch[1])) {
        violations.push({
          rule: 'R5-checkboxes',
          detail: `checkbox "${label}" missing from the Coordination Files cell`,
        });
      }
    }
  }

  // R6 — Recent Missions present, at most 3 pointer lines.
  const rmIdx = src.search(RECENT_MISSIONS_HEADER_RE);
  if (rmIdx === -1) {
    violations.push({ rule: 'R6-recent-missions', detail: '"## 📜 Recent Missions" section missing' });
  } else {
    let bullets = 0;
    for (const line of src.slice(rmIdx).split('\n').slice(1)) {
      if (/^##\s/.test(line)) break; // next section
      if (/^\s*-\s+\S/.test(line)) bullets += 1;
    }
    if (bullets > MAX_RECENT_MISSIONS) {
      violations.push({
        rule: 'R6-recent-missions',
        detail:
          `${bullets} pointer lines > ${MAX_RECENT_MISSIONS} — drop the oldest ` +
          `(every mission stays fully recoverable in the CHANGELOG lane)`,
      });
    }
  }

  // R7 — the "where what lives" routing table (the reliability half of the slim:
  // an agent landing on the card always knows where removed info-classes live).
  if (!ROUTING_HEADER_RE.test(src)) {
    violations.push({
      rule: 'R7-routing',
      detail: '"## 🧭 Navigation — where what lives" routing table missing',
    });
  }

  return { violations };
}

// --- CLI shell --------------------------------------------------------------------

function runCli() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const target = process.argv[2] ?? join(repoRoot, 'pipeline_status.md');

  let text;
  try {
    text = readFileSync(target, 'utf8');
  } catch (err) {
    console.error(`[check:entrance-card] cannot read ${target}: ${err?.message ?? err}`);
    process.exit(1);
  }

  const { violations } = checkEntranceCard(text);
  if (violations.length === 0) {
    console.log(`[check:entrance-card] ✓ conforms to the Entrance-card contract (ADR 103).`);
    process.exit(0);
  }
  console.error(`[check:entrance-card] ✗ ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  - [${v.rule}] ${v.detail}`);
  console.error(
    '  Contract: GOVERNANCE § Retention Policy (Entrance-card row) · ' +
      'framework-decisions.md ADR 103',
  );
  process.exit(1);
}

const invokedAsCli =
  typeof process.argv[1] === 'string' && /check-entrance-card\.mjs$/.test(process.argv[1]);

if (invokedAsCli) runCli();
