// Test for the skill-mirror sync's _evals/ ignore. The sync skips
// underscore-prefixed source directories, so the skill-eval fixture corpus under
// .agents/skills/_evals/ is neither mirrored into .claude/skills/ nor flagged stale
// by the pre-commit `--check`. Importing the module here ALSO proves the invokedAsCli
// guard holds — if it didn't, importing would run a real sync at test time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSkippedSourceDir } from '../../../scripts/sync-claude-skills.mjs';

test('isSkippedSourceDir: underscore-prefixed dirs (the _evals corpus) are skipped', () => {
  assert.equal(isSkippedSourceDir('_evals'), true);
  assert.equal(isSkippedSourceDir('_anything'), true);
});

test('isSkippedSourceDir: real skill dirs are NOT skipped (they must still mirror)', () => {
  assert.equal(isSkippedSourceDir('lfe-boot'), false);
  assert.equal(isSkippedSourceDir('lfe-security-check'), false);
  assert.equal(isSkippedSourceDir('lfe-skill-eval'), false);
});

test('isSkippedSourceDir: non-string / empty input → false, never throws', () => {
  assert.equal(isSkippedSourceDir(''), false);
  assert.equal(isSkippedSourceDir(null), false);
  assert.equal(isSkippedSourceDir(undefined), false);
  assert.equal(isSkippedSourceDir(42), false);
});

test('importing the sync module is side-effect-free (the invokedAsCli guard holds)', () => {
  // The import at the top resolved without running main(): a missing guard would have
  // executed a real sync (writing .claude/skills/ or exiting) the moment this file loaded.
  assert.equal(typeof isSkippedSourceDir, 'function');
});
