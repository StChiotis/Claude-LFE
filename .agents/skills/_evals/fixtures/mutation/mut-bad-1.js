import { test } from 'node:test';
import assert from 'node:assert/strict';

// Eligibility: must be strictly over 18.
export function isEligible(age) {
  return age > 18;
}

test('eligible when clearly an adult', () => {
  assert.equal(isEligible(25), true);
});

test('not eligible when clearly a minor', () => {
  assert.equal(isEligible(5), false);
});
