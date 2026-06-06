---
phase: architect
step: 4_active_plan
slice: 1
---

## Problem Statement
The CLI prints timestamps in local time, which makes log comparison across
machines error-prone.

## Proposed Solution
Format CLI timestamps as UTC ISO-8601 in the existing logging helper. What is
logged does not change — only the format of the timestamp field.

## Affected Code Files
- the logging helper module: switch the timestamp formatter to UTC ISO-8601.

## Acceptance Criteria
- [ ] A log line's timestamp ends with `Z` (UTC) rather than a local offset.
- [ ] The unit suite passes, including a new test that asserts the UTC format.

## Verification Strategy
- Run the unit suite; add one test that formats a fixed epoch and asserts the
  exact UTC ISO-8601 string it produces.
