// BE substrate library unit tests.
// Unit-test surface lifted from `.claude/hooks/__tests__/persona-path-lock.test.mjs`
// when the 7 BE helpers + 3 constants moved out of the hook into the shared library
// at `.claude/lib/be-escape.mjs`. New `describe('normalizePath: Sec-G1.H1 traversal
// closure')` block pins the path-traversal fix.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LFE_FORCE_KEYWORD,
  LFE_FORCE_SCAN_WINDOW,
  PROTOCOL_DEBT_PATH,
  DEBT_ROW_MAX_MISSION_CHARS,
  TRANSCRIPT_TAIL_BYTES,
  getGlobCacheSize,
  normalizePath,
  matchGlob,
  matchAnyGlob,
  extractActiveMission,
  extractAuthorizedScope,
  AUTHORIZED_SCOPE_PLACEHOLDERS,
  extractLfeForceFromTranscript,
  extractKeywordFromTranscript,
  buildDebtRow,
  insertDebtRowIntoFile,
} from '../be-escape.mjs';

// --- Shared fixtures (lifted) -------------------------------------------------

const PROTOCOL_DEBT_FIXTURE = `# LFE Protocol Debt Log

This file tracks every instance where the LFE Protocol was bypassed using the \`LFE-FORCE\` override.

> [!WARNING]
> All entries in this log must be resolved in the very next session by an Archivist/Inspector mission.

| Date | Mission | Reason for LFE-FORCE | Resolution Status |
| :--- | :--- | :--- | :--- |
| 2026-05-15 | Sample Mission | Bootstrap | resolved (session 2) |

---

**Archive:** Older entries are in [archive/protocol-debt-history.md](../archive/protocol-debt-history.md). Last archive sweep: session 5.
`;

function makeTranscript({ userMessages = [] } = {}) {
  return userMessages
    .map((text) => JSON.stringify({ role: 'user', content: text }))
    .join('\n');
}

// --- normalizePath ------------------------------------------------------------

describe('normalizePath', () => {
  test('strips Windows backslashes', () => {
    assert.equal(normalizePath('src\\foo\\bar.js'), 'src/foo/bar.js');
  });
  test('strips leading ./', () => {
    assert.equal(normalizePath('./src/foo.js'), 'src/foo.js');
  });
  test('strips project root prefix when present', () => {
    assert.equal(normalizePath('/proj/src/foo.js', '/proj'), 'src/foo.js');
  });
  test('handles trailing slash on project root', () => {
    assert.equal(normalizePath('/proj/src/foo.js', '/proj/'), 'src/foo.js');
  });
  test('handles Windows project root with backslashes', () => {
    assert.equal(normalizePath('C:\\proj\\src\\foo.js', 'C:\\proj'), 'src/foo.js');
  });
  test('returns empty for empty input', () => {
    assert.equal(normalizePath(''), '');
    assert.equal(normalizePath(null), '');
  });
});

describe('normalizePath: Sec-G1.H1 traversal closure', () => {
  test('canonicalises src/../etc/passwd → etc/passwd', () => {
    assert.equal(normalizePath('src/../etc/passwd'), 'etc/passwd');
  });
  test('canonicalises .claude/../etc/passwd → etc/passwd', () => {
    assert.equal(normalizePath('.claude/../etc/passwd'), 'etc/passwd');
  });
  test('canonicalises Windows-backslash traversal src\\..\\etc\\passwd → etc/passwd', () => {
    assert.equal(normalizePath('src\\..\\etc\\passwd'), 'etc/passwd');
  });
  test('canonicalises after project-root strip (/proj/src/../etc/passwd → etc/passwd)', () => {
    assert.equal(normalizePath('/proj/src/../etc/passwd', '/proj'), 'etc/passwd');
  });
  test('canonicalises chained dot-segments foo/./bar/.././baz → foo/baz', () => {
    assert.equal(normalizePath('foo/./bar/.././baz'), 'foo/baz');
  });
  test('canonicalises trailing .. (a/b/..) → a', () => {
    assert.equal(normalizePath('a/b/..'), 'a');
  });
  test('canonicalises a/.. → empty (dot-only result treated as empty path)', () => {
    assert.equal(normalizePath('a/..'), '');
  });
  test('preserves escape-beyond-root .. → ../ (leading-.. preserved by posix.normalize)', () => {
    assert.equal(normalizePath('../foo'), '../foo');
  });
  test('POST-FIX glob composition: .claude/../etc/passwd does NOT match .claude/** after normalize', () => {
    // This is the load-bearing assertion for Sec-G1.H1. Pre-fix, the raw input
    // `.claude/../etc/passwd` would have been compared as-is against the glob
    // `.claude/**` (regex `^\.claude/.*$`) and matched spuriously, short-
    // circuiting to silent ALLOW in the framework-infra carve-out. Post-fix,
    // normalizePath returns `etc/passwd` and the glob correctly fails.
    const target = normalizePath('.claude/../etc/passwd');
    assert.equal(target, 'etc/passwd');
    assert.ok(!matchGlob(target, '.claude/**'));
    assert.ok(!matchGlob(target, 'src/**'));
  });
  test('POST-FIX glob composition: src/../etc/passwd does NOT match src/** after normalize', () => {
    const target = normalizePath('src/../etc/passwd');
    assert.equal(target, 'etc/passwd');
    assert.ok(!matchGlob(target, 'src/**'));
  });
  test('benign paths unchanged: src/foo.js normalizes to src/foo.js', () => {
    assert.equal(normalizePath('src/foo.js'), 'src/foo.js');
    assert.ok(matchGlob(normalizePath('src/foo.js'), 'src/**'));
  });
});

