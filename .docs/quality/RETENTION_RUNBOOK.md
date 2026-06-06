# Retention Runbook — 

> **Owner:** project (WI-pure operational doc; does **not** modify any LFE-source file).
> **Read by:** anyone running a Hygiene sweep (`/lfe-hygiene` § 7) in this codebase.
> **Authoritative source:** `[.agents/skills/lfe-hygiene/SKILL.md](../../.agents/skills/lfe-hygiene/SKILL.md)` § 7 (Retention Check) and `[.docs/protocol/GOVERNANCE.md](../protocol/GOVERNANCE.md)` § Retention Policy. This runbook is a project-specific operational supplement — it links to the framework rules without restating them.

Every retention-managed file in this project has a **hot tier** (active, in `.docs/quality/` or `.docs/architecture/`) and a **cold tier** (archived, in `.docs/archive/`). The Hygiene sweep — triggered every 5 sessions per the Retention Policy — walks the table in `GOVERNANCE.md` and moves aged-out entries from hot to cold.

This project has not overridden any retention number (no `## Retention Policy Overrides` section in `LLM_AGENT_GUIDE.md`). Framework defaults apply: 15 sessions, 7 milestones, 5-session sweep cadence.

## The retention-managed files

| Hot file | Cold sibling | Hot retention rule | Archive trigger |
|---|---|---|---|
| `.docs/quality/CHANGELOG.md` | `.docs/archive/changelog-history.md` | 7 most recent milestones | When an 8th milestone ships |
| `.docs/architecture/architecture-decisions.md` *(product log)* | `.docs/archive/architecture-decisions-history.md` | All `Accepted`/`Proposed` ADRs + last 15 sessions of `Superseded`/`Deprecated` | At hygiene sweep |
| `.docs/architecture/framework-decisions.md` *(framework log — frozen)* | N/A | Preserved in full; excluded from archival (all entries Accepted) | N/A |
| `.docs/quality/skill-eval-scorecard.md` | `.docs/archive/skill-eval-scorecard-history.md` | 15 most recent eval sessions | At hygiene sweep |
| `.docs/quality/PROTOCOL_DEBT.md` | `.docs/archive/protocol-debt-history.md` | All `open`; `resolved` kept 1 hygiene cycle then archived | At hygiene sweep |
| `.docs/quality/known-issues.md` | `.docs/archive/known-issues-history.md` | All `open`; `resolved` / `won't-fix` kept 1 hygiene cycle | At hygiene sweep |

## Pre-flight (before any archival action)

1. Confirm the hot file ends with the canonical Cold Tier Pointer:
   > `**Archive:** Older entries are in [archive/<filename>-history.md](../archive/<filename>-history.md). Last archive sweep: session N.`
2. Confirm the cold sibling starts with the Hot Tier Pointer + an Index table header.
3. Read the *Retention Policy* row in `GOVERNANCE.md` for the file under consideration. Identify the rule (e.g., "7 most recent milestones").
4. If either pointer is missing or malformed, **stop** — that's a Hygiene violation; flag it before continuing.

## Per-file procedures

### CHANGELOG.md (7-milestone rolling window)

**Trigger:** an 8th milestone is about to be appended to `quality/CHANGELOG.md`.

1. Read the topmost (newest) and bottommost (oldest) milestones in the hot file. They are H2 sections (`## YYYY-MM-DD — Title`) ordered most-recent-first by convention.
2. Cut the **oldest** milestone (entire H2 + its body, up to but not including the next `## ` H2) from `quality/CHANGELOG.md`.
3. In `archive/changelog-history.md`:
   - Paste the cut milestone immediately after the `## Archived Milestones Index` table — at the top of the body section (newest archives sit closest to the index).
   - Add a row to the **Archived Milestones Index** table: `| <date> | <title> | <session N> |`.
4. In `quality/CHANGELOG.md`:
   - Prepend the new (8th, now 7th-after-archival) milestone above the surviving 6.
   - Update the Cold Tier Pointer line: `Last archive sweep: session N` where N is the current session count from `pipeline_status.md`.
5. Verify with greps: `grep -c "^## 20" quality/CHANGELOG.md` ≤ 7; `grep -c "^| 20" archive/changelog-history.md` increased by 1.

### architecture-decisions.md — the product log (rolling 15-session window for retired ADRs)

**Trigger:** Hygiene sweep at session ≥ 5 (the first sweep). Only `Superseded` or `Deprecated` ADRs whose status-date is older than (current session − 15) are candidates. `Accepted` and `Proposed` ADRs are never archived. The sibling `framework-decisions.md` is frozen (all entries Accepted) — the sweep skips it entirely.

1. For each ADR body, locate `**Status:** Superseded by ADR-N` or `**Status:** Deprecated`.
2. Compare the ADR's session-of-status-change (recorded in the ADR body as `(decided session N)` or in the index table's archive-session column) against `current_session − 15`. If older, archive.
3. Cut the ADR body (entire `## ADR N: Title` H2 + body, up to next `## ADR ` H2) from `architecture/architecture-decisions.md`.
4. In `archive/architecture-decisions-history.md`:
   - Paste the cut ADR after the `## Archived ADR Index` table.
   - Add an index row: `| <ADR-id> | <date> | <title> | <status> | <session N> |`.
5. In `architecture/architecture-decisions.md`:
   - Remove the now-stale row from the top-of-file index table.
   - Update the Cold Tier Pointer's session count.
