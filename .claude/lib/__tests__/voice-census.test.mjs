// Unit suite for the voice-census core (.claude/lib/voice-census.mjs).
// Behavior-first: assert the findings/partition a given input produces, via the pure
// helpers + the injected-I/O runner (FS-free), mirroring the DI test seam of
// plan-linter / be-escape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMarkers,
  partitionFindings,
  censusText,
  collectUnusedAllowlist,
  allowlistKey,
  resolveInScope,
  runCensus,
} from '../voice-census.mjs';
import { MARKER_LEXICON } from '../voice-census-config.mjs';

// --- findMarkers -------------------------------------------------------------

test('findMarkers: detects every marker form in the lexicon', () => {
  const lines = [
    'You must never edit src.',       // never
    'Do not bypass the gate.',        // do not
    "Don't touch the core.",          // don't
    'You cannot proceed.',            // cannot
    "You can't proceed.",             // can't
    'You must not push.',             // must not
    "You mustn't push.",              // mustn't
    'The Scout may not add files.',   // may not
    'You shall not pass.',            // shall not
    'This is forbidden.',             // forbidden
    'That is prohibited.',            // prohibited
    'We disallow that.',              // disallow
    'That is not allowed.',           // not allowed
    'That is not permitted.',         // not permitted
    'No edits are allowed here.',     // no-allowed
    'Zero code edits.',               // zero
  ];
  const found = new Set(findMarkers(lines.join('\n')).map((f) => f.marker));
  for (const m of MARKER_LEXICON.map((e) => e.marker)) {
    assert.ok(found.has(m), `expected lexicon marker "${m}" to be detected`);
  }
});

test('findMarkers: affirmative text yields no findings', () => {
  const text = 'Edit only the docs. Keep code in src. Run the suite and confirm it passes.';
  assert.deepEqual(findMarkers(text), []);
});

test('findMarkers: 1-based line numbers and marker labels', () => {
  const text = 'clean line\nDo not edit here.';
  const f = findMarkers(text);
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 2);
  assert.equal(f[0].marker, 'do not');
});

test('findMarkers: fail-soft on odd input (never throws)', () => {
  assert.deepEqual(findMarkers(null), []);
  assert.deepEqual(findMarkers(undefined), []);
  assert.deepEqual(findMarkers(12345), []);
  assert.deepEqual(findMarkers('never', null), []); // bad lexicon → empty
});

// --- partitionFindings -------------------------------------------------------

test('partitionFindings: allowlist is file-scoped AND snippet-scoped', () => {
  const findings = [{ file: 'a.md', line: 1, lineText: 'Do not edit.', marker: 'do not' }];

  const otherFile = partitionFindings(findings, 'a.md', [{ file: 'other.md', snippet: 'Do not edit', reason: 'x' }]);
  assert.equal(otherFile.flagged.length, 1, 'entry for a different file does not allow');
  assert.equal(otherFile.allowed.length, 0);

  const match = partitionFindings(findings, 'a.md', [{ file: 'a.md', snippet: 'Do not edit', reason: 'hard limit' }]);
  assert.equal(match.allowed.length, 1);
  assert.equal(match.flagged.length, 0);
  assert.equal(match.allowed[0].reason, 'hard limit');

  const wrongSnippet = partitionFindings(findings, 'a.md', [{ file: 'a.md', snippet: 'unrelated text', reason: 'x' }]);
  assert.equal(wrongSnippet.flagged.length, 1, 'snippet must occur in the line');
});

test('partitionFindings: an allowlist entry may target a glob', () => {
  const findings = [{ file: 'skills/x.md', line: 1, lineText: 'Never exceed the cap.', marker: 'never' }];
  const res = partitionFindings(findings, 'skills/x.md', [{ file: 'skills/*.md', snippet: 'Never exceed the cap', reason: 'g' }]);
  assert.equal(res.allowed.length, 1);
});

// --- censusText --------------------------------------------------------------

