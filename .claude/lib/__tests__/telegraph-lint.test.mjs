// Test suite for the telegraph lint (.claude/lib/telegraph-lint.mjs).
// Behaviour-first: canned fixture snippets through the pure scanTelegraph core.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanTelegraph, DEFAULT_MARKERS } from '../telegraph-lint.mjs';

test('clean fixture → not telegraphed', () => {
  const code = 'export function isEligible(age) {\n  return age > 18;\n}\n';
  const res = scanTelegraph(code, { mustMention: ['boundary'] });
  assert.equal(res.telegraphed, false);
  assert.equal(res.hits.length, 0);
});

test('a generic marker (BUG) anywhere → telegraphed', () => {
  const code = '// BUG: boundary is wrong below\nfor (let i = 0; i <= n; i++) {}\n';
  const res = scanTelegraph(code);
  assert.equal(res.telegraphed, true);
  assert.ok(res.hits.some((h) => h.kind === 'marker' && h.text === 'bug'));
});

test('a defect-signature mustMention term in a COMMENT → telegraphed', () => {
  const code = '// this query is open to injection\nconst q = "SELECT " + x;\n';
  const res = scanTelegraph(code, { mustMention: ['injection'] });
  assert.equal(res.telegraphed, true);
  assert.ok(res.hits.some((h) => h.kind === 'mention-in-comment' && h.text === 'injection'));
});

test('the same mustMention term in CODE (not a comment) is NOT telegraphing', () => {
  const code = 'function checkInjection(q) { return q.includes("\'"); }\n';
  const res = scanTelegraph(code, { mustMention: ['injection'] });
  assert.equal(res.telegraphed, false, 'a code identifier is the defect to reason about, not a giveaway');
});

test('markers are matched case-insensitively', () => {
  const res = scanTelegraph('/* fixme: rushed */\n');
  assert.equal(res.telegraphed, true);
});

test('fail-soft: weird inputs never throw', () => {
  for (const input of [null, undefined, 42, {}, []]) {
    assert.doesNotThrow(() => scanTelegraph(input));
    const res = scanTelegraph(input);
    assert.equal(typeof res.telegraphed, 'boolean');
    assert.ok(Array.isArray(res.hits));
    assert.equal(res.parseError, false);
  }
});

test('DEFAULT_MARKERS includes the canonical giveaways', () => {
  assert.ok(DEFAULT_MARKERS.includes('BUG'));
  assert.ok(DEFAULT_MARKERS.includes('FIXME'));
  assert.ok(DEFAULT_MARKERS.includes('PLANTED'));
});

test('TDD: a markdown <!-- comment --> carrying the signature → telegraphed', () => {
  const md = '## Plan\n<!-- note: this AC is not falsifiable -->\n- do the thing\n';
  const res = scanTelegraph(md, { mustMention: ['falsifiable'] });
  assert.equal(res.telegraphed, true);
  assert.ok(res.hits.some((h) => h.kind === 'mention-in-comment' && h.text === 'falsifiable'));
});

test('TDD: a block-comment continuation (* line) carrying the signature → telegraphed', () => {
  const code = '/*\n * the canWithdraw guard is untested\n */\nexport function canWithdraw() {}\n';
  const res = scanTelegraph(code, { mustMention: ['canWithdraw'] });
  assert.equal(res.telegraphed, true);
});
