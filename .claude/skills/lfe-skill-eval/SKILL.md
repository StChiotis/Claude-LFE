---
name: lfe-skill-eval
description: Skill-accuracy eval runner. Executes each LFE reasoning skill (security / perf / complexity / mutation + plan-critique) against the _evals corpus in isolated subagents, k times each, grades every run with the deterministic grader, and renders the skill-accuracy scorecard + machine results record. Dispatched from the Hygiene sub-pipeline or on demand; framework-dispatched (agent-only, outside the Brain-typeable set).
---

# LFE Skill-Eval Runner — Measured Catch-Rate for the Reasoning Skills

## Position in Pipeline
- **Phase**: 5 (Hygiene sub-pipeline — every 3rd sweep ≈ every 15 sessions) / on-demand
- **Persona**: any (read-only on the corpus + skills; writes the scorecard + the results record only)
- **Trigger**: dispatched from the Hygiene sub-pipeline, or on demand when measuring the reasoning skills' accuracy
- **Output**: `.docs/quality/skill-eval-scorecard.md` (human) + `.claude/lib/__eval__/results.json` (machine — the pre-commit gate reads it)

## Mission
LFE leans on five prompt-based reasoning skills; this runner is the first to measure their real catch-rate. It runs each skill's exact canonical prompt against a corpus of planted-defect (known-bad) and clean (known-good) fixtures, repeats each run k times for a consistency rate, grades every output deterministically, and reports a per-skill catch-rate, false-positive rate, and saturation flag.

## Why isolated subagents (ADR 98)
Each run executes in a fresh, isolated subagent context (the general-purpose Agent/Task tool). Isolation is the precondition for an honest consistency + saturation measurement — independent contexts keep each fixture's reasoning self-contained, so one fixture's output stays clear of the next and the rate stays honest. This uses the built-in general-purpose Agent tool, distinct from the project-registered specialist agents that ADR 93 found unreliable in this repo, and distinct from the in-chat sub-skill dispatch the Inspector uses. ADR 98 records this as a scoped complement to ADR 93.

## Hard Rules
1. **Verbatim prompts**: read each target skill's canonical prompt from `.agents/skills/<skill>/SKILL.md` and feed it to the subagent byte-for-byte. The eval measures the prompt exactly as it ships.
2. **One isolated subagent per run**: spawn a fresh subagent for every (fixture × run) pair; keep the contexts independent.
3. **Deterministic grading**: grade each captured output through `node .claude/lib/skill-eval.mjs <output> <sidecar> --json` and read the `pass` boolean. Aggregation + render run through `node .claude/lib/skill-eval-report.mjs`. Reasoning stays in the subagents; scoring stays in the tested core.
4. **Honest results**: the scorecard + the results record are rendered by the report CLI from real graded runs. A smoke run writes its scorecard + results into the per-run scratch directory (Hard Rule 6), leaving the committed scorecard in its initial state.
5. **Key off the sidecar**: each fixture's `expected/<name>.json` declares its `skill` and `kind`; resolve the canonical prompt and the family from that `skill` field (the fixture directory name is a family label; the sidecar `skill` is authoritative).
6. **Scratch lifecycle (out-of-tree + cleanup)**: write ALL transient scratch — captured-findings files, the `runResults` JSON, and any smoke-mode throwaway scorecard/results — to a single per-run scratch directory created under the OS temp dir (`os.tmpdir()` / `mkdtemp`; `$env:TEMP` on Windows), always outside the repo working tree. Give scratch files a `.tmp` suffix. Delete the per-run scratch directory at end-of-run — on success or failure — so a run leaves no transient file behind. The only files a run writes into the tree are the committed deliverables on a full run (`.docs/quality/skill-eval-scorecard.md` + `.claude/lib/__eval__/results.json`); a smoke run writes none.

