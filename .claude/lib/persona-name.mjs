// Canonical persona-name reader — shared by every pipeline_status.md
// Active-Persona cell consumer.
//
// The Active-Persona cell is decorated: by convention `<emoji> <Name>`
// (entrance-card Active-Constraint #9), e.g. `🔨 Builder`. A leading persona
// emoji defeats a naive `^(Name)` anchor, so before this reader existed each
// consumer rolled its own parser and the emoji silently broke ALL of them four
// different ways: statusline → ⚙️ Unknown; persona-path-lock → fail-safe ALLOW
// (the write-lane went unenforced); enforcement-context.isScoutPersona → false;
// persona-transition-guard (C3) → indeterminate → silent ALLOW. One hardened
// parser replaces the four divergent copies.
//
// Posture: zero-dep (ADR 83), ESM (ADR 81), pure function — no I/O.

// Canonical persona names. Brain is included so a decorated `🫵 Brain` cell
// resolves for the statusline (PERSONA_TABLE carries Brain); the enforcement
// gates tolerate the extra name harmlessly — no card carries Brain as the
// working Active Persona, and permissions.json has no `brain` write-lane
// (an unmatched persona fail-safe-ALLOWs, never locks out).
export const PERSONA_NAMES = Object.freeze([
  'Architect', 'Builder', 'Inspector', 'Archivist', 'Scout', 'Brain',
]);

const PERSONA_LEAD_RE = new RegExp(`^(${PERSONA_NAMES.join('|')})\\b`, 'i');

// Leading persona NAME (lowercased) of an Active-Persona cell value, or null
// when the cell does not begin with a known persona.
//
// Tolerant of a leading emoji / non-letter prefix (stripped first) and an
// optional trailing `*(...)*` note (it sits after the anchored name, so it is
// ignored). The word boundary keeps "Architecture" from matching "Architect";
// the start-anchored match means a persona named *inside* the note is inert
// (so `🏛️ Architect *(… from Archivist …)*` resolves to architect, not
// archivist). Returns null for an emoji-only cell, the "unknown" parse
// sentinel, garbage, and nullish input — every consumer then falls to its own
// safe default.
export function leadingPersonaName(cellValue) {
  const stripped = String(cellValue ?? '').trim().replace(/^[^A-Za-z]+/, '');
  const m = stripped.match(PERSONA_LEAD_RE);
  return m ? m[1].toLowerCase() : null;
}
