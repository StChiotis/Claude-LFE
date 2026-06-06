// Test suite for the skill-accuracy grader (.claude/lib/skill-eval.mjs).
// Behaviour-first: each test feeds canned skill-output text + a sidecar object
// through the pure gradeSkillOutput core (FS-free), plus direct coverage of the
// exported parse helpers — mirroring the DI / fail-soft test style of plan-linter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gradeSkillOutput,
  parseVerdict,
  countSeverityFindings,
  countEscapedMutations,
  checkMentions,
  FAMILIES,
  FAMILY,
} from '../skill-eval.mjs';

// --- Canned outputs mirroring the real skill templates ------------------------

const SECURITY_BAD = `## Security Check Findings

**Scope**: src/db.mjs
**Clean categories**: A01, A02, A04, A05, A07, A08, A10

### Critical
- A03 — SQL injection: request input concatenated into a query string — \`db.query("SELECT * FROM users WHERE id=" + req.params.id)\`

### High

### Medium

### Low / Informational
- A09 — verbose error response leaks a stack trace

### Summary
- Critical issues: 1 (block re-run until resolved)
- Advisory issues: 1 (human triages)
`;

const SECURITY_CLEAN = `## Security Check Findings

**Scope**: src/format.mjs
No security concerns identified across all OWASP Top-10 categories.
`;

const SECURITY_FALSE_ALARM = `## Security Check Findings

**Scope**: src/format.mjs

### Critical
- A03 — possible injection (flagged on a string that never reaches a query)

### Summary
- Critical issues: 1
- Advisory issues: 0
`;

const MUTATION_BAD = `## Mutation Verify Findings

**Implementation files**: src/fee.mjs
**Test files**: src/fee.test.mjs

### Escaped Mutations (no test catches these)

| Function | Mutation | Why it Escapes |
|---|---|---|
| \`calcFee\` | \`> n\` → \`>= n\` | No test asserts the boundary value exactly |
| \`calcFee\` | \`+\` → \`-\` | No test exercises the negative path |

### Covered Mutations (caught by existing tests)
- \`calcFee\` — base case caught by \`test_fee_base\`

### Summary
- Escaped mutations: 2 — recommend adding targeted assertions
- Covered: 1
- Partial: 0
`;

const MUTATION_NONE = `## Mutation Verify Findings

**Implementation files**: src/fee.mjs

### Escaped Mutations (no test catches these)

| Function | Mutation | Why it Escapes |
|---|---|---|

### Summary
- Escaped mutations: 0
- Covered: 4
`;

const CRITIQUE_BLOCK = `---
phase: architect
verdict: BLOCK
---

## Verdict: BLOCK

## Lens 3 — Domain Alignment
- Plan introduces undocumented business logic in the fee engine.
`;

const CRITIQUE_PASS = `---
verdict: PASS
---

## Verdict: PASS

## Lens 1 — Acceptance Criteria Scrutiny
- All criteria are falsifiable and traceable.
`;

// --- Severity family ----------------------------------------------------------

test('severity known-bad: critical finding in band + signature mention → pass', () => {
  const sidecar = {
    skill: 'lfe-security-check',
    kind: 'known-bad',
    severities: { critical: { min: 1, max: 3 }, high: { min: 0, max: 2 } },
    mustMention: ['A03', 'SQL'],
  };
  const res = gradeSkillOutput(SECURITY_BAD, sidecar);
  assert.equal(res.parseError, false);
  assert.equal(res.pass, true, JSON.stringify(res.reasons, null, 2));
  assert.equal(res.score, 1);
});

test('severity known-good: clean output with zero-bands + forbidden mention absent → pass', () => {
  const sidecar = {
    skill: 'lfe-security-check',
    kind: 'known-good',
    severities: { critical: { min: 0, max: 0 }, high: { min: 0, max: 0 } },
    mustNotMention: ['injection'],
  };
  const res = gradeSkillOutput(SECURITY_CLEAN, sidecar);
  assert.equal(res.pass, true, JSON.stringify(res.reasons, null, 2));
});

test('severity known-good: a false-alarm Critical fails the zero-band (false-positive guard)', () => {
  const sidecar = {
    skill: 'lfe-security-check',
    kind: 'known-good',
    severities: { critical: { min: 0, max: 0 } },
    mustNotMention: ['injection'],
  };
  const res = gradeSkillOutput(SECURITY_FALSE_ALARM, sidecar);
  assert.equal(res.pass, false, 'a wrongly-raised Critical must fail a known-good control');
  // Both the severity band AND the forbidden mention should trip.
  assert.ok(res.reasons.some((r) => /FAIL severity:critical/.test(r)));
  assert.ok(res.reasons.some((r) => /FAIL mustNotMention:injection/.test(r)));
});

