#!/usr/bin/env node
// Portable test runner for the LFE framework's unit suite.
//
// Why this exists: the unit tests live under `.claude/**/__tests__/*.test.mjs`, and
// `node --test`'s command-line glob expansion is version-sensitive — it only landed in
// Node 21 and is unreliable through npm scripts on older runtimes (see nodejs/node#50658).
// A bare `node --test` (no args) does not discover `__tests__/` directories at all. To make
// `npm test` behave identically on every modern Node (>=18, which ships the built-in test
// runner), we discover the test files here in JS and hand the explicit file list to the
// runner — the original, most-broadly-supported invocation form, free of CLI-glob fragility.
//
// Fail-loud on zero matches: a discovery that finds nothing must NEVER exit 0 — a silent
// green is worse than a red. This also pins the discovery scope against accidental narrowing
// (a shrunk scope shows a lower count and, at zero, fails the run).

import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEARCH_ROOT = join(REPO_ROOT, '.claude');
const TEST_SUFFIX = '.test.mjs';

/** Recursively collect every *.test.mjs path under `dir` (portable; no fs.glob dependency). */
function findTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findTests(full));
    else if (entry.isFile() && entry.name.endsWith(TEST_SUFFIX)) found.push(full);
  }
  return found;
}

const files = findTests(SEARCH_ROOT).sort();

if (files.length === 0) {
  console.error(
    `[run-tests] No ${TEST_SUFFIX} files found under ${SEARCH_ROOT} — ` +
      `refusing to report a passing run with zero tests.`,
  );
  process.exit(1);
}

console.error(`[run-tests] Discovered ${files.length} test file(s) under .claude/ — running via node --test.`);

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
