// Test suite for the plan-linter (.claude/lib/plan-linter.mjs).
// Behavior-first: each test asserts the correct findings for
// a given plan input, via the pure lintPlan core with an injected globResolver
// (FS-free), mirroring the DI test seam of be-escape / parse-frontmatter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lintPlan,
  CHECKS,
  SEVERITY,
  extractStatedCount,
  extractAffectedFileCount,
} from '../plan-linter.mjs';

// --- helpers -----------------------------------------------------------------

const findingsFor = (res, check) => res.findings.filter((f) => f.check === check);
const warnsFor = (res, check) => findingsFor(res, check).filter((f) => f.severity === SEVERITY.WARN);
const infosFor = (res, check) => findingsFor(res, check).filter((f) => f.severity === SEVERITY.INFO);

// --- clean control -----------------------------------------------------------

test('clean control plan → zero findings', () => {
  const plan = `---
phase: architect
slice: 1
---
## Problem Statement
A tidy plan with no glob ACs, no PowerShell existence checks, no narrow
line-count bounds, and prose that avoids orphan-prone words.

## Verification Strategy
- Run the unit suite and assert it passes.
- Confirm the module exports a single core function.
`;
  const res = lintPlan(plan, { globResolver: () => [] });
  assert.equal(res.parseError, false);
  assert.equal(res.findings.length, 0, JSON.stringify(res.findings, null, 2));
});

// --- Check A: glob-count, three tiers ----------------------------------------

test('glob tier (i): stated count contradicts resolved → warn + resolved-reach info', () => {
  // AC states "5 files" but the resolver returns only 3. No ## Affected section
  // → declaredCount null → no soft cross-check muddying the assertion.
  const plan = `## Verification Strategy
- [ ] Glob \`.claude/agents/lfe-*-check.md\` matches all 5 files.
`;
  const res = lintPlan(plan, { globResolver: () => ['a-check.md', 'b-check.md', 'c-check.md'] });
  const warns = warnsFor(res, CHECKS.GLOB_COUNT);
  const infos = infosFor(res, CHECKS.GLOB_COUNT);
  assert.equal(warns.length, 1, 'exactly one stated-count-contradiction warn');
  assert.match(warns[0].message, /resolves to 3 file\(s\) but the AC states 5/);
  assert.ok(infos.some((f) => /resolves to 3 file\(s\)/.test(f.message)), 'resolved-reach info present');
  assert.match(infos.find((f) => /resolves to 3/.test(f.message)).detail, /a-check\.md/);
});

test('glob tier (ii): no stated count, resolved ≠ declaredCount → info cross-check, NO warn (no false positive)', () => {
  // This is the case that distinguishes the design from the rejected option (a):
  // a glob legitimately targeting a subset must NOT warn.
  const plan = `## Affected Code Files
- \`.claude/agents/lfe-security-check.md\`
- \`.claude/agents/lfe-perf-check.md\`
- \`.claude/agents/lfe-complexity-check.md\`
- \`.claude/agents/lfe-dep-audit.md\`
- \`.claude/agents/lfe-mutation-verify.md\`

## Verification Strategy
- [ ] The check globs \`.claude/agents/lfe-*-check.md\` for the relevant defs.
`;
  const res = lintPlan(plan, { globResolver: () => ['x-check.md', 'y-check.md', 'z-check.md'] });
  assert.equal(extractAffectedFileCount(plan.split('\n')), 5, 'declaredCount parsed as 5');
  assert.equal(warnsFor(res, CHECKS.GLOB_COUNT).length, 0, 'NO warn — subset glob is legitimate');
  const infos = infosFor(res, CHECKS.GLOB_COUNT);
  assert.ok(infos.some((f) => /resolves to 3 file\(s\)/.test(f.message)), 'resolved-reach info');
  assert.ok(infos.some((f) => /differs from the declared affected-file count \(5\)/.test(f.message)), 'soft cross-check info');
});

test('glob tier (iii): stated count matches resolved → resolved-reach info only, no warn', () => {
  const plan = `## Verification Strategy
- [ ] Glob \`src/*.mjs\` matches 3 files.
`;
  const res = lintPlan(plan, { globResolver: () => ['a.mjs', 'b.mjs', 'c.mjs'] });
  assert.equal(warnsFor(res, CHECKS.GLOB_COUNT).length, 0);
  assert.equal(infosFor(res, CHECKS.GLOB_COUNT).length, 1);
  assert.match(infosFor(res, CHECKS.GLOB_COUNT)[0].message, /resolves to 3 file\(s\)/);
});

