// Test suite for the Cat D shared frontmatter parser (.claude/lib/parse-frontmatter.mjs).
// Per ADR 83 (zero-dep custom parser) and
// active_plan Step 2 fixture matrix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../parse-frontmatter.mjs';

// --- success cases ---------------------------------------------------------

test('parser: valid frontmatter with all 5 mandatory base fields', () => {
  const text = `---
phase: architect
step: 1_grill
status: complete
timestamp: 2026-05-16T16:38:01Z
source: n/a
---

# Body content
`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.deepEqual(fields, {
    phase: 'architect',
    step: '1_grill',
    status: 'complete',
    timestamp: '2026-05-16T16:38:01Z',
    source: 'n/a',
  });
});

test('parser: integer values normalized to JS Numbers', () => {
  const text = `---
revision: 1
total_slices: 4
tests_passed: 12
tests_failed: 0
---
`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.strictEqual(fields.revision, 1);
  assert.strictEqual(fields.total_slices, 4);
  assert.strictEqual(fields.tests_passed, 12);
  assert.strictEqual(fields.tests_failed, 0);
});

test('parser: boolean values normalized to JS true/false', () => {
  const text = `---
approved_by_human: true
some_other_flag: false
---
`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.strictEqual(fields.approved_by_human, true);
  assert.strictEqual(fields.some_other_flag, false);
});

test('parser: null literal normalized to JS null', () => {
  const text = `---
brain_confirmation: null
---
`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.strictEqual(fields.brain_confirmation, null);
});

test('parser: ISO-8601 timestamp preserved as string', () => {
  const text = `---
timestamp: 2026-05-16T17:05:07Z
---
`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.strictEqual(fields.timestamp, '2026-05-16T17:05:07Z');
  assert.strictEqual(typeof fields.timestamp, 'string');
});

test('parser: double-quoted string stripped to unquoted (Postel\'s law normalization)', () => {
  const text = `---
step: "1_grill"
source: "n/a"
---
`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.strictEqual(fields.step, '1_grill');
  assert.strictEqual(fields.source, 'n/a');
});

test('parser: single-quoted string also stripped', () => {
  const text = `---
step: '1_grill'
---
`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.strictEqual(fields.step, '1_grill');
});

test('parser: quoted integer-looking string stays a string (writer-chosen type semantics)', () => {
  const text = `---
revision: "1"
---
`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.strictEqual(fields.revision, '1');
  assert.strictEqual(typeof fields.revision, 'string');
});

test('parser: negative integers parse correctly', () => {
  const text = `---
delta: -5
---
`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.strictEqual(fields.delta, -5);
});

test('parser: blank lines inside frontmatter are skipped', () => {
  const text = `---
phase: architect

step: 1_grill

status: complete
---
`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.equal(fields.phase, 'architect');
  assert.equal(fields.step, '1_grill');
  assert.equal(fields.status, 'complete');
});

test('parser: trailing whitespace on values is trimmed', () => {
  const text = '---\nphase: architect   \nstep: 1_grill\t\n---\n';
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.strictEqual(fields.phase, 'architect');
  assert.strictEqual(fields.step, '1_grill');
});

test('parser: empty value normalized to empty string', () => {
  const text = `---
phase:
step: 1_grill
---
`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.strictEqual(fields.phase, '');
  assert.strictEqual(fields.step, '1_grill');
});

test('parser: frontmatter-only file (no body) parses cleanly', () => {
  const text = `---
phase: architect
---`;
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.equal(fields.phase, 'architect');
});

test('parser: CRLF line endings supported', () => {
  const text = '---\r\nphase: architect\r\nstep: 1_grill\r\n---\r\n';
  const { fields, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.equal(fields.phase, 'architect');
  assert.equal(fields.step, '1_grill');
});

// --- error: no_frontmatter -------------------------------------------------

test('parser: empty input → no_frontmatter error', () => {
  const { fields, error } = parseFrontmatter('');
  assert.ok(error);
  assert.equal(error.kind, 'no_frontmatter');
  assert.equal(error.line, 1);
  assert.match(error.message, /No frontmatter block found/);
  assert.deepEqual(fields, {});
});

test('parser: null/undefined input → no_frontmatter error (defensive coercion)', () => {
  for (const bad of [null, undefined]) {
    const { error } = parseFrontmatter(bad);
    assert.ok(error);
    assert.equal(error.kind, 'no_frontmatter');
  }
});

test('parser: file with body but no `---` block → no_frontmatter error', () => {
  const text = '# Just a markdown file\n\nNo frontmatter here.\n';
  const { error } = parseFrontmatter(text);
  assert.ok(error);
  assert.equal(error.kind, 'no_frontmatter');
});

test('parser: file with non-blank line before `---` → no_frontmatter error', () => {
  const text = 'Some prefix line\n---\nphase: architect\n---\n';
  const { error } = parseFrontmatter(text);
  assert.ok(error);
  assert.equal(error.kind, 'no_frontmatter');
});

// --- error: malformed_inside ----------------------------------------------

test('parser: opening `---` without closing `---` → malformed_inside error', () => {
  const text = `---
phase: architect
step: 1_grill
`;
  const { error } = parseFrontmatter(text);
  assert.ok(error);
  assert.equal(error.kind, 'malformed_inside');
  assert.equal(error.line, 1);
  assert.match(error.message, /no closing `---` delimiter/);
});

test('parser: line inside frontmatter without colon → malformed_inside error with correct line', () => {
  const text = `---
phase: architect
not-a-key-value
status: complete
---
`;
  const { error } = parseFrontmatter(text);
  assert.ok(error);
  assert.equal(error.kind, 'malformed_inside');
  assert.equal(error.line, 3);
  assert.match(error.message, /Expected `key: value` format/);
});

test('parser: line inside frontmatter with empty key → malformed_inside error', () => {
  const text = `---
phase: architect
: orphan-value
---
`;
  const { error } = parseFrontmatter(text);
  assert.ok(error);
  assert.equal(error.kind, 'malformed_inside');
  assert.match(error.message, /key is empty/);
});
