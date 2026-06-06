// voice-census-allowlist.mjs — the preserved-negation LEDGER for the voice-census
// (Positive-Framing). Each entry records a deliberately-kept negation:
// a load-bearing hard limit (numeric cap, absolute boundary, persona write-lane
// rule) or a deny/reject decision, where the starkness IS the feature.
//
// Match rule (see voice-census.mjs partitionFindings): a flagged line becomes
// ALLOWED when its file matches `file` (an exact path or a glob) AND its line text
// contains `snippet`. `reason` documents WHY the negation stays — it is NOT matched
// against; it is the audit record an adopter reads.
//
// Empty initially: the census ships before the rewrites. Later passes append one
// entry per preserved negation as each surface is rewritten. The census reports any
// entry that matches nothing in the scanned surface (collectUnusedAllowlist), so a
// stale entry cannot silently rot the ledger.
//
// Entry shape:
//   { file: '<exact path or glob>', snippet: '<substring of the preserved line>', reason: '<why it stays>', kind: <KIND> }
// where KIND is one of:
//   'hard-limit'     — a stark absolute boundary whose starkness IS the safety feature
//                      (e.g. "Zero Code Edits", "Never touch src/", a read-only skill's "Never modify").
//   'deny-decision'  — the line is a refuse/deny output the agent emits (like a hook deny-message).
//   'false-positive' — the marker is a quoted concept or literal report output that cannot be
//                      naturally removed (e.g. extract-domain's quoted 'Never' rules, "Zero Drift Detected").

export const ALLOWLIST = Object.freeze([
  // --- skills surface ---
  // Hard limits — stark absolute boundaries where the starkness is the safety feature.
  { file: '**/lfe-architect/SKILL.md', snippet: 'Zero Code Edits', reason: "Architect's absolute persona write-lane boundary (edits stay out of src/) — starkness is the feature", kind: 'hard-limit' },
  { file: '**/lfe-plan-critique/SKILL.md', snippet: 'Zero Code Writes', reason: 'absolute read-only boundary for the pre-build critique skill — starkness is the feature', kind: 'hard-limit' },
  { file: '**/lfe-whats-next/SKILL.md', snippet: 'Never modify any files', reason: 'read-only navigator skill — hard no-write boundary; starkness is the feature', kind: 'hard-limit' },
  // Deny outputs — text the agent emits to refuse, analogous to a hook deny-message.
  { file: '**/SKILL.md', snippet: 'cannot be run standalone', reason: 'the five Inspector sub-skills’ standalone-invocation refusal message (a deny output)', kind: 'deny-decision' },
  // False positives — quoted concept / literal report output that cannot be naturally removed.
  { file: '**/lfe-hygiene/SKILL.md', snippet: 'Zero Drift Detected', reason: 'literal clean-report body string the hygiene skill writes — output, not an instruction', kind: 'false-positive' },

  // --- protocol + persona surface ---
  // Deny output — the literal refusal message the agent emits (analogous to a hook deny-message).
  { file: '**/GOVERNANCE.md', snippet: 'I cannot perform this action', reason: 'the Logic-Sovereignty refusal message the agent emits — a deny output, not an instruction', kind: 'deny-decision' },
  // False positive — a named industry security concept, not prohibitive voice (one entry covers both occurrences in the file).
  { file: '**/INDUSTRY_STANDARDS.md', snippet: 'Zero-Trust', reason: '"Zero-Trust" is the named CODEOWNERS benchmark concept (an industry term), not prohibitive voice', kind: 'false-positive' },
  // Hard limits — stark absolute persona boundaries where the starkness is the safety feature.
  { file: '**/personas/architect.md', snippet: 'ZERO CODE EDITS', reason: "Architect's absolute write-lane boundary (edits stay out of src/) — mirrors the lfe-architect SKILL hard-limit", kind: 'hard-limit' },
  { file: '**/personas/scout.md', snippet: 'FORBIDDEN', reason: 'Scout Flyweight-mode bright-line — the hard-constraint header bounding the minor-fix lane; starkness is the feature', kind: 'hard-limit' },
]);
