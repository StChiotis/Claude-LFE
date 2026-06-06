// voice-census-config.mjs — scan configuration for the voice-census
// (Positive-Framing). Data only: the prohibitive-marker lexicon + the scope globs.
// The preserved-negation ledger lives separately in voice-census-allowlist.mjs.
//
// Posture: zero-dep ESM (ADR 81/83); pure data consumed by voice-census.mjs.

// Prohibitive-marker lexicon. Each entry is { marker, re }: a stable label plus a
// case-insensitive, word-boundary-anchored, NON-global regex (matched with .test,
// so there is no stateful lastIndex hazard). Conservative by design — the explicit
// imperative prohibitions plus the two hard-limit sentinels (`zero`, `no … allowed`)
// that the rewrite slices are expected to ALLOWLIST where they encode a real hard
// limit (which documents the preserve decision). Bare "no"/"not" are excluded as
// too noisy to be useful signal.
export const MARKER_LEXICON = Object.freeze([
  { marker: 'never', re: /\bnever\b/i },
  { marker: 'do not', re: /\bdo not\b/i },
  { marker: "don't", re: /\bdon[’']t\b/i },
  { marker: 'cannot', re: /\bcannot\b/i },
  { marker: "can't", re: /\bcan[’']t\b/i },
  { marker: 'must not', re: /\bmust not\b/i },
  { marker: "mustn't", re: /\bmustn[’']t\b/i },
  { marker: 'may not', re: /\bmay not\b/i },
  { marker: 'shall not', re: /\bshall not\b/i },
  { marker: 'forbidden', re: /\bforbidden\b/i },
  { marker: 'prohibited', re: /\bprohibit(?:ed|s|ion)?\b/i },
  { marker: 'disallow', re: /\bdisallow(?:ed|s)?\b/i },
  { marker: 'not allowed', re: /\bnot allowed\b/i },
  { marker: 'not permitted', re: /\bnot permitted\b/i },
  { marker: 'no-allowed', re: /\bno\b[^.!?\n]*\ballowed\b/i },
  { marker: 'zero', re: /\bzero\b/i },
]);

// The full M8 rewrite surface (report-mode worklist). The protocol surface needs
// BOTH globs: the glob engine (be-escape matchGlob) treats `**` as ≥1 path
// segment, so `.docs/protocol/**/*.md` matches only the nested personas/ dir;
// the top-level governance docs need the bare `.docs/protocol/*.md`.
export const IN_SCOPE_GLOBS = Object.freeze([
  '.agents/skills/**/*.md',
  '.claude/skills/**/*.md',
  '.docs/protocol/*.md',
  '.docs/protocol/**/*.md',
  'CLAUDE.md',
  '.agents/adapters/**',
  'LLM_AGENT_GUIDE.md',
]);

// The subset currently ENFORCED (the flagged remainder over these globs must be
// empty). Grows incrementally as each surface is rewritten; equals IN_SCOPE_GLOBS when complete
// (the scope-symmetry completeness assertion). The skills surface was added first;
// then the protocol + persona surface — BOTH globs are required (the bare
// `*.md` matches the top-level governance docs; `**/*.md` matches the personas/ dir).
// then the adapters + guide — ENFORCED_GLOBS now EQUALS IN_SCOPE_GLOBS
// (the full sweep is enforced; the integration test asserts that scope-symmetry).
export const ENFORCED_GLOBS = Object.freeze([
  '.agents/skills/**/*.md',
  '.claude/skills/**/*.md',
  '.docs/protocol/*.md',
  '.docs/protocol/**/*.md',
  'CLAUDE.md',
  '.agents/adapters/**',
  'LLM_AGENT_GUIDE.md',
]);

// Paths the census must never scan: the product/cold-tier doc dirs (strategy roadmaps,
// archive cold-tier) — not agent-instruction surfaces — plus transient/VCS dirs.
export const EXCLUDED_GLOBS = Object.freeze([
  '.docs/strategy/**',
  '.docs/archive/**',
  '.plans/**',
  '.git/**',
  // The skill-eval fixture corpus is non-instruction substrate (sample code,
  // plan fixtures, and a shelf index). Fixtures legitimately contain prohibitive
  // markers as test data, so the directive-voice census must not scan them.
  '.agents/skills/_evals/**',
]);