// --- matchGlob ----------------------------------------------------------------

describe('matchGlob', () => {
  test('canonical everything pattern matches anything', () => {
    assert.ok(matchGlob('src/foo.js', '**/*'));
    assert.ok(matchGlob('foo.js', '**/*'));
    assert.ok(matchGlob('.docs/x/y/z.md', '**/*'));
    assert.ok(matchGlob('a/b/c/d/e/f.js', '**/*'));
    assert.ok(matchGlob('anything', '**'));
  });
  test('** at end matches nested paths', () => {
    assert.ok(matchGlob('.claude/hooks/foo.mjs', '.claude/**'));
    assert.ok(matchGlob('.claude/settings.json', '.claude/**'));
    assert.ok(matchGlob('.claude/hooks/__tests__/foo.test.mjs', '.claude/**'));
    assert.ok(!matchGlob('.claudex/foo', '.claude/**'));
  });
  test('* matches within a single segment only', () => {
    assert.ok(matchGlob('scripts/setup-foo.mjs', 'scripts/setup-*.mjs'));
    assert.ok(matchGlob('scripts/setup-claude-env.mjs', 'scripts/setup-*.mjs'));
    assert.ok(!matchGlob('scripts/setup-foo/bar.mjs', 'scripts/setup-*.mjs'));
    assert.ok(!matchGlob('scripts/setup.mjs', 'scripts/setup-*.mjs'));
  });
  test('literal pattern matches exact string only', () => {
    assert.ok(matchGlob('CONTEXT.md', 'CONTEXT.md'));
    assert.ok(!matchGlob('subdir/CONTEXT.md', 'CONTEXT.md'));
    assert.ok(!matchGlob('CONTEXT.md.bak', 'CONTEXT.md'));
  });
  test('escapes regex metacharacters in literal portions', () => {
    assert.ok(matchGlob('path.with.dots.md', 'path.with.dots.md'));
    assert.ok(!matchGlob('pathXwith.dots.md', 'path.with.dots.md'));
  });
  test('handles src/** correctly', () => {
    assert.ok(matchGlob('src/foo.js', 'src/**'));
    assert.ok(matchGlob('src/core/golden-engine.js', 'src/**'));
    assert.ok(!matchGlob('srcfoo/x.js', 'src/**'));
  });
});

// --- matchAnyGlob -------------------------------------------------------------

describe('matchAnyGlob', () => {
  test('returns true on first match', () => {
    assert.ok(matchAnyGlob('src/foo.js', ['x', 'src/**', 'y']));
  });
  test('returns false when no pattern matches', () => {
    assert.ok(!matchAnyGlob('src/foo.js', ['x', 'y', 'z']));
  });
  test('handles non-array input gracefully', () => {
    assert.ok(!matchAnyGlob('src/foo.js', null));
    assert.ok(!matchAnyGlob('src/foo.js', 'src/**'));
  });
  test('handles empty array', () => {
    assert.ok(!matchAnyGlob('src/foo.js', []));
  });
});

// --- extractActiveMission -----------------------------------------------------