// --- Outcome family -----------------------------------------------------------

test('outcome known-bad: two escaped rows in band + function mention → pass', () => {
  const sidecar = {
    skill: 'lfe-mutation-verify',
    kind: 'known-bad',
    escaped: { min: 1, max: 5 },
    mustMention: ['calcFee'],
  };
  const res = gradeSkillOutput(MUTATION_BAD, sidecar);
  assert.equal(res.pass, true, JSON.stringify(res.reasons, null, 2));
});

test('outcome known-bad: zero escaped fails a "must find an escape" band', () => {
  const sidecar = {
    skill: 'lfe-mutation-verify',
    kind: 'known-bad',
    escaped: { min: 1, max: 5 },
  };
  const res = gradeSkillOutput(MUTATION_NONE, sidecar);
  assert.equal(res.pass, false, 'a known-bad mutation fixture the skill missed must fail');
});

// --- Verdict family -----------------------------------------------------------

test('verdict known-bad: expected BLOCK and output BLOCK → pass', () => {
  const sidecar = { skill: 'lfe-plan-critique', kind: 'known-bad', expectedVerdict: 'BLOCK' };
  const res = gradeSkillOutput(CRITIQUE_BLOCK, sidecar);
  assert.equal(res.pass, true, JSON.stringify(res.reasons, null, 2));
});

test('verdict known-bad: expected BLOCK but output PASS → fail', () => {
  const sidecar = { skill: 'lfe-plan-critique', kind: 'known-bad', expectedVerdict: 'BLOCK' };
  const res = gradeSkillOutput(CRITIQUE_PASS, sidecar);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.some((r) => /FAIL verdict: expected BLOCK, got PASS/.test(r)));
});

test('verdict known-good: expected PASS and output PASS → pass', () => {
  const sidecar = { skill: 'lfe-plan-critique', kind: 'known-good', expectedVerdict: 'PASS' };
  const res = gradeSkillOutput(CRITIQUE_PASS, sidecar);
  assert.equal(res.pass, true, JSON.stringify(res.reasons, null, 2));
});

// --- Mentions + score ---------------------------------------------------------

test('missing required mention fails even when the family check passes', () => {
  const sidecar = {
    skill: 'lfe-security-check',
    kind: 'known-bad',
    severities: { critical: { min: 1, max: 3 } },
    mustMention: ['CSRF'], // genuinely absent from SECURITY_BAD (incl. its clean-categories line)
  };
  const res = gradeSkillOutput(SECURITY_BAD, sidecar);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.some((r) => /FAIL mustMention:CSRF/.test(r)));
});

test('score is the fraction of checks that passed', () => {
  // verdict check passes (BLOCK==BLOCK); the mustMention fails → 1 of 2.
  const sidecar = {
    skill: 'lfe-plan-critique',
    kind: 'known-bad',
    expectedVerdict: 'BLOCK',
    mustMention: ['not-in-output'],
  };
  const res = gradeSkillOutput(CRITIQUE_BLOCK, sidecar);
  assert.equal(res.pass, false);
  assert.equal(res.score, 0.5);
});

// --- Fail-soft contract -------------------------------------------------------

test('fail-soft: malformed inputs never throw', () => {
  for (const [text, sidecar] of [
    [null, null],
    [undefined, undefined],
    [42, { skill: 'lfe-security-check', severities: {} }],
    ['text', {}],
    ['text', { skill: 'no-such-skill' }],
    [{}, []],
  ]) {
    assert.doesNotThrow(() => gradeSkillOutput(text, sidecar));
    const res = gradeSkillOutput(text, sidecar);
    assert.equal(typeof res.pass, 'boolean');
    assert.equal(typeof res.parseError, 'boolean');
    assert.ok(Array.isArray(res.reasons));
  }
});

test('fail-soft: missing/unknown skill → parseError, not a thrown error', () => {
  assert.equal(gradeSkillOutput('x', {}).parseError, true);
  assert.equal(gradeSkillOutput('x', { skill: 'no-such-skill' }).parseError, true);
  assert.equal(gradeSkillOutput('x', null).parseError, true);
});

test('fail-soft: a sidecar that throws on property access → parseError, no exception', () => {
  const evil = { get skill() { throw new Error('boom'); } };
  let res;
  assert.doesNotThrow(() => { res = gradeSkillOutput('x', evil); });
  assert.equal(res.parseError, true);
  assert.ok(res.reasons.some((r) => /fail-soft/.test(r)));
});

// --- Direct helper coverage ---------------------------------------------------

