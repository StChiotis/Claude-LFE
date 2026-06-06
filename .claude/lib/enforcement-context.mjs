// Enforcement-context — shared state-reader for the enforcement gates.
//
// Per ADR 95. The
// four enforcement gates (no-mission / boot-precondition / bash-posture /
// persona-transition) all need the same facts about "where the framework
// stands": the entrance-card state, the active mission, whether a coordination
// trail exists in .plans/, whether a Scout session is active, and whether the
// session has been booted. Reading that once here — instead of each gate
// re-deriving it — keeps the reads DRY and the fail-safe behaviour uniform.
//
// Posture: zero-dep (Node built-ins only, ADR 83); ESM (ADR 81); pure functions
// over injected I/O (no direct filesystem access) so the consuming gates' tests
// can mock every read. Mirrors the dependency-injection seam used across the
// hook layer.
//
// Asymmetric fail-safe (ADR 85): if the entrance card cannot be read or parsed,
// `readEnforcementContext` returns `{ unreadable: true, ... }`. Gates treat an
// unreadable substrate as ALLOW — an unparseable framework state must never lock
// the user out of recovery.

import { parseEntranceCard, ENTRANCE_CARD_FILENAME } from './parse-entrance-card.mjs';
import { extractActiveMission, normalizePath } from './be-escape.mjs';
import { FRAMEWORK_INFRA_PATHS } from '../hooks/persona-path-lock.mjs';
import { leadingPersonaName } from './persona-name.mjs';

// --- Constants ----------------------------------------------------------------

export const ENFORCEMENT_POSTURE_PATH = '.claude/enforcement-posture.json';
export const DEFAULT_POSTURE = 'warn';
export const VALID_POSTURES = Object.freeze(['warn', 'block']);

// Per-session boot marker. The C4 no-mission gate does not consume this
// field; the C2a boot-precondition gate finalizes the session-id keying and
// owns the write side via /lfe-boot.
export const BOOT_SENTINEL_PATH = '.plans/.session-booted';

// Per-session id, rotated by the SessionStart hook (it alone receives session_id).
// /lfe-boot copies this into BOOT_SENTINEL_PATH; the gates compare the two.
export const BOOT_SESSION_ID_PATH = '.plans/.session-id';

// Single shared substrate carve-out for the whole enforcement-gate family: the
// canonical framework-infra path set (defined in persona-path-lock) PLUS
// `.plans/**` — coordination-trail and session-marker writes establish/maintain
// the pipeline and must never be gated. Centralized here so every gate consumes
// ONE definition instead of each re-deriving it. (persona-path-lock does not
// import this lib, so the import is acyclic.)
export const SUBSTRATE_CARVE_OUT = Object.freeze([...FRAMEWORK_INFRA_PATHS, '.plans/**']);

// A coordination "trail" = any real coordination file in .plans/. `.gitkeep`
// marks the directory and does not count; dotfiles (e.g. the boot sentinel) are
// framework substrate, not a pipeline trail.
function isTrailFile(name) {
  return typeof name === 'string' && name.endsWith('.md') && name !== '.gitkeep';
}

// --- Pure helpers (exported for unit testing) ---------------------------------

// True when the entrance card reports no active mission of the "completed/idle"
// kind that C4 guards. Scoped deliberately to MISSION COMPLETE: BLANK CANVAS and
// DOMAIN LOADED are pre-domain states with their own Day-0 flow (e.g.
// /lfe-extract-domain writes docs) and must not trip the no-mission gate.
export function isMissionCompleteIdle(missionState) {
  return /MISSION COMPLETE/i.test(String(missionState ?? ''));
}

export function isScoutPersona(activePersona) {
  return leadingPersonaName(activePersona) === 'scout';
}

// --- Posture reader -----------------------------------------------------------

