# Shelf Index: domain

## Directory Mission
Home for this project's **domain Source of Truth** — the mathematics, business rules, and canonical terminology that the project's core logic must derive from (per [`GOVERNANCE.md §🏛 Logic Centralization`](../protocol/GOVERNANCE.md) and the [Source-of-Truth Hierarchy](../../LLM_AGENT_GUIDE.md)). No AI agent may improvise domain logic; it must trace back to the files here.

This directory is **empty on a fresh clone by design**. It is populated on Day 0 when you run `/lfe-extract-domain` (which interviews you and seeds the domain model) and kept in sync thereafter by `/lfe-grill-with-docs` (canonical terms) and the Archivist (rule changes).

## File Registry

| File | Purpose | Status |
|---|---|---|
| `domain-knowledge.md` | Math + business rules SSOT — formulas, invariants, calculation contracts. | Created Day-0 by `/lfe-extract-domain` |
| `glossary.md` | Canonical domain terms (the detailed companion to the root [`CONTEXT.md`](../../CONTEXT.md) glossary). | Created during `/lfe-grill-with-docs` |

> **Note to AI**: This is a local index. Do not assume these are the only files in the project, but these are the only files in this specific directory. If you need a file not listed here, consult the Master Floor Map at `.docs/README.md`. On a fresh clone this directory holds only this index — that is the correct Day-0 state, not a missing file.
