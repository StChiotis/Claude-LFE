// Test suite for the Cat D plan_critique specialist
// (.claude/hooks/validate-plan-critique.mjs). The Cat D plan_critique specialist tests.
// Typed-field validation per COORDINATION_FILES.md:29-31:
//   verdict ∈ {PASS, WARN, BLOCK}
//   revision ∈ {1, 2}
//   brain_confirmation: null OR ISO-8601 string
//
// Falsifiable X/Y pair from the specialist's AC, pinned verbatim:
//   X — verdict=MAYBE → ok:false, message matches /Invalid value for verdict: got "MAYBE"/
//   Y — verdict=PASS + revision=1 + brain_confirmation=null → ok:true
//
// Regex updated to QUOTED form per a plan-critique WARN closure
// (2026-05-16T17:57:39Z) to align with the base validator's /got "invalid_value"/ convention.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../validate-plan-critique.mjs';

// --- falsifiable AC pair (pinned verbatim from the slice's AC row) -

test('[Falsifiable AC X] verdict="MAYBE" → { ok: false, message matches /Invalid value for verdict: got "MAYBE"/ }', () => {
  const result = validate({ verdict: 'MAYBE', revision: 1, brain_confirmation: null });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for verdict: got "MAYBE", expected one of PASS, WARN, BLOCK/);
});

test('[Falsifiable AC Y] verdict="PASS", revision=1, brain_confirmation=null → { ok: true }', () => {
  const result = validate({ verdict: 'PASS', revision: 1, brain_confirmation: null });
  assert.deepEqual(result, { ok: true });
});

// --- verdict field -------------------------------------------------------

test('verdict: "PASS" accepted', () => {
  assert.equal(validate({ verdict: 'PASS', revision: 1, brain_confirmation: null }).ok, true);
});

test('verdict: "WARN" accepted', () => {
  assert.equal(validate({ verdict: 'WARN', revision: 1, brain_confirmation: null }).ok, true);
});

test('verdict: "BLOCK" accepted', () => {
  assert.equal(validate({ verdict: 'BLOCK', revision: 1, brain_confirmation: null }).ok, true);
});

test('verdict: lowercase "pass" rejected (enum is case-sensitive)', () => {
  const result = validate({ verdict: 'pass', revision: 1, brain_confirmation: null });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for verdict: got "pass"/);
});

test('verdict: missing → rejected', () => {
  const result = validate({ revision: 1, brain_confirmation: null });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for verdict: got "undefined"/);
});

test('verdict: empty string → rejected', () => {
  const result = validate({ verdict: '', revision: 1, brain_confirmation: null });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for verdict: got ""/);
});

// --- revision field ------------------------------------------------------

test('revision: 1 accepted', () => {
  assert.equal(validate({ verdict: 'PASS', revision: 1, brain_confirmation: null }).ok, true);
});

test('revision: 2 accepted', () => {
  assert.equal(validate({ verdict: 'PASS', revision: 2, brain_confirmation: null }).ok, true);
});

test('revision: 0 rejected (must be 1 or 2)', () => {
  const result = validate({ verdict: 'PASS', revision: 0, brain_confirmation: null });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for revision: got 0/);
});

test('revision: 3 rejected (must be 1 or 2)', () => {
  const result = validate({ verdict: 'PASS', revision: 3, brain_confirmation: null });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for revision: got 3/);
});

test('revision: string "1" rejected (must be integer, not string)', () => {
  const result = validate({ verdict: 'PASS', revision: '1', brain_confirmation: null });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for revision: got "1"/);
});

test('revision: missing → rejected', () => {
  const result = validate({ verdict: 'PASS', brain_confirmation: null });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for revision/);
});

// --- brain_confirmation field --------------------------------------------

test('brain_confirmation: null accepted (literal null)', () => {
  assert.equal(
    validate({ verdict: 'PASS', revision: 1, brain_confirmation: null }).ok,
    true,
  );
});

test('brain_confirmation: valid ISO-8601 string accepted', () => {
  assert.equal(
    validate({ verdict: 'WARN', revision: 1, brain_confirmation: '2026-05-16T17:57:39Z' }).ok,
    true,
  );
});

