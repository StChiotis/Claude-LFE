#!/usr/bin/env node
/**
 * setup-git-hooks.mjs — configure git to use the committed .githooks/ directory.
 *
 * Runs automatically via `npm install` (postinstall). Idempotent: re-running is a no-op
 * if core.hooksPath is already set to .githooks.
 *
 * Why this exists: git hooks normally live in .git/hooks/ (not committed). To share
 * hooks across developers via the repository, we commit them to .githooks/ and point
 * git there per-clone via core.hooksPath. This guarantees every developer runs the
 * same drift-prevention pre-commit hook on every commit.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const HOOKS_PATH = '.githooks';

function git(...args) {
  return spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

const probe = git('rev-parse', '--git-dir');
if (probe.status !== 0) {
  console.log('setup-git-hooks: not inside a git working tree, skipping.');
  process.exit(0);
}

const current = (git('config', '--get', 'core.hooksPath').stdout || '').trim();
if (current === HOOKS_PATH) {
  console.log(`setup-git-hooks: core.hooksPath already set to ${HOOKS_PATH}.`);
  process.exit(0);
}

const set = git('config', 'core.hooksPath', HOOKS_PATH);
if (set.status !== 0) {
  console.error(`setup-git-hooks: failed to set core.hooksPath`);
  console.error(set.stderr);
  process.exit(1);
}

console.log(`setup-git-hooks: core.hooksPath set to ${HOOKS_PATH}.`);
