// Shared text-formatting + sanitization helpers for the .claude scripts.
// Two consumer families: the display / orientation scripts (statusline.mjs,
// session-start-reminder.mjs) use ELLIPSIS + stripAnsi for width-correct
// truncation; the enforcement hooks (validate-frontmatter.mjs and the
// BE-consumer deny-message builders) use stripControl to defang an
// attacker-influenced field value before it is embedded in stderr.
// ELLIPSIS + shared stripAnsi.
// stripControl promoted here from validate-frontmatter once
// the rule-of-three was met (3 consumers) — one ESC-strip defense, not three.
// Featherweight + dependency-free so importing scripts keep their load-light property.

// Truncation ellipsis. ELLIPSIS_LEN is derived from ELLIPSIS so the cap math
// stays correct if the marker is ever changed (no hardcoded length).
export const ELLIPSIS = '...';
export const ELLIPSIS_LEN = ELLIPSIS.length;

// Strip ANSI SGR colour / style sequences (ESC [ ... m). Defensively
// String-coerced so non-string input never throws.
export function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

// Strip the ESC introducer byte (0x1b) from a value before it is embedded in
// stderr / a permissionDecisionReason. Removing ESC neutralizes ANY ANSI / CSI /
// OSC / SGR terminal escape sequence (all require ESC as the introducer),
// rendering an attacker-influenced field value inert in the emitted message.
// Broader than stripAnsi (which targets only the SGR colour subset for display
// width). Defensively String-coerced so non-string input never throws.
export function stripControl(s) {
  return String(s).replace(/\x1b/g, '');
}
