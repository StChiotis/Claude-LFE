# LFE Industry Standards (Optional Enhancements)

The core LFE framework relies on local AI personas (Builder, Inspector) to maintain discipline. However, as projects scale or when working in team environments, enforcing these rules solely through LLM system prompts can fall short.

This document lists **industry-standard enhancements** that you can implement in your repository to enforce the LFE protocol automatically. 

> [!NOTE]
> **Why are these optional?**
> For solo founders or rapid prototypes, these configurations can introduce unnecessary overhead. Adopt these standards only when the project reaches a maturity level that requires strict, platform-level governance.

---

## 1. Automated Cloud Inspector (CI/CD)

Relying entirely on a local "Builder" agent to run tests can be risky if the agent hallucinates a passing result or skips the step.
- **Reference Standard**: GitHub Actions / GitLab CI pipelines.
- **Implementation**: Create a workflow (e.g., `.github/workflows/ci.yml`) that automatically runs your test suite and linting tools on every Pull Request.
- **LFE Benefit**: Acts as an incorruptible "Cloud Inspector" that verifies the work before it merges into the main branch.

## 2. Repository Governance Templates

Ensure that both humans and AI agents follow the LFE assembly line when submitting code or raising issues.
- **Reference Standard**: Issue and PR Templates.
- **Implementation**: Add `.github/PULL_REQUEST_TEMPLATE.md` with checklists confirming that:
  - An `.plans/active_plan.md` was followed.
  - `.plans/plan_critique.md` reached `verdict: PASS` (or `WARN` with a non-null `brain_confirmation`) before any `src/` edits.
  - Inspector phase produced a passing or explicitly-triaged `inspection_report.md`.
  - Unit tests have been written and run successfully.
  - The Archivist has updated `CHANGELOG.md` and relevant ADRs.
- **LFE Benefit**: Forces contributors (and AI agents auto-generating PR descriptions) to explicitly acknowledge LFE compliance — including the pre-build critique gate.

## 3. Zero-Trust Benchmark via CODEOWNERS

The LFE benchmark establishes a "Zero-Trust" rule for core logic. Platform-level enforcement is highly recommended for production systems.
- **Reference Standard**: GitHub `CODEOWNERS` file.
- **Implementation**: Create a `.github/CODEOWNERS` file mandating human review for changes to:
  - The designated "Engine" modules (Logic Sovereignty).
  - `.docs/` (Truth Home).
- **LFE Benefit**: Prevents AI agents from autonomously pushing unauthorized changes to the project's most critical paths.

## 4. Local Pre-commit Hooks

Catching errors before the CI pipeline runs saves time and prevents malformed code from entering the repository history.
- **Reference Standard**: Husky, `pre-commit`, or Lefthook.
- **Implementation**: Configure local git hooks to enforce automated formatting and run unit tests on changed files before allowing a commit.
- **LFE Benefit**: Assists the Builder persona by automatically enforcing formatting rules.

## 5. Automated Secret Scanning

AI agents can occasionally hallucinate or copy-paste sensitive credentials (API keys, tokens) into the source code.
- **Reference Standard**: GitHub Advanced Security, TruffleHog, or GitLeaks.
- **Implementation**: Enable repository-level secret scanning or include a scanning job in your CI pipeline.
- **LFE Benefit**: Adds a crucial safety net during the Builder phase.

## 6. Runtime Persona Enforcement (Physical Tool-Locking)

LFE ships with runtime persona path-locking that operates by default inside Claude Code, with an optional CI/CD layer available for team / multi-runtime deployments:
- **Layer 1 — PreToolUse hook**: `.claude/hooks/persona-path-lock.mjs` reads `.agents/permissions.json` on every `Write`/`Edit` and denies cross-persona writes at the source. E.g., when the Architect is the active persona, `Write` on paths under `src/` is refused at the source — the hook denies the write before it reaches disk.
- **Layer 2 (optional, team-scale) — CI/CD enforcement**: a GitHub Action or equivalent CI pipeline can read the same `.agents/permissions.json` manifest and reject PRs whose diffs violate persona constraints. Recommended pattern for repositories with multiple agent runtimes or non-Claude-Code editing surfaces.
- **LFE Benefit**: The default hook promotes LFE from an "Honor System" to "Mechanically Enforced" without any adopter setup. The optional CI/CD layer extends the same enforcement contract to the PR-review pipeline.

### 6.1 Enforcement-Gate Family (Enforcement Hardening — ADR 95)

The path-lock (Layer 1 above) is one member of a broader **enforcement-gate family** that closes the structural gaps a momentum-optimizing agent can otherwise walk through (it can drift off-pipeline without ever breaking a single rule, because the rules sat outside the path of what it did). All ship **warn-and-log first** (promotable per-gate via `.claude/enforcement-posture.json`), all with an asymmetric fail-safe ALLOW:

- **C1 — terminal git posture** (`bash-posture-gate.mjs`): gates mutating git in two tiers — ordinary mutating git needs an active mission; merge/push-to-`main`/force/legal-anchor-tag additionally needs a typed `MERGE-OK` confirmation. Closes the unguarded-terminal hole.
- **C2a — boot-precondition** (`boot-precondition-gate.mjs`): no substantive Write/Edit until `/lfe-boot` ran this session (two-file session-id handshake).
- **C2b — scout-boundary** (extends `skill-invocation-gate.mjs`): `/lfe-scout` allowed only at a clean session boundary, refused mid-mission.
- **C3 — persona-transition** (`persona-transition-guard.mjs`): the Active-Persona *value* changes only when an official skill-dispatched step drops a marker — the agent can no longer free-hand its own role.
- **C4 — no-mission** (`no-mission-gate.mjs`): no substantive change at a completed/idle slate with no coordination trail.
- **mission-aware path-lock** (`persona-path-lock.mjs`): an in-flight mission's `Authorized Scope` entrance-card row extends the authorized write scope (e.g. a sanctioned second repo).

**`Write|Edit` decision order:** boot-precondition → no-mission → persona-transition → persona-path. **Honest ceiling:** this is speed-bumps + loudness, not containment — the harness sandbox is the real boundary; the gates make the cooperative path easiest and drift loud. Promotion to hard-block is per-gate, manual, and human-reviewed against the telemetry log.
