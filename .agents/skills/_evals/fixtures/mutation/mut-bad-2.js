import { test } from 'node:test';
import assert from 'node:assert/strict';

// Allow withdrawal only when the account is active and has sufficient funds.
export function canWithdraw(account, amount) {
  return account.active && account.balance >= amount;
}

test('allows a normal withdrawal', () => {
  assert.equal(canWithdraw({ active: true, balance: 100 }, 50), true);
});

test('blocks an overdraft', () => {
  assert.equal(canWithdraw({ active: true, balance: 30 }, 50), false);
});