// Reads the per-gate posture ("warn" | "block") from .claude/enforcement-posture.json.
// Default "warn" on any read/parse failure, missing key, or invalid value — new
// enforcement always starts in warn-and-log posture (ADR 87 family). Promotion to
// "block" is a deliberate human edit of that one file.
export async function readPosture(gateName, { readFileText, projectRoot } = {}) {
  try {
    const path = projectRoot
      ? joinPath(projectRoot, ENFORCEMENT_POSTURE_PATH)
      : ENFORCEMENT_POSTURE_PATH;
    const text = await readFileText(path);
    const config = JSON.parse(text);
    const value = config?.[gateName];
    return VALID_POSTURES.includes(value) ? value : DEFAULT_POSTURE;
  } catch {
    return DEFAULT_POSTURE;
  }
}

// Local path join (avoids importing node:path into this otherwise path-free lib;
// the gates pass a normalized projectRoot). Forward-slash join is correct for the
// glob/normalize layer, which is posix-based.
function joinPath(root, rel) {
  const r = String(root ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  return r ? `${r}/${rel}` : rel;
}

// --- Context reader -----------------------------------------------------------

// Reads framework state once and returns a typed context the gates consume.
//   payload      — parsed hook stdin ({ tool_name, tool_input, cwd, session_id, ... })
//   readFileText — injected file reader (entrance card, boot sentinel)
//   listPlans    — injected () => string[] of .plans/ entry names
//   projectRoot  — repo root (forward-slashed)
export async function readEnforcementContext({ payload, readFileText, listPlans, projectRoot }) {
  const toolName = payload?.tool_name ?? null;
  const toolInput = payload?.tool_input ?? {};
  const rawFilePath = typeof toolInput?.file_path === 'string' ? toolInput.file_path : null;
  const target = rawFilePath ? normalizePath(rawFilePath, projectRoot) : null;
  const sessionId = payload?.session_id ?? null;

  // Entrance card — the authoritative state. Unreadable/unparseable => fail-safe.
  let entranceText;
  try {
    const cardPath = projectRoot
      ? joinPath(projectRoot, ENTRANCE_CARD_FILENAME)
      : ENTRANCE_CARD_FILENAME;
    entranceText = await readFileText(cardPath);
  } catch {
    return {
      unreadable: true,
      toolName,
      target,
      sessionId,
      missionState: 'unknown',
      activePersona: 'unknown',
      activeMission: 'n/a',
      hasCoordinationTrail: false,
      scoutActive: false,
      missionCompleteIdle: false,
      booted: false,
      bootMechanismPrimed: false,
    };
  }

  const card = parseEntranceCard(entranceText);
  const missionState = card.missionState ?? 'unknown';
  const activePersona = card.activePersona ?? 'unknown';
  const activeMission = extractActiveMission(entranceText);

  // Coordination trail in .plans/ (mission-in-flight signal).
  let hasCoordinationTrail = false;
  try {
    const entries = (await listPlans()) ?? [];
    hasCoordinationTrail = entries.some(isTrailFile);
  } catch {
    // Listing failure: treat as no-trail but do not mark the whole context
    // unreadable — the entrance card (the authoritative source) was readable.
    hasCoordinationTrail = false;
  }

  // Boot handshake (C2a): the session is "booted" iff the boot marker
  // (.session-booted, written by /lfe-boot) equals the per-session id
  // (.session-id, rotated by the SessionStart hook). `bootMechanismPrimed` is
  // true once .session-id exists — it lets a gate distinguish "rotation not
  // active → fail-safe ALLOW" from "primed but not booted → warn".
  const readTrimmed = async (rel) => {
    try {
      const p = projectRoot ? joinPath(projectRoot, rel) : rel;
      return String(await readFileText(p)).trim();
    } catch {
      return null;
    }
  };
  const sessionIdContent = await readTrimmed(BOOT_SESSION_ID_PATH);
  const sessionBootedContent = await readTrimmed(BOOT_SENTINEL_PATH);
  const bootMechanismPrimed = sessionIdContent !== null && sessionIdContent !== '';
  const booted =
    bootMechanismPrimed &&
    sessionBootedContent !== null &&
    sessionBootedContent === sessionIdContent;

  return {
    unreadable: false,
    toolName,
    target,
    sessionId,
    missionState,
    activePersona,
    activeMission,
    hasCoordinationTrail,
    scoutActive: isScoutPersona(activePersona),
    missionCompleteIdle: isMissionCompleteIdle(missionState),
    booted,
    bootMechanismPrimed,
  };
}
