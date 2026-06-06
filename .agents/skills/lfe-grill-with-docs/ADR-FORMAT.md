# ADR Format

ADRs live as numbered `## ADR N: Title` sections, each log with a top-of-file index table. There are **two** logs:
- **Your product's decisions → `.docs/architecture/architecture-decisions.md`.** A new product ADR goes here. The log starts empty; your first decision is **ADR 1**.
- **The framework's own decisions → `.docs/architecture/framework-decisions.md`.** A frozen set documenting the `.claude/` substrate, numbered 81 and up. Edit it only when modifying the framework itself.

The Architect appends a new ADR to the appropriate log; the Archivist updates that log's index table.

## Template

```md
## ADR N: {Short title of the decision}

**Status:** Accepted | Proposed | Deprecated | Superseded by ADR-M
**Date:** YYYY-MM-DD

{1-3 sentences: what's the context, what did we decide, and why.}
```

An ADR can be a single paragraph. The value is in recording *that* a decision was made and *why*.

## Optional sections

Only include these when they add genuine value. Most ADRs won't need them.

- **Considered Options** — only when the rejected alternatives are worth remembering
- **Consequences** — only when non-obvious downstream effects need to be called out

## Numbering

For a **product** ADR, scan `.docs/architecture/architecture-decisions.md` for the highest existing `## ADR N:` heading and increment by one (starting at 1 when the log is empty). For a **framework** ADR, do the same in `framework-decisions.md` (its numbers run 81 and up). Then add a row to that log's top-of-file index table.

## When to offer an ADR

All three must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — genuine alternatives existed and you picked one for specific reasons

### What qualifies

- **Architectural shape.** "We're using a monorepo."
- **Integration patterns between contexts.** "Ordering and Billing communicate via domain events."
- **Technology choices that carry lock-in.** Database, message bus, auth provider.
- **Boundary and scope decisions.** Explicit no-s are as valuable as yes-s.
- **Deliberate deviations from the obvious path.** Anything where a reasonable reader would assume the opposite.
- **Constraints not visible in the code.** Compliance, performance contracts, partner requirements.
- **Rejected alternatives when the rejection is non-obvious.**
