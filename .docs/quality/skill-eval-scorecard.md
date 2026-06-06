# Skill-Accuracy Scorecard

> **Retention policy:** 15 most recent eval sessions in this hot file; older entries roll to [`.docs/archive/skill-eval-scorecard-history.md`](../archive/skill-eval-scorecard-history.md). Measures whether LFE's five defect-catching reasoning skills (security, performance, complexity, mutation-reasoning, plan-critique) actually catch planted defects (catch-rate), how often they false-alarm on clean controls (false-positive rate), and whether the corpus has saturated.

> **Status — initial (no run yet).** This scorecard ships in its honest initial state: no eval has run, so no results are fabricated. Run `/lfe-skill-eval` (full mode) to populate the tables below. The render is produced by [`.claude/lib/skill-eval-report.mjs`](../../.claude/lib/skill-eval-report.mjs) from real graded runs; the proof that it populates correctly is the report unit test ([`.claude/lib/__tests__/skill-eval-report.test.mjs`](../../.claude/lib/__tests__/skill-eval-report.test.mjs)), not committed sample data.

**Run parameters:** k = 5 run(s)/fixture · session 0 · not yet run · model not yet recorded · thresholds: reliable-pass ≥ 80%, skill-pass catch-rate ≥ 80% and false-positive ≤ 20%.

## Per-Skill Results

| Skill | Catch-rate | False-positive | Saturated | Passed |
|---|---|---|---|---|
| _(no eval run yet — run `/lfe-skill-eval` to populate)_ | — | — | — | — |

## Raw Per-Fixture Pass-Rates

| Fixture | Skill | Kind | Pass-rate | Reliable-pass (≥ 80%) |
|---|---|---|---|---|
| _(none yet)_ | — | — | — | — |

---

**Archive:** Older entries are in [archive/skill-eval-scorecard-history.md](../archive/skill-eval-scorecard-history.md). Last archive sweep: session 0.
