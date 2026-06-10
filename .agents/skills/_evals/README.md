# Shelf Index: _evals (skill-accuracy eval corpus)

## Directory Mission
Fixture corpus + expected-outcome sidecars for the skill-accuracy eval harness. Each `lfe-*` reasoning skill is measured against small samples that carry a planted defect (known-bad) plus clean controls (known-good). The deterministic grader (`.claude/lib/skill-eval.mjs`) scores a skill's output against the matching sidecar; the telegraph lint (`.claude/lib/telegraph-lint.mjs`) guarantees no fixture gives its defect away. The leading-underscore name marks this as non-dispatchable substrate — `scripts/sync-claude-skills.mjs` skips it, so it is never mirrored into `.claude/skills/`.

## File Registry

| Path | Purpose | Status |
|---|---|---|
| `fixtures/security/` | OWASP defects (SQLi, command injection) + a clean control | Active |
| `fixtures/perf/` | N+1 + unbounded-growth defects + a clean control | Active |
| `fixtures/complexity/` | deep-nesting + god-function defects + a clean control | Active |
| `fixtures/mutation/` | impl+test pairs with an escaping mutation + a thorough control | Active |
| `fixtures/plan-critique/` | plan docs → BLOCK (undocumented logic) / PASS (clean); the subjective WARN borderline is delegated to the human gate, not auto-graded | Active |
| `expected/<name>.json` | one sidecar per fixture: `skill`, `kind`, the family match block, `mustMention`/`mustNotMention` | Active |

Convention: each fixture `fixtures/<skill>/<name>.{js,md}` has a sidecar `expected/<name>.json`. Two known-bad + one known-good per skill — except plan-critique, which carries one known-bad (clear BLOCK) + one known-good (clear PASS), its subjective WARN/BLOCK borderline delegated to the human gate (14 fixtures total). The corpus-integrity test is `.claude/lib/__tests__/skill-eval-corpus.test.mjs`.

> **Note to AI**: This is a local index — the project holds more files than these. For a file not listed here, consult the Master Floor Map at `.docs/README.md`.
