// Test suite for the Cat D 03_slices specialist
// (.claude/hooks/validate-slices.mjs). The Cat D 03_slices.md specialist tests.
// Typed-field validation per lfe-to-issues/SKILL.md:53-63:
//   approved_by_human: type-strict boolean
//   total_slices: positive integer (≥ 1)
//
// Falsifiable X/Y pair from the specialist's AC, pinned verbatim:
//   X — approved_by_human "true" (string) → ok:false,
//       message matches /Invalid value for approved_by_human: got "true" \(string\), expected boolean/
//   Y — approved_by_human true + total_slices 4 → ok:true
//
// The `(string)` part of the X regex pins the implementation's `(${typeof})`
// diagnostic annotation — same convention as the tdd_report specialist's "broken TDD phase"
// structural hint (evolved further with explicit JS-type annotation).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../validate-slices.mjs';
import * as slicesModule from '../validate-slices.mjs';

// --- falsifiable AC pair (pinned verbatim from the slice's AC row) -

test('[Falsifiable AC X] approved_by_human="true" (string) → { ok: false, message matches /got "true" \\(string\\), expected boolean/ }', () => {
  const result = validate({ approved_by_human: 'true', total_slices: 4 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for approved_by_human: got "true" \(string\), expected boolean/);
});

test('[Falsifiable AC Y] approved_by_human=true + total_slices=4 → { ok: true }', () => {
  const result = validate({ approved_by_human: true, total_slices: 4 });
  assert.deepEqual(result, { ok: true });
});

// --- valid combinations --------------------------------------------------

test('valid: approved_by_human=true + total_slices=1 (minimum) accepted', () => {
  assert.equal(validate({ approved_by_human: true, total_slices: 1 }).ok, true);
});

test('valid: approved_by_human=false + total_slices=4 accepted (false is still a boolean)', () => {
  // approved_by_human=false would be unusual (the writer skill only emits true
  // after Brain approval) but the specialist's job is type-strict validation,
  // not semantic gating. false IS a boolean and passes.
  assert.equal(validate({ approved_by_human: false, total_slices: 4 }).ok, true);
});

test('valid: approved_by_human=true + total_slices=100 (large) accepted', () => {
  assert.equal(validate({ approved_by_human: true, total_slices: 100 }).ok, true);
});

// --- approved_by_human violations (type-strict) --------------------------

test('approved_by_human: string "true" rejected with explicit (string) type annotation', () => {
  const result = validate({ approved_by_human: 'true', total_slices: 4 });
  assert.equal(result.ok, false);
  assert.match(result.message, /got "true" \(string\)/);
  assert.match(result.message, /expected boolean/);
});

test('approved_by_human: string "false" rejected with explicit (string) type annotation', () => {
  const result = validate({ approved_by_human: 'false', total_slices: 4 });
  assert.equal(result.ok, false);
  assert.match(result.message, /got "false" \(string\)/);
});

test('approved_by_human: number 1 rejected with explicit (number) type annotation', () => {
  const result = validate({ approved_by_human: 1, total_slices: 4 });
  assert.equal(result.ok, false);
  assert.match(result.message, /got 1 \(number\)/);
});

test('approved_by_human: null rejected with explicit (object) type annotation (typeof null === "object" in JS)', () => {
  const result = validate({ approved_by_human: null, total_slices: 4 });
  assert.equal(result.ok, false);
  assert.match(result.message, /got null \(object\)/);
});

test('approved_by_human: missing (undefined) rejected', () => {
  const result = validate({ total_slices: 4 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for approved_by_human/);
});

test('approved_by_human: object {} rejected', () => {
  const result = validate({ approved_by_human: {}, total_slices: 4 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for approved_by_human/);
  assert.match(result.message, /\(object\)/);
});

// --- total_slices violations (positive integer ≥ 1) ----------------------

test('total_slices: 0 rejected (boundary — framework slicing always yields ≥1 cut)', () => {
  const result = validate({ approved_by_human: true, total_slices: 0 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for total_slices: got 0/);
  assert.match(result.message, /expected integer ≥ 1/);
});

test('total_slices: -1 rejected (negative)', () => {
  const result = validate({ approved_by_human: true, total_slices: -1 });
  assert.equal(result.ok, false);
  assert.match(result.message, /got -1/);
});

test('total_slices: 1.5 rejected (non-integer)', () => {
  const result = validate({ approved_by_human: true, total_slices: 1.5 });
  assert.equal(result.ok, false);
  assert.match(result.message, /got 1.5/);
});

test('total_slices: string "4" rejected (type-strict; must be integer not string)', () => {
  const result = validate({ approved_by_human: true, total_slices: '4' });
  assert.equal(result.ok, false);
  assert.match(result.message, /got "4"/);
});

test('total_slices: null rejected', () => {
  const result = validate({ approved_by_human: true, total_slices: null });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for total_slices/);
});

test('total_slices: missing (undefined) rejected', () => {
  const result = validate({ approved_by_human: true });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for total_slices/);
});

// --- first-violation-wins composite --------------------------------------

test('composite: invalid approved_by_human + invalid total_slices → approved_by_human cited (first check)', () => {
  const result = validate({ approved_by_human: 'true', total_slices: 0 });
  assert.equal(result.ok, false);
  // Check order is approved_by_human → total_slices; approved_by_human fails first
  assert.match(result.message, /Invalid value for approved_by_human/);
  assert.doesNotMatch(result.message, /Invalid value for total_slices/);
});

// --- export surface pinning (TDD pin) -----------------------------------

test('TDD pin: specialist module exports ONLY `validate` — pins narrow contract surface', () => {
  // Same regression pin pattern as the sibling specialists. Catches a future
  // contributor who accidentally exports a helper (or removes `validate`).
  // The local `isPositiveInteger` helper is intentionally NOT exported —
  // duplication-with-different-boundary across the two specialists means
  // each specialist owns its own helper variant.
  const exports = Object.keys(slicesModule).sort();
  assert.deepEqual(exports, ['validate']);
});

// --- TDD pass: regression pins (no impl changes) --------------------------
// Added during the TDD pass per Builder Notes item 4. Parallel to
// the sibling's T1/T2 NaN/Infinity pins; targets the Number.isInteger guard
// in isPositiveInteger. A mutation that drops Number.isInteger and keeps
// only `typeof === 'number' && v >= 1` would let Infinity slip through
// (typeof Infinity === 'number' AND Infinity >= 1).

test('TDD pin: total_slices=NaN rejected — pins Number.isInteger guard in isPositiveInteger', () => {
  // typeof NaN === 'number' but Number.isInteger(NaN) === false AND NaN >= 1 === false.
  // Mutation dropping Number.isInteger would still reject NaN (NaN >= 1 is false).
  // BUT a more aggressive mutation that ALSO weakens the comparison to >= 0
  // (collapsing to the sibling's threshold) would let NaN through. This test
  // pins the specific behavior for this specialist's strict boundary.
  const result = validate({ approved_by_human: true, total_slices: NaN });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for total_slices/);
});

test('TDD pin: total_slices=Infinity rejected — pins Number.isInteger guard against typeof-only mutation', () => {
  // typeof Infinity === 'number' AND Infinity >= 1 === true, but
  // Number.isInteger(Infinity) === false. A mutation that drops
  // Number.isInteger and keeps only `typeof === 'number' && v >= 1`
  // would let Infinity slip through — this test catches that mutation
  // class. Same pin shape as the sibling's T2 for tests_passed.
  const result = validate({ approved_by_human: true, total_slices: Infinity });
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid value for total_slices/);
});
