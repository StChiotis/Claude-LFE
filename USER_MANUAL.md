# LFE User Manual: The Human Guide

Welcome to Library-First Engineering (LFE). This document is written for **you**—the human developer.

While the rest of the `.docs/` directory is primarily written as strict protocol instructions for your AI agents, this manual strips away the theory and explains exactly how you operate this framework day-to-day.

Think of LFE like a car. The AI agents are the engine. The `.docs/` directory is the GPS. **You are the driver.** If you don't steer, the car doesn't move. If you override the GPS, the car gets lost.

---

## Installation & Setup

Before your first session, enable the framework on your clone — a one-time setup. Standalone configuration is canonical: no plugin flag and no marketplace install are involved.

1. **Clone the repo.** The clone already includes everything the framework needs: `.claude/`, `.agents/`, `.githooks/`, `scripts/`, and `package.json`.
2. **Run `npm install`.** Alongside dependencies, this runs the `postinstall` step (`scripts/setup-git-hooks.mjs`), which points git at the repo's hooks (`git config core.hooksPath .githooks`) so the pre-commit drift-guard is active.
3. **Reload your AI tool** (Claude Code) in the cloned directory so it loads `.claude/`.
4. **Confirm it's live.** `/lfe-boot` resolves; the LFE skills dispatch as `/lfe-*`; the configured hooks fire on their events; and the status line shows your Active Persona, Mission State, Pipeline Phase, and Session Count.

The active hooks and the events they fire on are declared in `.claude/settings.json`; the protocol behind each lives in `.docs/protocol/`. Standalone-canonical configuration is the recorded posture — the repo ships without a `.claude-plugin/` directory and needs none.

---

## 0. How You Interact with LFE (Read This First)

**You describe intent in natural language. The AI translates intent into the right skill sequence.** You do not need to memorize skill names.

The framework's guarantees — crash recovery, no documentation drift, repeatable quality — depend on each skill running in the right order with the right inputs. So the design is: **the AI invokes skills; you give intent and approve at gates.**

**The five commands you ever type yourself:**

| Command | When to type it |
|---|---|
| `/lfe-boot` | At the start of every session. Always. |
| `/lfe-whats-next` | If you're not sure where you are or what comes next. |
| `/lfe-scout` | When the AI asks at the Complexity Gate and you have a minor fix. |
| `/lfe-extract-domain` | To restart Day 0 discovery on a Blank Canvas. |
| `LFE-FORCE` | Emergency hotfix keyword. |

For everything else, **talk to the AI**: *"build feature X"*, *"fix this typo"*, *"review the security of this change"*. The AI knows which skill to run based on the active persona and the pipeline state.

The Skill Glossary at the bottom of this manual is a **reference for what the AI is doing on your behalf** — not a menu for you to invoke. If you try to bypass the assembly line by typing a skill name out of sequence (e.g., `/lfe-builder` before approving a plan), the AI is instructed to refuse and route you back through the pipeline. That refusal is the framework working as designed — it's how LFE prevents you from accidentally corrupting your own pipeline state.

---

## 1. Day 0: Starting a New Project

If your `CONTEXT.md` is empty or missing, you are on Day 0 — proceed with the steps below. If you ever need to restart domain discovery (e.g. introducing a new bounded context), run `/lfe-extract-domain`.

If you have just cloned this repo and the AI says the Mission State is `[BLANK CANVAS]`, follow the Day 0 protocol:

1. **Open your AI chat:**
   - **In Claude Code**: `CLAUDE.md` is auto-loaded as the adapter — proceed directly.
   - **In a raw Claude.ai chat (no Claude Code)**: paste the content of [`.agents/adapters/system_prompt.txt`](.agents/adapters/system_prompt.txt) as your first message.