describe('extractActiveMission', () => {
  test('extracts mission row', () => {
    const text = '| **Active Mission** | Sample Mission |';
    assert.equal(extractActiveMission(text), 'Sample Mission');
  });
  test('returns n/a when missing', () => {
    assert.equal(extractActiveMission('no mission here'), 'n/a');
    assert.equal(extractActiveMission(''), 'n/a');
    assert.equal(extractActiveMission(null), 'n/a');
  });
  test('truncates long missions', () => {
    const long = 'x'.repeat(200);
    const text = `| **Active Mission** | ${long} |`;
    const result = extractActiveMission(text);
    assert.ok(result.length <= DEBT_ROW_MAX_MISSION_CHARS);
    assert.ok(result.endsWith('...'));
  });
  test('strips ANSI escapes', () => {
    const text = '| **Active Mission** | \x1bhello world\x1b |';
    assert.equal(extractActiveMission(text), 'hello world');
  });
});

// --- extractAuthorizedScope --------------------

describe('extractAuthorizedScope', () => {
  test('parses a single glob from the Authorized Scope row', () => {
    const text = '| **Authorized Scope** | ../OtherRepo/** |';
    assert.deepEqual(extractAuthorizedScope(text), ['../OtherRepo/**']);
  });
  test('parses a comma-separated glob list, trimming whitespace', () => {
    const text = '| **Authorized Scope** | ../OtherRepo/** ,  vendor/**, ../sib/a.js |';
    assert.deepEqual(extractAuthorizedScope(text), ['../OtherRepo/**', 'vendor/**', '../sib/a.js']);
  });
  test('returns [] when the row is absent', () => {
    assert.deepEqual(extractAuthorizedScope('no scope row here'), []);
    assert.deepEqual(extractAuthorizedScope(''), []);
    assert.deepEqual(extractAuthorizedScope(null), []);
  });
  test('returns [] for the (none) placeholder and other placeholders', () => {
    assert.deepEqual(extractAuthorizedScope('| **Authorized Scope** | (none) |'), []);
    assert.deepEqual(extractAuthorizedScope('| **Authorized Scope** | n/a |'), []);
    assert.deepEqual(extractAuthorizedScope('| **Authorized Scope** | — |'), []);
    assert.deepEqual(extractAuthorizedScope('| **Authorized Scope** | - |'), []);
  });
  test('placeholder match is case-insensitive and drops placeholder tokens mixed with globs', () => {
    assert.deepEqual(extractAuthorizedScope('| **Authorized Scope** | (None) |'), []);
    assert.deepEqual(
      extractAuthorizedScope('| **Authorized Scope** | (none), ../Real/** |'),
      ['../Real/**'],
    );
  });
  test('returns [] for an empty cell', () => {
    assert.deepEqual(extractAuthorizedScope('| **Authorized Scope** |  |'), []);
  });
  test('strips ANSI escapes at the parser boundary', () => {
    assert.deepEqual(extractAuthorizedScope('| **Authorized Scope** | \x1b../X/**\x1b |'), ['../X/**']);
  });
  test('ignores trailing descriptive prose only if outside the cell (cell is pipe-bounded)', () => {
    // The row parser is bounded by the next `|`; a real entrance-card row puts the
    // prose after a closing pipe, so it is not captured.
    const text = '| **Authorized Scope** | ../OtherRepo/** | *(note: cleared at close)* |';
    assert.deepEqual(extractAuthorizedScope(text), ['../OtherRepo/**']);
  });
  test('placeholders constant is frozen and includes (none)', () => {
    assert.ok(AUTHORIZED_SCOPE_PLACEHOLDERS.includes('(none)'));
    assert.ok(Object.isFrozen(AUTHORIZED_SCOPE_PLACEHOLDERS));
  });
});

// --- extractLfeForceFromTranscript --------------------------------------------

