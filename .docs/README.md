# Documentation Floor Map (LFE)

> **LLM instruction:** Read this file immediately after `pipeline_status.md` (at repo root). It tells you which file answers which question. Do not open files speculatively — use this index to navigate directly to the relevant shelf.

## 🧱 Library-First Engineering at a glance

- **`.docs/` (The Library)**: the absolute Source of Truth — permanent, verified project knowledge.
- **`.plans/` (The Coordination Layer)**: short-term file-based handoffs between pipeline steps. Empty when no mission is in flight.
- **`pipeline_status.md` (repo root)**: the live entrance card for the active session.
- **`.agents/skills/`**: the 23 LFE skills the framework dispatches.
- See `LLM_AGENT_GUIDE.md` (repo root) for the canonical agent rules.

---

## How this library is organized

| Layer | File | Purpose |
|---|---|---|
| Entrance card | [`pipeline_status.md`](../pipeline_status.md) (repo root) | Current session state, active mission, coordination file tracker, session count. |
| User Manual | [`USER_MANUAL.md`](../USER_MANUAL.md) | The human guide: how to drive the framework day-to-day. |
| Agent Guide | [`LLM_AGENT_GUIDE.md`](../LLM_AGENT_GUIDE.md) | Core instructions for any AI entering this repo (skill catalog, coordination table, project bindings). |
| Adapter | [`CLAUDE.md`](../CLAUDE.md) | Claude Code adapter pointer stub — auto-loaded by Claude Code at session start. References `LLM_AGENT_GUIDE.md` as canonical. |
| System Prompt | [`.agents/adapters/system_prompt.txt`](../.agents/adapters/system_prompt.txt) | Raw Claude.ai chat adapter (copy-paste as first message when no Claude Code is available). |
| Floor map | **this file** | Navigation index. |
| Agent Core | [`.agents/skills/`](../.agents/skills/) | Home for the 23 LFE skills the framework dispatches (the persona skills, the 5 Inspector sub-skills, and `lfe-plan-critique`). |
| Eval Corpus | [`.agents/skills/_evals/`](../.agents/skills/_evals/) | Skill-accuracy eval fixtures + expected sidecars + shelf index — the corpus `/lfe-skill-eval` grades. |
| Domain Language | [`CONTEXT.md`](../CONTEXT.md) (repo root) | Canonical glossary — populated by `/lfe-extract-domain`. Intentionally absent on a fresh clone. |
| Domain SSOT | [`domain/`](./domain/README.md) | Math + business rules + detailed glossary. Ships with a Shelf Index only; populated Day-0 by `/lfe-extract-domain` + `/lfe-grill-with-docs`. |
| Coordination | [`.plans/`](../.plans/) | Transaction log for pipeline steps. |
| Contributing | [`CONTRIBUTING.md`](../CONTRIBUTING.md) | How to contribute under the LFE workflow. |
| License | [`LICENSE`](../LICENSE) | MIT license. |
| Root Readme | [`README.md`](../README.md) | High-level project overview and getting-started guide. |
| Narrative context | [`MEDIUM ARTICLE.md`](<../MEDIUM ARTICLE.md>) (repo root) | Long-form essay on *why* the framework exists — the trust-bottleneck argument. Context for human readers and any agent auditing the repo; cloners may delete it when adapting the template. |

---

## Coordination Layer (`.plans/`)

The pipeline uses file-based coordination. Each skill writes output to `.plans/`, and the next skill reads it as input. The full schema and registry live in [`COORDINATION_FILES.md`](./protocol/COORDINATION_FILES.md).

| File | Written by | Read by |
|---|---|---|
| `01_grill_summary.md` | `/lfe-grill-with-docs` | `/lfe-to-prd` |
| `02_prd.md` | `/lfe-to-prd` | `/lfe-to-issues` |
| `03_slices.md` | `/lfe-to-issues` | `/lfe-architect` |
| `active_plan.md` | `/lfe-architect` | `/lfe-plan-critique`, `/lfe-builder`, `/lfe-tdd` |
| `plan_critique.md` | `/lfe-plan-critique` | Brain / `/lfe-builder` (auto-gate) |
| `builder_done.md` | `/lfe-builder` | `/lfe-tdd` (resume marker) |
| `tdd_report.md` | `/lfe-tdd` | `/lfe-inspector` |
| `.plans/checks/*.md` | Inspector sub-skills | `/lfe-inspector` (aggregates) |
| `critique.md` | `/lfe-inspector` (4-Eyes + aggregation) | `/lfe-inspector` (self) |
| `inspection_report.md` | `/lfe-inspector` | `/lfe-archivist` |
| `diagnosis_report.md` | `/lfe-diagnose` (conditional) | `/lfe-builder` (next iteration) |
| `hygiene_report.md` | `/lfe-hygiene` (every 5 sessions) | `/lfe-improve-architecture` |

