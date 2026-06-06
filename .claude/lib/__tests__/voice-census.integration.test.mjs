// Integration suite for the voice-census — real filesystem I/O.
//   (1) A stable committed fixture → an exact, pinned flagged/allowed partition.
//   (2) The enforced-remainder invariant over the real repo: the flagged total is
//       zero for ENFORCED_GLOBS (vacuously true when ENFORCED_GLOBS is empty; gains teeth as the
//       enforced scope grows in S2–S4).
//   (3) Report mode reaches the real in-scope surface and excludes DELETE-bound paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { censusText, runCensus } from '../voice-census.mjs';
import { IN_SCOPE_GLOBS, ENFORCED_GLOBS, EXCLUDED_GLOBS } from '../voice-census-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..'); // __tests__ → lib → .claude → repo root
const FIXTURE = join(HERE, 'fixtures', 'voice-census-sample.md');

function walkRepo(root) {
  const out = [];
  const skip = new Set(['node_modules', '.git']);
  const recurse = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) recurse(full);
      else if (e.isFile()) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  recurse(root);
  return out;
}

test('integration: stable fixture → pinned flagged/allowed partition', async () => {
  const text = await readFile(FIXTURE, 'utf8');
  // The fixture has exactly four prohibitive lines (never / do not / may not / never).
  // Allowlist the single hard-limit line; the other three stay flagged.
  const res = censusText('fixture.md', text, {
    allowlist: [{ file: 'fixture.md', snippet: 'never exceed that hard limit', reason: 'hard limit (fixture)' }],
  });
  assert.equal(res.flagged.length, 3, JSON.stringify(res.flagged, null, 2));
  assert.equal(res.allowed.length, 1);
  assert.equal(res.allowed[0].reason, 'hard limit (fixture)');
});

test('integration: enforced remainder is empty over ENFORCED_GLOBS (real repo)', async () => {
  const res = await runCensus({
    listFiles: async () => walkRepo(REPO_ROOT),
    readFileText: async (rel) => readFile(join(REPO_ROOT, rel), 'utf8'),
    scopeGlobs: ENFORCED_GLOBS,
    excludeGlobs: EXCLUDED_GLOBS,
  });
  assert.equal(res.flaggedTotal, 0, JSON.stringify((res.flagged || []).slice(0, 20), null, 2));
  // Non-vacuous once ENFORCED_GLOBS covers the skills surface: the enforced
  // scan must actually reach files (guards against a glob that silently under-resolves).
  assert.ok(res.filesScanned >= 60, `enforced scope under-resolved: only ${res.filesScanned} files scanned`);
});

test('integration: enforced scope reaches the protocol surface via both globs', async () => {
  const res = await runCensus({
    listFiles: async () => walkRepo(REPO_ROOT),
    readFileText: async (rel) => readFile(join(REPO_ROOT, rel), 'utf8'),
    scopeGlobs: ENFORCED_GLOBS,
    excludeGlobs: EXCLUDED_GLOBS,
  });
  // The `**`-suffix glob (`.docs/protocol/**/*.md`) matches only the nested personas/ dir;
  // the bare `.docs/protocol/*.md` reaches the top-level governance docs. Assert BOTH
  // levels are scanned, so a dropped glob cannot silently leave a surface unenforced.
  const topLevel = res.perFile.filter((p) => /^\.docs\/protocol\/[^/]+\.md$/.test(p.file));
  const personas = res.perFile.filter((p) => /^\.docs\/protocol\/personas\/[^/]+\.md$/.test(p.file));
  assert.ok(topLevel.length >= 1, `top-level protocol docs not reached: ${topLevel.length}`);
  assert.ok(personas.length >= 1, `persona contracts not reached: ${personas.length}`);
});

test('integration: enforced scope reaches the adapters + guide', async () => {
  const res = await runCensus({
    listFiles: async () => walkRepo(REPO_ROOT),
    readFileText: async (rel) => readFile(join(REPO_ROOT, rel), 'utf8'),
    scopeGlobs: ENFORCED_GLOBS,
    excludeGlobs: EXCLUDED_GLOBS,
  });
  const paths = new Set(res.perFile.map((p) => p.file));
  // Both adapters (one is a .txt under the `.agents/adapters/**` dir glob) + the canonical
  // guide must all be scanned — guards the bare-filename and dir globs from under-resolving.
  assert.ok(paths.has('CLAUDE.md'), 'CLAUDE.md not reached by enforced scope');
  assert.ok(paths.has('.agents/adapters/system_prompt.txt'), 'system_prompt.txt not reached by enforced scope');
  assert.ok(paths.has('LLM_AGENT_GUIDE.md'), 'LLM_AGENT_GUIDE.md not reached by enforced scope');
});

test('integration: ENFORCED_GLOBS == IN_SCOPE_GLOBS — full-sweep scope symmetry', () => {
  // The enforced scope grew incrementally to equal the full in-scope rewrite surface. Lock it:
  // adding a surface to one set but not the other (or dropping one) makes this fail —
  // so enforcement can never silently diverge from the declared rewrite scope.
  assert.deepEqual([...ENFORCED_GLOBS].sort(), [...IN_SCOPE_GLOBS].sort());
});

test('integration: report mode reaches the in-scope surface and excludes DELETE-bound paths', async () => {
  const res = await runCensus({
    listFiles: async () => walkRepo(REPO_ROOT),
    readFileText: async (rel) => readFile(join(REPO_ROOT, rel), 'utf8'),
    scopeGlobs: IN_SCOPE_GLOBS,
    excludeGlobs: EXCLUDED_GLOBS,
  });
  assert.ok(res.filesScanned > 0, 'report mode scans real in-scope files');
  for (const p of res.perFile) {
    assert.ok(!p.file.startsWith('.docs/strategy/'), `DELETE-bound path scanned: ${p.file}`);
    assert.ok(!p.file.startsWith('.docs/archive/'), `DELETE-bound path scanned: ${p.file}`);
  }
});