test('censusText: integrates find + partition and tags the file', () => {
  const text = 'Do not edit.\nKeep at most 3 — never exceed.';
  const res = censusText('f.md', text, {
    allowlist: [{ file: 'f.md', snippet: 'never exceed', reason: 'hard limit', kind: 'hard-limit' }],
  });
  assert.equal(res.flagged.length, 1);
  assert.equal(res.flagged[0].file, 'f.md');
  assert.equal(res.flagged[0].marker, 'do not');
  assert.equal(res.allowed.length, 1);
  assert.equal(res.allowed[0].marker, 'never');
  assert.equal(res.allowed[0].kind, 'hard-limit', 'allowed items carry the entry kind');
});

test('censusText: fail-soft on null text / null allowlist', () => {
  const res = censusText('f.md', null, { allowlist: null });
  assert.deepEqual(res.flagged, []);
  assert.deepEqual(res.allowed, []);
});

// --- collectUnusedAllowlist --------------------------------------------------

test('collectUnusedAllowlist: reports entries that matched nothing', () => {
  const allowlist = [
    { file: 'a.md', snippet: 'used', reason: 'x' },
    { file: 'a.md', snippet: 'dead', reason: 'stale' },
  ];
  const used = new Set([allowlistKey(allowlist[0])]);
  const unused = collectUnusedAllowlist(allowlist, used);
  assert.equal(unused.length, 1);
  assert.equal(unused[0].snippet, 'dead');
});

test('collectUnusedAllowlist: fail-soft on null inputs', () => {
  assert.deepEqual(collectUnusedAllowlist(null, null), []);
});

// --- runCensus (injected I/O) ------------------------------------------------

test('runCensus: scopes, reads, partitions, aggregates', async () => {
  const contents = {
    'a.md': 'Do not edit.\nClean line.',
    'b.md': 'You must never push.',
    'skip.md': 'Never ever.',
  };
  const res = await runCensus({
    listFiles: async () => Object.keys(contents),
    readFileText: async (f) => contents[f],
    scopeGlobs: ['*.md'],
    excludeGlobs: ['skip.md'],
    allowlist: [],
  });
  assert.equal(res.filesScanned, 2, 'skip.md excluded');
  assert.equal(res.flaggedTotal, 2);
  assert.ok(res.perFile.find((p) => p.file === 'a.md'));
  assert.ok(!res.perFile.find((p) => p.file === 'skip.md'));
});

test('runCensus: fail-soft on an unreadable file — records error, scans the rest', async () => {
  const res = await runCensus({
    listFiles: async () => ['ok.md', 'bad.md'],
    readFileText: async (f) => {
      if (f === 'bad.md') throw new Error('EACCES');
      return 'Do not.';
    },
    scopeGlobs: ['*.md'],
    allowlist: [],
  });
  assert.equal(res.filesScanned, 1);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].file, 'bad.md');
  assert.equal(res.flaggedTotal, 1);
});

test('runCensus: listFiles failure → empty run, no throw', async () => {
  const res = await runCensus({
    listFiles: async () => {
      throw new Error('boom');
    },
    readFileText: async () => '',
    scopeGlobs: ['*.md'],
  });
  assert.equal(res.filesScanned, 0);
  assert.equal(res.flaggedTotal, 0);
});

test('runCensus: empty scope → nothing scanned', async () => {
  const res = await runCensus({
    listFiles: async () => ['a.md'],
    readFileText: async () => 'Never.',
    scopeGlobs: [],
    allowlist: [],
  });
  assert.equal(res.filesScanned, 0);
  assert.equal(res.flaggedTotal, 0);
});

test('runCensus: a file matched by two scope globs is scanned once', async () => {
  const res = await runCensus({
    listFiles: async () => ['x.md'],
    readFileText: async () => 'Do not.',
    scopeGlobs: ['*.md', 'x.md'],
    allowlist: [],
  });
  assert.equal(res.filesScanned, 1);
});

