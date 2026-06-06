import { test } from 'node:test';
import assert from 'node:assert/strict';

// Eligibility: must be strictly over 18.
export function isEligible(age) {
  return age > 18;
}

test('boundary and both sides are asserted', () => {
  assert.equal(isEligible(19), true);
  assert.equal(isEligible(18), false); // exact boundary distinguishes > from >=
  assert.equal(isEligible(17), false);
});
