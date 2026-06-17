# Shelf Index: quality

## Directory Mission
This directory tracks the health, technical debt, and historical evolution of the project. It ensures that regressions are documented and protocol bypasses are resolved.

## File Registry

| File | Purpose | Status |
|---|---|---|
| `CHANGELOG.md` | Tracks recent changes using a 7-milestone rolling window. | Active |
| `known-issues.md` | Documents existing bugs or technical debt. | Active |
| `PROTOCOL_DEBT.md` | Tracks LFE-FORCE protocol bypasses that need to be resolved. | Active |
| `skill-eval-scorecard.md` | Measured catch-rate / false-positive rate per reasoning skill; 15-session retention. | Active |
| `inspector-config.md` | Enable/disable table for Inspector specialist sub-skills (security/perf/complexity/dep/mutation/visual). | Active |
| `RETENTION_RUNBOOK.md` | Step-by-step procedure for running a Hygiene retention sweep against the retention-managed files. Operational supplement to `lfe-hygiene/SKILL.md` §7. | Active |

> **Note to AI**: This is a local index. If you need a file not listed here, consult the Master Floor Map at `.docs/README.md`. The `pipeline_status.md` entrance card lives at the repo ROOT, not here.