describe('extractLfeForceFromTranscript', () => {
  test('detects keyword in user message (exact case)', () => {
    const t = makeTranscript({ userMessages: ['Please write LFE-FORCE this'] });
    assert.ok(extractLfeForceFromTranscript(t));
  });
  test('detects keyword case-insensitive', () => {
    const t = makeTranscript({ userMessages: ['Please write lfe-force this'] });
    assert.ok(extractLfeForceFromTranscript(t));
  });
  test('detects keyword in mixed case', () => {
    const t = makeTranscript({ userMessages: ['Lfe-Force enabled'] });
    assert.ok(extractLfeForceFromTranscript(t));
  });
  test('returns false when keyword absent', () => {
    const t = makeTranscript({ userMessages: ['regular request'] });
    assert.ok(!extractLfeForceFromTranscript(t));
  });
  test('only scans recent N messages', () => {
    const old = JSON.stringify({ role: 'user', content: 'LFE-FORCE in old message' });
    const recent = Array.from({ length: 4 }, (_, i) =>
      JSON.stringify({ role: 'user', content: `msg ${i}` }),
    );
    const transcript = [old, ...recent].join('\n');
    assert.ok(!extractLfeForceFromTranscript(transcript, 3));
  });
  test('ignores assistant messages', () => {
    const transcript = [
      JSON.stringify({ role: 'assistant', content: 'LFE-FORCE here' }),
      JSON.stringify({ role: 'user', content: 'innocent prompt' }),
    ].join('\n');
    assert.ok(!extractLfeForceFromTranscript(transcript));
  });
  test('handles content as array of strings', () => {
    const transcript = JSON.stringify({
      role: 'user',
      content: ['Please ', 'LFE-FORCE', ' me'],
    });
    assert.ok(extractLfeForceFromTranscript(transcript));
  });
  test('handles content as array of objects with text field', () => {
    const transcript = JSON.stringify({
      role: 'user',
      content: [{ type: 'text', text: 'LFE-FORCE me' }],
    });
    assert.ok(extractLfeForceFromTranscript(transcript));
  });
  test('handles nested message field (legacy format)', () => {
    const transcript = JSON.stringify({
      message: { role: 'user', content: 'LFE-FORCE me' },
    });
    assert.ok(extractLfeForceFromTranscript(transcript));
  });
  test('skips malformed lines gracefully', () => {
    const transcript = ['not json', JSON.stringify({ role: 'user', content: 'LFE-FORCE me' })].join('\n');
    assert.ok(extractLfeForceFromTranscript(transcript));
  });
  test('returns false on empty/null input', () => {
    assert.ok(!extractLfeForceFromTranscript(''));
    assert.ok(!extractLfeForceFromTranscript(null));
  });
});

// --- extractKeywordFromTranscript -------------------

describe('extractKeywordFromTranscript (generic)', () => {
  const tx = (msgs) => msgs.map((t) => JSON.stringify({ role: 'user', content: t })).join('\n');
  test('detects an arbitrary keyword case-insensitively', () => {
    assert.ok(extractKeywordFromTranscript(tx(['please MERGE-OK now']), 'MERGE-OK'));
    assert.ok(extractKeywordFromTranscript(tx(['merge-ok']), 'MERGE-OK'));
  });
  test('returns false when the keyword is absent', () => {
    assert.ok(!extractKeywordFromTranscript(tx(['just push it']), 'MERGE-OK'));
  });
  test('ignores assistant messages', () => {
    const t = [
      JSON.stringify({ role: 'assistant', content: 'MERGE-OK' }),
      JSON.stringify({ role: 'user', content: 'hi' }),
    ].join('\n');
    assert.ok(!extractKeywordFromTranscript(t, 'MERGE-OK'));
  });
  test('empty/nullish keyword returns false', () => {
    assert.ok(!extractKeywordFromTranscript(tx(['anything']), ''));
    assert.ok(!extractKeywordFromTranscript(tx(['anything']), null));
  });
  test('LFE-FORCE detector still works via delegation (behavior preserved)', () => {
    assert.ok(extractLfeForceFromTranscript(tx(['LFE-FORCE'])));
    assert.ok(!extractLfeForceFromTranscript(tx(['nope'])));
  });
});

// --- buildDebtRow -------------------------------------------------------------

describe('buildDebtRow', () => {
  test('produces correct markdown table row shape', () => {
    const row = buildDebtRow({
      now: '2026-05-17T10:00:00.000Z',
      missionName: 'Sample Mission',
      persona: 'Architect',
      target: 'src/foo.js',
    });
    assert.equal(
      row,
      '| 2026-05-17 | Sample Mission | LFE-FORCE write to `src/foo.js` by Architect persona | open |',
    );
  });
  test('uses n/a when mission missing', () => {
    const row = buildDebtRow({
      now: '2026-05-17T10:00:00.000Z',
      missionName: 'n/a',
      persona: 'Builder',
      target: 'src/x',
    });
    assert.match(row, /\| n\/a \|/);
  });
  test('escapes pipe characters in target and persona', () => {
    const row = buildDebtRow({
      now: '2026-05-17T10:00:00.000Z',
      missionName: 'm',
      persona: 'p|p',
      target: 't|t',
    });
    assert.match(row, /p\\\|p/);
    assert.match(row, /t\\\|t/);
  });
});