2. **Type the command:** `/lfe-boot`
3. **The AI will detect the Blank Canvas** and immediately trigger the `/lfe-extract-domain` skill.
4. **The Interview:** The AI will ask you questions about your app (What does it do? Who are the users? What are the core rules?).
5. **The Result:** The AI will populate your `CONTEXT.md` and `.docs/domain/domain-knowledge.md` files. Your repository is now initialized.

---

## 2. The Daily Workflow (End-to-End)
For every new feature, refactor, or major change, you will follow this exact loop. **Rule of thumb: One feature per session.**

### Step 1: Start the Engine
At the beginning of your session, open your AI chat and type:
> `/lfe-boot`

The AI will read `pipeline_status.md` and tell you exactly where you are.

### Step 2: The Complexity Gate
The AI will ask you: *"Is this a Major Architectural Change or a Minor Fix?"*
- **If it's a new feature or complex logic:** Answer "Major Change." The AI will start the Full Assembly Line.
- **If it's a typo, UI tweak, or simple bug:** Answer "Minor Fix" and tell the AI to run `/lfe-scout`. (See *Bypass Routes* below).

### Step 3: The Assembly Line (Major Changes)
If you are doing a Major Change, the AI will cycle through four distinct "Personas." You don't have to memorize the prompts, but you **must** know when to say "Yes."

#### 🏛️ Phase 1: The Architect (Planning)
1. **The Grill (`/lfe-grill-with-docs`):** You tell the AI what you want to build. The Architect will cross-reference your request against the existing docs and ask you probing questions to resolve any ambiguity.
2. **The PRD (`/lfe-to-prd`):** The AI synthesizes your conversation into a Product Requirements Document.
3. **The Breakdown (`/lfe-to-issues`):** The AI breaks the PRD into "Vertical Slices" (independently testable chunks of work).
   - 🛑 **HUMAN ACTION REQUIRED:** The AI will stop and ask you: *"Do you approve these slices?"* Read them. If they look good, say "Yes."
4. **The Plan (`/lfe-architect`):** The AI drafts a strict, file-by-file blueprint for the first slice.
   - 🛑 **HUMAN ACTION REQUIRED:** The AI will stop again. *"Do you approve this implementation plan?"* Read it carefully. If it is correct, say "Yes, proceed to Builder."
5. **The Pre-Build Critique (`/lfe-plan-critique`):** Before any code is written, the Architect runs a 5-lens review of the approved plan — checking that every acceptance criterion is testable, the test strategy is feasible, the plan respects domain boundaries, there is no architectural drift, and the edits leave the surrounding text coherent (no dangling references). A mechanical **plan-linter** also runs, flagging glob-count mismatches, fragile line-count assertions, and PowerShell existence-check antipatterns so the human lenses reason over verified facts. The output is `.plans/plan_critique.md` with a verdict:
   - **PASS** — proceed to Builder automatically.
   - **WARN** — findings are advisory; the AI surfaces them and asks you to confirm before continuing. When you confirm, the AI writes a timestamp into the file's frontmatter (`brain_confirmation`) — that's the file-based signal the Builder reads, not your conversational "yes". If the session crashes between you saying "yes" and the file write, you'll be asked again — by design, because the file is the truth.
   - **BLOCK** — the plan loops back to step 4 for revision. *Max 2 revisions per slice* — the counter lives in the file's frontmatter (`revision`), so the limit survives crashes. If it still fails on the 2nd attempt, the AI asks you to choose: revert to the PRD, accept WARN, or abort the mission.

#### 🔨 Phase 2: The Builder (Coding)
1. **Implementation (`/lfe-builder`):** The Builder persona takes over and writes the actual code in `src/` based *only* on the approved plan.
2. **Testing (`/lfe-tdd`):** The Builder writes unit tests and ensures the code passes.

