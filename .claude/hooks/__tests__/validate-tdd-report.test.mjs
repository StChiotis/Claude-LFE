// Test suite for the Cat D tdd_report specialist
// (.claude/hooks/validate-tdd-report.mjs). The Cat D tdd_report specialist tests.
// Typed-field validation per COORDINATION_FILES.md:28 + §10.2 plan brief:
//   tests_passed: non-negative integer
//   tests_failed: non-negative integer
//   tests_passed + tests_failed > 0 ("no tests ran" structural error)
//
// Falsifiable X/Y pair from the specialist's AC, pinned verbatim:
//   X — (0, 0) → ok:false, message matches /tests_passed \+ tests_failed must be > 0/
//   Y — (12, 0) → ok:true (positive sum; no failures)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../validate-tdd-report.mjs';
import * as tddReportModule from '../validate-tdd-report.mjs';

// --- falsifiable AC pair (pinned verbatim from the slice's AC row) -

test('[Falsifiable AC X] tests_passed=0 + tests_failed=0 → { ok: false, message matches /tests_passed \\+ tests_failed must be > 0/ }', () => {
  const result = validate({ tests_passed: 0, tests_failed: 0 });
  assert.equal(result.ok, false);
  assert.match(result.message, /tests_passed \+ tests_failed must be > 0/);
  // Also pin the diagnostic context that helps the agent self-correct
  assert.match(result.message, /broken TDD phase/);
});

test('[Falsifiable AC Y] tests_passed=12 + tests_failed=0 → { ok: true }', () => {
  const result = validate({ tests_passed: 12, tests_failed: 0 });
  assert.deepEqual(result, { ok: true });
});

// --- valid combinations --------------------------------------------------

test('valid: (12, 0) accepted — all passing', () => {
  assert.equal(validate({ tests_passed: 12, tests_failed: 0 }).ok, true);
});

test('valid: (0, 5) accepted — all failing but tests ran', () => {
  // Note: the constraint is sum > 0, not tests_failed === 0. A tdd_report
  // with all-failures is still a valid tdd_report SHAPE; the inspector
  // judges pass/fail separately based on the body content.
  assert.equal(validate({ tests_passed: 0, tests_failed: 5 }).ok, true);
});

test('valid: (54, 3) accepted — mixed pass and fail', () => {
  assert.equal(validate({ tests_passed: 54, tests_failed: 3 }).ok, true);
});

test('valid: (1000, 100) accepted — large values', () => {
  assert.equal(validate({ tests_passed: 1000, tests_failed: 100 }).ok, true);
});

test('valid: (1, 0) accepted — minimum positive sum', () => {
  assert.equal(validate({ tests_passed: 1, tests_failed: 0 }).ok, true);
});

// --- tests_passed violations ---------------------------------------------

test('tests_passed: missing (undefined) → rejected', () => {
  const result = validate({ tests_failed: 0 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_passed/);
});

test('tests_passed: negative integer (-1) → rejected', () => {
  const result = validate({ tests_passed: -1, tests_failed: 0 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_passed: got -1/);
});

test('tests_passed: non-integer (1.5) → rejected', () => {
  const result = validate({ tests_passed: 1.5, tests_failed: 0 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_passed: got 1.5/);
});

test('tests_passed: string "12" → rejected (type-strict; must be integer not string)', () => {
  const result = validate({ tests_passed: '12', tests_failed: 0 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_passed: got "12"/);
});

test('tests_passed: null → rejected', () => {
  const result = validate({ tests_passed: null, tests_failed: 0 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_passed/);
});

test('tests_passed: boolean true → rejected', () => {
  const result = validate({ tests_passed: true, tests_failed: 0 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_passed/);
});

// --- tests_failed violations ---------------------------------------------

test('tests_failed: missing (undefined) → rejected', () => {
  const result = validate({ tests_passed: 12 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_failed/);
});

test('tests_failed: negative integer (-3) → rejected', () => {
  const result = validate({ tests_passed: 12, tests_failed: -3 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_failed: got -3/);
});

test('tests_failed: non-integer (0.5) → rejected', () => {
  const result = validate({ tests_passed: 12, tests_failed: 0.5 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_failed: got 0.5/);
});

test('tests_failed: string "0" → rejected (type-strict)', () => {
  const result = validate({ tests_passed: 12, tests_failed: '0' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_failed: got "0"/);
});

// --- first-violation-wins composite --------------------------------------

test('composite: invalid tests_passed + invalid tests_failed + (would-be) sum-zero → tests_passed cited (first check)', () => {
  const result = validate({ tests_passed: 'bad', tests_failed: -1 });
  assert.equal(result.ok, false);
  // Check order is tests_passed → tests_failed → sum; tests_passed fails first
  assert.match(result.message, /Invalid value for tests_passed/);
  assert.doesNotMatch(result.message, /Invalid value for tests_failed/);
  assert.doesNotMatch(result.message, /must be > 0/);
});

test('composite: valid tests_passed + invalid tests_failed → tests_failed cited (second check)', () => {
  const result = validate({ tests_passed: 12, tests_failed: -1 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_failed/);
  assert.doesNotMatch(result.message, /Invalid value for tests_passed/);
});

// --- export surface pinning (TDD pin) -----------------------------------

test('TDD pin: specialist module exports ONLY `validate` — pins narrow contract surface', () => {
  // Same regression pin pattern as validate-plan-critique.mjs.
  // Catches a future contributor who accidentally exports a helper (or
  // removes `validate`). Should isNonNegativeInteger ever be promoted to
  // a shared helper (e.g., the total_slices check), this test will
  // need updating along with the extraction.
  const exports = Object.keys(tddReportModule).sort();
  assert.deepEqual(exports, ['validate']);
});

// --- TDD pass: regression pins (no impl changes) --------------------------
// Added during the TDD red-green-refactor pass per Builder Notes
// item 3 (type-strictness edge cases). These pin the `Number.isInteger`
// guard in `isNonNegativeInteger` against a mutation that drops the
// integer check while keeping `typeof === 'number'`. NaN and Infinity both
// satisfy `typeof === 'number'` per the JS spec but fail `Number.isInteger`
// — so dropping the integer check would let them slip through. These tests
// catch that mutation class.

test('TDD pin: tests_passed=NaN rejected — pins Number.isInteger guard against typeof-only mutation', () => {
  // typeof NaN === 'number' but Number.isInteger(NaN) === false.
  // A mutation that drops Number.isInteger and keeps only `typeof === 'number'`
  // would let NaN slip through. This test breaks under that mutation.
  const result = validate({ tests_passed: NaN, tests_failed: 0 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_passed/);
});

test('TDD pin: tests_passed=Infinity rejected — pins Number.isInteger guard', () => {
  // typeof Infinity === 'number' but Number.isInteger(Infinity) === false.
  // Same mutation class as NaN pin. The parser doesn't produce Infinity
  // (it would parse as the string "Infinity" instead), so this is
  // mutation-pinning only — defensive against a hypothetical future where
  // the parser changes OR `validate` is called standalone with crafted input.
  const result = validate({ tests_passed: Infinity, tests_failed: 0 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_passed/);
});

test('TDD pin: tests_failed=NaN rejected — type-strictness applies symmetrically to both fields', () => {
  // Mirrors the tests_passed NaN test for tests_failed. A mutation that
  // weakened only one of the two field checks would still pass for the
  // other; this symmetry test pins both branches of isNonNegativeInteger
  // usage.
  const result = validate({ tests_passed: 12, tests_failed: NaN });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for tests_failed/);
});