test('parseVerdict: frontmatter, body header, and absent', () => {
  assert.equal(parseVerdict('---\nverdict: WARN\n---'), 'WARN');
  assert.equal(parseVerdict('## Verdict: BLOCK'), 'BLOCK');
  assert.equal(parseVerdict('verdict: pass'), 'PASS');
  assert.equal(parseVerdict('no verdict stated here'), null);
  assert.equal(parseVerdict(null), null);
});

test('countSeverityFindings: counts real bullets, ignores empty + Summary sections', () => {
  const counts = countSeverityFindings(SECURITY_BAD);
  assert.equal(counts.critical, 1);
  assert.equal(counts.high, 0);
  assert.equal(counts.medium, 0);
  assert.equal(counts.lowInfo, 1);
});

test('countSeverityFindings: a "- None" sentinel under a section counts zero', () => {
  const text = '### Critical\n- None\n\n### Summary\n- Critical issues: 0\n';
  assert.equal(countSeverityFindings(text).critical, 0);
});

test('countEscapedMutations: counts data rows, skips header + separator', () => {
  assert.equal(countEscapedMutations(MUTATION_BAD), 2);
  assert.equal(countEscapedMutations(MUTATION_NONE), 0);
});

test('checkMentions: presence and absence are case-insensitive', () => {
  const rows = checkMentions('Found a SQL injection vector', ['sql'], ['xss']);
  assert.equal(rows.find((r) => r.name === 'mustMention:sql').ok, true);
  assert.equal(rows.find((r) => r.name === 'mustNotMention:xss').ok, true);
  const bad = checkMentions('contains XSS', [], ['xss']);
  assert.equal(bad[0].ok, false);
});

test('FAMILIES maps each of the five skills to a known family', () => {
  assert.equal(FAMILIES['lfe-plan-critique'], FAMILY.VERDICT);
  assert.equal(FAMILIES['lfe-security-check'], FAMILY.SEVERITY);
  assert.equal(FAMILIES['lfe-perf-check'], FAMILY.SEVERITY);
  assert.equal(FAMILIES['lfe-complexity-check'], FAMILY.SEVERITY);
  assert.equal(FAMILIES['lfe-mutation-verify'], FAMILY.OUTCOME);
});

// --- TDD pass: gap-filling characterization tests ----------------------------

test('TDD: open-ended severity band (min only) admits any count at or above min', () => {
  const sidecar = { skill: 'lfe-perf-check', severities: { high: { min: 1 } } };
  const ok = gradeSkillOutput('### High\n- leak one\n- leak two\n', sidecar);
  assert.equal(ok.pass, true, JSON.stringify(ok.reasons));
  const below = gradeSkillOutput('### High\n', sidecar);
  assert.equal(below.pass, false, 'zero high findings is below an open min:1 band');
});

test('TDD: open-ended escaped band (max only) treats min as zero', () => {
  const none = gradeSkillOutput(MUTATION_NONE, { skill: 'lfe-mutation-verify', escaped: { max: 0 } });
  assert.equal(none.pass, true, 'zero escaped satisfies max:0 (min defaults to 0)');
  const bad = gradeSkillOutput(MUTATION_BAD, { skill: 'lfe-mutation-verify', escaped: { max: 0 } });
  assert.equal(bad.pass, false, 'two escaped exceeds max:0');
});

test('TDD: escaped mutations counted from bullet form, not only tables', () => {
  const text = `### Escaped Mutations (no test catches these)
- \`foo\` — \`>\` → \`>=\` is never asserted
- \`bar\` — guard-clause removal goes uncaught

### Summary
- Escaped mutations: 2`;
  assert.equal(countEscapedMutations(text), 2);
});

test('TDD: complexity family (no Critical section) grades on the High band', () => {
  const text = `## Complexity Check Findings

### High
- \`calcStuff\` — cyclomatic complexity 14 across 5 nesting levels

### Medium

### Low / Informational

### Summary
- High issues: 1`;
  const res = gradeSkillOutput(text, {
    skill: 'lfe-complexity-check',
    kind: 'known-bad',
    severities: { critical: { min: 0, max: 0 }, high: { min: 1, max: 2 } },
    mustMention: ['cyclomatic'],
  });
  assert.equal(res.pass, true, JSON.stringify(res.reasons, null, 2));
});

test('hardening: prototype-chain skill keys are rejected, not graded (no vacuous pass)', () => {
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    const res = gradeSkillOutput('## Verdict: PASS', { skill: k, expectedVerdict: 'PASS' });
    assert.equal(res.parseError, true, `skill:'${k}' must be rejected as unknown, not resolved via the prototype chain`);
    assert.equal(res.pass, false, `skill:'${k}' must not vacuously pass`);
  }
});