6. Re-run `npm run build && npm test -- --run` if any code references the archived ADR by number (rare, but happens in code comments or test descriptions).

### skill-eval-scorecard.md (15 most recent eval sessions)

**Trigger:** Hygiene sweep once the hot file holds more than 15 eval-session entries (the 16th eval session exists).

1. The hot file holds at most 15 eval-session entries. When a 16th lands at the top, the oldest ages out.
2. Cut the oldest eval-session entry from `quality/skill-eval-scorecard.md`.
3. In `archive/skill-eval-scorecard-history.md`:
   - Add the cut entry to the **Archived Eval Sessions Index** table (newest closest to the index).
4. Update the Cold Tier Pointer in `skill-eval-scorecard.md` (`Last archive sweep: session N`).

### PROTOCOL_DEBT.md (resolved entries kept 1 cycle)

**Trigger:** Hygiene sweep finds entries with `Resolution Status: resolved` whose resolved-session is at least 1 cycle (5 sessions) old.

1. For each row in the *Active Debt* table with `resolved` status and `resolved_session ≤ current_session − 5`:
   - Cut the row from `quality/PROTOCOL_DEBT.md`.
   - Add to `archive/protocol-debt-history.md` *Archived Debt Index* (columns: Date / Mission / Reason for LFE-FORCE / Resolution / Archived in session).
2. Update Cold Tier Pointer.

### known-issues.md (resolved / won't-fix kept 1 cycle)

**Trigger:** Hygiene sweep finds `Resolved Issues` H2 entries whose resolution date is at least 1 cycle (5 sessions) old.

1. For each `### ~~Title~~ RESOLVED` entry under the `## Resolved Issues` H2 whose resolved-date is ≥ 5 sessions ago:
   - Cut the entry (H3 + its body).
   - Add to `archive/known-issues-history.md` index table (columns: Date opened / Title / Final status / Archived in session). The body goes below the index.
2. Update Cold Tier Pointer in `quality/known-issues.md`.

## Concrete walkthrough — CHANGELOG archival (hypothetical 8th milestone)

Starting state: `quality/CHANGELOG.md` has 7 milestones, oldest dated 2026-04-18. Current session = 6.

1. The Builder ships a new milestone for 2026-05-20.
2. Archivist runs: read the 2026-04-18 milestone (H2 + body, ~30 lines). Copy it.
3. In `archive/changelog-history.md`, immediately after the *Archived Milestones Index* table, paste the milestone.
4. Add to the index: `| 2026-04-18 | Example milestone title (ADR 74) | session 6 |`.
5. In `quality/CHANGELOG.md`, delete the 2026-04-18 H2 + body. Prepend the new 2026-05-20 milestone above the (now-6, becoming-7) surviving milestones.
6. Update Cold Tier Pointer: `Last archive sweep: session 6`.
7. Verify: `grep -c "^## 20" quality/CHANGELOG.md` returns 7; archive index has one new row.

## Concrete walkthrough — ADR archival (hypothetical session 20)

Starting state: ADR 39 has `**Status:** Superseded by ADR-79` with status-date `(decided session 4)`. Current session = 20. `20 − 4 = 16 > 15`, so ADR 39 is aged out.

1. Archivist finds ADR 39 in the body; cuts the full `## ADR 39: Example superseded decision` section.
2. In `archive/architecture-decisions-history.md`, after the *Archived ADR Index*, paste the body. Add an index row: `| 39 | 2026-03-24 | Example superseded decision | Superseded by ADR-79 | session 20 |`.
3. In `architecture/architecture-decisions.md`, delete the ADR 39 row from the top-of-file index table.
4. Update Cold Tier Pointer: `Last archive sweep: session 20`.

## What not to do

- **Never** edit `.agents/skills/lfe-archivist/SKILL.md`, `.agents/skills/lfe-hygiene/SKILL.md`, or `.docs/protocol/GOVERNANCE.md`. These are LFE-SOURCE files (byte-identical to upstream). Operational notes for this project go in this runbook, in `pipeline_status.md`'s constraint list, or in `.docs/quality/README.md` — never in the LFE protocol surface. *(Exception — framework-source repo: this prohibition is written for downstream **adopter** repos, whose LFE protocol copy stays read-only. **This** repo is the framework's own upstream / reusable starter, so deliberate evolution of its own protocol surface here is legitimate when it travels through the assembly line — see ADR 99, which records exactly such a sanctioned edit to `GOVERNANCE.md` + `lfe-archivist/SKILL.md`.)*
- **Never** archive an `Accepted` or `Proposed` ADR. Only `Superseded` and `Deprecated` are archive candidates, and only once they age past the 15-session window.
- **Never** delete an archived entry from a cold file. The cold tier is append-only; the index row is the audit trail.
- **Never** move an entry between hot and cold without updating the Cold Tier Pointer's session counter on the hot file.

## Cross-references

- LFE framework rule: [`.agents/skills/lfe-hygiene/SKILL.md`](../../.agents/skills/lfe-hygiene/SKILL.md) § 7 Retention Check.
- Retention Policy table: [`.docs/protocol/GOVERNANCE.md`](../protocol/GOVERNANCE.md) § Retention Policy.
- Archivist step list: [`.agents/skills/lfe-archivist/SKILL.md`](../../.agents/skills/lfe-archivist/SKILL.md) Step 6.
- Cold-tier shelf index: [`.docs/archive/README.md`](../archive/README.md).