test('runCensus: allowlist partitions, and unused entries are reported', async () => {
  const res = await runCensus({
    listFiles: async () => ['a.md'],
    readFileText: async () => 'Never exceed the cap.',
    scopeGlobs: ['*.md'],
    allowlist: [
      { file: 'a.md', snippet: 'Never exceed the cap', reason: 'hard limit' },
      { file: 'a.md', snippet: 'this never appears', reason: 'stale' },
    ],
  });
  assert.equal(res.flaggedTotal, 0);
  assert.equal(res.allowedTotal, 1);
  assert.equal(res.unusedAllowlist.length, 1);
  assert.equal(res.unusedAllowlist[0].snippet, 'this never appears');
});

// --- discrimination hardening (TDD pass) -------------------------------------

test('findMarkers: multiple distinct markers on one line each surface', () => {
  // Guards against a "break after the first marker per line" regression.
  const markers = findMarkers('Do not ever; you must never.')
    .filter((x) => x.line === 1)
    .map((x) => x.marker);
  assert.ok(markers.includes('do not'), 'do not');
  assert.ok(markers.includes('never'), 'never');
});

test('partitionFindings: a snippet covering a multi-marker line allows every marker on it', () => {
  const line = 'Do not ever; never.';
  const findings = [
    { file: 'a.md', line: 1, lineText: line, marker: 'do not' },
    { file: 'a.md', line: 1, lineText: line, marker: 'never' },
  ];
  const res = partitionFindings(findings, 'a.md', [{ file: 'a.md', snippet: line, reason: 'preserved line' }]);
  assert.equal(res.allowed.length, 2);
  assert.equal(res.flagged.length, 0);
});

test('allowlistKey: distinct entries whose fields are space-adjacent do not collide', () => {
  // file+snippet must be joined by a separator that cannot occur in either field,
  // else "a.md"/"b c" and "a.md b"/"c" would share a key and hide an unused entry.
  const k1 = allowlistKey({ file: 'a.md', snippet: 'b c' });
  const k2 = allowlistKey({ file: 'a.md b', snippet: 'c' });
  assert.notEqual(k1, k2);
});

// --- resolveInScope (pure scope resolution helper) ------------

test('resolveInScope: dedups, normalizes, and applies scope ∧ ¬exclude', () => {
  const inScope = resolveInScope(
    ['a.md', './a.md', 'b.md', 'skip.md', 'c.txt'],
    ['*.md'],
    ['skip.md'],
  );
  // './a.md' normalizes to 'a.md' (deduped); 'skip.md' excluded; 'c.txt' out of scope.
  assert.deepEqual(inScope, ['a.md', 'b.md']);
});

test('resolveInScope: fail-soft on a non-array file list', () => {
  assert.deepEqual(resolveInScope(null, ['*.md'], []), []);
});

// --- defensive guard: malformed allowlist entry -----------------------------

test('partitionFindings: an allowlist entry missing `snippet` stays flagged (entryCovers guard, no throw)', () => {
  const findings = [{ file: 'a.md', line: 1, lineText: 'Do not edit.', marker: 'do not' }];
  // A malformed entry with no `snippet` is not a valid preserve directive: entryCovers'
  // `!entry.snippet` guard returns false, so the finding stays flagged and nothing throws.
  const res = partitionFindings(findings, 'a.md', [{ file: 'a.md', reason: 'malformed — no snippet' }]);
  assert.equal(res.flagged.length, 1);
  assert.equal(res.allowed.length, 0);

  // Discriminate the guard itself, not just its outcome: on a line that contains the literal
  // substring "undefined", dropping the `!entry.snippet` guard makes
  // String(lineText).includes(entry.snippet) === ('…undefined…').includes(undefined)
  // === .includes("undefined") === true — which would WRONGLY allow the finding. The guard
  // keeps it flagged, so this case goes red the moment the guard is removed (kills that mutant).
  const onUndefinedLine = [{ file: 'a.md', line: 1, lineText: 'Do not rely on undefined behavior.', marker: 'do not' }];
  const guarded = partitionFindings(onUndefinedLine, 'a.md', [{ file: 'a.md', reason: 'malformed — no snippet' }]);
  assert.equal(guarded.flagged.length, 1, 'snippet-less entry must not allow via includes("undefined")');
  assert.equal(guarded.allowed.length, 0);
});
