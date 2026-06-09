# Skill-Accuracy Scorecard

> **Retention policy:** 15 most recent eval sessions in this hot file; older entries roll to [`.docs/archive/skill-eval-scorecard-history.md`](../archive/skill-eval-scorecard-history.md). Measures whether LFE's five prompt-based reasoning skills actually catch planted defects (catch-rate), how often they false-alarm on clean controls (false-positive rate), and whether the corpus has saturated.

**Run parameters:** k = 5 run(s)/fixture · session 0 · generated 2026-06-09T15:36:17Z · model Claude Opus 4.8 · thresholds: reliable-pass ≥ 80%, skill-pass catch-rate ≥ 80% and false-positive ≤ 20%.

## Per-Skill Results

| Skill | Catch-rate | False-positive | Saturated | Passed |
|---|---|---|---|---|
| `lfe-complexity-check` | 100% | 0% | ⚠ yes | ✅ |
| `lfe-mutation-verify` | 100% | 0% | ⚠ yes | ✅ |
| `lfe-perf-check` | 100% | 0% | ⚠ yes | ✅ |
| `lfe-plan-critique` | 100% | 0% | ⚠ yes | ✅ |
| `lfe-security-check` | 100% | 0% | ⚠ yes | ✅ |

## Raw Per-Fixture Pass-Rates

| Fixture | Skill | Kind | Pass-rate | Reliable-pass (≥ 80%) |
|---|---|---|---|---|
| `cx-bad-1` | `lfe-complexity-check` | known-bad | 100% | ✅ |
| `cx-bad-2` | `lfe-complexity-check` | known-bad | 100% | ✅ |
| `cx-good-1` | `lfe-complexity-check` | known-good | 100% | ✅ |
| `mut-bad-1` | `lfe-mutation-verify` | known-bad | 100% | ✅ |
| `mut-bad-2` | `lfe-mutation-verify` | known-bad | 100% | ✅ |
| `mut-good-1` | `lfe-mutation-verify` | known-good | 100% | ✅ |
| `perf-bad-1` | `lfe-perf-check` | known-bad | 100% | ✅ |
| `perf-bad-2` | `lfe-perf-check` | known-bad | 100% | ✅ |
| `perf-good-1` | `lfe-perf-check` | known-good | 100% | ✅ |
| `plan-bad-2` | `lfe-plan-critique` | known-bad | 100% | ✅ |
| `plan-good-1` | `lfe-plan-critique` | known-good | 100% | ✅ |
| `sec-bad-1` | `lfe-security-check` | known-bad | 100% | ✅ |
| `sec-bad-2` | `lfe-security-check` | known-bad | 100% | ✅ |
| `sec-good-1` | `lfe-security-check` | known-good | 100% | ✅ |

---

**Archive:** Older entries are in [archive/skill-eval-scorecard-history.md](../archive/skill-eval-scorecard-history.md). Last archive sweep: session 0.
