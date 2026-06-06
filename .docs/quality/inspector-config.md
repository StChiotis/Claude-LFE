# Inspector Sub-Skill Configuration

> **Owner**: Architect configures at project start; Brain may override per-mission.
> **Read by**: `/lfe-inspector` during Sub-Skill Dispatch (before writing `critique.md`).

Configure which specialist sub-skills the Inspector invokes for this project. Disabled sub-skills are silently skipped — no placeholder section appears in `critique.md`.

## Sub-Skill Registry

| Sub-skill | Enabled | Notes |
|---|---|---|
| `lfe-security-check` | true | OWASP Top-10 prompt analysis; always-on by default. |
| `lfe-perf-check` | true | Resource leaks, N+1, algorithmic complexity. |
| `lfe-complexity-check` | false | Disabled by default. Enable per-slice via `active_plan.md` `## Inspector Overrides` when the slice introduces substantial logic — long functions, deep nesting, or branching that would benefit from a cognitive-load audit. |
| `lfe-dep-audit` | true | Dependency file review + human-run audit instruction (`npm audit`). |
| `lfe-mutation-verify` | false | Disabled by default. Enable per-slice via `## Inspector Overrides` for changes to high-correctness-stakes code where you want to know whether existing tests would actually catch a bug — high-token sub-skill, target use is small and selective. |

## How to Override Per-Mission

Per-mission overrides live in a typed body section of `.plans/active_plan.md` called **`## Inspector Overrides`**. The Inspector parses this section after reading this config table and before dispatching sub-skills; overrides take precedence over the table above.

**Schema** (the exact format the Inspector parses — informal text or scattered comments are ignored):

````markdown
## Inspector Overrides
```yaml
lfe-security-check: true
lfe-mutation-verify: true
lfe-perf-check: false
```
````

- Keys: any sub-skill name from the Registry above.
- Values: `true` (force enable) or `false` (force disable).
- Omit the section entirely when no overrides are needed.
- Unknown keys are ignored with a warning to the Brain. Missing keys fall through to the config table default.

The Architect's `active_plan.md` body template includes this section as optional. See `.agents/skills/lfe-architect/SKILL.md` Step 6.

## Dispatch Order

When multiple sub-skills are enabled, Inspector runs them in this fixed sequence:
1. `lfe-security-check`
2. `lfe-perf-check`
3. `lfe-complexity-check`
4. `lfe-dep-audit`
5. `lfe-mutation-verify`

Each sub-skill writes its findings to `.plans/checks/<sub-skill-name>_findings.md`. Inspector aggregates all outputs into `critique.md` under labelled sections.

## Dispatch

The Inspector dispatches each enabled sub-skill via the **Skill tool**, in the main conversation thread. Each sub-skill runs its canonical protocol at `.agents/skills/lfe-<name>-check/SKILL.md` (LFE-SOURCE, unchanged) and writes its own findings file at `.plans/checks/<name>_findings.md` directly from the main-thread context — where the PostToolUse hooks (`validate-frontmatter.mjs` + `checkpoint-flip.mjs`) run normally. The Inspector then aggregates the findings files into `critique.md`.

This is the single, canonical dispatch mechanism. Every `lfe-*-check` sub-skill is **prompt-only and tool-agnostic** — a reasoning pass over the diff with no external tooling or test runner — so running it as an in-chat skill is fully sufficient. There is no separate subagent / Task-tool dispatch path: Claude Code does not reliably register project subagents from `.claude/agents/` (confirmed empirically across multiple sessions, consistent with known upstream agent-discovery issues), so the framework standardizes on the skill path, which works in every environment. Write isolation is provided by the `persona-path-lock` hook (the Inspector writes only under `.plans/**`) together with the resume rule below.

**Resume rule (crash recovery):** before invoking a sub-skill, skip it if `.plans/checks/<name>_findings.md` already exists *and* its frontmatter parses with `status: complete`; otherwise invoke it (the sub-skill overwrites its findings file). File presence alone is not a skip signal — only `status: complete` is.

## Security Floor Rules

`lfe-security-check` has a **floor** for high-risk change classes — it runs regardless of the config table above or any per-mission override whenever a slice's changed files (from `.plans/builder_done.md`) include either:

1. **Category-II FRAMEWORK_INFRA_PATHS entry docs** — `pipeline_status.md`, `LLM_AGENT_GUIDE.md`, `CLAUDE.md`, `USER_MANUAL.md`, `README.md`. These are the adopter-facing entry points; a rewrite by a drifting agent without an OWASP pass is exactly the threat class ADR 90's compensating-controls argument depends on. *(closes Sec-S3.L1)*
2. **CI workflow files** — `.github/workflows/**`. Workflow YAMLs run with repository tokens, so they are the highest-risk surface in the framework-infra carve-out; any change must get the security lens. **Dormant** until the repo adds its first workflow file. *(closes F1)*

**Floor semantics:** the floor is a *minimum*. A per-mission `## Inspector Overrides` block may raise `lfe-security-check` to `true` (redundant for these paths) but may **not** lower it below the floor — an `lfe-security-check: false` override is ignored, with a warning to the Brain, for any slice that touches a floor path class. The Inspector evaluates the floor after reading the config table + overrides, when computing the final enabled set.
