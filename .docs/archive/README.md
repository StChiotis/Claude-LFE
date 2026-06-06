# Shelf Index: archive

## Directory Mission
Cold-tier home for retention-managed hot files. Everything here is **historical** — the Hygiene sweep (every 5 sessions) moves aged-out entries from the hot tier to cold siblings here. Empty on a fresh clone; populated as your project accumulates history.

## File Registry

*(No archived files yet. The Archivist creates a cold sibling — e.g. `<hot-file>-history.md` — here when a hot file's retention window overflows during a Hygiene sweep.)*

> **Rule:** The cold tier is append-only. Never delete archived entries. The Archivist adds entries here during the Hygiene sweep per [`RETENTION_RUNBOOK.md`](../quality/RETENTION_RUNBOOK.md).