// --- insertDebtRowIntoFile ----------------------------------------------------

describe('insertDebtRowIntoFile', () => {
  test('inserts row before --- separator', () => {
    const result = insertDebtRowIntoFile(PROTOCOL_DEBT_FIXTURE, '| 2026-05-17 | M | reason | open |');
    const separatorIdx = result.indexOf('\n---');
    const rowIdx = result.indexOf('| 2026-05-17 | M | reason | open |');
    assert.ok(rowIdx >= 0, 'row should appear in result');
    assert.ok(rowIdx < separatorIdx, 'row should be before --- separator');
  });
  test('preserves archive pointer at end of file', () => {
    const result = insertDebtRowIntoFile(PROTOCOL_DEBT_FIXTURE, '| 2026-05-17 | M | reason | open |');
    assert.ok(result.includes('**Archive:**'));
    assert.ok(result.endsWith('\n'));
  });
  test('preserves the pre-existing debt row', () => {
    const result = insertDebtRowIntoFile(PROTOCOL_DEBT_FIXTURE, '| 2026-05-17 | M | reason | open |');
    assert.ok(result.includes('| 2026-05-15 | Sample Mission | Bootstrap | resolved (session 2) |'));
  });
  test('appends at end when no separator found', () => {
    const noSep = '# Just a header\n\n| date | mission | reason | status |\n';
    const result = insertDebtRowIntoFile(noSep, '| row |');
    assert.ok(result.endsWith('| row |\n'));
  });
});

// --- Constants sanity ---------------------------------------------------------

describe('be-escape constants', () => {
  test('LFE_FORCE_KEYWORD is the canonical break-glass keyword', () => {
    assert.equal(LFE_FORCE_KEYWORD, 'LFE-FORCE');
  });
  test('LFE_FORCE_SCAN_WINDOW is positive integer', () => {
    assert.ok(Number.isInteger(LFE_FORCE_SCAN_WINDOW) && LFE_FORCE_SCAN_WINDOW >= 1);
  });
  test('PROTOCOL_DEBT_PATH is the canonical debt-log path', () => {
    assert.equal(PROTOCOL_DEBT_PATH, '.docs/quality/PROTOCOL_DEBT.md');
  });
  test('DEBT_ROW_MAX_MISSION_CHARS is positive integer', () => {
    assert.ok(Number.isInteger(DEBT_ROW_MAX_MISSION_CHARS) && DEBT_ROW_MAX_MISSION_CHARS >= 10);
  });
});

// ==========================================================================
// BE-substrate robustness
// ==========================================================================