test('brain_confirmation: "yesterday" (non-ISO-8601 string) rejected', () => {
  const result = validate({ verdict: 'PASS', revision: 1, brain_confirmation: 'yesterday' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for brain_confirmation: got "yesterday"/);
});

test('brain_confirmation: "2026-05-16" (date only, missing time) rejected', () => {
  const result = validate({ verdict: 'PASS', revision: 1, brain_confirmation: '2026-05-16' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for brain_confirmation/);
});

test('brain_confirmation: "2026-05-16T17:57:39" (missing Z suffix) rejected', () => {
  const result = validate({ verdict: 'PASS', revision: 1, brain_confirmation: '2026-05-16T17:57:39' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for brain_confirmation/);
});

test('brain_confirmation: undefined (missing field) rejected (must be null or ISO-8601 string)', () => {
  const result = validate({ verdict: 'PASS', revision: 1 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for brain_confirmation/);
});

test('brain_confirmation: empty string rejected', () => {
  const result = validate({ verdict: 'PASS', revision: 1, brain_confirmation: '' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for brain_confirmation/);
});

// --- composite (multiple invalid fields; first violation wins) -----------

test('composite: multiple invalid fields → first violation wins (verdict checked before revision)', () => {
  const result = validate({ verdict: 'MAYBE', revision: 99, brain_confirmation: 'garbage' });
  assert.equal(result.ok, false);
  // The check order is verdict → revision → brain_confirmation; verdict fails first
  assert.match(result.message, /Invalid value for verdict/);
  assert.doesNotMatch(result.message, /Invalid value for revision/);
});

// --- TDD pass: regression pins (no impl changes) --------------------------
// Added during the TDD red-green-refactor pass. Each test below
// targets an observable contract from active_plan / builder_done Notes for
// TDD. All pass on current code; they exist to catch hypothetical future
// regressions that the original 22-case matrix would miss.

import * as planCritiqueModule from '../validate-plan-critique.mjs';

test('TDD pin: brain_confirmation with fractional seconds (.123Z) rejected — pins strict ISO-8601 regex', () => {
  // Builder note 3: the ISO-8601 regex /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
  // is deliberately strict. It rejects fractional seconds, timezone offsets,
  // and missing Z suffix. This test pins the fractional-seconds rejection
  // so a future "relax the regex" mutation (e.g., adding `\.?\d*` before Z)
  // breaks the test. Every coordination-file writer in the project produces
  // YYYY-MM-DDTHH:MM:SSZ form via `date -u +"%Y-%m-%dT%H:%M:%SZ"`; the strict
  // regex is the convention enforcement.
  const result = validate({
    verdict: 'PASS',
    revision: 1,
    brain_confirmation: '2026-05-16T17:57:39.123Z',
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for brain_confirmation/);
});

test('TDD pin: brain_confirmation as number (1234567890) rejected — pins typeof string check', () => {
  // Builder note 4: the specialist explicitly checks `typeof
  // fields.brain_confirmation !== 'string'` BEFORE the regex test. Without
  // that guard, a number value would be coerced to a string by RegExp.test()
  // and might match or not match unpredictably. This test pins the explicit
  // type check so a future "trust the regex coercion" mutation (dropping
  // the typeof guard) breaks the test.
  const result = validate({
    verdict: 'PASS',
    revision: 1,
    brain_confirmation: 1234567890,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for brain_confirmation/);
});

// --- mutation cell — typeof guard via object-with-toString
test('mutation cell: brain_confirmation as an object whose toString() returns valid ISO → rejected (typeof guard runs before the regex)', () => {
  // The realistic escape that T2 (a number) cannot reach: an object whose
  // toString() returns a valid ISO-8601 string. The specialist checks
  // `typeof !== 'string'` BEFORE ISO_8601_REGEX.test(); without that guard,
  // RegExp.test() would coerce the object via toString() to a valid timestamp
  // and the value would WRONGLY pass. This kills the "drop the typeof guard,
  // trust the regex coercion" mutant that T2 leaves alive.
  const result = validate({
    verdict: 'PASS',
    revision: 1,
    brain_confirmation: { toString: () => '2026-05-16T17:57:39Z' },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for brain_confirmation/);
});

test('TDD pin: specialist module exports ONLY `validate` — pins narrow contract surface', () => {
  // Builder note 5: the specialist's contract surface is intentionally
  // narrow. Only `validate(fields)` should be public; no helper exports,
  // no leaked internals, no side-effect exports. This test pins the
  // public surface so a future contributor who accidentally exports a
  // helper (or removes `validate`) breaks the test.
  const exports = Object.keys(planCritiqueModule).sort();
  assert.deepEqual(exports, ['validate']);
});