#### 🕵️ Phase 3: The Inspector (Verification)
1. **Verification (`/lfe-inspector`):** A new persona takes over. It acts as an independent auditor, checking the Builder's code against your core domain rules.
2. **Cycle Guard:** Before inspecting, the AI checks whether this slice has already failed once. If yes, instead of looping forever, it stops on the second failure and asks you to triage: (A) accept as known debt, (B) escalate `LFE-FORCE`, or (C) re-plan the slice from scratch.
3. **Specialist Sub-Skills (opt-in):** If you have enabled them in `.docs/quality/inspector-config.md`, the Inspector also dispatches specialist passes — security (OWASP Top-10), performance, complexity, dependency audit, and mutation reasoning. Each writes findings to `.plans/checks/`, then the Inspector aggregates everything into `critique.md`.
4. **The 4-Eyes Principle (The Critique):** Before approving the code, the Inspector is forced to write a `.plans/critique.md` file. It must act as a "Devil's Advocate" to actively hunt for edge cases, performance regressions, or undocumented debt. If it finds a bug (and this is the **first** failure), it sends it back to the Builder via `/lfe-diagnose`.
5. **Handoff:** If it passes the 4-Eyes check, it asks for your final blessing.
   - 🛑 **HUMAN ACTION REQUIRED:** Verify the app works visually/functionally. Say "Approved, proceed to Archivist."

#### 📚 Phase 4: The Archivist (Cleanup)
1. **Documentation Sync (`/lfe-archivist`):** The AI updates your `CHANGELOG.md`, `README.md`, and any architecture files so the docs perfectly match the new code.
2. **Loop or Close:** If there are more slices, it loops back to the Architect. If the feature is done, it deletes the temporary planning files and closes the session.

---

## 3. Bypass Routes & Emergencies
You don't need a 4-step pipeline to change a button color.

### The Scout (`/lfe-scout`)
Use this for **Minor Fixes** (typos, UI tweaks, simple bugs touching < 3 files).
- **How:** Boot the session, declare a "Minor Fix", and tell the AI: *"Run `/lfe-scout` to fix the padding on the login button."*
- **Constraint:** The Scout is physically forbidden from renaming files, changing architecture, or adding dependencies.

### The Break-Glass Override (`LFE-FORCE`)
Use this for **Production Emergencies** (e.g., the server is down, you need a patch *right now*).
- **How:** Tell the AI: *"LFE-FORCE: Fix the database connection string immediately."*
- **The Catch:** The AI will do it immediately, but it will log "Protocol Debt." Your very next session *must* be an Archivist/Inspector session to properly document what you just hotfixed.

---

## 4. Session Crashes (Interrupted Sessions)
If your IDE crashes, or you run out of tokens in the middle of a pipeline, **do not panic.**
LFE uses "File-Based Coordination." Everything the AI thought about was saved to the `.plans/` directory.

**To Recover:**
1. Open a new chat window.
2. Run `/lfe-boot`.
3. The AI will scan the `.plans/` folder, realize you crashed halfway through, and say: *"Interrupted session detected. Resume from Builder? "*
4. Say "Yes." It will read the files and continue as if nothing happened.

---

## 5. Scaling: Team & Production Features
LFE's runtime persona enforcement (§5.2 below) is on by default. For team scale-out, you can also turn on the additional layers documented in this section.

### GitHub Actions (CI/CD Enforcement)
If you are working with a team, you can enforce LFE rules in the cloud.
- **How:** Set up a GitHub Action that reads `pipeline_status.md`. If someone opens a Pull Request claiming to be the "Architect", but the PR contains edits to source code (`src/`), the Action automatically rejects the PR. (See `.docs/protocol/INDUSTRY_STANDARDS.md`).

### Runtime Persona Enforcement (Default-On)
Out of the box in Claude Code, LFE's `persona-path-lock` PreToolUse hook (`.claude/hooks/persona-path-lock.mjs`) reads `.agents/permissions.json` and physically denies cross-persona writes — e.g., if the active persona is "Architect", `Write` and `Edit` are refused on paths under `src/`. This ships active in this scaffold; no adopter setup required. For team / multi-runtime deployments, the GitHub Actions story above is the canonical scale-out layer reading the same `.agents/permissions.json` manifest.