// --- buildDebtRow: CR/LF escape (AC1; Sec-G1.M2 follow-on) ----------
describe('buildDebtRow: CR/LF escape', () => {
  test('[Falsifiable AC X] a newline in the target cannot break the row across table rows', () => {
    const row = buildDebtRow({
      now: '2026-06-01T10:00:00Z',
      missionName: 'm',
      persona: 'Architect',
      target: 'src/a.js\n| injected | row |',
    });
    assert.equal(row.split('\n').length, 1, 'row must be a single line (no raw newline)');
    assert.ok(row.includes('\\n'), 'newline must be escaped to the visible \\n token');
    assert.ok(!row.includes('\n'), 'no raw newline byte remains');
  });
  test('a carriage return in the target is escaped', () => {
    const row = buildDebtRow({
      now: '2026-06-01T10:00:00Z',
      missionName: 'm',
      persona: 'Architect',
      target: 'src/a.js\rmalicious',
    });
    assert.ok(row.includes('\\r'), 'CR must be escaped to the visible \\r token');
    assert.ok(!row.includes('\r'), 'no raw CR byte remains');
  });
  test('a CRLF target is fully escaped (no raw control bytes)', () => {
    const row = buildDebtRow({ now: '2026-06-01T10:00:00Z', missionName: 'm', persona: 'p', target: 'a\r\nb' });
    assert.ok(row.includes('\\r\\n'));
    assert.ok(!row.includes('\r') && !row.includes('\n'), 'no raw CR/LF remain');
  });
  test('defense-in-depth: a newline in the mission cell is also escaped', () => {
    const row = buildDebtRow({ now: '2026-06-01T10:00:00Z', missionName: 'evil\nmission', persona: 'p', target: 't' });
    assert.equal(row.split('\n').length, 1);
    assert.ok(row.includes('evil\\nmission'));
  });
  test('pipe-escape behavior is preserved (regression)', () => {
    const row = buildDebtRow({ now: '2026-06-01T10:00:00Z', missionName: 'm', persona: 'p|p', target: 't|t' });
    assert.match(row, /t\\\|t/);
    assert.match(row, /p\\\|p/);
  });
  test('global-flag completeness: EVERY pipe, CR, and LF is escaped, not just the first', () => {
    // 2 pipes, 2 LF, 2 CR in one field. Pins the /g flag on each replace: dropping it
    // (escape only the first occurrence) leaves a raw second char → caught here.
    const row = buildDebtRow({ now: '2026-06-01T10:00:00Z', missionName: 'm', persona: 'p', target: 'a|b|c\nd\ne\rf\rg' });
    assert.equal(row.split('\n').length, 1, 'no raw LF survives (kills the \\n /g-flag drop)');
    assert.ok(!row.includes('\r'), 'no raw CR survives (kills the \\r /g-flag drop)');
    const targetCell = row.match(/write to `([^`]*)`/)[1];
    assert.equal((targetCell.match(/\\\|/g) || []).length, 2, 'both pipes escaped (kills the \\| /g-flag drop)');
  });
});

// --- insertDebtRowIntoFile: dedup (AC2) + multi-separator mutation cell ------
describe('insertDebtRowIntoFile: dedup + multi-separator', () => {
  const ROW = '| 2026-06-01 | M | LFE-FORCE write to `src/x.js` by Architect persona | open |';

  test('[Falsifiable AC Y] inserting the same row twice yields exactly one occurrence', () => {
    const once = insertDebtRowIntoFile(PROTOCOL_DEBT_FIXTURE, ROW);
    const twice = insertDebtRowIntoFile(once, ROW);
    const count = twice.split('\n').filter((l) => l === ROW).length;
    assert.equal(count, 1, 'the duplicate insertion must be skipped');
    assert.equal(twice, once, 'a no-op dedup returns the file unchanged');
  });
  test('a genuinely different row (different target) is NOT suppressed', () => {
    const other = '| 2026-06-01 | M | LFE-FORCE write to `src/y.js` by Architect persona | open |';
    const step1 = insertDebtRowIntoFile(PROTOCOL_DEBT_FIXTURE, ROW);
    const step2 = insertDebtRowIntoFile(step1, other);
    assert.ok(step2.split('\n').some((l) => l === ROW));
    assert.ok(step2.split('\n').some((l) => l === other));
  });
  test('mutation cell (b): with multiple --- separators, the row is inserted before the FIRST', () => {
    const multi = 'head\n| a | b | c | open |\n\n---\nmiddle\n\n---\ntail\n';
    const result = insertDebtRowIntoFile(multi, ROW);
    const firstSep = result.indexOf('\n---');
    const rowIdx = result.indexOf(ROW);
    assert.ok(rowIdx >= 0, 'row should appear in result');
    assert.ok(rowIdx < firstSep, 'row must be inserted before the FIRST separator (indexOf, not lastIndexOf)');
  });
  test('dedup is CRLF-robust: an existing CRLF-terminated identical row is recognized and skipped', () => {
    // The file already contains ROW as a CRLF line. A `split('\n')` (no `\r?`) would
    // leave a trailing \r on that line (ROW + '\r' !== ROW) and FAIL to dedup; the
    // `split(/\r?\n/)` strips it. This pins the CRLF-robustness on a Windows repo.
    const crlfFile = `# Debt\r\n\r\n${ROW}\r\n\r\n---\r\ntail\r\n`;
    const result = insertDebtRowIntoFile(crlfFile, ROW);
    assert.equal(result, crlfFile, 'an existing CRLF-terminated identical row must be recognized → no-op');
  });
});

// --- extractActiveMission: cap boundary (mutation cell a) --------------------
describe('extractActiveMission: cap boundary', () => {
  test('mutation cell (a): exactly DEBT_ROW_MAX_MISSION_CHARS chars → returned unchanged (no ellipsis)', () => {
    const exact = 'x'.repeat(DEBT_ROW_MAX_MISSION_CHARS);
    const result = extractActiveMission(`| **Active Mission** | ${exact} |`);
    assert.equal(result, exact);
    assert.ok(!result.endsWith('...'));
    assert.equal(result.length, DEBT_ROW_MAX_MISSION_CHARS);
  });
  test('mutation cell (a): DEBT_ROW_MAX_MISSION_CHARS + 1 chars → truncated to exactly MAX with ellipsis', () => {
    const over = 'x'.repeat(DEBT_ROW_MAX_MISSION_CHARS + 1);
    const result = extractActiveMission(`| **Active Mission** | ${over} |`);
    assert.ok(result.endsWith('...'));
    assert.equal(result.length, DEBT_ROW_MAX_MISSION_CHARS);
  });
});