test('glob detector: prose backtick spans with markdown-bold asterisks are NOT treated as globs', () => {
  // Regression: the real active_plan.md prose tripped the glob detector because
  // backtick spans quoting sentences contained `**bold**` asterisks. A glob
  // token must be path-shaped (no whitespace; has a `/` or `.ext`).
  const plan = `## Proposed Solution
This is the \`**load-bearing signal**\` that makes the reach visible, and
the AC's glob target and the plan's \` file list are **not** the same set\`.
`;
  const res = lintPlan(plan, { globResolver: () => ['should-not-be-called'] });
  assert.equal(findingsFor(res, CHECKS.GLOB_COUNT).length, 0, 'prose spans must not be linted as globs');
});

test('glob detector: path-shaped tokens with no slash but a .ext still count', () => {
  const plan = `## Verification Strategy
- [ ] Glob \`*.test.mjs\` matches 2 files.
`;
  const res = lintPlan(plan, { globResolver: () => ['a.test.mjs', 'b.test.mjs'] });
  assert.equal(infosFor(res, CHECKS.GLOB_COUNT).length, 1, 'extensionless-dir but .ext glob is recognized');
  assert.match(infosFor(res, CHECKS.GLOB_COUNT)[0].message, /resolves to 2 file\(s\)/);
});

// --- Check B: test-path antipattern ------------------------------------------

test('test-path antipattern → warn; bare Test-Path → silent', () => {
  const bad = `## Verification Strategy
- [ ] Run \`Get-ChildItem '.agents/skills/lfe-boot' | ForEach-Object { Test-Path "$($_.FullName)/SKILL.md" }\`.
`;
  const resBad = lintPlan(bad, { globResolver: () => [] });
  assert.equal(warnsFor(resBad, CHECKS.TEST_PATH).length, 1);
  assert.match(warnsFor(resBad, CHECKS.TEST_PATH)[0].message, /existence-check antipattern/);

  const good = `## Verification Strategy
- [ ] Run \`Test-Path '.agents/skills/lfe-boot/SKILL.md'\`.
`;
  const resGood = lintPlan(good, { globResolver: () => [] });
  assert.equal(findingsFor(resGood, CHECKS.TEST_PATH).length, 0, 'bare Test-Path is silent');
});

// --- Check C: line-count soft-bound ------------------------------------------

test('narrow line-count AC → warn; wide band → silent', () => {
  const narrow = `## Verification Strategy
- [ ] \`(Get-Content $f).Length -in 25..26\` lines.
`;
  const resNarrow = lintPlan(narrow, { globResolver: () => [] });
  assert.equal(warnsFor(resNarrow, CHECKS.LINE_COUNT).length, 1);
  assert.match(warnsFor(resNarrow, CHECKS.LINE_COUNT)[0].message, /Fragile line-count AC/);

  const wide = `## Verification Strategy
- [ ] \`(Get-Content $f).Length -in 20..40\` lines.
`;
  const resWide = lintPlan(wide, { globResolver: () => [] });
  assert.equal(findingsFor(resWide, CHECKS.LINE_COUNT).length, 0, 'span 20 ≥ threshold → silent');
});

test('exact line-count equality → warn', () => {
  const plan = `## Verification Strategy
- [ ] \`(Get-Content $f).Count -eq 30\` lines exactly.
`;
  const res = lintPlan(plan, { globResolver: () => [] });
  assert.equal(warnsFor(res, CHECKS.LINE_COUNT).length, 1);
  assert.match(warnsFor(res, CHECKS.LINE_COUNT)[0].message, /exact equality/);
});

test('line-count: bare -eq without a line-count indicator is NOT flagged', () => {
  const plan = `## Verification Strategy
- [ ] Assert the exit code \`$LASTEXITCODE -eq 0\`.
`;
  const res = lintPlan(plan, { globResolver: () => [] });
  assert.equal(findingsFor(res, CHECKS.LINE_COUNT).length, 0, 'no line-count indicator → no false positive');
});

// --- Check D: orphan-word scan -----------------------------------------------

test('orphan-prone word in plan text → info candidate; clean text silent', () => {
  const plan = `## Proposed Solution
> The hook still references the old persona row that this slice deletes.
`;
  const res = lintPlan(plan, { globResolver: () => [] });
  const infos = infosFor(res, CHECKS.ORPHAN_WORD);
  assert.equal(infos.length, 1);
  assert.match(infos[0].message, /\[still\]/);
  assert.match(infos[0].message, /Lens-5 coherence candidate/);
});

// --- fail-soft contract ------------------------------------------------------

test('fail-soft: weird inputs never throw', () => {
  for (const input of [null, undefined, 42, {}, []]) {
    assert.doesNotThrow(() => lintPlan(input, { globResolver: () => [] }));
    const res = lintPlan(input, { globResolver: () => [] });
    assert.ok(Array.isArray(res.findings));
    assert.equal(typeof res.parseError, 'boolean');
  }
});

