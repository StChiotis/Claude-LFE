// Test suite for the shared stdin reader (.claude/lib/stdin-reader.mjs).
// Array-join concat + error tolerance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStdinAll } from '../stdin-reader.mjs';

// Minimal async-iterable fakes — no real process.stdin involved.
function fakeStdin(chunks) {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

function throwingStdin(chunksBeforeThrow) {
  return (async function* () {
    for (const c of chunksBeforeThrow) yield c;
    throw new Error('stream blew up mid-iteration');
  })();
}

test('readStdinAll concatenates multiple chunks in order', async () => {
  assert.equal(await readStdinAll(fakeStdin(['a', 'b', 'c'])), 'abc');
});

test('readStdinAll returns an empty string on an empty stream', async () => {
  assert.equal(await readStdinAll(fakeStdin([])), '');
});

test('readStdinAll is error-tolerant — returns the partial read without throwing', async () => {
  assert.equal(await readStdinAll(throwingStdin(['partial'])), 'partial');
});