// --- extractLfeForceFromTranscript: scan-window lower bound (mutation cell c) -
describe('extractLfeForceFromTranscript: scan-window lower bound', () => {
  test('mutation cell (c): scanWindow=0 scans only the last 1 message (Math.max(1, scanWindow) guard)', () => {
    const transcript = [
      JSON.stringify({ role: 'user', content: 'LFE-FORCE in the older message' }),
      JSON.stringify({ role: 'user', content: 'innocent latest message' }),
    ].join('\n');
    // With the guard, slice(-Math.max(1,0)) = slice(-1) → only the last message is
    // scanned → keyword not found. Without it, slice(-0) = slice(0) = all → would match.
    assert.ok(!extractLfeForceFromTranscript(transcript, 0));
  });
  test('scanWindow=1 finds the keyword when it is in the last message', () => {
    const transcript = [
      JSON.stringify({ role: 'user', content: 'innocent older message' }),
      JSON.stringify({ role: 'user', content: 'now LFE-FORCE please' }),
    ].join('\n');
    assert.ok(extractLfeForceFromTranscript(transcript, 1));
  });
});

// ==========================================================================
// BE-substrate perf (AC2 compile-once)
// ==========================================================================

// --- matchGlob compile-once memo cache (AC2) --------------------------------
describe('matchGlob compile-once cache (AC2)', () => {
  test('a pattern compiles once (cache +1); reusing the SAME pattern compiles nothing new', () => {
    // Unique patterns so the delta is deterministic regardless of other suites that
    // share the process-global cache.
    const p = 'slice4-cache-uniq-1/**';
    const before = getGlobCacheSize();
    matchGlob('slice4-cache-uniq-1/a', p);
    const afterFirst = getGlobCacheSize();
    matchGlob('slice4-cache-uniq-1/b/c', p); // same pattern, different path
    const afterSecond = getGlobCacheSize();
    assert.equal(afterFirst - before, 1, 'first compile of a pattern adds exactly one cache entry');
    assert.equal(afterSecond, afterFirst, 'reusing the same pattern compiles nothing new (kills a no-cache mutation)');
  });

  test('two distinct patterns add exactly two cache entries', () => {
    const before = getGlobCacheSize();
    matchGlob('z', 'slice4-cache-uniq-2/**');
    matchGlob('z', 'slice4-cache-uniq-3/**');
    assert.equal(getGlobCacheSize() - before, 2);
  });

  test('behavior unchanged: a cached matcher returns identical results on repeat calls', () => {
    const p = 'slice4-cache-uniq-4/**';
    assert.ok(matchGlob('slice4-cache-uniq-4/deep/x', p));
    assert.ok(matchGlob('slice4-cache-uniq-4/deep/x', p)); // cached call, identical
    assert.ok(!matchGlob('other/x', p));
    assert.ok(!matchGlob('other/x', p)); // cached negative, identical
  });

  test('adversarial pattern never throws and returns a boolean (try/catch → false preserved)', () => {
    assert.equal(typeof matchGlob('x', '['), 'boolean');
    assert.equal(typeof matchGlob('x', '\\'), 'boolean');
  });
});

// --- TRANSCRIPT_TAIL_BYTES constant sanity (AC1 tuning knob) -----------------
describe('TRANSCRIPT_TAIL_BYTES (AC1)', () => {
  test('is a positive integer byte window', () => {
    assert.ok(Number.isInteger(TRANSCRIPT_TAIL_BYTES) && TRANSCRIPT_TAIL_BYTES > 0);
  });
  test('is large enough to span several user turns (≥ 64 KiB)', () => {
    assert.ok(TRANSCRIPT_TAIL_BYTES >= 65536);
  });
});