---

## 6. The Skill Glossary (Reference Only)
This is a **reference for what the AI does on your behalf** during the Assembly Line — not a menu for you to invoke. Section 0 lists the five commands you ever type yourself; everything below is dispatched by the framework. If you try to call an agent-only skill out of sequence, the AI is instructed to refuse and route you back through the pipeline.

### 🧭 Navigation & Utility
| Command | Purpose |
|---|---|
| `/lfe-boot` | **Always start here.** Bootstraps the session, reads `pipeline_status.md`, and detects crashes. |
| `/lfe-whats-next` | Type this if the AI gets confused. It acts as a compass to re-orient the agent to the current pipeline phase. |
| `/lfe-extract-domain` | Used on Day 0 to interview you and extract business rules into `domain-knowledge.md`. |
| `/lfe-scout` | Flyweight mode. Used to bypass the strict assembly line for minor UI tweaks or typos (max 3 files). |

### 🏛️ Phase 1: The Architect (Planning)
| Command | Purpose |
|---|---|
| `/lfe-grill-with-docs` | A deep interview where the AI challenges your ideas against existing domain knowledge. |
| `/lfe-to-prd` | Synthesizes the interview into a formal Product Requirements Document. |
| `/lfe-to-issues` | Breaks the PRD into "Vertical Slices" for you to approve. |
| `/lfe-architect` | Drafts the strict file-by-file implementation plan. |

### 🔨 Phase 2: The Builder (Coding)
| Command | Purpose |
|---|---|
| `/lfe-builder` | Executes the approved plan, modifying `src/` code. |
| `/lfe-tdd` | Runs a Red-Green-Refactor quality pass and writes tests. |

### 🕵️ Phase 3: The Inspector (Verification)
| Command | Purpose |
|---|---|
| `/lfe-zoom-out` | Instructs the AI to map out unfamiliar codebase areas before touching anything. |
| `/lfe-inspector` | Verifies the code against domain truth and writes a Devil's Advocate critique. |
| `/lfe-diagnose` | A disciplined bug-diagnosis loop used only if verification fails. |

### 📚 Phase 4 & 5: Archiving & Maintenance
| Command | Purpose |
|---|---|
| `/lfe-archivist` | Syncs documentation, updates `CHANGELOG.md`, and cleans up `.plans/`. |
| `/lfe-hygiene` | Scheduled every 5 sessions. Audits the repo for missing indexes or bloated files. |
| `/lfe-improve-architecture` | Looks for "deepening" opportunities to refactor messy code into clean abstractions. |

---

## 7. The Honest Ceiling: Speed-Bumps, Not Containment

LFE's enforcement layer — the persona path-lock plus the enforcement gates (terminal-git posture, boot-precondition, scout-boundary, persona-transition, no-mission, and mission-aware path-lock) — makes off-pipeline drift **expensive, visible, and logged**. It does **not** make it impossible, and you should not trust it as a sandbox.

**Why:** an AI agent with shell access can `git` anything, write files through the terminal, or edit the hooks themselves. True containment requires harness-level tool sandboxing, which is outside LFE's reach. The gates are **speed-bumps + loudness** — they put the rules in the path of the actions that matter and record every warning to a local log, so the cooperative path is the easiest path and drift is loud rather than silent.

**What this means for you (the driver):**
- The gates ship in **warn-and-log** mode: they surface a warning and record it but allow the action — so a misfiring gate can never brick your own recovery. You promote a gate to hard-block **deliberately, per-gate**, after reviewing the log (edit `.claude/enforcement-posture.json`).
- Aliasing, direct filesystem writes, and editing the hooks bypass the gates **by design**. That's accepted — the gate's job is to make the *honest* path frictionless and the *drifting* path noisy, not to win an adversarial fight it structurally cannot.
- The real boundary is the harness. For team / production hardening, layer the optional CI/CD enforcement (§5) on top.

