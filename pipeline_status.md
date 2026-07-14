# 🏛️ LFE Mission Control (Entrance Card)

> Bounded by the **Entrance-card contract** (GOVERNANCE § Retention Policy; **ADR 103**): current state only · ≤ 12,000 chars · ≤ 3 Recent Missions pointers · mission history lives in the CHANGELOG lane, never here.

| Category | Status / Value |
| :--- | :--- |
| **Integrity Score** | 🟢 [Integrity: 100%] |
| **Mission State** | [BLANK CANVAS] — fresh scaffold; no product domain loaded yet. |
| **Active Persona** | Architect |
| **Active Mission** | *(none — blank-canvas starter)*. Run `/lfe-boot`, then `/lfe-extract-domain`, to load your product domain and start delivering. |
| **Pipeline Phase** | Day 0 — awaiting `/lfe-extract-domain` (no mission in flight) |
| **Coordination Files** | 01 ⬜  02 ⬜  03 ⬜  plan ⬜  plan_critique ⬜  build ⬜  tdd ⬜  critique ⬜  inspect ⬜  *(clean)* |
| **Session Count** | 0 |
| **Last Architecture Sweep** | none yet (fresh starter) |
| **Authorized Scope** | (none) |

## 📜 Recent Missions (max 3 — full history: [.docs/quality/CHANGELOG.md](.docs/quality/CHANGELOG.md) → [.docs/archive/changelog-history.md](.docs/archive/changelog-history.md))
- (none yet — the Archivist's verify-then-trim demotes each closed mission to one pointer line here) → CHANGELOG

---

## 🎯 Current Mission
> *"**Welcome to your new Claude-LFE project.** This is a blank-canvas starter: the Library-First Engineering framework — personas, the Architect → Builder → Inspector → Archivist assembly line, the skill set, and the enforcement hooks — is fully wired, but no product domain is loaded yet. To begin, run `/lfe-boot`; on a blank canvas it routes straight to `/lfe-extract-domain`, which interviews you about your product and seeds the domain library (`CONTEXT.md`, `.docs/domain/`). From there the assembly line drives every change: plan in `.plans/`, build, verify, archive. New here? Read [USER_MANUAL.md](USER_MANUAL.md) for installation, day-to-day usage, and how to edit the framework's own skills; read [LLM_AGENT_GUIDE.md](LLM_AGENT_GUIDE.md) for the agent protocol and the file-based coordination layer."*

### 📋 Active Constraints
1. **Docs-First**: `.docs/` is the Source of Truth.
2. **No Cowboy Coding**: All Major Changes require `.plans/active_plan.md`.
3. **Persona Discipline**: Tool-locking is active.
4. **Human Approval**: Two structural gates — slice approval + plan approval. Plus the `/lfe-plan-critique` auto-gate (PASS proceeds; WARN requires file-recorded `brain_confirmation`; BLOCK loops back, max 2 revisions).
5. **File-Based Coordination**: Skills read/write `.plans/` files, not conversation.
6. **Hygiene Scheduling**: Architecture sweep every 5 sessions.
7. **Skill Invocation**: Skills are agent-dispatched. Brain types only `/lfe-boot`, `/lfe-whats-next`, `/lfe-scout`, `/lfe-extract-domain`, or `LFE-FORCE` (see `LLM_AGENT_GUIDE.md` §8.8).
8. **SessionStart hook**: `.claude/hooks/session-start-reminder.mjs` injects a state-aware boot reminder via `additionalContext` on every Claude Code session start. Warn-and-log posture — never blocks. Reads `pipeline_status.md` + `.plans/`; emits per six state variants. Appends a hygiene-due banner when `current_session − last_sweep ≥ 5`.
9. **statusLine continuous-display**: `.claude/statusline.mjs` is invoked by Claude Code's `statusLine` setting on every render-trigger event. Reads `pipeline_status.md`; emits a single ANSI-coloured line — persona emoji + name │ Mission State │ Pipeline Phase │ #Session Count.
10. **Cat D PostToolUse frontmatter validator**: `.claude/hooks/validate-frontmatter.mjs` enforces the COORDINATION_FILES.md schema on every `.plans/*.md` Write. Signal-strict posture (exit 2 + educational stderr on violation).
11. **Persona path-locking PreToolUse hook**: `.claude/hooks/persona-path-lock.mjs` gates every Write/Edit call against the active persona's allowed path list from `.agents/permissions.json`. Block-with-Escape posture + LFE-FORCE escape.
12. **UserPromptSubmit skill-invocation gate**: `.claude/hooks/skill-invocation-gate.mjs` denies agent-only skills typed directly by the Brain. Block-strict posture.
13. **Plan-critique gate PreToolUse hook**: `.claude/hooks/plan-critique-gate.mjs` gates `src/**` writes on plan critique verdict. Block-with-Escape posture.
14. **PostToolUse checkpoint-flip hook**: `.claude/hooks/checkpoint-flip.mjs` auto-flips coordination file checkboxes in the Coordination Files row above on every `.plans/*.md` Write. State-mutator silent-ALLOW posture.
15. **Inspector specialist skills (skill-based dispatch)**: the Inspector runs 6 specialist passes — security, perf, complexity, dep-audit, mutation, and visual rendering — as in-chat skills (`.agents/skills/lfe-*-check/` + `lfe-visual-check/` + `.claude/skills/` mirror), writing findings to `.plans/checks/`. Configured via `.docs/quality/inspector-config.md`.
16. **PostToolUse pipeline_status narrative guard**: `.claude/hooks/pipeline-status-narrative-check.mjs` scans every `pipeline_status.md` Write for generic personal/dev-local path shapes (`C:\Users\<name>`, `/home/<name>`, `/Users/<name>`, `~/<path>` — no hardcoded username) and emits a warning on a hit. Warn-only / silent-ALLOW posture (ADR 86 sibling of checkpoint-flip); never blocks. Mechanically enforces the O-S2.A1 convention (ADR 94).
17. **C1 terminal git posture gate** (PreToolUse Bash): `.claude/hooks/bash-posture-gate.mjs` — two-tier (tier-1 mutating git needs a mission; tier-2 merge/push-to-`main`/force/legal-tag needs typed `MERGE-OK`); `git-command-classifier` lib. Warn-first (`enforcement-posture.json` key `bash-posture`). ADR 95.
18. **C2a boot-precondition gate** (PreToolUse Write|Edit): `.claude/hooks/boot-precondition-gate.mjs` — refuses substantive change until `/lfe-boot` ran this session (two-file `.session-id`/`.session-booted` handshake). Warn-first (key `boot-precondition`). ADR 95.
19. **C2b scout-boundary guard** (UserPromptSubmit, in `skill-invocation-gate.mjs`): `/lfe-scout` refused mid-mission. Warn-first (key `scout-boundary`). ADR 95.
20. **C3 persona-transition guard** (PreToolUse Write|Edit): `.claude/hooks/persona-transition-guard.mjs` — gates the Active-Persona *value* change in `pipeline_status.md`; official skill-dispatched transitions drop `.plans/.persona-transition`. Warn-first (key `persona-transition`). ADR 95.
21. **C4 no-mission gate** (PreToolUse Write|Edit): `.claude/hooks/no-mission-gate.mjs` — refuses substantive change at `MISSION COMPLETE` with no coordination trail. Warn-first (key `no-mission`). ADR 95.
22. **Mission-aware path-lock + enforcement substrate**: `persona-path-lock.mjs` honors an in-flight mission's `Authorized Scope` row (closes G5). Shared substrate: `.claude/lib/enforcement-context.mjs`, `.claude/lib/enforcement-telemetry.mjs` (gitignored JSONL), `.claude/enforcement-posture.json` (per-gate warn|block promotion). `Write|Edit` chain order: boot-precondition → no-mission → persona-transition → visual-gate → persona-path. **Doctrine: speed-bumps, not containment** (ADR 95).
23. **visual-gate hard floor** (PreToolUse Write|Edit): `.claude/hooks/visual-gate.mjs` — denies the Inspector→Archivist close of a *visual slice* (changed files match `UI_GLOBS`) until `inspection_report.md` carries `visual_confirmed` + `visual_signoff`. The framework's first **unconditional-deny** floor (holds even under `warn`; key `visual-gate` is gate-inventory parity only), with asymmetric fail-safe ALLOW on every ambiguous path (unreadable substrate, non-visual slice, escalated/failed status). ADR 102.

---

## 🧭 Navigation — where what lives
| Looking for… | Go to |
| :--- | :--- |
| Full mission history (per-session narratives, gates) | [.docs/quality/CHANGELOG.md](.docs/quality/CHANGELOG.md) (last 7) → [.docs/archive/changelog-history.md](.docs/archive/changelog-history.md) (all) |
| Product architecture decisions | [.docs/architecture/architecture-decisions.md](.docs/architecture/architecture-decisions.md) *(starts at ADR 1 for your product)* |
| Framework substrate decisions | [.docs/architecture/framework-decisions.md](.docs/architecture/framework-decisions.md) *(read-only history, ADR 81+)* |
| Open bugs / advisories / carried follow-ups | [.docs/quality/known-issues.md](.docs/quality/known-issues.md) |
| Domain truth & canonical terms | `.docs/domain/` · `CONTEXT.md` *(absent on a fresh clone; populated by `/lfe-extract-domain`)* |
| LFE-FORCE bypass log | [.docs/quality/PROTOCOL_DEBT.md](.docs/quality/PROTOCOL_DEBT.md) |
| Mid-mission work products (crash recovery) | `.plans/` coordination files — resume ladder: [.docs/protocol/LOOP_ARCHITECTURE.md](.docs/protocol/LOOP_ARCHITECTURE.md) §4 |
| Pre-trim entrance-card history (forensics) | git history of `pipeline_status.md` |
| Operator manual | [USER_MANUAL.md](USER_MANUAL.md) *(installation · usage · editing the framework's skills)* |
| Everything else | [.docs/README.md](.docs/README.md) (Floor Map) · `/lfe-whats-next` for instant orientation |