// --- Hoisted "directive" regexes are call-stable (AC2; no /g lastIndex drift) --
describe('hoisted extractor regexes are call-stable (AC2)', () => {
  test('extractActiveMission / extractAuthorizedScope return identical results on repeat calls', () => {
    const card = '| **Active Mission** | M6 S4 |\n| **Authorized Scope** | a/**, b/** |';
    // A stray /g flag on a module-hoisted regex used with .match would make the
    // second call drift (stateful lastIndex). Pin repeat-call stability + values.
    assert.equal(extractActiveMission(card), extractActiveMission(card));
    assert.deepEqual(extractAuthorizedScope(card), extractAuthorizedScope(card));
    assert.equal(extractActiveMission(card), 'M6 S4');
    assert.deepEqual(extractAuthorizedScope(card), ['a/**', 'b/**']);
  });
});

// ==========================================================================
// extractAuthorizedScope: markdown normalization (KI-3)
// ==========================================================================
// The entrance-card Authorized Scope row idiomatically wraps each glob in
// markdown backticks (and may carry a trailing italic note). Pre-KI-3 the parser
// left the backticks on the token, so matchGlob compiled them as literal chars
// and the glob never matched a backtick-free target path → the ADR-95 (G5)
// mission-aware path-lock extension silently never fired. These pin the
// backtick/italic-note stripping AND the no-regression guarantee for bare globs
// whose own `**` must survive normalization.
describe('extractAuthorizedScope: markdown normalization (KI-3)', () => {
  test('strips surrounding backticks from a single backtick-wrapped glob', () => {
    const text = '| **Authorized Scope** | `.claude/lib/**` |';
    assert.deepEqual(extractAuthorizedScope(text), ['.claude/lib/**']);
  });
  test('strips backticks from each glob in a backtick-wrapped comma list', () => {
    const text = '| **Authorized Scope** | `.claude/lib/**`, `.agents/skills/_evals/**` |';
    assert.deepEqual(extractAuthorizedScope(text), ['.claude/lib/**', '.agents/skills/_evals/**']);
  });
  test('drops a trailing *(...)* italic note attached to a backtick-wrapped glob (inside the cell)', () => {
    const text = '| **Authorized Scope** | `.agents/skills/_evals/**` *(eval corpus)* |';
    assert.deepEqual(extractAuthorizedScope(text), ['.agents/skills/_evals/**']);
  });
  test('normalizes a mix of bare and backtick-wrapped globs', () => {
    const text = '| **Authorized Scope** | .docs/README.md, `.claude/lib/**` |';
    assert.deepEqual(extractAuthorizedScope(text), ['.docs/README.md', '.claude/lib/**']);
  });
  test('REGRESSION: a bare glob ending in ** is byte-identical (note-strip must NOT eat the **)', () => {
    // Kills the mutation SCOPE_ITALIC_NOTE_RE → /\s*\*[^*]*\*\s*$/ (bare italic, no
    // parens): that would match the trailing `**` of src/** and truncate it to src/.
    // Requiring the parenthesized form keeps a bare glob's own asterisks intact.
    assert.deepEqual(extractAuthorizedScope('| **Authorized Scope** | src/** |'), ['src/**']);
    assert.deepEqual(extractAuthorizedScope('| **Authorized Scope** | `src/**` |'), ['src/**']);
  });
  test('trims whitespace adjacent to inner content inside backticks (pins the final .trim())', () => {
    // ` src/** ` — padding INSIDE the backticks. The leading/trailing backtick strip
    // exposes the residual spaces; normalizeScopeToken's closing .trim() removes them.
    // Kills the mutation that drops that final .trim() (Inspector mutation-verify, KI-3).
    assert.deepEqual(extractAuthorizedScope('| **Authorized Scope** | ` src/** ` |'), ['src/**']);
  });
  test('filters a backtick-wrapped placeholder sentinel', () => {
    assert.deepEqual(extractAuthorizedScope('| **Authorized Scope** | `(none)` |'), []);
    assert.deepEqual(
      extractAuthorizedScope('| **Authorized Scope** | `(none)`, `../Real/**` |'),
      ['../Real/**'],
    );
  });
  test('INTEGRATION: backtick-origin globs match a real target via matchAnyGlob (the behavior KI-3 broke)', () => {
    const scope = extractAuthorizedScope('| **Authorized Scope** | `.claude/lib/**`, `.agents/skills/_evals/**` |');
    // In-scope targets now match (pre-fix: false — the token carried literal backticks).
    assert.ok(matchAnyGlob('.claude/lib/be-escape.mjs', scope));
    assert.ok(matchAnyGlob('.agents/skills/_evals/fixtures/security/sec-good-1.js', scope));
    // Out-of-scope target still does not match.
    assert.ok(!matchAnyGlob('src/secret.js', scope));
  });
});
