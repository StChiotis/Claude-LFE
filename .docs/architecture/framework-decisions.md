# Framework Decision Records — the Claude-LFE Substrate

> **What this file is.** These ADRs document the architectural decisions behind the Claude Code integration substrate that ships with Claude-LFE — the enforcement hooks, the statusLine, the Inspector specialist dispatch, the eval harness, the drift/sync tooling. They explain the **why** behind every file under `.claude/` and `.githooks/`. Read this when you are modifying the framework itself.
> **Frozen for adopters.** Building a product on Claude-LFE? Record your product's architecture decisions in [`architecture-decisions.md`](./architecture-decisions.md) — it starts empty at ADR 1. Treat this file as read-only framework history; the inline `(ADR N)` citations throughout `.claude/` resolve to the numbered entries here.
> **Numbering.** These entries keep their original sequence numbers (81 and up) as a frozen historical set; a new framework decision increments the highest number here. The sequence runs 81–102; **ADR 88 (Inspector subagent dispatch) was superseded by ADR 93** before this file was split out, so it is kept as a short stub — its full decision content lives in the index row above and in ADR 93. The Full ADR Bodies section therefore reads 89 → 88 (stub) → 87 by design.

| ADR | Title | Status | What it governs |
|---|---|---|---|
| 102 | Visual verification competency — `lfe-visual-check` sub-skill + the `visual-gate` hard floor | Accepted | Gives the Inspector eyes: a new opt-in, artifact-free sub-skill (`lfe-visual-check`) renders the changed UI surface and presents it for a human visual sign-off, plus a new enforcement hook (`visual-gate.mjs`) that **denies** the Inspector→Archivist close of a *visual slice* until `inspection_report.md` carries `visual_confirmed` + `visual_signoff`. The framework's first **unconditional-deny** floor (it denies even under `warn` posture — a deliberate, scoped departure from the ADR-95 warn-first family), kept safe by asymmetric fail-safe ALLOW on every ambiguous path. Auto-arms via a Visual Floor on any `UI_GLOBS` touch; typed fields ride below `source:` with no status-enum change; a visual rejection reuses the ADR-101 rework loop. |
| 101 | Human-rejection finalization-rework loop + `src`-only-under-Builder invariant | Accepted | Adds the missing "Brain rejects at finalization → re-enter Builder" branch (Inspector Step 8b) as a re-entrant rework loop tracked in a new `.plans/rework_directive.md` sentinel (typed `rework_round` + `directive_hash`), capped at 5 (GOVERNANCE Correction Cycle Limit 3) and orthogonal to the inspection Cycle Guard. Names the `src/**`-writable-only-under-Builder path-lock invariant that closes the patch-in-place door (scoped to the Authorized-Scope extension; LFE-FORCE unaffected). No lifecycle status-enum change. |
| 100 | Framework vs product ADR split — two decision logs | Accepted | Splits the single ADR file: this `framework-decisions.md` holds the framework substrate ADRs (81+, frozen), while `architecture-decisions.md` becomes the adopter's product log starting at ADR 1. Numbers kept (no renumber); inline `(ADR N)` citations resolve here. |
| 99 | Self-Measurement Pivot — retire the cost log (cost→quality), decouple + self-stamp the eval cadence, record the eval model | Accepted | The framework's self-measurement pivots cost→quality: the skill-accuracy scorecard is the sole surface (the token-budget cost log is retired); `/lfe-skill-eval` self-gates to every 3rd Hygiene sweep (≈ 15 sessions) off the scorecard's own last-run session stamp, on-demand primary; each eval records its producing (current-session) model. In part supersedes ADR 98 (its eval-cadence + token-budget trade-off bullets). |
| 98 | Skill-accuracy eval harness — isolated-subagent runner + deterministic grader (scoped complement to ADR 93) | Accepted *(cadence + token-budget trade-offs → ADR 99)* | The five prompt-based reasoning skills (security/perf/complexity/mutation + plan-critique) gain a measured catch-rate: a deterministic grader (`skill-eval.mjs`, joins `npm test`) + a fixture corpus with telegraph/saturation guards + the Hygiene-dispatched `/lfe-skill-eval` runner (isolated Agent/Task-tool subagents, pass-rate @ k=5) → `skill-eval-scorecard.md`, fed by a hash-pinned warn-first pre-commit gate. Complements ADR 93 (in-chat dispatch for production inspection) — isolated subagents are scoped to *evaluation*, where independent contexts are the precondition for an honest consistency/saturation read. |
| 97 | Positive/directive-voice instruction convention + mechanical voice-census enforcement | Accepted | Agent-facing instruction surfaces (skills, protocol, personas, adapters, guide) use positive/directive voice; load-bearing negation (genuine hard limits, hook deny/reject decisions, documented false-positives) is preserved via an allowlist ledger that records each preserve decision. Enforced durably by a voice-census (`.claude/lib/voice-census.mjs` + config) wired into `npm test` — scans the in-scope surface for a conservative imperative-prohibition marker lexicon and fails on any un-allowlisted marker; the closing slice asserts scope-symmetry (enforced set == full in-scope set). Neutralized the product-flavored core-module term → "Main Engine". |
| 96 | Shared gate-test harness for the enforcement-gate family | Accepted | Extracts the five common-contract test cells (wrong-tool→skip, malformed-stdin→allow, unreadable-card→fail-safe-allow, telemetry-failure→decision-unchanged, block-posture→DENY+reason) of the four ADR-95 enforcement gates (C1 bash-posture, C2a boot-precondition, C3 persona-transition, C4 no-mission) into `.claude/hooks/__tests__/gate-harness.mjs`, parameterized by a per-gate descriptor. Each suite calls `runCommonGateContract(test, descriptor)` + keeps only its distinctive cells. Scope = the four substrate-sharing gates only (the older `persona-path-lock`/`plan-critique-gate` stay out — different substrate). Discrimination preserved via a mutation-reasoning before/after bracket. |
| 95 | Enforcement Hardening doctrine — warn-first speed-bumps, not airtight containment | Accepted | The enforcement-architecture position behind the C1–C4 + mission-aware-path-lock gates: **speed-bumps + loudness, not containment** (the harness sandbox is the real boundary). All gates ship **warn-first** (promotable per-gate via `.claude/enforcement-posture.json`) with **asymmetric fail-safe ALLOW**. Shared substrate: `enforcement-context.mjs`, `enforcement-telemetry.mjs`, posture file. Closes the five off-pipeline-drift gaps G1–G5. |
| 94 | Plan-critique mechanization — tested plan-linter + Lens 5 | Accepted | `/lfe-plan-critique` becomes a **5-lens** review whose Lens 2 (glob/test-path/line-count) and Lens 5 (coherence) consume a tested mechanical linter `.claude/lib/plan-linter.mjs` (Step 1.5); also covers the `pipeline-status-narrative-check.mjs` guard hook. Rationale: honor-system checks get skipped (checkpoint-flip precedent). |
| 93 | Inspector specialist dispatch → skills; subagent machinery removed | Accepted (supersedes an earlier subagent-dispatch decision) | The 5 `lfe-*-check` specialists run as in-chat **skills**; the earlier subagent defs + write-restriction hook are removed (they never registered in this repo). Inspector engine + the 5 specialist skills unchanged. |
| 92 | `package.json` carve-out + portable test runner | Accepted | Adds `package.json` (exact literal) to `FRAMEWORK_INFRA_PATHS` Cat I so any persona can maintain the manifest; `npm test` runs a portable JS runner (`tests/run-tests.mjs`) instead of version-fragile `node --test` CLI-glob. Extends ADR 84/90. |
| 91 | Persona retention for doc-only and destructive-only slices | Accepted | Slices whose entire implementation is doc edits (`.docs/**` and other Architect-allow-list paths) or destructive operations (Bash deletes outside any persona `write_constraints`) RETAIN the prior persona (typically Architect) through the Builder phase instead of transitioning per `/lfe-plan-critique` Step 7. The Builder skill still executes; the persona name is informational, not gating. Smallest-blast-radius option (docs only) over expanding `FRAMEWORK_INFRA_PATHS` or Builder `write_constraints`. |
| 90 | Adopter-facing project infrastructure carve-out expansion | Accepted | Extends ADR 84's `FRAMEWORK_INFRA_PATHS` with 6 adopter-facing globs split between Cat I (mechanical wiring: `.agents/skills/**`, `.gitattributes`, `.gitignore`, `.github/**`) and Cat II (operator manuals: `CLAUDE.md`, `USER_MANUAL.md`). Same architectural category as the original ADR 84 carve-out. Extension rule still applies: "framework substrate, not domain content." |
| 89 | Standalone configuration as canonical Claude Code integration posture | Accepted | The standalone scaffolding (mirror + sync scripts + drift-guard + `package.json` sync entries) is the **durable, canonical** integration posture. Plugin packaging investigated and rejected on 3 doc-derived structural blockers (B1 namespacing, B2 no project-local auto-enable, B3 `statusLine` not in plugin schema). |
| 88 | Inspector subagent dispatch + per-specialist write-restriction | Superseded → ADR 93 | *(Subagent machinery removed — never registered in this repo. Retained for the historical record; see ADR 93 for the standing decision.)* Inspector sub-skill dispatch via Claude Code's Task tool. 5 specialist subagent files at `.claude/agents/lfe-{security,perf,complexity,dep,mutation}-check.md` reference their LFE-source SKILL.md at runtime. Per-specialist write isolation enforced via agent-def `tools:` allowlist; the PreToolUse hook is defensive belt-and-braces. |
| 87 | Hook `if`-filter pattern: matcher-only over `if: "<dir>/*"`; external Brain live-verification convention | Accepted | Hook-config canonical pattern in `.claude/settings.json` — the harness `if`-field permission-rule matching does NOT honor cwd-relative path patterns against `tool_input.file_path`. Canonical fix: drop the `if` field; rely on each hook's internal Stage-2 path-prefix guard. Codifies external-Brain live-verification convention for mechanical-enforcement landings. |
| 86 | PostToolUse state-mutator silent-ALLOW posture (sibling of ADR 82) | Accepted | Runtime contract for any PostToolUse hook that performs a state-coordinating side-effect — always exit 0, all I/O failures emit informative stderr and never block the user's write. Reference design for checkpoint-flip. |
| 85 | Block-with-escape (BE) hook design pattern for PreToolUse | Accepted | Runtime contract for any BE-posture PreToolUse hook — transcript LFE-FORCE detection + `permissionDecision` JSON envelope + read-modify-write append to `PROTOCOL_DEBT.md` + asymmetric fail-safe (ALLOW on substrate corruption, DENY on transcript failure). |
| 84 | Framework-infrastructure carve-out for persona path-locking (Cat I + Cat II) | Accepted | Persona-agnostic write-allow paths in `persona-path-lock.mjs` — Cat I (mechanical wiring: `.claude/**`, `.githooks/**`, etc.); Cat II (coordination substrate: `pipeline_status.md`, `LLM_AGENT_GUIDE.md`). Rule for extending: "framework substrate, not domain content." |
| 83 | Zero-dep custom frontmatter parser (extends ADR 81 to parsers/utilities) | Accepted | Project-wide convention for parsing/utility code in `.claude/` — hand-rolled parsers for closed schemas; no `js-yaml` or equivalent runtime dep without a superseding ADR. |
| 82 | Cat D PostToolUse frontmatter validators are signal-strict, not block-strict | Accepted | Runtime semantic for ALL PostToolUse-based enforcement hooks; signal-strict means exit 2 + educational stderr; the malformed file remains on disk for self-correction. |
| 81 | `.claude/` script runtime: Node ESM (cross-platform over `.sh`) | Accepted | Runtime convention for the `.claude/` integration scripts. `.mjs` chosen over `.sh` for cross-platform (Windows + macOS + Linux without Git Bash dependency) and pre-ratifies the later hooks. |

---

## Full ADR Bodies (most recent first)

---
## ADR 102: Visual verification competency — lfe-visual-check sub-skill + the visual-gate hard floor (2026-06-17)

**Status:** Accepted
**Date:** 2026-06-17

**Context**

The Inspector can assert a *technical* pass — logic matches the domain, baselines hold, tests are green — but it has no way to *see* the rendered result. A UI change can pass mechanically while the screen is visibly wrong. Observed downstream: a visual bug "fixed" in place at the finalization step, unverified, for hours, because nothing rendered the surface and nothing forced a human to look before the change closed. Slice 1 (ADR 101) gave a human rejection a scripted path back to the Builder; what remained missing was (a) the *capability to see*, and (b) a mechanism that makes a human visual sign-off mandatory before a UI change can close.

**Decision**

Two coupled pieces, both pure framework machinery, inert on a non-visual project.

1. **`lfe-visual-check`** — a new opt-in Inspector sub-skill. It renders the changed UI surface (preferred preview renderer → browser renderer → a manual instruction that names the screen when no renderer or preview target exists), reasons over the result, and writes a text findings file (`.plans/checks/visual_findings.md`) carrying a human-action instruction and a sign-off token. It is **artifact-free** (saves no image files, keeping the blank-canvas seal) and **verdict-free** (the human alone declares the visual verdict). It **auto-arms** via a **Visual Floor** whenever a changed file matches a visual class (`UI_GLOBS`, the single literal source of truth in the hook); the floor is a minimum an override leaves armed, mirroring the Security Floor.

2. **`visual-gate.mjs`** — a new `PreToolUse(Write|Edit)` enforcement hook on the Inspector→Archivist transition. For a *visual slice* it **denies** the close unless `inspection_report.md` carries both `visual_confirmed` (timestamp) and `visual_signoff` (token). The two are typed fields riding below `source:`, tolerated by the base validator with no status-enum change (the ADR-101 precedent); the token is agent-transcribed — the same trust model as `brain_confirmation` (a transcription convention, not a non-forgeable mechanism). The unified three-outcome finalization gate (Inspector Step 8) reads: approve + visual present → Archivist; approve but visual absent → obtain the sign-off first; reject → the ADR-101 rework loop.