*(Architecture rationale: ADR 95 — the enforcement doctrine, born from a real consumer session where an agent committed + merged to `main` + ran a legal-tag mission entirely off-pipeline while the full hook layer was active.)*

---

## Evidence Discipline (Trust, Verified)

LFE personas back their "done" with proof rather than optimism. The rule — shared across the Builder, the TDD pass, and the Inspector — is simple: **a completion claim is only as good as the fresh tool output that backs it.**

- **Show the receipt.** "Tests pass" means the agent pastes the actual pass/fail counts from the run it just did; "no regression" means it shows the counts held or rose. A claim from memory does not count.
- **Route by confidence.** High (a tool just verified it) → state it plainly. Medium (inferred) → state it *with* the caveat that it's inferred. Low (recalled from training) → verify first, then state.
- **Catch hallucinations early.** A short checklist makes the agent pause and verify the moment it notices a tell: referencing a file it never opened this session, quoting a number with no source, contradicting the latest tool output, or assuming a dependency exists.

**Why it matters:** this is the framework's "No Blind Trust" principle — once the Inspector's alone — generalized to every persona that makes a claim, so confident-but-unverified "it works" surfaces less often and you spend less time hand-checking. It is pure agent-instruction guidance (no new tooling); the directive-voice census keeps the wording in the framework's positive voice, and the clause is written inline in each carrying contract and skill.

---

## The Skill-Accuracy Harness (Measurement Layer)

LFE leans on five prompt-based reasoning skills — the four Inspector specialist checks (security, performance, complexity, mutation) and the Architect's plan-critique. These five are singled out because they're the only skills with a *catch-or-miss* verdict you can score — the framework's other ~18 skills run the workflow or produce plans and docs, where there's no planted defect to catch. The skill-accuracy harness measures how reliably they do their job: it runs each skill's exact prompt against a corpus of fixtures that carry a **planted defect** (plus known-good controls), repeats each run *k* times, and reports a **catch-rate**, a **false-positive rate** (from the clean controls), and a **saturation** flag (when the corpus has gone too easy to discriminate) into a scorecard.

**How to run it.** The harness rides the Hygiene sub-pipeline on a longer cadence than the 5-session sweep — **every 3rd sweep (≈ 15 sessions)**, because a full run is token-heavy — or **on demand** (the primary path): describe the intent ("measure the reasoning skills") and the AI runs `/lfe-skill-eval`. Results land in two places: the human-readable scorecard at [`.docs/quality/skill-eval-scorecard.md`](.docs/quality/skill-eval-scorecard.md) and a machine-readable record at `.claude/lib/__eval__/results.json` that the pre-commit gate reads. The scorecard ships in an honest initial state (no run yet) until you run it.

**The first-prompt-edit warning (expect this).** A pre-commit gate guards against silently shipping a prompt edit that lowers a skill's catch-rate: when you stage an edit to one of the five reasoning-skill prompts, the gate looks for a fresh passing eval whose recorded hash matches the prompt's new content. On a fresh clone the results record ships empty, so the **first** time you edit one of those prompts the gate prints a warn-and-log advisory pointing you to `/lfe-skill-eval`. This is expected, designed behavior — it is **advisory by default** (the commit still goes through) and becomes a hard block only when you promote it via `.claude/enforcement-posture.json`. Run `/lfe-skill-eval` to record a passing baseline; afterward, only an *unproven* prompt edit trips the warning.

---

## Where LFE Actually Runs (and What Costs Tokens)

It's easy to assume an LFE session runs end-to-end on Claude's side. It doesn't —
the work is split across two machines:

- **The model runs on Anthropic's servers** — always, whatever your device. This
  is the *reasoning*: the agent's decisions, plus the five reasoning skills and
  `/lfe-skill-eval` when they analyze.