## Modes
- **smoke** (build-time proof / CI-cheap): a small subset — e.g. 2 fixtures × k=2 — that proves the subagent → grade → aggregate → render pipeline end-to-end. Output goes to the per-run scratch directory (Hard Rule 6); the committed scorecard stays in its initial state.
- **full** (every 3rd Hygiene sweep ≈ every 15 sessions / on-demand): the whole corpus (15 fixtures) × k=5 ≈ 75 subagent runs. Token-bounded by design — this is exactly why the full run rides a longer cadence than the 5-session sweep (see Step 1's cadence gate): run it on every 3rd Hygiene sweep or on explicit request, and surface the run count as the token cost for Brain awareness. A full run populates the committed scorecard + results record.

## Inputs
1. Corpus fixtures: `.agents/skills/_evals/fixtures/<family>/<name>.{js,md}`
2. Expected sidecars: `.agents/skills/_evals/expected/<name>.json` (`skill`, `kind`, the family match block, `mustMention`/`mustNotMention`)
3. Canonical prompts: `.agents/skills/<sidecar.skill>/SKILL.md`
4. Grader: `.claude/lib/skill-eval.mjs` · Report core: `.claude/lib/skill-eval-report.mjs`

## Workflow

### Step 1 — Scope the run
Choose the mode (smoke | full), k (default 5), and read the current session count from `pipeline_status.md`. **Also record the model you are currently running as** — the model identity from your own environment/system context (e.g. the `claude-…` id you are running as — read it live from your own context each run), which the isolated subagents inherit — and pass it to the report CLI in Step 3 so the scorecard captures which model produced the scores. For a smoke run, pick a representative subset (at least one known-bad and one known-good across one or two skills).

**Cadence gate (Hygiene-dispatched full runs only).** A full run is token-heavy (~75 subagent runs), so it rides a longer cadence than the 5-session Hygiene sweep: **every 3rd sweep ≈ every 15 sessions**. When the Hygiene sub-pipeline dispatches this skill, gate the full run on the scorecard's own last-run session: read the `session N` stamp from `.docs/quality/skill-eval-scorecard.md`'s Run-parameters line, and run the full pass **only when** `current_session − last_eval_session ≥ 15`. If the gap is smaller, report *"eval not due (last ran session X; gap Y < 15; next at session X+15)"* and skip — no subagents spawned. The initial scorecard stamps session 0, so the first scheduled full run fires at the first sweep where `current_session ≥ 15`. **On-demand invocations** (an explicit Brain request, or a pre-release check) **always run, bypassing the gate** — the cadence is only the automatic floor. This Light mechanism stays self-contained: it reads the eval's own scorecard stamp, adding no entrance-card field and no hook change.

### Step 2 — Per fixture, per run: isolated subagent
For each selected fixture:
1. Read its sidecar `expected/<name>.json` → `{ skill, kind }`.
2. Read the canonical prompt `.agents/skills/<skill>/SKILL.md`.
3. Read the fixture file `fixtures/<family>/<name>.{js,md}`.
4. Repeat k times: spawn an isolated subagent (general-purpose Agent/Task tool) whose instruction is the canonical prompt PLUS the fixture (presented per its family, below), asking it to emit only the skill's findings output in that skill's canonical format.
5. Write the captured findings to a `.tmp` file inside the per-run scratch directory (Hard Rule 6) and grade it: `node .claude/lib/skill-eval.mjs <scratch-dir>/findings.tmp .agents/skills/_evals/expected/<name>.json --json` → record the `pass` boolean.

The k booleans become that fixture's `runs` array.

### Step 2a — Fixture presentation per family
Present each fixture to the subagent in the role its skill expects:
- **security / perf / complexity** (severity family; `.js` fixture): present the fixture as the changed implementation under review; the subagent walks its checklist and emits `## <Name> Check Findings` with the severity sections + Summary.
- **mutation** (outcome family; `.js` fixture carrying impl + tests): present the fixture as the implementation together with its tests; the subagent reasons about escaping mutations and emits `## Mutation Verify Findings` with the Escaped Mutations table + Summary.
- **plan-critique** (verdict family; `.md` fixture = a plan document): present the fixture as the plan under review and ask for the `## Verdict: PASS | WARN | BLOCK` output. In eval, the usual companion inputs (PRD, slices) are absent by design — the fixture plans are self-contained for a standalone verdict.

### Step 3 — Aggregate + render
Assemble `runResults` = `[{ fixture, skill, kind, runs }]` for every evaluated fixture, write it to a `.tmp` JSON inside the per-run scratch directory (Hard Rule 6), then run the report CLI:

```
node .claude/lib/skill-eval-report.mjs --runs <runResults.json> \
  --scorecard <scorecard-path> --results <results-path> \
  --k <k> --session <N> --timestamp <ISO-8601> --model <current-session-model-id>
```

For a smoke run, `<scorecard-path>` and `<results-path>` point into the per-run scratch directory (Hard Rule 6); for a full run they are the committed paths.

The report CLI computes per-skill catch-rate / false-positive / saturation / passed, hashes each evaluated prompt, and writes the scorecard + results record — keeping the math in tested code rather than in prose.

### Step 4 — Report
Summarise to the Brain: the scorecard path + a one-line per-skill read (passed / saturated / any skill below threshold) + the model the run was produced with (now recorded on the scorecard's Run-parameters line and in the results record). For a full run, include the subagent-run count as the token cost.

## Handoff
A full run leaves a populated scorecard + results record in place for the pre-commit gate and the next Hygiene review. A smoke run writes its scratch under the OS temp dir (inspectable there during the run) and removes it at end-of-run (Hard Rule 6), leaving the committed scorecard in its initial state.