**The warn-first departure (load-bearing).** Every ADR-95 gate ships warn-first. The `visual-gate` floor is the framework's **first unconditional-deny** gate: it denies *even under `warn` posture*. This is deliberate — a warn-only visual gate would let the very anti-pattern it exists to kill (an unverified visual close) proceed on a mere warning, defeating its purpose, exactly as the Security Floor ignores an `lfe-security-check: false` override. The departure is bounded by the family's **asymmetric fail-safe ALLOW**: the gate stands aside on every ambiguous path (unreadable card / `builder_done.md` / `inspection_report.md`; a non-visual slice; any transition other than inspector→archivist; `status: escalated` or `failed` — the debt/triage paths), so it can never deadlock a legitimate close. The `visual-gate` key in `enforcement-posture.json` is registered for gate-inventory parity; the floor does not consult it.

**Considered Alternatives**

- *A warn-first visual gate (consistent with ADR 95)* — declined: a warning the agent can walk past does not stop the unverified close; the floor has to hold to be worth building.
- *A new `awaiting_visual` lifecycle status* — declined: it forces `STATUS_ALLOWED` + validator-test + enum churn and a checkpoint-flip reversal problem, exactly as ADR 101 found. Typed fields (`visual_confirmed` / `visual_signoff`) sidestep all of it.
- *Persisted screenshots in a swept location* — declined: the render MCPs cannot reliably place a binary in a swept path, and a persisted image breaks the blank-canvas seal. Text-only reasoning plus a human look is more reliable and self-cleaning.
- *Auto-detecting the running app* — declined: the preview surface is declared in the plan (`## UI Surface`) or handled by the manual fallback; auto-detection is out of scope.

**Consequences**

- A UI-touching slice no longer closes on a green technical pass alone — a human visual sign-off is a hard floor, enforced mechanically.
- A visual rejection reuses the ADR-101 rework loop, so a rejected visual defect travels back through the Builder and is fully re-verified rather than patched in place.
- The framework gains its first unconditional-deny gate, documented here as a scoped departure from warn-first; the asymmetric fail-safe ALLOW keeps it from ever deadlocking.
- Inert on a non-visual project: the registry entry is off by default, the floor arms only on a `UI_GLOBS` touch, and no image binary is ever persisted — the starter re-seals to a clean blank canvas.
- `UI_GLOBS` lives as one adopter-extendable literal in the hook; the default web / SPA / static set is documented in `inspector-config.md` prose, with native-mobile / game-engine classes called out as an extension point.

---
## ADR 101: Human-rejection finalization-rework loop + src-only-under-Builder invariant (2026-06-16)

**Status:** Accepted
**Date:** 2026-06-16

**Context**

The Inspector's finalization step (Step 8) scripted only "approval → Archivist." A Brain rejection at finalization — the common case when a defect (most often visual) survives a green *technical* pass — had no scripted path back into the pipeline. Observed in a downstream project: the session patched `src/**` in place at the final step, unverified, for hours, because nothing returned the work to the Builder and nothing forbade the in-place edit. The mechanical Cycle Guard (Correction Cycle Limit 2) covers Inspector-detected *mechanical* failures, not human finalization rejections.

**Decision**

Add a finalization rework loop. On REJECT, the Inspector (Step 8b) writes a new execution-tier coordination file `.plans/rework_directive.md` carrying typed fields `rework_round` and `directive_hash`, deletes any stale same-slice `diagnosis_report.md`, resets the per-slice checkboxes, and flips the persona to Builder. The Builder re-implements the directive (precedence over the diagnosis-retry branch); the slice re-traverses Builder → `/lfe-tdd` → Inspector → finalize, re-entrant up to **5 rounds** (GOVERNANCE Correction Cycle Limit 3). The counter advances on a `directive_hash` change, making it exactly-once across a crash. The loop is **orthogonal** to the Cycle Guard: a rework round writes neither `status: failed` nor a diagnosis report, so the inspection report stays `status: passed` and the lifecycle status enum is unchanged. To close the patch-in-place door structurally, a named path-lock invariant makes `src/**` writable only under the Builder persona, scoped to the Authorized-Scope extension and placed before the LFE-FORCE escape (which stays the sole documented break-glass).

**Considered Alternatives**

- *A new `rework_requested` lifecycle status* — declined: it forces `STATUS_ALLOWED` + validator-test + `COORDINATION_FILES` enum churn, creates a Cycle-Guard determination ambiguity, and (because `checkpoint-flip` already fired on the prior `status: passed`) cannot reverse the `inspect` checkbox. The typed-field sentinel sidesteps all of it.
- *A blanket pre-escape `src/**` DENY in the path-lock* — declined: placed ahead of the LFE-FORCE escape it would strand the documented break-glass. Scoping the invariant to the Authorized-Scope extension keeps LFE-FORCE intact.
- *Reuse the Cycle Guard's 2-strike counter for rework* — declined: distinct cosmetic rounds would false-escalate on the 2nd rejection. A separate file-based counter keeps the two axes independent.

**Consequences**

- A Brain rejection at finalization re-enters the Builder and re-verifies; ten distinct defects each get the full pipeline, while the same defect mechanically re-failing still escalates via Limit 2.
- Crash recovery is deterministic — a present `rework_directive.md` resumes the Builder.
- Patch-in-place at the final step is a path-lock DENY for any non-Builder persona targeting `src/**`.
- No status-enum change, so `checkpoint-flip`, the Archivist status branch, and the Cat-D validator are untouched. The sentinel is on both cleanup tiers, so the canvas re-seals clean at mission end.

---
## ADR 100: Framework vs product ADR split — two decision logs (2026-06-06)

**Status:** Accepted
**Date:** 2026-06-06

**Context**

The framework shipped a single canonical ADR file (`architecture-decisions.md`) that held the 18 framework-internal ADRs (81–99) AND served as the file the ADR-writing skills appended an adopting project's *product* ADRs to. An adopter's first product decision therefore landed as "ADR 100", appended under 18 framework ADRs irrelevant to their product — the log meant to be theirs read as the framework's, starting at a confusing high number. An adversarial reference audit (28 files) established **zero behavioural dependence** on ADR identity: nothing parses an ADR number and nothing reads the ADR file at runtime; the references are all comments, test labels, and prose.

**Decision**

Split the one file into two. `framework-decisions.md` (this file) holds the framework's substrate ADRs, keeping their original **81–99 numbering** as a frozen historical set. `architecture-decisions.md` becomes the adopter's empty **product** ADR log, whose first entry is ADR 1. The ADR-writing skills append new *product* ADRs to the product log; framework ADRs are added here only when modifying the framework. The inline `(ADR N)` citations throughout `.claude/` resolve to this file, unchanged.

**Considered Alternatives**

- *Keep one file (status quo)* — declined: it is the very conflation that forces an adopter's log to begin at ADR 100 under the framework's internals.
- *Renumber the framework ADRs to 1–18* — declined: a ~268-site reference edit (code comments, test labels, prose) across ~47 files for zero behavioural gain, carrying real mechanical-error risk; the numbering is provably cosmetic.
- *Delete the framework ADRs from the repo* — declined: it would orphan the inline `(ADR N)` citations in the shipped machinery and discard the design rationale a framework-modifier relies on; a separate, clearly-labelled file preserves both while giving the adopter a clean product log.

**Consequences**

- An adopter's product decision log reads as theirs and starts clean at ADR 1.
- The framework's design rationale stays discoverable and the inline citations keep resolving here, so the shipped machinery stays self-documenting.
- The split is pure documentation reorganisation, verified to change no runtime behaviour (full suite green at its established count).
- This file is frozen and excluded from rolling-window archival — every entry is Accepted, shipped-machinery rationale.

---
## ADR 99: Self-Measurement Pivot — retire the cost log (cost→quality), decouple + self-stamp the eval cadence, record the eval model (2026-06-05)