test('fail-soft: internal throw → parseError true, no exception, partial results', () => {
  const evil = { toString() { throw new Error('boom'); } };
  let res;
  assert.doesNotThrow(() => { res = lintPlan(evil, { globResolver: () => [] }); });
  assert.equal(res.parseError, true);
  assert.ok(res.findings.some((f) => f.check === CHECKS.LINT), 'meta lint finding emitted');
});

test('lintPlan with no globResolver still lints non-glob checks (no throw)', () => {
  const plan = `## Verification Strategy
- [ ] \`(Get-Content $f).Length -eq 10\`
`;
  assert.doesNotThrow(() => lintPlan(plan));
  const res = lintPlan(plan);
  assert.equal(warnsFor(res, CHECKS.LINE_COUNT).length, 1, 'line-count check runs without a resolver');
});

// --- TDD pass: hot-spot pins through the public lintPlan API -----------------

test('hot spot: a backtick span containing a path with whitespace is NOT a glob', () => {
  // PATH_SHAPED_RE excludes whitespace — a quoted phrase that happens to contain
  // a slash and an asterisk (prose) must not be linted as a glob.
  const plan = `## Notes
The pattern \`src/ * everything under here\` is described in prose, not an AC.
`;
  const res = lintPlan(plan, { globResolver: () => ['x'] });
  assert.equal(findingsFor(res, CHECKS.GLOB_COUNT).length, 0);
});

test('hot spot: a bare `*` with no slash and no extension is NOT a glob', () => {
  const plan = `## Notes
Use \`*\` as a wildcard placeholder in this sentence.
`;
  const res = lintPlan(plan, { globResolver: () => ['x'] });
  assert.equal(findingsFor(res, CHECKS.GLOB_COUNT).length, 0);
});

test('hot spot: extractStatedCount via lintPlan — `-in N..M` upper bound is the stated count', () => {
  // A glob AC stating `-in 1..5` resolving to 5 files must NOT warn (5 == upper bound);
  // resolving to 3 MUST warn (3 != 5). Pins the upper-bound precedence behaviorally.
  const planMatch = `## Verification Strategy
- [ ] Glob \`src/*.mjs\` count \`-in 1..5\`.
`;
  const resMatch = lintPlan(planMatch, { globResolver: () => ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs', 'e.mjs'] });
  assert.equal(warnsFor(resMatch, CHECKS.GLOB_COUNT).length, 0, '5 matches upper bound 5 → no warn');

  const planMiss = `## Verification Strategy
- [ ] Glob \`src/*.mjs\` count \`-in 1..5\`.
`;
  const resMiss = lintPlan(planMiss, { globResolver: () => ['a.mjs', 'b.mjs', 'c.mjs'] });
  assert.equal(warnsFor(resMiss, CHECKS.GLOB_COUNT).length, 1, '3 ≠ upper bound 5 → warn');
});

test('hot spot: tier (ii) emits NO warn even when many globs each undercut declaredCount', () => {
  // Defensive restatement of the no-false-positive guarantee with multiple globs.
  const plan = `## Affected Code Files
- \`a/one.mjs\`
- \`b/two.mjs\`
- \`c/three.mjs\`

## Verification Strategy
- [ ] Glob \`a/*.mjs\` for the first group.
- [ ] Glob \`b/*.mjs\` for the second group.
`;
  const res = lintPlan(plan, { globResolver: () => ['only-one.mjs'] });
  assert.equal(warnsFor(res, CHECKS.GLOB_COUNT).length, 0, 'subset globs never warn (no stated count)');
  assert.ok(infosFor(res, CHECKS.GLOB_COUNT).length >= 2, 'each glob still surfaces its reach');
});

// --- pure-helper direct coverage ---------------------------------------------

test('extractStatedCount: forms', () => {
  assert.equal(extractStatedCount('matches all 5 files'), 5);
  assert.equal(extractStatedCount('count -eq 7'), 7);
  assert.equal(extractStatedCount('-in 1..5'), 5);
  assert.equal(extractStatedCount('all 3 specialist defs'), 3);
  assert.equal(extractStatedCount('no number here'), null);
});

test('extractAffectedFileCount: counts file bullets, null when absent', () => {
  const withSection = `## Affected Code Files
- \`a/b.mjs\`: new
- \`c/d.mjs\`: edit
- not a file bullet (no backtick path)
`.split('\n');
  assert.equal(extractAffectedFileCount(withSection), 2);
  assert.equal(extractAffectedFileCount('## Problem\n- nothing\n'.split('\n')), null);
});
