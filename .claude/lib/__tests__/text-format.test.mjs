// Test suite for the shared text-format helpers (.claude/lib/text-format.mjs).
// ELLIPSIS constant + shared stripAnsi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ELLIPSIS, ELLIPSIS_LEN, stripAnsi, stripControl } from '../text-format.mjs';

test('ELLIPSIS_LEN stays in sync with ELLIPSIS length', () => {
  // The invariant the cap functions rely on — length is derived, not hardcoded.
  assert.equal(ELLIPSIS_LEN, ELLIPSIS.length);
});

test('stripAnsi removes SGR colour / style sequences', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
  assert.equal(stripAnsi('\x1b[1m\x1b[36mbold cyan\x1b[0m'), 'bold cyan');
});

test('stripAnsi is a no-op on text with no escape sequences', () => {
  assert.equal(stripAnsi('plain text — no codes'), 'plain text — no codes');
});

test('stripAnsi coerces non-string input defensively (never throws)', () => {
  assert.equal(stripAnsi(42), '42');
  assert.equal(stripAnsi(null), 'null');
  assert.equal(stripAnsi(undefined), 'undefined');
});

test('stripControl removes the ESC introducer byte (defangs CSI/OSC/SGR)', () => {
  assert.equal(stripControl('\x1b[31mred\x1b[0m'), '[31mred[0m');
  assert.ok(!stripControl('\x1b]0;title\x07').includes('\x1b'));
  assert.equal(stripControl('plain — no codes'), 'plain — no codes');
});

test('stripControl is broader than stripAnsi (strips non-SGR escapes too)', () => {
  // A cursor-clear CSI (ESC [ 2J) has no `m` terminator, so stripAnsi leaves the
  // ESC; stripControl removes the introducer and renders the sequence inert.
  const hostile = 'x\x1b[2Jy';
  assert.ok(stripAnsi(hostile).includes('\x1b'), 'stripAnsi leaves the bare ESC');
  assert.ok(!stripControl(hostile).includes('\x1b'), 'stripControl removes it');
});

test('stripControl coerces non-string input defensively (never throws)', () => {
  assert.equal(stripControl(42), '42');
  assert.equal(stripControl(null), 'null');
  assert.equal(stripControl(undefined), 'undefined');
});