- **Everything else runs on your local CPU** (or the cloud container, if you drive
  LFE from the web): the shell, the enforcement hooks, the git pre-commit gates,
  the full test suite, the linters, git, and every file edit.

Two consequences follow from that split:

- **Speed** depends on where the *local* parts run — your CPU, disk, and network
  latency versus the cloud container's hardware.
- **Token cost** depends only on whether the *model* is invoked — and the model is
  always remote, so running LFE "locally" never makes a model call free.

### Runs on your CPU — deterministic, zero tokens

| What | Why it's free |
|---|---|
| `npm test` (the full suite) | plain `node --test` — no model involved |
| The enforcement hooks (path-lock, validators, checkpoint-flip, …) | Node scripts |
| The git **pre-commit gates** (mirror-drift + skill-eval freshness) | a sync check plus a pure hash-compare — no LLM runs at commit time |
| `plan-linter` and `voice-census` | deterministic scans |
| The skill-eval **grader** | deterministic scoring of recorded outputs |
| git, npm, file reads/writes | shell + disk |

### Runs on the model — costs tokens

| What | Why it bills |
|---|---|
| The agent itself (every reasoning + tool-planning step) | LLM calls |
| The five reasoning skills when they analyze (security / perf / complexity / mutation / plan-critique) | each is a *prompt* the model executes |
| **`/lfe-skill-eval`** | runs those prompts in **~75 isolated subagent calls** (k × fixtures) — the one harness that is genuinely token-heavy, which is why it self-gates to ~every 15 sessions |

**Rule of thumb:** the local half — tests, hooks, the pre-commit gates, linters,
git — is free to run as often as you like; the model half (the agent's reasoning
and the skill-accuracy eval) is where tokens go. Where a step physically runs
changes the *speed*, not the *bill*. Note that the only token-spending part of the
eval story is `/lfe-skill-eval` itself — the pre-commit gate that protects it just
reads the recorded result (a hash compare), so it stays free.

---

## Editing the Framework's Skills

Most adopters never need to edit a skill — see [`CONTRIBUTING.md`](CONTRIBUTING.md), where skill protocol is LFE-SOURCE and changes are proposed upstream rather than patched into a fork. If you do customize skills (as the maintainer or an upstream contributor), edit the source and let the mirror regenerate:

- **Edit `.agents/skills/<name>/SKILL.md`** — the LFE-SOURCE. The `.claude/skills/` copy is a generated mirror; treat it as read-only.
- **Regenerate the mirror:** `npm run sync:lfe-skills`.
- **Stage both sides and commit:** `git add .agents/ .claude/`, then `git commit`. The pre-commit drift-guard confirms the mirror matches its source.

If a skill was removed at the source, run `node scripts/sync-claude-skills.mjs --clean` to drop it from the mirror as well.

---

## Troubleshooting

**`/lfe-boot` resolves but the git hooks don't run** — usually the `postinstall` step was skipped (e.g. `npm ci` with lifecycle scripts suppressed). Run it directly: `node scripts/setup-git-hooks.mjs` (safe to re-run anytime).

**`git config core.hooksPath` returns a value other than `.githooks`** — usually the clone shares a worktree with another repo that set its own hooks path. Point it back: `git config core.hooksPath .githooks`, or re-run `node scripts/setup-git-hooks.mjs`.

**A commit is rejected for skill-mirror drift** — usually an upstream change landed without a re-sync. Regenerate and re-stage: `npm run sync:lfe-skills`, then `git add .claude/`, then retry the commit.

---

## Summary Cheat Sheet
- **Always start with:** `/lfe-boot`
- **If you get lost:** `/lfe-whats-next`
- **For big features:** Answer "Major Change" and approve the Architect's plans.
- **For tiny tweaks:** Run `/lfe-scout`
- **For emergencies:** Say `LFE-FORCE`
- **Never:** Let the AI write code without an approved plan.