**Status:** Accepted *(in part supersedes ADR 98 — its eval-cadence and `token-budget.md` trade-off bullets; ADR 98's core eval-harness decision stands)*
**Date:** 2026-06-05

**Context**

The framework kept **two** self-measurement surfaces: a per-session **token-budget cost log** and the **skill-accuracy scorecard** (live since ADR 98). The cost log was a liability on the framework's own terms — it measured **cost**, against the stated #1 value *"reliability over tokens,"* and its data was inaccurate by construction (the agent self-estimated its own token usage; the existing rows were flagged "coarse self-estimate"). It also carried standing maintenance weight: a retention row (governance + runbook), an Archivist end-of-mission append step, a cold-tier archive slot, and a place in the closing-seal's re-empty template set.

Two adjacent gaps compounded this. The skill-accuracy eval (`/lfe-skill-eval`) was bound to the **5-session Hygiene sweep**, but a full run is token-heavy (~75 isolated subagent runs) — too expensive for that rhythm. And the scorecard did **not** record which model produced the scores, so a catch-rate drop caused by a model-version change was indistinguishable from one caused by a prompt edit. This decision's rationale must outlive the **closing seal**, which removes the transient development scaffolding that would otherwise carry it — hence an ADR rather than a scaffolding note.

**Decision**

Pivot the framework's self-measurement from **cost → quality**, and harden the surviving surface. Three threads:

1. **Retire the cost log (cost→quality).** Delete `.docs/quality/token-budget.md`; the skill-accuracy scorecard becomes the **sole** self-measurement surface. Remove every mechanism that fed or tracked the cost log: the Archivist's end-of-mission append step (former `lfe-archivist` Step 3.5), its retention row in both the governance retention table and the project retention runbook (table + per-file procedure), and its agent-guide self-reporting prose (§8.7 rewritten quality-not-cost). The closing-seal re-empty set names the scorecard in the cost log's place.

2. **Decouple + self-stamp the eval cadence.** `/lfe-skill-eval` runs **every 3rd Hygiene sweep (≈ 15 sessions)**, with **on-demand as the primary path**. Implemented as the **Light mechanism**: there is no native 15-session trigger to ride (15 is a retention *window size* applied at the 5-session sweep — the only periodic trigger in the system), so the eval **self-gates off the scorecard's own last-run `session N` stamp** — on the Hygiene-dispatched path it runs the full pass only when `current − last ≥ 15`; on-demand always runs. No new entrance-card field, no session-start-hook change, no new state; the gate logic lives in the eval runner's own `SKILL.md` (the `lfe-hygiene` skill never names the eval, so it stays untouched). *(This is the thread that most needs an ADR: a behavioral rule with no single code site, whose only prior home was transient development scaffolding.)*

3. **Record the eval model.** The runner records the **current session model** it runs as (inherited by the isolated subagents) via a new `--model` flag on `skill-eval-report.mjs`, threaded through `meta.model` into the scorecard's **Run-parameters line** and the machine results record's **top-level metadata** — making cross-model-version catch-rate drift visible with zero new config. The pure-function / fail-soft / exits-0 contract is preserved (absent model → safe placeholder, never throws).

**LFE-SOURCE reconciliation (load-bearing).** Threads 1–2 required editing `.docs/protocol/GOVERNANCE.md` and `.agents/skills/lfe-archivist/SKILL.md`, which `RETENTION_RUNBOOK.md`'s "never edit LFE-SOURCE protocol files (byte-identical to upstream)" note nominally forbids. These edits are legitimate: **this repo *is* the framework's own upstream / reusable starter, so editing its own protocol surface here is framework evolution, not adopter drift.** The runbook prohibition is written from a downstream **adopter's** perspective — an adopter's copy of the LFE protocol stays read-only; the framework's source repo is where the protocol legitimately evolves (through the assembly line). The runbook wording is clarified to name this exception.

**Considered Alternatives**

- **Keep the cost log / dual surfaces** — rejected: it measures the very thing the framework deprioritizes, on self-estimated (inaccurate) data, and carries ongoing retention / append / seal weight for a signal no decision consumes.
- **The "Independent" cadence mechanism** — a new `Last Eval Sweep` entrance-card field + a session-start eval-due banner + accompanying hook tests — rejected in favor of **Light**: the scorecard already stamps its own last-run session, so no new state is needed; Light adds zero entrance-card surface and zero hook change.
- **A configured / pinned eval model** — rejected in favor of the **current session model**: the honest answer to "what produced these scores" is the model that actually ran them, captured with zero config; a pinned identifier drifts from reality the moment the session model changes.
- **Mark ADR 98 fully superseded** — rejected: ADR 98's core decision (the eval-harness runner + deterministic grader) is unchanged and standing; only its two *trade-off bullets* (the cadence figure and the token-budget coexistence note) are refined/retired here. This is a **partial** supersession — the index keeps ADR 98 `Accepted`.

**Consequences**

- ✅ A single self-measurement surface that measures **quality, not cost** — the framework now measures what it actually values (*reliability over tokens*) and stops maintaining a ledger it admitted was inaccurate.
- ✅ The token-heavy eval sits at the **least-frequent** end (≈ every 15 sessions, on-demand primary) while the cheap deterministic checks stay continuous — the cost↔frequency law, enforced via a no-new-state self-stamp.
- ✅ Each eval **records its producing model**, so skill-accuracy drift from a model change is distinguishable from drift caused by a prompt change.
- ✅ The pivot's rationale **lives durably in this ADR** — preserved past the closing seal rather than tied to the transient development scaffolding the seal removes.
- ⚖ The "never edit LFE-SOURCE" prohibition now carries a documented **framework-source-repo exception** (this repo); downstream adopters still treat their LFE protocol copies as read-only.
- ⚖ ADR 98 is **partially superseded** (its two trade-off bullets); its core eval-harness decision stands `Accepted`.

---
## ADR 98: Skill-accuracy eval harness — isolated-subagent runner + deterministic grader (scoped complement to ADR 93) (2026-06-03)

**Status:** Accepted
**Date:** 2026-06-03

**Context**

LFE leans on five prompt-based reasoning skills — the four Inspector specialist checks (`lfe-security-check`, `lfe-perf-check`, `lfe-complexity-check`, `lfe-mutation-verify`) and the Architect's `lfe-plan-critique`. Their catch-rate was **unmeasured**: nobody had verified whether they detect the defects they exist to catch, how often they false-alarm on clean code, or whether a prompt edit quietly lowers a skill's catch-rate. Every *other* soft layer the framework leans on has been mechanized and guarded — the plan-linter (ADR 94) and the voice-census (ADR 97). These reasoning skills were the one soft layer left unmeasured; this harness is the fourth member of the "mechanize the soft layer" family. An honest reading of *consistency* (does the skill catch the defect on every run, not just one lucky pass?) and *saturation* (has the corpus gone too easy to discriminate?) requires running each skill's exact prompt against planted-defect fixtures **k times in independent contexts** — a single shared context would leak fixture-to-fixture and inflate the rate.

**Decision**

Ship a two-half harness:
1. A **deterministic grader** (`.claude/lib/skill-eval.mjs`) — a pure, fail-soft scoring function that grades a captured skill output against an expected-outcome sidecar (`{ pass, score, reasons }`), polymorphic across the three confirmed output shapes (verdict-bearing / severity-bucketed / outcome-bucketed). It joins `npm test` via the portable runner (ADR 92), so the measurement tooling is itself regression-guarded — exactly like the plan-linter and the voice-census.
2. A **fixture corpus** under `.agents/skills/_evals/` (planted-defect + known-good controls per skill) with expected sidecars, a deterministic **telegraph lint** (anti-overfit — fixtures avoid giving away their defect), and a **saturation** ceiling flag.
3. A **runner skill `/lfe-skill-eval`** (Hygiene-dispatched, or on demand) that runs each skill's canonical prompt against each fixture in an **isolated general-purpose Agent/Task-tool subagent**, repeats k = 5, computes a consistency-based pass-rate via the grader, and renders `.docs/quality/skill-eval-scorecard.md` plus a machine-readable results record.
4. A **hash-pinned pre-commit regression gate** (`skill-eval-gate.mjs`) — a staged edit to one of the five reasoning-skill prompts requires a recorded passing eval whose content-hash matches the prompt's current content. Warn-first, promotable to block (ADR 95 family); a pure content-hash compare, with no model invoked at commit time.

**The ADR 93 relationship (load-bearing).** This decision **complements, and does not reverse, ADR 93.** ADR 93 removed the *project-registered* `.claude/agents/lfe-*-check.md` subagents (which did not register in this repo) and standardized the Inspector's *production* specialist passes on in-chat **skill** dispatch — the path that works in every environment. ADR 98's runner instead uses the **general-purpose Agent/Task tool** for *evaluation*. The two decisions are scoped to different mechanisms and different domains: ADR 93 governs how production inspection passes run (in-chat, where main-thread reasoning suffices); ADR 98 governs how the harness *measures* those skills (isolated contexts, where independence is the precondition for an honest consistency + saturation reading). In-chat dispatch stays correct for the Inspector specialists; isolated subagents are correct for the eval runner. The two coexist.

**Considered Alternatives**

- **Run the eval in-chat (shared context), mirroring ADR 93's in-chat specialist dispatch** — rejected: a shared context leaks fixture-to-fixture, inflating catch-rate and defeating the consistency/saturation measurement that is the harness's entire purpose. Isolation here is the measurement's precondition, not a stylistic choice.
- **Re-introduce project-registered subagents (`.claude/agents/`)** — rejected: ADR 93 established empirically (3+ sessions) that Claude Code does not register them in this repo; the general Agent/Task tool is the portable path.
- **LLM-graded results** — rejected: the grader is deterministic, so it joins `npm test` and the measurement tooling is itself regression-guarded; LLM grading would be non-deterministic and unguarded.
- **Honor-system "re-run the eval" reminder instead of a gate** — rejected: the framework's recurring lesson is that honor-system checks get skipped (the checkpoint-flip and plan-linter precedents). A tested, hash-pinned gate is the durable form.

**Consequences**

- ✅ First measured catch-rate, false-positive read, and flakiness read per reasoning skill — the one unmeasured soft layer is now measured, completing the ADR 94 / ADR 97 "mechanize the soft layer" family.
- ✅ The deterministic grader joins `npm test`, so the measurement machinery is regression-guarded like the rest of the substrate.
- ✅ The warn-first hash-pinned pre-commit gate stops a silent prompt-regression from shipping.
- ✅ Scoped coexistence with ADR 93 — a complement, not a reversal: in-chat for production inspection, isolated subagents for evaluation.
- ⚖ Trade-off — *the runner is LLM-driven*, so its output (the scorecard) is exercised by running it against the corpus rather than unit-tested as code; its deterministic halves (grader, telegraph lint, saturation, gate) are unit-tested.
- ⚖ Trade-off — *the eval is token-heavy* (k × fixtures × isolated subagents), so it is Hygiene-dispatched (every 5 sessions) or on-demand, not per-commit.
- ⚖ `token-budget.md` coexisted with the scorecard initially; a later self-measurement decision (ADR 99) retires it and pivots self-measurement from cost to quality.
- 🔄 **Superseded in part by ADR 99 (2026-06-05):** the two trade-off bullets immediately above — the eval cadence ("Hygiene-dispatched (every 5 sessions)") and `token-budget.md` coexistence — are refined/retired by ADR 99 (cadence → every 3rd sweep ≈ 15 sessions, on-demand primary; the cost log is retired, self-measurement pivots cost→quality). ADR 98's core decision — the eval harness itself — stands unchanged (Accepted).

---
## ADR 97: Positive/directive-voice instruction convention + mechanical voice-census enforcement (2026-06-02)

**Status:** Accepted
**Date:** 2026-06-02

**Context**

LFE's agent-facing instruction surfaces (skill `SKILL.md` files, the protocol + persona contracts, the adapters, and the agent guide) were heavily prohibition-framed. Prompt-engineering practice favors positive/directive phrasing: a prohibition leaves the *desired* behavior unspecified, and a model can fixate on the negated token. But not all negation is incidental — a genuine hard limit (e.g. the rule that a push to the protected branch needs a typed confirmation), a hook's deny/reject decision, and a documented false-positive are cases where the negative phrasing *is* the contract and its starkness is the feature. A one-time rewrite also regresses the moment someone adds a new prohibition — the framework's recurring "honor-system checks get skipped" failure mode (the same lesson behind the checkpoint-flip hook and the plan-linter).

**Decision**

1. **Rewrite to directive voice** across the full agent-facing instruction surface — skills (`.agents/skills/**` + the `.claude` mirror), `.docs/protocol/**` (personas + governance), the adapters (`CLAUDE.md`, `.agents/adapters/system_prompt.txt`), and `LLM_AGENT_GUIDE.md`.
2. **Preserve load-bearing negation** — genuine hard limits, hook deny/reject decisions, and documented false-positives stay negated, each recorded in an allowlist ledger (`.claude/lib/voice-census-allowlist.mjs`) whose entry *documents the preserve decision* (file + snippet + reason + kind).
3. **Enforce mechanically and durably** via a voice-census (`.claude/lib/voice-census.mjs` + `voice-census-config.mjs`) wired into `npm test`: it scans the in-scope instruction surface for a conservative lexicon of imperative-prohibition markers (negated modal verbs, explicit prohibition verbs, and two hard-limit sentinels; bare "no"/"not" deliberately excluded as too noisy) and fails the suite on any prohibitive marker not covered by the allowlist. Each rewrite slice adds its surface to the enforced globs; the closing slice asserts **scope-symmetry** (the enforced set equals the full in-scope set) so enforcement can never silently lag the declared scope.
4. **Neutralize the product-flavored core-module term → "Main Engine"** for adopter-neutrality.

*(The literal marker lexicon and scope globs live in `voice-census-config.mjs` as the SSOT; summarized here in prose per the framework's prose-not-literal doc-writing discipline.)*

**Considered Alternatives**

- **One-time rewrite, no enforcement** — rejected: it regresses silently the next time a prohibition is added; the framework already learned this lesson (honor-system checks get skipped — checkpoint-flip / plan-linter precedent).
- **Strip all negation uniformly** — rejected: hard limits and deny/reject decisions lose the starkness that *is* their contract.
- **Manual review / lint-by-vigilance** — rejected for the same honor-system failure mode; a tested mechanical gate is the durable form.

**Consequences**

- ✅ Durable guard: the suite catches a regression mechanically the moment an un-allowlisted prohibition enters the in-scope surface.
- ✅ Scope-symmetry assertion means the enforced surface cannot drift below the declared rewrite scope without a test failure.
- ⚖ Trade-off — *positive framing vs. hard-limit starkness*: directive voice can soften a genuine hard limit; mitigated by the allowlist preserve-rule (load-bearing negations stay, and the entry documents why).
- ⚖ Trade-off — *mechanical enforcement vs. manual review*: a new legitimate hard-limit negation must be allowlisted with a reason to pass the suite; the census also reports unused (dead) allowlist entries to keep the ledger honest.
- ⚖ Trade-off — *allowlist maintenance cost*: the ledger is a living artifact that grows with each justified negation; the conservative lexicon keeps false-positives (and thus ledger churn) low at the cost of not catching softer prohibitive phrasings.

---
## ADR 96: Shared gate-test harness for the enforcement-gate family (2026-06-01)

**Status:** Accepted
**Date:** 2026-06-01

**Context**

The four enforcement gates introduced by ADR 95 — C1 `bash-posture`, C2a `boot-precondition`, C3 `persona-transition`, C4 `no-mission` — share one substrate (`enforcement-context` + `enforcement-telemetry` + the posture file). Their test suites independently re-implemented the same five common-contract cells (wrong/non-gated tool → silent ALLOW; malformed stdin → silent ALLOW; unreadable entrance card → fail-safe ALLOW + stderr; telemetry-append-failure → decision unchanged; block posture → DENY envelope), plus per-file copies of the `card` / `makeRead` / `stdin` / `captureAppend` helpers — roughly twenty hand-written cells of duplication. A change to the shared substrate's contract rippled four ways.

**Decision**

Extract the five common-contract cells into a shared test helper `.claude/hooks/__tests__/gate-harness.mjs`, exposing `runCommonGateContract(test, descriptor)` parameterized by a small per-gate descriptor (`main`, `gateName`, `env`, `listPlans`, `makeRead`, `wrongToolStdin`, `triggerStdin`, `triggerReadOpts`, `reasonOnTrigger`), plus a shared `captureAppend`. Each gate's `*.test.mjs` calls the harness once and retains only its distinctive rule cells. The helper is deliberately NOT named `*.test.mjs` — the runner (`tests/run-tests.mjs`) discovers only that suffix, so the harness is never executed standalone; it is imported by the four suites, which pass their own `node:test` `test` in (registering the cells in the importing module's context). Future enforcement gates on the same substrate adopt the harness.

**Scope:** the four substrate-sharing ADR-95 gates only. The older `persona-path-lock` and `plan-critique-gate` gates use a different substrate (`permissions.json` / LFE-FORCE-debt, no telemetry/posture) and stay out — folding them in would force a second harness adapter (a leaky abstraction over two unlike substrates).

**Considered Alternatives**

- **(α) Shared harness for the four-gate family — chosen.** One substrate, one contract, one clean parameterization; the descriptor carries exactly what differs.
- **(β) Include all six Write/Edit-ish gates** — rejected: `persona-path-lock` / `plan-critique-gate` need a second adapter; more complexity and risk for marginal extra dedup, and it would re-cut recently-edited test files.
- **(γ) Leave the duplication** — rejected: a substrate-contract change rippled four ways; the slice's mandate was to slim with zero discrimination loss.

**Consequences**

- DRY: ~20 duplicated cells → one harness + four descriptor calls; `captureAppend` de-duplicated.
- **Slightly stronger** coverage, not just preserved: the harness block cell asserts the telemetry `reason` for all four gates (several old per-gate block cells asserted only `decision==='deny'`), and `bash-posture` gained a malformed-stdin cell it previously lacked.
- Discrimination is **proven preserved** by a mutation-reasoning bracket — recorded before the refactor and re-verified after by the Inspector's `lfe-mutation-verify`. Per-gate distinctive discriminations are retained as local cells: boot's `sentinel === id` absent-vs-mismatch, persona-transition's marker authorization + BLOCK-path telemetry invariant, bash's tier-2 reason variants, no-mission's `.plans/**` carve-out.
- Net test-count drop is modest (−2); the dominant win is maintainability, not the count.
- Trade-off: the descriptor adds a small indirection — a maintainer must open the harness to see the five common cells rather than reading them inline. Accepted (one well-documented module beats four drifting copies).

---
## ADR 95: Enforcement Hardening doctrine — warn-first speed-bumps, not airtight containment (2026-06-01)

**Status:** Accepted
**Date:** 2026-06-01

**Context**

A momentum-optimizing agent was observed drifting entirely off-pipeline despite the full hook layer being active: it committed, merged to `main`, and ran a legal-anchor-tag mission without ever booting a mission or following the assembly line. The existing hooks (`persona-path-lock`, `plan-critique-gate`, `skill-invocation-gate`, the PostToolUse validators) were each either advisory, scoped to the wrong surface, or trivially bypassable. Five enforcement gaps surfaced: **G1** terminal git actions ungated; **G2** orientation is advisory (substantive work proceeds without `/lfe-boot`); **G3** self-attested persona (a free-hand edit silently elevates the Active Persona); **G4** substantive work at a completed/idle slate with no mission; **G5** the persona path-lock is mission-unaware (cannot extend authorized scope for a sanctioned active mission).

**Decision**

Adopt the explicit architectural position: framework enforcement is **speed-bumps + loudness, not airtight containment.** The harness sandbox is the real security boundary; the gates' job is to make off-pipeline drift *expensive, visible, and logged* — not impossible. Aliasing, indirection, and direct-filesystem bypasses are accepted by design and stated plainly in the operator manual.

Ship five gates closing G1–G5, every one **warn-first** (warn-and-log; promotable per-gate to `block` via a single deliberate edit of `.claude/enforcement-posture.json`) and every one with **asymmetric fail-safe ALLOW** (an unreadable/ambiguous substrate must never lock the user out of recovery — ADR 85 lineage):

- **C1 — terminal git posture gate** (`bash-posture-gate.mjs`, closes G1): two-tier. Tier-1 mutating git (commit/reset --hard/rebase/cherry-pick) requires an active mission; tier-2 (merge/push-to-`main`/force-push/legal-anchor tag) additionally requires a typed `MERGE-OK` confirmation detected in the recent transcript. Read-only git and non-git shell pass through. Backed by `.claude/lib/git-command-classifier.mjs`.
- **C2a — boot-precondition gate** (`boot-precondition-gate.mjs`, closes G2): a two-file session handshake — the SessionStart hook rotates `.plans/.session-id`; `/lfe-boot` Step 1.1 copies it to `.plans/.session-booted`; the gate treats the session as booted only when the two match. Fail-safe ALLOW (silent) when the mechanism is unprimed.
- **C2b — scout-boundary guard** (extends `skill-invocation-gate.mjs`): `/lfe-scout` is allowed only at a clean session boundary and refused mid-mission; other Brain-typeable skills are unaffected.
- **C3 — persona-transition guard, light** (`persona-transition-guard.mjs`, closes G3): acts ONLY on `pipeline_status.md`; allows general entrance-card edits but gates a change to the *leading Active-Persona name*. An official, skill-dispatched transition drops a `.plans/.persona-transition` marker (= the new persona name) immediately before editing the row; a free-hand persona elevation has no marker and warns/denies. The entrance card and all its fields are preserved — only the *act of changing the persona value* is guarded (the Brain's explicit LIGHT-fix choice over a deduce-from-state alternative).
- **C4 — no-mission gate** (`no-mission-gate.mjs`, closes G4): a substantive Write/Edit at `MISSION COMPLETE` with no coordination trail and not in a Scout session warns to boot a mission first.
- **Mission-aware path-lock** (closes G5). `persona-path-lock.mjs` gains a branch (after the persona `write_constraints` match, before the LFE-FORCE/deny path): when the mission is `IN-FLIGHT` and the target matches a glob in the entrance card's **`Authorized Scope` row**, the write is ALLOWED without LFE-FORCE — so a sanctioned mission can write a second repo (e.g. `../OtherRepo/**`). Scope lives in the `Authorized Scope` row (parsed by `extractAuthorizedScope` in `be-escape.mjs`; `(none)`/empty/absent ⇒ no extension), documented in `LLM_AGENT_GUIDE.md` §10. **Location decision (Brain):** the entrance card was chosen over the persona-locked `.agents/permissions.json` alternative — it reuses the card the hook already reads (near-zero cost) and persists across slices. **Accepted residual:** the entrance card is agent-editable (Cat II carve-out), so the scope row is a self-authorization vector — consistent with this ADR's speed-bumps doctrine (the harness sandbox is the real boundary); gating the row à la C3 is possible future hardening. The Archivist clears the row to `(none)` at mission close.

Shared substrate (all zero-dep ESM per ADR 81/83, pure `main()` + injected I/O): `.claude/lib/enforcement-context.mjs` (single per-invocation state read + `SUBSTRATE_CARVE_OUT`), `.claude/lib/enforcement-telemetry.mjs` (gitignored JSONL warn log — **observability, never control**: a logging failure never alters a decision), `.claude/enforcement-posture.json` (per-gate `warn`|`block` promotion surface, default `warn`). The `Write|Edit` PreToolUse decision order is **boot-precondition → no-mission → persona-transition → persona-path**.

**Considered Alternatives**

- *Airtight containment (block-by-default sandbox)* — rejected: impossible within the harness (the agent shares the user's shell and filesystem; any block is bypassable via aliasing/indirection), and block-by-default risks bricking recovery. Warn-first + telemetry instead builds the evidence base for selective, deliberate promotion to `block`.
- *Per-gate hardcoded enable/disable* — rejected in favor of the single posture file so each promotion is one auditable edit.
- *C3 deduce-persona-from-state (heavy)* — rejected by the Brain in favor of the light marker-based design that preserves `pipeline_status.md` untouched.

**Consequences**

- ✅ The five drift vectors now produce a loud, logged speed-bump; the observed off-pipeline sequence would warn at multiple points instead of proceeding silently.
- ✅ Warn-first + JSONL telemetry gives the Brain a real evidence base before promoting any gate to `block`.
- ✅ Asymmetric fail-safe ALLOW guarantees the gate family can never lock out recovery, even on a corrupt substrate.
- ⚠ Honest ceiling: a determined agent can still bypass via aliasing, direct fs, or declining to read instructions. Accepted and documented; this is a discipline aid, not a sandbox.

---
## ADR 94: Plan-critique mechanization — tested plan-linter feeding Lens 2 + Lens 5 (2026-05-30)

**Status:** Accepted
**Date:** 2026-05-30

**Context**

`/lfe-plan-critique` was four purely-judgment lenses (AC scrutiny, test feasibility, domain alignment, structural impact). The pipeline repeatedly rediscovered the same plan-quality defects *late* — at Inspector Cycle 1 or Builder pre-verification, the most expensive moment (~150–200k tokens per diagnose loop): glob ACs that under-match their target, PowerShell `Test-Path` existence antipatterns, fragile narrow line-count ACs, and cross-edit incoherence where an edit leaves orphaned references in preserved text. All four were catchable at plan-critique time but were left to agent vigilance — and the framework's own history proves vigilance is unreliable: `checkpoint-flip.mjs` had to be built precisely because an earlier session silently skipped every honor-system checkpoint flip.

**Decision**

Mechanize every plan-quality check that *can* be mechanized into tested code, and reserve the lenses for genuine judgment.
- **New tested module `.claude/lib/plan-linter.mjs`**: a pure `lintPlan(text, {globResolver})` core + CLI, sibling of the existing `.claude/lib/` substrate (`be-escape`, `parse-frontmatter`, `parse-entrance-card`), following the same DI/CLI seam. Four checks: `glob-count` ("resolve and surface" — always surface a glob's resolved reach, `warn` only on an explicit stated-count contradiction, soft `info` cross-check vs the declared affected-file count, never false-positive on a legitimate subset), `test-path`, `line-count`, `orphan-word`. **Advisory + fail-soft**: never throws, never blocks; CLI always exits 0.
- **`/lfe-plan-critique` gains Step 1.5 + Lens 5**: runs the linter, feeds `glob-count`/`test-path`/`line-count` into Lens 2 and `orphan-word` candidates into a new **Lens 5 — Coherence Simulation** (the semantic judgment a regex cannot make: is the preserved/framing text actually incoherent after this edit?). The review is now **5 lenses**; every plan-critique lens-count reference updated 4→5. The unrelated Inspector **4-Eyes Principle** (Devil's Advocate `critique.md`) is a different concept and is deliberately left unchanged.
- **`pipeline-status-narrative-check.mjs`**: a warn-only PostToolUse guard against generic personal-path leakage in the entrance card — same "mechanize the honor-system convention" rationale, recorded here for one cohesive decision.

**Considered Alternatives**

- *Prose-only discipline notes* (no executable checks) — rejected as the primary mechanism: it is exactly the honor-system pattern that failed in session 8. Discipline notes are still added to `/lfe-architect` as a human-facing complement, but the mechanical linter is the load-bearing guarantee.
- *Glob check compares glob-count to declaredCount by equality* (rejected during plan-critique, Brain-directed): an AC glob may legitimately target a subset of affected files, so blind equality false-positives. The "resolve and surface" design warns only on an explicit stated-count contradiction.

**Consequences**

- ✅ The four defect classes are caught at the cheapest moment (plan-critique) by tested code, not memory. Dogfooded live (the linter flagged a real glob-detector bug in its own development, and the 4→5 sweep was verified by Lens 5's own coherence discipline).
- ✅ Generic, ship-safe: the narrative-check detects *any* user's local-path shapes (no hardcoded seller username), so it protects adopters and leaves no fingerprint to scrub later.
- ⚠ `/lfe-plan-critique` now shells out to `node .claude/lib/plan-linter.mjs` — a runtime dependency of the skill on the substrate module. Bounded: the linter is fail-soft (a missing/broken linter degrades the critique to the prior judgment-only behavior, never blocks). Reversible via standard ADR supersession.

---
## ADR 93: Inspector specialist dispatch standardized on skills; subagent machinery removed (2026-05-30)

**Status:** Accepted (supersedes an earlier subagent-dispatch decision)
**Date:** 2026-05-30

**Context**

An earlier decision landed Inspector sub-skill dispatch as 5 specialist *subagents* (`.claude/agents/lfe-*-check.md`) with per-specialist write isolation via the agent-def `tools:` allowlist + a defensive `sub-skill-write-restrict.mjs` hook. That design was verified once in the upstream lineage but **never functioned in this extracted Claude-LFE repo**: Claude Code does not register the project agents (`Agent type 'lfe-security-check' not found`), reproduced across 3+ independent sessions and consistent with known upstream agent-discovery bugs. The `subagent_with_skill_fallback` mode meant missions still completed via skill dispatch, but the advertised subagent isolation / parallel fan-out never ran — an over-promised feature for a shippable product.

**Decision**

Remove the subagent machinery and standardize the Inspector on **skill-based dispatch** (the path that works in every environment).
- **Removed:** the 5 `.claude/agents/lfe-*-check.md` defs + their tests; `sub-skill-write-restrict.mjs` + its test + its `settings.json` registration.
- **Reframed:** `inspector-config.md` → skill-only; every operational doc (README, USER_MANUAL §5.2, INDUSTRY_STANDARDS §6, PERSONAS, pipeline_status Constraint #15) → the skill reality.
- **Unchanged:** the 5 specialist **skills** (`.agents/skills/lfe-*-check/` + mirror) and the mechanism-agnostic `lfe-inspector` skill (LFE-SOURCE). The capability is retained — only the dispatch mechanism is now honest.

**Consequences**

- ✅ No over-promised feature ships. The Inspector's 5 specialist passes run reliably as in-chat skills — dogfooded live in this repo's own inspections.
- ✅ Smaller, honest surface: −12 files, −1 PreToolUse hook, simpler `inspector-config.md`, −1 enforcement-layer claim in the docs.
- ⚠ Lost the (environment-dependent, never-working-here) context-isolation / parallel-fan-out property of subagent dispatch. Accepted: it never functioned in this repo, and the specialists are prompt-only reasoning passes for which main-thread execution is sufficient. Write isolation is preserved by `persona-path-lock` (Inspector writes confined to `.plans/**`).
- **Supersedes the earlier subagent-dispatch decision** (its ADR is retained, marked superseded, for the historical record until removed).

---
## ADR 92: `package.json` in the framework-infra carve-out + portable test runner (2026-05-30)

**Status:** Accepted
**Date:** 2026-05-30

**Context**

`package.json` had no `test` script, so a fresh clone's `npm test` errored. Adding it surfaced two problems:
1. `package.json` was in no mission-persona's `write_constraints` and not in `FRAMEWORK_INFRA_PATHS` — only Scout could write it, so the Builder could not add the script under persona-locking.
2. The natural command `node --test ".claude/**/*.test.mjs"` relies on command-line glob expansion that only landed in Node 21 and is unreliable through npm on older runtimes (nodejs/node#50658); a bare `node --test` discovers nothing under `__tests__/` directories (a silent zero-match green).

**Decision**

1. Add `'package.json'` (exact literal) to `FRAMEWORK_INFRA_PATHS` **Category I**. The manifest defines the mechanical npm scripts (`sync:*`, `postinstall`, `test`) — the same class of mechanical wiring as `scripts/setup-*.mjs` / `scripts/sync-*.mjs`, already Cat I. The entry is exact-match (not a glob), pinned by the strict carve-out snapshot test plus sibling deny-cases (`package-lock.json`, `package.json.bak` → DENY).
2. `npm test` runs `node tests/run-tests.mjs` — a zero-dependency runner that discovers `.claude/**/*.test.mjs` in JS and invokes `node --test` on the explicit file list (the most-broadly-supported invocation, Node ≥18), prints the discovered count, and exits 1 on zero matches. Placed in `tests/` (Builder-writable) rather than `scripts/` to avoid a second carve-out widening.

**Consequences**

- ✅ `npm test` works on any Node ≥18, identically across cmd / sh / PowerShell; no CLI-glob fragility; no silent zero-match.
- ✅ The manifest is maintainable by any persona (and by a buyer's own personas).
- ✅ The runner's zero-match exit-1 + per-run count print makes the discovery scope self-guarding.
- ⚠ Security (Low, accepted): any persona may now write `package.json`, a latent npm-lifecycle-script execution vector. Accepted under the drifting-agent (not malicious) threat model — diff-visible, consistent with the already-allowed higher-risk `.github/**` carve-out (ADR 90), exact-match scoped + deny-tested.
- Extends ADR 84/90's carve-out under the same "framework substrate, not domain content" rule; supersedes nothing. The carve-out grew 16→17 entries; the snapshot test was updated in lockstep (the forcing function per ADR 84).

---
## ADR 91: Persona retention for doc-only and destructive-only slices (2026-05-29)

**Status:** Accepted
**Date:** 2026-05-29

### Context

Builder's `write_constraints` per `.agents/permissions.json` are `src/**`, `.plans/**`, `tests/**`. Slices whose entire implementation is doc edits (under `.docs/**` or other Architect-allow-list paths such as `CONTEXT.md`) or destructive operations (Bash deletes, outside any persona's `write_constraints` and outside `FRAMEWORK_INFRA_PATHS`) would be DENIED by the persona-path-lock hook (`.claude/hooks/persona-path-lock.mjs`) if Active Persona transitioned to Builder per the standard `/lfe-plan-critique` Step 7 directive. This pattern recurred across multiple doc-only / destructive-only slices, each previously justified ad-hoc. A recurring deviation justified case-by-case deserves codification as deliberate convention.

### Decision

For slices whose `active_plan.md` flags them as **doc-only** or **destructive-only** (no `src/**` or `tests/**` writes), Active Persona is **RETAINED** from the Architect phase (NOT transitioned to Builder) through the Builder phase. The Builder skill still executes per protocol; the persona name is informational rather than gating.

### Consequences

- The persona-path-lock hook reads Active Persona = Architect at slice execution; Architect's `.docs/**` + `.plans/**` + `CONTEXT.md` allow-list covers all doc-only writes.
- Builder's role becomes semantic ("the Builder skill orchestrates execution") rather than persona-strict for these slices.
- The plan-critique-gate hook (`.claude/hooks/plan-critique-gate.mjs`) only gates `src/**` writes, so the retention has no functional hook impact for doc-only/destructive-only slices.
- Documented in each affected slice's `builder_done.md § Deviation Note` for traceability. The convention now reads as deliberate-by-design, not a recurring ad-hoc deviation.

### Rationale for Option A over B and C

- **Option B — expand `FRAMEWORK_INFRA_PATHS` to cover `.docs/**`**: rejected. The carve-out is security-sensitive (ADR 84 + the enforcement history); every expansion needs threat-model review; the marginal benefit doesn't justify the architectural change; a broader carve-out makes drifting agents more dangerous, not less.
- **Option C — extend Builder's `write_constraints` to `.docs/**`**: rejected. It muddles persona boundaries (Builder is "code Builder"); it creates plan-critique-gate inconsistency; adopter-reset-style missions are conceptually Architect + Archivist work, so Builder's role doesn't naturally fit.
- **Option A** is the smallest blast radius (documentation only), preserves the observed convention as a deliberate decision, and touches no hook code or `permissions.json`.

---
## ADR 90: Adopter-facing project infrastructure carve-out expansion (2026-05-25)

**Status:** Accepted
**Date:** 2026-05-25
**Depends on:** ADR 84 (original framework-infrastructure carve-out)

### Context

ADR 84 introduced `FRAMEWORK_INFRA_PATHS` in `.claude/hooks/persona-path-lock.mjs` as a persona-agnostic carve-out for files whose ownership cannot belong to a single persona because the files ARE the substrate of persona-locking. The original list covered `.claude/**`, `.githooks/**`, sync scripts, `.claude-plugin/**`, harness plan/projects directories, `pipeline_status.md`, and `LLM_AGENT_GUIDE.md`. During an early substrate-analysis pass, six additional adopter-facing project-infrastructure files surfaced outside both the carve-out and every persona's `write_constraints`: `.agents/skills/**`, `.gitattributes`, `.gitignore`, `.github/**`, `CLAUDE.md`, `USER_MANUAL.md`. These files are repo-wide infrastructure touched by hygiene, upstream-sync, and adopter-reset missions across persona transitions. Without carve-out coverage, every such write requires LFE-FORCE, accumulating Protocol-Debt entries that contradict mission-reliability invariants.

### Decision

Expand `FRAMEWORK_INFRA_PATHS` with the six globs above, split between Category I and Category II per their architectural fit:

- **Category I additions** (mechanical wiring): `.agents/skills/**`, `.gitattributes`, `.gitignore`, `.github/**`. Same architectural family as `.claude/**`, `.githooks/**`, sync scripts — repo-wide mechanical config and tooling surface.
- **Category II additions** (operator manuals / coordination-state): `CLAUDE.md`, `USER_MANUAL.md`. Same architectural family as `LLM_AGENT_GUIDE.md` — framework operator documentation that any persona may need to maintain across mission transitions.

No persona `write_constraints` are modified. No new persona is introduced. The expansion is architecturally identical in shape to the original ADR-84 carve-out — these files share the same property (substrate-of-persona-locking, no single owning persona).

### Consequences

- Hygiene, upstream-sync, and adopter-reset-style missions touching these files can write these surfaces under any persona without LFE-FORCE.
- The persona-path-lock hook's defense-in-depth properties are preserved: persona-bound writes to non-carve-out paths still go through the standard allow-list check.
- Tests in `.claude/hooks/__tests__/persona-path-lock.test.mjs` are extended with 15 enumerated test cases (E1-E15) covering positive ALLOW across the 6 new globs + persona-agnostic coverage + deny-case mirrors for `-fake` / `-bak` / `-LOCAL` directory variants. Existing test suites are unaffected.
- Audit-trail: `FRAMEWORK_INFRA_PATHS` is now 15 entries (was 9); future expansion follows the same ADR template (one ADR per expansion batch, referencing prior art).
- Reversibility: removing any entry is mechanically trivial (delete the line) but would re-introduce the LFE-FORCE pile-up; reversion is a substantive architectural decision requiring its own ADR.

### Permanent-substrate classification (per Brain confirmation 2026-05-25)

`USER_MANUAL.md` and `CLAUDE.md` are framework documentation only — they explain LFE itself (what it is, how it works, how adopters interact with the framework). They are NOT meant to be re-purposed by adopters to describe their own product. Same permanent-substrate status as `LLM_AGENT_GUIDE.md` (already in `FRAMEWORK_INFRA_PATHS` Category II). Adopters customising the framework keep `USER_MANUAL.md` and `CLAUDE.md` describing LFE; product-specific documentation belongs in their own files (e.g. customised `README.md` or new `.docs/product/*` files). The ADR 84 extension rule (*"framework substrate, not domain content"*) is satisfied because these files are permanently framework substrate.

### Threat model considerations

This carve-out includes `.github/**`, which covers GitHub Actions workflow files (`.github/workflows/*.yml`) — security-sensitive because workflow YAMLs execute with repository tokens at CI run time. The scope is accepted because the LFE protocol's plan-critique (`/lfe-plan-critique`) and Inspector (`/lfe-inspector` with `lfe-security-check` sub-skill) gates review every change before it lands. No workflow file can be added or modified without traversing these gates. Any future change to `.github/workflows/**` SHOULD trigger `lfe-security-check` regardless of the slice's other Inspector overrides — recommend codifying as a default-on rule in `.docs/quality/inspector-config.md` (deferred to a future ADR if needed).

### `README.md` Category-II addition (2026-05-25)

Extended `FRAMEWORK_INFRA_PATHS` Category II with `README.md` — the canonical adopter-facing entry-point doc. Same logical category as `CLAUDE.md` and `USER_MANUAL.md` (already covered by the original S0 expansion above): framework operator documentation that any persona may need to maintain across mission transitions. Same architectural family (substrate-of-persona-locking, no single owning persona); same threat model (compensating controls: LFE plan-critique + Inspector + commit-diff review for any agent-driven rewrite that would mislead adopters about framework behavior).

Surfaced during pre-plan reconnaissance: a `README.md` content edit could not execute under any persona's allowlist (Architect's allowlist covers `.docs/**` + `.plans/**` + `CONTEXT.md` only; root `README.md` is not covered, and the initial expansion missed it because its scope focused on what the early slices *needed* to write rather than what categorically belonged in Category II). Without this amendment, the edit would have required LFE-FORCE for a one-line README cell rewrite — exactly the discipline-erosion pattern the carve-out was designed to prevent.

5 new test cases added to `.claude/hooks/__tests__/persona-path-lock.test.mjs` (E19–E23) covering README.md persona-agnostic ALLOW × 4 personas + sibling-named deny-case (`README-fake.md` → DENY). Snapshot test in the `constants` describe block updated to include `README.md` per the maintenance-policy comment's forcing function. Persona-path-lock suite total: 134 tests (was 129 + 5 = 134). Backwards-compatible — no existing test changed; no existing slice broken; no production-code behavior change beyond the additional carve-out entry.

Audit-trail: `FRAMEWORK_INFRA_PATHS` is now 16 entries (was 15). ADR 90 remains the architectural decision of record (amended, not superseded).

---
## ADR 89: Standalone configuration as canonical Claude Code integration posture (2026-05-22)

**Status**: ✅ Accepted. Scoped to "Claude Code documentation as of 2026-05-22 per https://code.claude.com/docs/en/plugins.md and /plugins-reference"; reversible via standard ADR-supersession path if a future Claude Code release introduces project-local plugin auto-enable AND disables forced skill namespacing AND adds `statusLine` to plugin manifest schema. See ADR 87's Process Consequences ("external-Brain live-verification convention") for the epistemic family this ADR joins.

### Context

The standalone scaffolding absorbed the LFE framework into this project. To make `/lfe-*` skills dispatch via Claude Code's native skill system, 31 files were copied from `.agents/skills/**` (LFE-SOURCE) to `.claude/skills/**` (Claude Code dispatch path) and a pre-commit drift-guard installed (`scripts/sync-claude-skills.mjs`, `.githooks/pre-commit`, `package.json` `postinstall` activation). This scaffolding has been the canonical dispatch path supporting every assembly-line mission since.

A proposal framed the atomic replacement of this scaffolding with a Claude Code plugin manifest (`.claude-plugin/plugin.json` declaring `"skills": ".agents/skills/"`). The framing assumed plugin packaging was strictly superior: cleaner upstream-LFE-merge surface, version-pinning ergonomics, and "fresh clone + `npm install` + reload Claude Code — done" onboarding without per-session flags.

The grill phase verified the plugin-migration premise against the official Claude Code plugin documentation. Three structural blockers surfaced that cannot be circumvented within the LFE-SOURCE boundary.

### Decision

**Reject plugin migration. Ratify the standalone scaffolding (mirror + sync scripts + drift-guard + `package.json` sync entries) as the durable, canonical Claude Code integration posture.**

The scaffolding stays. No `.claude-plugin/` directory is created. The earlier framing of this scaffolding as removable is invalidated — the plugin migration is rejected.

### Three Structural Blockers

#### B1 — Skill namespacing is mandatory and unconfigurable

> *"Plugin skills are always namespaced (like `/my-first-plugin:hello`) to prevent conflicts when multiple plugins have skills with the same name. To change the namespace prefix, update the `name` field in `plugin.json`."* — https://code.claude.com/docs/en/plugins.md

The `name:` field in `plugin.json` chooses the namespace prefix but cannot omit it. The framework's 22 canonical Brain-typeable + agent-only `/lfe-*` skill names (per LLM_AGENT_GUIDE §9 and §8.8) would all gain a forced prefix: `/lfe-boot` → `/<plugin-name>:lfe-boot`. Shortest possible plugin name `lfe` yields `/lfe:lfe-boot`. Renaming SKILL.md directories from `lfe-boot/` to `boot/` to achieve `/lfe:boot` requires editing LFE-SOURCE (`.agents/skills/lfe-boot/`) — forbidden per §10.7 LFE-SOURCE boundary.

Cascading impact of forced namespacing: every literal `/lfe-*` reference in `LLM_AGENT_GUIDE.md §8.8` Brain-typeable allow-list, `.docs/protocol/PERSONAS.md`, `.docs/protocol/ASSEMBLY_LINE.md`, all 22 `.agents/skills/*/SKILL.md` bodies, `CLAUDE.md`, `.claude/hooks/skill-invocation-gate.mjs` (BRAIN_TYPEABLE_SKILLS set + AGENT_ONLY_PREDECESSORS 18-entry map), `.claude/hooks/session-start-reminder.mjs` resume-ladder messages, and `.claude/statusline.mjs` rendering would all need adjustment, and many of those targets are LFE-SOURCE.

The plugins-reference docs note (lines 555-557) that single-skill plugins MAY use the SKILL.md frontmatter `name:` field for invocation without the namespace prefix. This is the only documented escape hatch from B1, and it does not apply to multi-skill plugins. Splitting the project's 22 skills into 22 separate single-skill plugins is structurally absurd (marketplace metadata multiplies, plugin-discovery surface bloats, no integration benefit).

#### B2 — No documented project-local auto-enable mechanism

The plugin-migration hypothesis assumed that committing `enabledPlugins: ["lfe"]` in `.claude/settings.json` would auto-enable a co-resident `.claude-plugin/plugin.json` on a fresh clone. The official documentation refutes this:

- `enabledPlugins` (per plugins-reference) is populated by `claude plugin install <name>@<marketplace> --scope project` and enables **already-installed** plugins on fresh clones via marketplace re-install. It does NOT install a project-local plugin from a `.claude-plugin/` directory.
- Documented installation paths for a plugin:
  - `claude --plugin-dir <path>` — per-session flag, explicitly documented as *"useful for development and testing"* (plugins.md "Test your plugins locally" section).
  - `claude --plugin-url <url>` — fetches a zip archive per session.
  - `claude plugin install <name>@<marketplace>` — requires a marketplace.json hosted somewhere reachable (private repo or public catalog).
- **No documented mechanism exists** for auto-loading a project-local plugin from `.claude-plugin/plugin.json` without one of the three paths above.

The "clone + `npm install` + reload Claude Code — done" onboarding cannot work as scoped. The realistic alternatives are: per-session `--plugin-dir` (adds operator burden, no net benefit over standalone) or marketplace publication (out of scope for single-team single-project use). Standalone configuration (the current scaffolding) auto-activates on fresh clones via `package.json` `postinstall` → `scripts/setup-git-hooks.mjs` and requires NO per-session flags.

#### B3 — `statusLine` cannot live inside a plugin manifest

The framework's statusLine (`.claude/statusline.mjs` invoked by Claude Code's `statusLine` setting per ADR 81) renders the entrance card's Active Persona + Mission State + Pipeline Phase + Session Count below the prompt.

The full plugin manifest schema (plugins-reference "Plugin manifest schema" section) enumerates: `name`, `displayName`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `outputStyles`, `lspServers`, `experimental.themes`, `experimental.monitors`, `userConfig`, `channels`, `dependencies`. **`statusLine` is not in this list.**

The plugin-internal `settings.json` (plugins-reference: *"Default configuration applied when the plugin is enabled. Only the `agent` and `subagentStatusLine` keys are currently supported"*) supports only `agent` and `subagentStatusLine` — the latter is a different feature (subagent footer line per `/en/statusline#subagent-status-lines`), not the generic command-based statusLine the project uses.

Even if plugin packaging worked perfectly for skills + hooks + agents, `.claude/statusline.mjs` + the corresponding `.claude/settings.json` `statusLine` block would have to remain as standalone configuration. Plugin packaging cannot reach feature-parity with the current standalone substrate.

### Anthropic's positioning (verbatim)

From https://code.claude.com/docs/en/plugins.md "When to use plugins vs standalone configuration":

> | Approach | Skill names | Best for |
> | :--- | :--- | :--- |
> | **Standalone** (`.claude/` directory) | `/hello` | Personal workflows, project-specific customizations, quick experiments |
> | **Plugins** (directories with `.claude-plugin/plugin.json`) | `/plugin-name:hello` | Sharing with teammates, distributing to community, versioned releases, reusable across projects |
>
> **Use standalone configuration when**:
> - You're customizing Claude Code for a single project
> - The configuration is personal and doesn't need to be shared
> - You're experimenting with skills or hooks before packaging them
> - You want short skill names like `/hello` or `/deploy`

This framework matches the standalone column on 2 of 3 dimensions explicitly named: single project (yes) + short skill names canonical (`/lfe-boot` per LFE-SOURCE — yes). The third dimension (single-developer use) is mixed. The documented standalone-vs-plugin decision matrix recommends standalone for this situation.

### Consequences

**Positive:**

- **Short skill names preserved**: `/lfe-boot`, `/lfe-whats-next`, `/lfe-scout`, `/lfe-extract-domain` continue to dispatch as documented in LFE-SOURCE (§8.8 Brain-typeable). All 22 `/lfe-*` cross-references in LFE-SOURCE, `.claude/hooks/*.mjs`, `.docs/protocol/*.md`, and `CLAUDE.md` stay valid without any rename work.
- **No per-session flags**: onboarding remains `git clone` + `npm install` (postinstall fires `setup-git-hooks.mjs`) + reload Claude Code. No `--plugin-dir`, no marketplace dependency, no published plugin metadata to maintain.
- **`statusLine` continues to render**: the statusLine substrate works as designed without forced migration to an unsupported plugin field.
- **LFE-SOURCE boundary clean by construction**: the mirror is a read-only-from-LFE-SOURCE copy; no plugin manifest exists to need its own versioning lifecycle. Upstream-LFE merges produce zero conflicts in `.agents/skills/**` per §10.7 audit.
- **§10 already declares the substrate**: Constraints 9-16 enumerate every integration component; ADR 89's Constraint 17 reframes the standalone scaffolding as canonical without architectural redesign.

**Negative:**

- **Permanent maintenance surface**: `.claude/skills/**` mirror (31 files), `scripts/sync-claude-skills.mjs`, `scripts/setup-git-hooks.mjs`, `.githooks/pre-commit`, three `package.json` sync entries are all permanent state. Future LFE-source structural changes (new skills, renamed support files) must propagate via the sync script.
- **Upstream-LFE-merge convenience cost**: the sync script handles any LFE-source structural changes; if upstream LFE adds new skill directories, the sync script's recursive copy logic must keep working — single point of failure for mirror integrity.
- **Originally treated as transitional**: the early integration narrative anticipated plugin packaging as the durable answer; reframing as canonical requires documentation updates (this ADR + Constraint 17 + Constraint 16 inline annotation + the onboarding-doc stub).

**Conditional reversal:**

- ADR 89 is empirically scoped to "Claude Code documentation as of 2026-05-22". If a future Claude Code release introduces:
  - project-local plugin auto-enable WITHOUT per-session flag AND WITHOUT marketplace dependency, AND
  - opt-out from forced skill namespacing for project-internal plugins, AND
  - `statusLine` field support in plugin manifest schema,

  then ADR 89's conclusion may warrant revisiting via the standard ADR-supersession path. The "Falsification Procedure" section below preserves the empirical kit for re-running.

### Rejected Alternatives

**Full plugin packaging (the original framing)**: plugin packaging is strictly superior; `.claude-plugin/plugin.json` declares `"skills": ".agents/skills/"`; atomic scaffolding removal in same commit; onboarding becomes clone + `npm install` + reload — done.

Rejected: structurally not achievable per B1 (forced namespacing) + B2 (no project-local auto-enable) + B3 (`statusLine` plugin-ineligible). The envisioned outcome (`/skills` shows 22 entries as `/lfe-*`, no flags, fresh clone) cannot be produced by any documented Claude Code plugin mechanism.

**Per-session `--plugin-dir` (the fallback framing)**: `--plugin-dir .` per session + mirror stays + plugin packages hooks + agents only.

Rejected: ~zero net benefit. Skills and statusLine still served by standalone configuration. Hooks and agents already work fine in standalone. Adding `--plugin-dir .` flag burden across every session for a partial migration that gains version-pinning ergonomics only (and only for hooks + agents) is worst-of-both. The assessment that a partial migration is barely worth doing is corroborated here.

**22 single-skill plugins**: theoretical escape hatch from B1 via the plugins-reference lines 555-557 single-skill plugin behavior (frontmatter `name:` field as full invocation name).

Rejected: 22 plugins is ergonomically absurd. Plugin marketplace metadata multiplies 22×. Plugin-discovery surface bloats Claude Code's `/plugin` UI. Hooks + agents cannot be split into per-skill plugins. Integration benefit is negative (more files to maintain than the current mirror).

### Falsification Procedure

The grill phase staged a sandbox falsification protocol for Brain external execution before locking the decision. The Brain elected to skip the empirical step on doc-derived evidence acceptance; the protocol is preserved below for future re-litigation if a Claude Code release surfaces undocumented escape hatches.

**Hypothesis to falsify** (re-stated): the three blockers (B1 namespacing, B2 no project-local auto-enable, B3 `statusLine` plugin-ineligibility) are structurally enforced by Claude Code as of 2026-05-22.

**Setup** (minimal scratch repo outside this project):

1. Create `~/lfe-sandbox-test/.claude-plugin/plugin.json` with `name: "lfe-sandbox"`, `version: "0.0.1"`, and a `statusLine: { type: "command", command: "echo '[SANDBOX statusLine FROM PLUGIN MANIFEST]'" }` field (B3 probe).
2. Create `~/lfe-sandbox-test/skills/sandbox-ping/SKILL.md` with frontmatter `name: sandbox-ping`.
3. Create `~/lfe-sandbox-test/skills/sandbox-pong/SKILL.md` to force multi-skill mode.
4. Create `~/lfe-sandbox-test/hooks/hooks.json` with a SessionStart echo to stderr.
5. Create `~/lfe-sandbox-test/.claude/settings.json` with `{ "enabledPlugins": ["lfe-sandbox"] }`.

**Tests**:

- **T1 — Auto-enable from committed `enabledPlugins` (no flag)**: `cd ~/lfe-sandbox-test/; claude` (no flags). Observe whether plugin loads, skills dispatch, statusLine renders, hooks fire. → B2 verdict.
- **T2 — `--plugin-dir` control (multi-skill mode)**: `cd ~/lfe-sandbox-test/; claude --plugin-dir .`. Observe whether `/sandbox-ping` dispatches with or without `lfe-sandbox:` prefix. Observe statusLine. → B1 + B3 verdicts.
- **T3 — Single-skill plugin escape hatch (conditional)**: delete `sandbox-pong/`; re-run T2. Observe whether `/sandbox-ping` resolves without prefix. → B1 single-skill escape verdict.

**Disposition**:

- If all three blockers confirm under sandbox → ADR 89 remains correct as written.
- If any blocker falsifies → file a new ADR superseding ADR 89; reopen the plugin-migration scope under updated assumptions; preserve ADR 89 as historical context.

### Cross-references

- **ADR 84** (Cat I/II carve-out for persona path-locking): the standalone scaffolding paths (`.claude/**`, `.githooks/**`, `scripts/setup-*.mjs`, `scripts/sync-*.mjs`) are Cat I framework-infra paths; ADR 89's ratification of those paths as canonical is consistent with ADR 84's existing categorization. `.claude-plugin/**` was originally listed in Cat I anticipating plugin migration; that listing is now defunct (no `.claude-plugin/` exists) but harmless (Cat I is broader-than-strictly-necessary by design per the §10.4 threat model).
- **ADR 87** (matcher-only hook config + external-Brain live-verification convention): ADR 89 follows the Process Consequences convention via boot verification ACs (fresh-clone enable flow / drift-guard exit 0 / deliberate drift detected). The convention is empirically validated as load-bearing on every mechanical-enforcement landing; ADR 89 inherits the same epistemic discipline.
- **The subagent-dispatch investigation** (since removed — see ADR 93): same epistemic family as ADR 89. It found that PreToolUse envelope-honoring for subagent contexts is structurally not viable in Claude Code; the working seam was the agent-def `tools:` allowlist. ADR 89 finds that plugin packaging for single-project + short-skill-names + statusLine-bearing integrations is structurally not viable; the working seam is standalone configuration. Both follow the same rule: find the seam the harness actually supports, build durable architecture on that seam, don't fight documentation.

---

## ADR 88: Inspector subagent dispatch + per-specialist write-restriction — superseded by ADR 93

**Status:** Superseded → ADR 93

*No standalone body by design.* ADR 88's full decision content is preserved inline in the index-table row at the top of this file; the standing decision is **ADR 93** below (the Inspector's 5 specialist passes run as in-chat skills — the subagent machinery never registered in this repo and was removed). This stub keeps the Full ADR Bodies sequence contiguous: the 89 → 88 → 87 order is intentional, not a gap.

---

## ADR 87: Hook `if`-filter pattern: matcher-only over `if: "<dir>/*"`; external Brain live-verification convention (2026-05-18)

**Status:** ✅ Accepted (the external-Brain live-verification convention has completed its first PASSing cycle since ratification. Mutation M9 was confirmed empirically across multiple sessions — the first several on the FAIL side, then on the PASS side; the convention is empirically validated as load-bearing on every mechanical-enforcement landing.)
**Date:** 2026-05-18 (PASS-cycle annotation 2026-05-22)

A Hygiene sweep empirically confirmed that the PostToolUse `checkpoint-flip.mjs` hook did NOT fire across 9 coordination-file writes despite valid frontmatter + eligible `status: complete | passed`. A follow-up diagnostic-as-build ran a 4-probe empirical sequence:
- **Probe 0** (`if: "Write(.plans/*)"`): zero hook fires.
- **Probe 1** (`if: "Write(.plans/**)"`): zero hook fires.
- **Probe 2** (no `if` field; matcher-only): both PostToolUse hooks fired correctly.
- **Probe 2b ext** (`if: "Write(src/**)"` for plan-critique-gate): zero fires — bug generalizes across hook scopes.

The harness `if`-field permission-rule matching does NOT honor cwd-relative path patterns (`<scope>/*` or `<scope>/**`) against `tool_input.file_path` despite the [Claude Code permissions reference](https://code.claude.com/docs/en/permissions) documenting gitignore-style semantics with cwd-relative path resolution. Three hooks were silently inert: `validate-frontmatter.mjs`, `checkpoint-flip.mjs`, and `plan-critique-gate.mjs` (the last never live-exercised because no `src/**` writes occurred). The framework's mechanical Layer-2 enforcement substrate (ratified by ADRs 81-86) was theoretical, not actual.

### Considered Options

**Fix candidate space (from the diagnostic findings):**

- **(A) Matcher-only — drop `if` field; rely on internal Stage-2 path-prefix guard — chosen.** Each affected hook already has an internal Stage-2 path-prefix guard: `checkpoint-flip.mjs:111` (`!target.startsWith(PLANS_PREFIX)`), `validate-frontmatter.mjs:180` (same), `plan-critique-gate.mjs` Stage 3 (`!isUnderSrc(target)` via `matchAnyGlob`). These guards short-circuit in microseconds after Node spawn. Existing unit-cell coverage (137 cells across the 3 `main()` decision trees) already covers them. **Empirically confirmed working** via Probe 2: both PostToolUse sentinels fired on a `.plans/` write.

- **(B) Change `*` → `**` — rejected.** Probe 1 showed `Write(.plans/**)` is also non-functional. The bug is the `if`-field implementation itself, not the glob shape.

- **(C) Absolute-path syntax `Write(//<root>/.plans/**)` — not attempted; deferred.** An earlier review noted Probe 3 was not executed; the Builder phase did not retry per the Brain's slice-approval decision ("Approve as-is"). The candidate-A working evidence is sufficient; a hypothetical working surgical alternative would only matter for perf optimization, not correctness.

**Architectural symmetric-trust precedent:** the matcher-only invocation pattern has empirical-safety precedent from `persona-path-lock.mjs` (shipped with `matcher: "Write|Edit"` and NO `if` filter). The hook fires on every Write/Edit; the script self-filters via internal Stage-2 guard + Cat I/II carve-out. Zero security incidents recorded.

**The structural test-quality gap (mutation M9):** the harness layer (matcher + `if`-field dispatch) is structurally unit-test-unreachable. Tests bypass the harness by directly invoking `main()` with synthesized stdin. **Mutation reasoning over `.claude/settings.json` matcher OR hook entry shape → all 637 cells stay GREEN**. This is the structural test-quality gap that allowed the inert-hook defect to persist several mission cycles before detection. **Mitigation must live at the framework-process level, not the test-suite level** — codified below as the external-Brain live-verification convention.

### Decision

**Direct decision** (the hook-config pattern):
- For `.claude/settings.json` hook entries scoped to a specific path-pattern, **drop the `if` field**. Use `matcher` alone (or `matcher: "Write|Edit"` for tool-name fan-out). Each script self-filters via its existing internal Stage-2 path-prefix guard.
- For new hooks: choose `matcher` granularity carefully; the internal guard does the path-scope filtering.
- For settings.json edits: **JSON-parse smoke check is mandatory** after every edit (high blast-radius if the JSON becomes malformed — breaks all hook dispatch globally).

**Process decision** (the external-verification convention):
- Every mechanical-enforcement hook mission MUST land an `## Inspector Overrides` section enabling all 5 sub-skills.
- The Inspector phase performs unit-test-based verification (necessary).
- The mission-close Archivist phase MUST NOT declare the mechanical hook "verified working" or close any bug-#10-family open-issue based on agent-internal signals alone (sentinel files, in-session checkbox flips, etc.).
- **The closure signal is the Brain's session-N+1 boot external observation**: Brain visually confirms the hook fires on a real subsequent-session coordination-file / src/** write (e.g., `pipeline_status.md` Coordination Files row mechanically flips). Only then does the session-N+1 Archivist retroactively close the prior session's mechanical-hook bug entry.

### Direct Consequences

- ✅ **Mechanical Layer-2 enforcement substrate restored.** Three hooks (checkpoint-flip, validate-frontmatter, plan-critique-gate) now fire on every Write tool call as documented; internal Stage-2 guards correctly filter. In-mission evidence: `build ✅`, `tdd ✅`, `critique ✅`, `inspect ✅` all flipped mechanically post-fix.

- âš ï¸ **Harness pre-screen optimization lost; ~5-15s aggregate session overhead per typical 30-50-Write mission**. Per-hook cost: ~60-180ms Node-spawn (ADR 81/82 cost family). For a typical session: 30-50 Writes × 3 added hook invocations × ~120ms avg = ~10-22 seconds session-time overhead vs the hypothetical-working-`if`-filter alternative. **However**, the prior-state was silently broken (`if` filter inert; hooks weren't firing at all). So the actual delta vs prior-session sessions is: hooks now fire correctly. Each hook's internal Stage-2 prefix guard short-circuits in microseconds after spawn; net cost is the spawn itself. Accepted per ADR 81/82 precedent.

- ✅ **Architectural symmetric-trust precedent codified.** `persona-path-lock.mjs` has been matcher-only with zero security/perf incidents. The other hooks now follow the same pattern. ADR-84's Cat I + II carve-outs continue to handle persona-agnostic framework-substrate writes correctly across the expanded invocation pattern.

- 🛡 **JSON-parse smoke check is now load-bearing convention.** Every `.claude/settings.json` edit MUST be followed by `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"` (or equivalent) to confirm structural validity. Settings.json corruption breaks all hook dispatch globally — a regression here would silently re-introduce bug-#10-style failures.

### Process Consequences

- 🛡 **External-Brain live-verification convention is non-negotiable for mechanical-enforcement hook missions.**

  > *"Every mechanical-enforcement hook must be live-verified externally by Brain observation before its mission can claim closure. Ship-and-declare-done without external verification is empirically broken (a PostToolUse hook was silently inert for multiple mission cycles before detection). Inspector phase of every future mechanical-enforcement hook mission MUST treat external Brain live-verification as a mandatory gate at mission close; agent-internal verification (unit tests + instrumented synthetic write) is necessary but NOT sufficient."*

- 🛡 **Mechanical-enforcement-hook Inspector checklist** — Inspector phase of every future mechanical-enforcement hook mission walks through these gates before declaring `inspection_report.md` `status: passed`:
  1. `git diff .claude/settings.json` shows no `if: "<scope>/<pattern>"` field re-introduced under PreToolUse / PostToolUse hooks (matcher-only convention preserved).
  2. Each affected hook's `main()` internal path-prefix guard is covered by existing unit cells (no regression in 95%+ strict mutation coverage on `main()` bodies).
  3. JSON-parse smoke check on settings.json passes.
  4. `.plans/inspection_report.md` body explicitly notes whether external-Brain live-verification at session-N+1 boot is the closure signal — if yes, the corresponding `known-issues.md` entry MUST stay open with a "Awaiting external Brain verification at session-N+1 boot" hold-open note.
  5. Archivist phase verifies the hold-open note landed (or the closure entry is correctly deferred).

- 📁 **CHANGELOG + known-issues hold-open pattern.** When a mechanical-enforcement hook mission closes, the CHANGELOG milestone is prepended (mission shipped) AND the bug/issue entry in known-issues.md stays open with the hold-open note. The next session's boot is responsible for resolving the hold-open via Brain external observation; the session-N+1 Archivist retroactively closes the entry.

- âš ï¸ **The convention is enforced by review discipline + ADR + literal checklist lines, not by mechanical hook.** A meta-mechanical-hook (a hook enforcing "do not let agent self-certify mechanical hooks") would itself be subject to mutation M9. The recursion bottoms out at framework-process convention. This is acceptable per LFE's broader pattern (e.g., persona discipline is enforced by `permissions.json` + Inspector audit, not by OS-level sandbox).

- 📁 **LFE-upstream-feedback candidate filed** (conditional): the empirical evidence in this ADR documents a Claude Code documentation/implementation discrepancy. The [permissions reference](https://code.claude.com/docs/en/permissions) declares gitignore-style semantics with cwd-relative path resolution; the implementation does not honor these for hook `if`-filter matching against `tool_input.file_path`. Surface upstream during a future plugin-packaging contribution. **Mark conditional**: drop if a future Claude Code release fixes or clarifies.

### Reversibility

If a future Claude Code release fixes the harness `if`-field matching to honor gitignore-style cwd-relative patterns, the `if` field could be re-introduced surgically (one entry at a time, with verification each step) — but the matcher-only pattern remains the safer default per the symmetric-trust precedent from persona-path-lock. The external-verification convention is independent of this and remains non-negotiable regardless of harness fixes; even if `if`-filter matching becomes reliable, mutation M9 (the structural test-quality gap on the harness layer) persists by nature of unit tests bypassing the harness.

---
## ADR 86: PostToolUse state-mutator silent-ALLOW posture (2026-05-17)

**Status:** Accepted
**Date:** 2026-05-17

`.claude/hooks/checkpoint-flip.mjs` is the first PostToolUse hook that performs a **state-coordinating side-effect** (flips a checkbox in `pipeline_status.md`) rather than verdicting the write that triggered it. ADR 82 covers signal-strict PostToolUse hooks where the hook *gates* a schema (exit 2 + educational stderr → agent self-corrects). The new posture has the same event type but a fundamentally different intent: the hook trusts the upstream signal-strict gate (Cat D's `validate-frontmatter.mjs`) and reacts to the validated write by mutating coordination state. This ADR ratifies that distinction and pre-ratifies any future PostToolUse state-orchestration hook.

### Considered Options

**Posture for state-mutator PostToolUse hooks:**
- **(a) Always silent-ALLOW (exit 0); informative stderr on every branch — chosen.** The hook does not verdict the write it observes — it reacts to it. Failure of the side-effect (e.g., `pipeline_status.md` unreadable) must not block the user's `.plans/` write or the orchestrating skill's progress. All decision-tree exits use `exit 0`; stderr text distinguishes flip / no-op / already / could-not-read / write-failed branches so debugging is preserved without affecting tool execution.
- **(b) Signal-strict like Cat D (exit 2 on side-effect failure) — rejected.** Conflates "the write you just made is malformed" with "I couldn't update an unrelated coordination file." The user's write succeeded, was schema-valid (Cat D ran first), and is on disk. Failing it post-hoc gives the wrong feedback to the agent and produces spurious self-corrections.
- **(c) Mixed — silent on success, exit 2 on side-effect failure — rejected.** Same conflation as (b) when the side-effect fails; introduces a posture that is neither signal-strict nor silent.

**Multi-hook ordering on `PostToolUse / matcher: "Write" / if: "Write(.plans/*)"`:**
- **(d) Cat D first (schema gate), state-mutator second (side-effect) — chosen.** Both hooks live under the same `matcher: "Write"` group's `hooks` array in `.claude/settings.json`. Cat D's signal-strict exit 2 on a malformed write does NOT prevent the next entry from firing (Claude Code runs all matchers); the state-mutator's frontmatter parse would then fail safely (silent-ALLOW + stderr "parse failed"). Ordering is preserved by the array order; reversing would still work but loses the "validate then react" mental model.
- **(e) Single coalesced hook combining schema + state mutation — rejected.** Couples two orthogonal concerns (Cat D's validator already has 4 specialists; adding state mutation grows the surface). Separate hooks keep mutation testing local to each concern.

**Cat II carve-out for state mutator writes (per ADR 84):**
- **(f) State-mutator writes pipeline_status.md persona-agnostically via Cat II carve-out — chosen.** The Cat II carve-out (ADR 84) was originally for the Archivist's end-of-mission entrance-card update; this hook extends the same justification to mid-mission mechanical flips. Same architectural truth: the file determining who-is-the-active-persona cannot itself be persona-locked. No new carve-out entry needed.

### Consequences

- ✅ **Posture separation explicit.** Future hook authors choose ADR 82 (signal-strict, gate intent) vs ADR 86 (silent-ALLOW, side-effect intent) by asking "is my hook verdicting the write, or reacting to it?" — a clean discriminator.
- ✅ **State coordination becomes mechanical.** Honor-system flips (one prior session complied; another skipped all) move to harness enforcement. Agent skills can read `pipeline_status.md` and trust the checkpoint state.
- ✅ **No blocking risk.** Side-effect failure never blocks the user's `.plans/` write — preserves the LFE assembly line's progress invariant.
- âš ï¸ **Visibility is via stderr, not stdout envelope.** PostToolUse has no `permissionDecision` semantic (the write already happened). Debugging requires looking at the hook log for `[LFE C.0] checkpoint-flip:` lines. Acceptable cost — Claude Code does surface stderr to the user.
- âš ï¸ **Idempotency is the hook's responsibility.** Re-writes of the same `.plans/*.md` file fire the hook again; the `flipCheckbox` helper returns `already` on `<label> ✅` and no-ops the write. Future state-mutator hooks must replicate this idempotency contract.
- 🛡 **TDD pins the silent-ALLOW posture.** The checkpoint-flip suite asserts `exit 0` across all infrastructure-failure branches (51 cases, including written-file-unreadable, frontmatter-parse-fail, pipeline_status-unreadable, row-not-found, label-not-present, write-fail). A future contributor cannot accidentally retrofit signal-strict without breaking the suite and writing a superseding ADR.

### Reversibility

If a future state-mutator hook needs to fail-strict on its side-effect (e.g., a security-critical coordination state that must not silently drift), it would write a superseding ADR that documents the asymmetry: signal-strict on side-effect failure for that specific hook, while ADR 86 remains the default for the broader class. The chosen pattern is small enough that the swap is local: a per-branch exit code change in `main`, plus tests.

---
## ADR 85: Block-with-escape (BE) hook design pattern for PreToolUse (2026-05-17)

**Status:** Accepted
**Date:** 2026-05-17

`.claude/hooks/persona-path-lock.mjs` is the first **block-with-escape (BE)** posture hook — and the first PreToolUse seam in the repo. BE is one of three hook postures (Warn-and-log / Block-strict / Block-with-escape); this ADR specifies its runtime mechanisms. The grill resolved each fork; this ADR ratifies them as the project-wide reference design for any future BE hook (the plan-critique gate is the next likely consumer).

### Considered Options (per mechanism)

**Override-keyword detection (how does the hook see `LFE-FORCE` in user context?):**
- **(a) Read `transcript_path` from stdin payload — chosen.** Claude Code's PreToolUse stdin schema includes `transcript_path: string` (a path to the conversation JSONL log per [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)). Hook reads the file, scans the last 3 user-role messages (`LFE_FORCE_SCAN_WINDOW = 3`) for a case-insensitive substring match. Matches GOVERNANCE.md § Emergency Protocol's contract (Brain types the keyword in-chat; protocol recognises it).
- **(b) Environment variable `LFE_FORCE=1` — rejected.** Decouples from natural chat flow; Brain must set env before the action and unset after, which is operationally fragile and doesn't match the GOVERNANCE.md user-keyword model.
- **(c) Magic comment in tool input — rejected.** Encoding the keyword in the file_path or command argument is brittle and exploitable.

**Block mechanism (how does the hook tell the harness to deny?):**
- **(d) `hookSpecificOutput.permissionDecision: "deny"` JSON envelope on stdout, exit 0 — chosen as primary signal.** Per the documented PreToolUse output schema. Envelope: `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny" | "allow", "permissionDecisionReason": "<message>" } }`. Educational message goes in `permissionDecisionReason`. Stderr also carries the message (defense-in-depth log visibility).
- **(e) Exit code 2 alone — retained as fallback.** Per docs, "exit 2 = blocking error; stderr fed to Claude". Used only on hook-infrastructure errors (JSON emission failure, unexpected exception in `main`). Primary signal stays the JSON envelope.

**PROTOCOL_DEBT.md append on escape (how does the hook record the debt?):**
- **(f) Read-modify-write splitting on first `\n---` separator — chosen.** Preserves the file's `<intro> | table | --- | archive-pointer` structure by inserting the new table row **before** the separator, not at end-of-file. `appendFile`-with-`O_APPEND` would put the row after the archive pointer and break the structure.

**Asymmetric fail-safe policy (what to do when a read fails?):**
- **(g) ALLOW on substrate corruption (pipeline_status.md, permissions.json), DENY on detection-path failure (transcript) — chosen.** A corrupted framework substrate (entrance card unparseable, persona absent from permissions.json) must NOT lock the user out of recovery — fail-safe ALLOW with stderr warning. But transcript read failure could silently hide an LFE-FORCE the user actually typed; allowing on that would defeat the gate. Asymmetric, deliberate.
- **(h) Symmetric fail-safe (ALLOW everywhere on read fail) — rejected.** Hides intent-bearing failures.

### Consequences

- ✅ **Reference design for future BE hooks.** The plan-critique gate (PreToolUse on `src/**` reads `plan_critique.md`) inherits this pattern: same JSON envelope mechanism, same fail-safe semantics, same PROTOCOL_DEBT.md append on escape. Any new BE hook in the project must use this template unless a superseding ADR documents a deviation.
- ✅ **GOVERNANCE.md § Emergency Protocol mechanised.** The prose-level rule ("Brain uses `LFE-FORCE` keyword; every action MUST be recorded") is now harness-enforced for `Write|Edit` tool calls.
- ✅ **Defense-in-depth Layer 2 strengthened.** The persona-discipline rule moves from honor-system prose to harness-level mechanical enforcement (per the four-layer defense-in-depth model).
- âš ï¸ **Phishing surface in LFE-FORCE detection.** A user innocently typing "I'm reading about the LFE-FORCE protocol" within the scan window could trigger a spurious escape on a subsequent unrelated Write. Damage is bounded (one debt row, next session surfaces it, Brain marks `resolved (false positive)`). Acceptable cost vs the risk of missing a genuine override.
- âš ï¸ **`transcript_path` field-rename fragility.** If Claude Code renames or removes the field in a future release, transcript reads fail → asymmetric fail-safe DENIES every Write/Edit. Fails closed (correct for a security hook); Brain notices immediately; rescue note in deny message names the `.claude/settings.local.json` comment-out fix; LFE-FORCE remains as escape valve via env-var fallback if it comes to that.
- âš ï¸ **Read-modify-write of PROTOCOL_DEBT.md is not atomic at the file-system level.** Splits on the first `\n---` and re-writes the full file. Acceptable in Claude Code's single-threaded-per-session model; future multi-process harnesses would need a lockfile.
- 🛡 **TDD pins both fail-safe branches.** The persona-path-lock test suite includes `unparseable pipeline_status.md → ALLOW + stderr` AND `transcript read failure → DENY` cells. Future contributors cannot accidentally retrofit symmetric fail-safe without breaking the suite and writing a superseding ADR.

### Reversibility

If a future harness change breaks any mechanism (e.g., Claude Code deprecates `permissionDecision` for a new schema), the hook's pure-`main` body with injected dependencies makes a targeted swap trivial — re-wire the CLI wrapper, update one branch in `main`, update affected tests. The ADR pattern (transcript detection + JSON envelope + read-modify-write debt append + asymmetric fail-safe) stays valid; only the mechanism implementations change.

---
## ADR 84: Framework-infrastructure carve-out for persona path-locking hook (2026-05-17)

**Status:** Accepted
**Date:** 2026-05-17

The PreToolUse persona-path-lock hook (`.claude/hooks/persona-path-lock.mjs`) reads the Active Persona from `pipeline_status.md` and the persona's `write_constraints` from `.agents/permissions.json` to enforce path-discipline on Write/Edit tool calls. Two file categories present a structural problem the simple persona→write_constraints model cannot solve:

1. **Mechanical wiring** — `.claude/**` (hooks, settings, statusline, agents), `.githooks/**` (drift guards), `scripts/setup-*.mjs` + `scripts/sync-*.mjs` (per-clone bootstrap), `.claude-plugin/**` (plugin manifest). **No persona** has these paths in their `write_constraints`. Yet every integration mission ships artifacts to these paths. Without a carve-out, the hook would deadlock its own Builder phase (writing the hook script to `.claude/hooks/`) AND every subsequent mission's plumbing build.

2. **Coordination-state substrate** — `pipeline_status.md` (the entrance card, source of Active Persona) and `LLM_AGENT_GUIDE.md` (§10 Project-Specific Bindings registry). Only Archivist owns `pipeline_status.md` per permissions.json. But the hook reads `pipeline_status.md` FOR the Active Persona — so when the Archivist phase tries to update `pipeline_status.md` for end-of-mission state transition, the hook sees the OLD Active Persona (still "Architect") and denies. Chicken-and-egg deadlock: the file that determines persona-locking cannot itself be persona-locked without preventing the lock from ever being updated. (Same architectural truth as `/etc/passwd` being root-owned regardless of the current user — the substrate that ENFORCES the rule cannot be GATED by the rule.) `LLM_AGENT_GUIDE.md` was originally not in Archivist's allow-list either (a pre-existing permissions.json gap surfaced by this hook); routing through `.docs/**` would also miss because it lives at repo root.

The Brain-approved plan at the plan-mode gate listed only Category I paths in `FRAMEWORK_INFRA_PATHS`. Mid-Builder execution surfaced the Category II deadlock; the Builder expanded the carve-out to include Category II files and documented the deviation in `builder_done.md` for Inspector verification. The Inspector's Devil's Advocate pass (`critique.md`) explicitly verified the expansion against the carve-out's stated *spirit* ("framework substrate, not domain content subject to persona discipline") and accepted it with this ADR as the formal ratification. The expansion does NOT touch LFE-SOURCE — it lives in the hook script's `FRAMEWORK_INFRA_PATHS` constant array.

### Considered Options

- **(α) Hook-internal hard-coded list, Categories I + II — chosen.** Persona-agnostic; lives in the hook script (`persona-path-lock.mjs`), not in `permissions.json`; preserves the 0-LFE-SOURCE-touches success criterion; self-documenting (anyone reading the hook sees the carve-out and its rationale via this ADR); tested via the per-persona × per-path-class fixture matrix (35 ALLOW cells: 5 personas × 7 carve-out paths).
- **(β) Edit `.agents/permissions.json` to add `.claude/**` + `pipeline_status.md` + `LLM_AGENT_GUIDE.md` to all personas — rejected.** Requires editing LFE-SOURCE, violating the 0-LFE-SOURCE-touches invariant and the [.gitattributes](../../.gitattributes) lock. Also misframes the architectural truth — these are not "things every persona is allowed to write because we forgot to list them" but "infrastructure layered beneath the persona model itself."
- **(γ) Project override field `lfeProjectOverrides.frameworkInfraPaths` in `.claude/settings.json` — rejected.** More flexible (project can extend the list without code change) but adds a new contract surface (the override field + its parser), increases the hook's input dependency count, and provides no benefit when the carve-out list is small and stable.
- **(δ) `LFE-FORCE` escape for every Archivist write to `pipeline_status.md` / `LLM_AGENT_GUIDE.md` — rejected.** Would generate a PROTOCOL_DEBT.md row per Archivist mission for routine end-of-mission cleanup. The point of LFE-FORCE is to record genuine emergencies, not to launder framework-internal coordination as bureaucratic debt.
- **(ε) Separate `.plans/persona_lock.md` state file outside `pipeline_status.md` — rejected for v1.**  Would let the hook read persona state from a file that's NOT in the carve-out, decoupling the Active Persona signal from the entrance card. Plausible but adds a new coordination file and a second source of truth for persona state; significant architectural complexity for what is currently a clean trade-off resolution.

### Consequences

- ✅ **Missions can complete without LFE-SOURCE touches.** This mission and all future integration missions ship hook artifacts to `.claude/**` without triggering deny or generating Protocol Debt.
- ✅ **Archivist phase end-of-mission updates succeed.** `pipeline_status.md` constraint additions, session bumps, persona transitions, and `LLM_AGENT_GUIDE.md §10` binding entries all flow through the carve-out.
- ✅ **Persona contract integrity preserved for project code.** `src/**` writes by Architect still deny; `.docs/architecture/**` writes by Builder still deny. The contract holds for project/domain content, where it's load-bearing.
- âš ï¸ **Category II weakens the lock against an adversarial agent.** A drifting agent could rewrite the Active Persona row to "Archivist" before performing a forbidden write — the hook would then check against Archivist's allow-list and proceed. Defense-in-depth mitigations remain in place (prose layer in PERSONAS.md, Inspector audit, Hygiene sweep, Cat D PostToolUse validation of `.plans/*.md` writes). Threat model qualification: the hook is a persona-discipline enforcer for confused/drifting agents acting in good faith, not a sandbox against an outright malicious agent (that's a Claude Code harness concern).
- âš ï¸ **Rule for extending the carve-out is "framework substrate, not domain content."** New paths qualify only if they are mechanical wiring (Category I) or substrate-of-locking (Category II). Future Hygiene sweep should audit `FRAMEWORK_INFRA_PATHS` for drift away from this principle.
- 🛡 **Test fixture matrix pins the carve-out membership.** The `constants` describe block in the test suite asserts the EXACT `FRAMEWORK_INFRA_PATHS` array. Removing a path would silently weaken the carve-out and break tests; adding an inappropriate path would require explicit test updates that prompt Inspector review.

### Reversibility

If a future LFE upstream release adds `.claude/**` or `pipeline_status.md` to permissions.json natively, this ADR can be partially or fully superseded — the carve-out shrinks to whatever paths LFE-SOURCE doesn't cover. The pattern (hook-internal carve-out as the "framework substrate" layer beneath persona-locking) stays valid even if the exact path-set changes.

---
## ADR 83: Zero-dep custom frontmatter parser (extends ADR 81 to parsers/utilities) (2026-05-16)

**Status:** Accepted
**Date:** 2026-05-16

The Cat D validators must parse `.plans/*.md` YAML frontmatter. ADR 81 established zero-dep Node ESM as the `.claude/` script runtime convention but did not explicitly speak to parsers and utility libraries — a gap a future contributor could read as "deps are fine if I want them." Cat D is the first integration unit with a "parse YAML" requirement; the grill surfaced the fork between custom and adding `js-yaml`. Decision: a zero-dep custom parser at `.claude/lib/parse-frontmatter.mjs`, scoped to the LFE coordination-file frontmatter schema in `COORDINATION_FILES.md` (single-line `key: value` pairs over a closed value space: enum strings, ISO-8601 timestamps, paths, integers, booleans, `null`). The API is Result-style — `parseFrontmatter(text) → { fields, error }` — no throws; `error` is `null` on success or `{ line, message }` on failure, with the message distinguishing *"no frontmatter block found"* from *"malformed inside `---`"* so the agent's self-correction is unambiguous. Lenient on quoted vs unquoted scalars (Postel's law applied to a controlled schema); the parser normalizes to unquoted in the returned `fields`. **Do NOT add `js-yaml`** to the project's dependencies for this purpose.

### Considered Options

- **(α) Zero-dep custom parser — chosen.** ~50 LOC; closed-schema scope; shared by base + 3 specialist Cat D validators (`validate-frontmatter.mjs`, `validate-plan-critique.mjs`, `validate-tdd-report.mjs`, `validate-slices.mjs`); mirrors the existing `.claude/lib/parse-entrance-card.mjs` precedent for hand-rolled this project-controlled formats.
- **(β) `js-yaml` runtime dep — rejected.** Bullet-proof against arbitrary YAML but buys nothing for the closed coordination-file schema; contradicts ADR 81's zero-dep precedent; this would be the **first** non-built-in runtime dep added by the integration program and the precedent is unjustified at this scope. Has historical CVEs (CVE-2013-4660 series) and ~200KB transitive weight. The Brain's mandatory `dep_audit: true` Inspector Override per `active_plan.md` would scrutinize this addition; pre-empting that round by not adding the dep is cleaner than landing → debating → removing.

### Consequences

- ✅ Preserves ADR 81's zero-runtime-dep precedent. First Cat-D-shaped feature does not break the convention.
- ✅ Establishes the broader pattern explicitly: the project's `.claude/` is **Node ESM, zero runtime deps preferred, hand-rolled parsers for closed schemas**. A new developer reads ADR 81 + ADR 83 and knows the convention top-to-bottom.
- ✅ Pattern consistency with `.claude/lib/parse-entrance-card.mjs` (already hand-rolled-controlled entrance-card markdown table).
- ✅ Two-class error discipline (`no_frontmatter` vs `malformed_inside`) makes the educational stderr actionable — the agent knows whether to write a frontmatter block from scratch or fix the existing one.
- âš ï¸ Custom parser maintenance: bounded (~50 LOC, closed scope). Schema changes require parser updates — same as js-yaml-consuming code would, so no net cost increase.
- âš ï¸ No protection against arbitrary YAML edge cases (anchors, aliases, multi-line scalars, comments): irrelevant — LFE-controlled inputs never include them and the schema explicitly excludes them.
- 🛡 Reversibility: if a future requirement legitimately needs arbitrary YAML (e.g., parsing a nested `## Inspector Overrides` block from inside the `active_plan.md` body), `js-yaml` can be added with a new ADR that supersedes this one *for that specific use*. The frontmatter-parsing convention stays.

---
## ADR 82: Cat D PostToolUse frontmatter validators are signal-strict, not block-strict (2026-05-16)

**Status:** Accepted
**Date:** 2026-05-16

The Cat D frontmatter validators were originally labeled "BS" (block-strict). PostToolUse fires *after* the Write tool has already committed the file to disk — it cannot pre-empt the write the way PreToolUse can pre-empt a tool call. The Cat D grill resolved the semantic precision and the design fork between *signal-only* (exit 2 + educational stderr; malformed file remains on disk; agent self-corrects on next action) and *rollback-on-violation* (validator additionally `fs.unlink`s the bad file). The decision is **signal-only**: the hook signals strongly, the existing four-layer defense-in-depth model (prose → harness signal → next-skill reader fail-fast → Hygiene long-drift) handles the rest. The terminology "block-strict" is understood per this ADR as **signal-strict** for any PostToolUse hook in this repository — including the three Cat D specialists and any future PostToolUse enforcement gate.

### Considered Options

- **(a) Signal-only — chosen.** Validator exits 2 with educational stderr; malformed file remains on disk transiently; the agent reads stderr as failure context and self-corrects on its next action.
- **(b) Rollback-on-violation — rejected.** Validator additionally deletes the malformed file. Adds two new failure modes (unlink errors, race conditions on concurrent writes that the framework's "parallelism scoped to one point" rule already prohibits) without preventing adversarial agents — a prompt-injected agent would simply write a different bad file. Mixes signaling and enforcement responsibilities at a layer that should remain simple. One-way escape preserved: if signal-only proves insufficient in practice, (b) is a one-slice retrofit.

### Consequences

- ✅ Simpler hook semantics: one operation (parse + exit), not two (parse + unlink + exit) with separate failure modes per file-system call.
- ✅ Aligns with the defense-in-depth model — each layer covers a distinct failure mode; signal-only is the load-bearing contribution of layer 2 (harness).
- ✅ Sets the project-wide convention for every PostToolUse hook (the Cat D base + 3 specialists; any future PostToolUse-based gate). Same scope as ADR 81's `.mjs` runtime decision.
- âš ï¸ Malformed file persists on disk transiently between the bad write and the agent's correction. Acceptable per the parallelism-scoped rule (no concurrent reader exists during that window in LFE flows; the next-skill reader runs only after the agent's next message).
- âš ï¸ The original "BS" vocabulary is slightly imprecise for PostToolUse; this ADR rectifies it.
- 🛡 An explicit TDD test pins the signal-only semantic: "malformed write → exit 2 + stderr matching `/Missing required field: <name>/` + file still exists on disk." Future contributors cannot accidentally retrofit rollback without breaking that test and writing a superseding ADR.

---
## ADR 81: `.claude/` script runtime: Node ESM (cross-platform over `.sh`) (2026-05-15)

- **Date:** 2026-05-15
- **Status:** Accepted

The Claude Code integration scripts (`.claude/hooks/session-start-reminder.mjs`, `.claude/statusline.mjs`) are implemented as Node ESM (`.mjs`) rather than bash (`.sh`). The Brain ratified the runtime choice at the grill phase, surfacing the cross-cutting convention.

### Considered Options

- **`.sh` (bash)** — the bash alternative. On Windows, `statusLine` and hook commands run "through Git Bash (if installed) or PowerShell" per the Claude Code docs. Git Bash presence is contributor-environment dependent; the test harness for `.sh` scripts must spawn child processes and assert stdout; native stdin JSON parsing requires `jq` (extra dependency) or grep hacks (fragile).
- **`.ps1` (PowerShell)** — Windows-native but does not run on macOS/Linux contributors without an additional `pwsh` install. Asymmetric cross-platform story.
- **`.mjs` (Node ESM)** — cross-platform via the existing `node` dependency already required by `npm install`; native `JSON.parse` for stdin; same `node --test` runner used by the SessionStart hook tests; identical module-shape convention (`main({stdinText, readFileText, env, cwd})` + CLI wrapper guarded by `invokedAsCli`) across every integration script.

### Decision

**`.mjs`.** The convention spans the SessionStart reminder, the Hygiene-due flag, and the statusLine, and pre-ratifies the later hooks (`persona-path-lock`, `skill-invocation-gate`, `plan-critique-gate`, and the Category D frontmatter validator cluster).

### Consequences

- Windows developers do not need Git Bash on PATH for Claude Code hooks or `statusLine` to function on this project.
- All `.claude/` scripts share one test harness (`node --test`), one stdin/stdout idiom (string args + DI-injected `readFileText` for unit tests), and one fallback discipline (try/catch + benign fallback string + `process.exit(0)` for the warn-and-log posture).
- Later hooks should follow the same convention. Any new `.sh` or `.ps1` script in `.claude/` requires a superseding ADR with a documented reason.
- The `.claude/skills/` mirror (see project-specific bindings in `LLM_AGENT_GUIDE.md §10`) remains shell-agnostic — those are SKILL.md markdown files, unaffected by this runtime choice. This ADR governs scripts in `.claude/` not under `skills/`.

---

**Framework log — preserved in full.** Every entry here is an Accepted decision documenting shipped machinery, so this file is excluded from the rolling-window archival that applies to the adopter's product log. See [`../quality/RETENTION_RUNBOOK.md`](../quality/RETENTION_RUNBOOK.md).