---

## Protocol (`protocol/`)

| File | Answers the question… |
|---|---|
| [`ASSEMBLY_LINE.md`](./protocol/ASSEMBLY_LINE.md) | How do agents hand off work? (sub-pipelines + coordination layer) |
| [`COORDINATION_FILES.md`](./protocol/COORDINATION_FILES.md) | What is the frontmatter schema and registry for `.plans/` files? |
| [`GOVERNANCE.md`](./protocol/GOVERNANCE.md) | What are the rules for Logic Sovereignty, Domain Language, retention policy? |
| [`PERSONAS.md`](./protocol/PERSONAS.md) | Persona index — links to individual contracts. |
| [`personas/`](./protocol/personas/README.md) | Individual persona contracts (one file per role). |
| [`INDUSTRY_STANDARDS.md`](./protocol/INDUSTRY_STANDARDS.md) | What optional CI/CD enhancements are available? |
| [`LOOP_ARCHITECTURE.md`](./protocol/LOOP_ARCHITECTURE.md) | How does the framework mechanically handle loops, crashes, and overrides? |
| [`SHELF_INDEX_TEMPLATE.md`](./protocol/SHELF_INDEX_TEMPLATE.md) | Standardized template for local directory indexes. |
| [`README.md`](./protocol/README.md) | **Shelf Index**: Local navigation for the protocol layer. |

---

## Architecture (`architecture/`)

| File | Answers the question… |
|---|---|
| [`architecture-decisions.md`](./architecture/architecture-decisions.md) | **Your product's** architecture decisions. Empty on a fresh clone — your first decision is ADR 1. |
| [`framework-decisions.md`](./architecture/framework-decisions.md) | The **framework's own** decisions (ADRs 81+, frozen). The "why" behind the hooks, statusLine, enforcement gates, eval harness, and the skill-mirror; where the inline `(ADR N)` citations resolve. |
| [`README.md`](./architecture/README.md) | **Shelf Index**: Local navigation for the architecture layer. |

---

## Quality (`quality/`)

| File | Answers the question… |
|---|---|
| [`CHANGELOG.md`](./quality/CHANGELOG.md) | What changed recently? (7-milestone rolling window) |
| [`known-issues.md`](./quality/known-issues.md) | What open bugs / technical debt / refactor candidates exist? |
| [`PROTOCOL_DEBT.md`](./quality/PROTOCOL_DEBT.md) | What LFE-FORCE protocol bypasses need to be resolved? |
| [`skill-eval-scorecard.md`](./quality/skill-eval-scorecard.md) | What is each reasoning skill's measured catch-rate / false-positive rate? |
| [`inspector-config.md`](./quality/inspector-config.md) | Which Inspector specialist sub-skills are enabled for this project? |
| [`RETENTION_RUNBOOK.md`](./quality/RETENTION_RUNBOOK.md) | How to run a Hygiene retention sweep against the retention-managed files. |
| [`README.md`](./quality/README.md) | **Shelf Index**: Local navigation for the quality layer. |

> **Note:** The pipeline cursor `pipeline_status.md` lives at the **repo root**, not here.

---

## Strategy (`strategy/`)

| File | Answers the question… |
|---|---|
| [`README.md`](./strategy/README.md) | **Shelf Index**: your product's roadmaps + goals. Empty scaffold on a fresh clone — populate it as your product's strategy takes shape. |

---

## Archive (`archive/`)

> **Rule:** Everything in `archive/` is historical (cold tier). Empty on a fresh clone; the Hygiene sweep (every 5 sessions) populates it as retention windows overflow. See [`archive/README.md`](./archive/README.md).

---

*Maintained by the Archivist role. Update this file whenever a new doc is created or a file is moved/archived. The retention-policy sweep (every 5 sessions) walks the cold tier.*