#!/usr/bin/env node
// statusLine — continuous-display command.
// Reads stdin JSON payload + pipeline_status.md and emits a single-line
// summary of Persona / Mission State / Pipeline Phase / Session Count with
// persona emoji + ANSI colors. Warn-and-log posture: always exits 0; falls
// back to a benign hint on any parse failure.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { parseEntranceCard, ENTRANCE_CARD_FILENAME } from './lib/parse-entrance-card.mjs';
import { leadingPersonaName } from './lib/persona-name.mjs';
import { ELLIPSIS, ELLIPSIS_LEN, stripAnsi } from './lib/text-format.mjs';
import { readStdinAll } from './lib/stdin-reader.mjs';

// Re-export so .claude/__tests__/statusline.test.mjs's existing import
// (from '../statusline.mjs') continues to resolve unchanged after the
// session-5 Hygiene extraction.
export { parseEntranceCard };

const MAX_LINE_CHARS = 120;
export const FALLBACK_TEXT = '[LFE] status unavailable — run /lfe-boot';
const SEP = ' │ ';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// Persona table — emoji from .docs/protocol/PERSONAS.md + ANSI color.
export const PERSONA_TABLE = {
  Architect: { emoji: '🏛️', color: ANSI.cyan },
  Builder:   { emoji: '🔨', color: ANSI.yellow },
  Inspector: { emoji: '🕵️', color: ANSI.magenta },
  Archivist: { emoji: '📚', color: ANSI.blue },
  Scout:     { emoji: '🚀', color: ANSI.green },
  Brain:     { emoji: '🫵', color: ANSI.white },
};

// Mission State variants — match against bracketed entrance-card values.
export const STATE_VARIANTS = [
  { match: /^\[BLANK CANVAS\]/i,     label: 'BLANK CANVAS',     color: ANSI.blue },
  { match: /^\[DOMAIN LOADED\]/i,    label: 'DOMAIN LOADED',    color: ANSI.cyan },
  { match: /^\[IN-FLIGHT/i,          label: 'IN-FLIGHT',        color: ANSI.yellow },
  { match: /^\[MISSION COMPLETE\]/i, label: 'MISSION COMPLETE', color: ANSI.green },
  { match: /^\[State Anomaly\]/i,    label: 'STATE ANOMALY',    color: ANSI.red },
];

export function parseStdinPayload(text) {
  if (text == null) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function resolveProjectDir({ stdinPayload, env, cwd }) {
  const fromStdin = stdinPayload?.workspace?.project_dir;
  if (typeof fromStdin === 'string' && fromStdin.length > 0) return fromStdin;
  const fromEnv = env?.CLAUDE_PROJECT_DIR;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return cwd ?? process.cwd();
}

// pipeline_status.md Active-Persona cell convention (entrance-card
// Active-Constraint #9): `<emoji> <Name>` — a leading persona emoji + the
// canonical name, no trailing note. Lowercase-canonical map built once from
// PERSONA_TABLE so the two never drift; lets formatPersona resolve the decorated
// live cell via the shared leadingPersonaName reader. A legacy `*(...)*` note is
// tolerated defensively (the reader ignores it).
const PERSONA_BY_LOWER = Object.fromEntries(
  Object.keys(PERSONA_TABLE).map((name) => [name.toLowerCase(), name]),
);

export function formatPersona(personaStr) {
  const raw = String(personaStr ?? '').trim();
  // Fast path: a bare canonical name (the historical input shape).
  if (raw && Object.prototype.hasOwnProperty.call(PERSONA_TABLE, raw)) {
    return { ...PERSONA_TABLE[raw], raw };
  }
  // Decorated cell (`<emoji> <Name> [*(note)*]`): strip via the shared reader,
  // then map the lowercase name back to its canonical PERSONA_TABLE entry.
  const name = leadingPersonaName(raw);
  if (name && Object.prototype.hasOwnProperty.call(PERSONA_BY_LOWER, name)) {
    const canonical = PERSONA_BY_LOWER[name];
    return { ...PERSONA_TABLE[canonical], raw: canonical };
  }
  return { emoji: '⚙️', color: ANSI.dim, raw: 'Unknown' };
}

export function formatState(stateStr) {
  const raw = String(stateStr ?? '').trim();
  for (const variant of STATE_VARIANTS) {
    if (variant.match.test(raw)) {
      return { label: variant.label, color: variant.color };
    }
  }
  return { label: 'UNPARSED', color: ANSI.dim };
}

export function capLine(s) {
  const visible = stripAnsi(s);
  if (visible.length <= MAX_LINE_CHARS) return s;
  // Pathological-input defensive guard: drop ANSI on overflow and slice to
  // exactly MAX visible chars including the trailing ellipsis.
  return visible.slice(0, MAX_LINE_CHARS - ELLIPSIS_LEN) + ELLIPSIS;
}

export function render({ entrance }) {
  try {
    const persona = formatPersona(entrance?.activePersona);
    const state = formatState(entrance?.missionState);
    const phaseRaw = String(entrance?.pipelinePhase ?? '').trim() || '—';
    const sessionRaw = String(entrance?.sessionCount ?? '').trim() || '?';

    const personaField = `${persona.color}${persona.emoji} ${persona.raw}${ANSI.reset}`;
    const stateField = `${state.color}${state.label}${ANSI.reset}`;
    const phaseField = `${ANSI.dim}${phaseRaw}${ANSI.reset}`;
    const sessionField = `${ANSI.bold}#${sessionRaw}${ANSI.reset}`;

    const line = [personaField, stateField, phaseField, sessionField].join(SEP);
    return capLine(line);
  } catch {
    return FALLBACK_TEXT;
  }
}

export async function main({ stdinText, readFileText, env, cwd }) {
  try {
    const stdinPayload = parseStdinPayload(stdinText);
    const projectDir = resolveProjectDir({ stdinPayload, env, cwd });
    const entranceText = await readFileText(join(projectDir, ENTRANCE_CARD_FILENAME));
    const entrance = parseEntranceCard(entranceText);
    // If every primary row is 'unknown', the file isn't a recognisable
    // entrance card — return fallback rather than render a useless line.
    const knownCount = ['missionState', 'activePersona', 'pipelinePhase', 'sessionCount']
      .map((k) => entrance[k])
      .filter((v) => v !== 'unknown').length;
    if (knownCount === 0) return FALLBACK_TEXT;
    return render({ entrance });
  } catch {
    return FALLBACK_TEXT;
  }
}

async function runCli() {
  const stdinText = await readStdinAll();
  const text = await main({
    stdinText,
    readFileText: (p) => readFile(p, 'utf8'),
    env: process.env,
    cwd: process.cwd(),
  });
  process.stdout.write(text);
  process.exit(0);
}

const invokedAsCli =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /statusline\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch(() => {
    process.stdout.write(FALLBACK_TEXT);
    process.exit(0);
  });
}
