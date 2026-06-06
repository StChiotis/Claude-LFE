// Test suite for the pipeline_status.md narrative guard.
// Mirrors the DI pattern of checkpoint-flip.test.mjs: every fixture passes mocks
// to main(); no real disk I/O. The hook is warn-only/silent-ALLOW — there is no
// permissionDecision envelope; assertions key off exitCode (always 0) + stderr.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  main,
  scanForPersonalPaths,
  PERSONAL_PATH_PATTERNS,
} from '../pipeline-status-narrative-check.mjs';

const PROJ = '/proj';

// Build a PostToolUse(Write) payload for a given file_path.
function payloadFor(filePath) {
  return JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath }, cwd: PROJ });
}

// A reader that returns `content` for any path.
const readerReturning = (content) => async () => content;

function makeEnv() {
  return { CLAUDE_PROJECT_DIR: PROJ };
}

const CLEAN_CARD = `# 🏛️ LFE Mission Control
| **Active Mission** | Sample Mission — wire a feature into <project-root>/.claude/lib. |
| **Coordination Files** | 01 ✅ 02 ✅ |
`;

async function run(filePath, content) {
  return main({
    stdinText: payloadFor(filePath),
    readFileText: readerReturning(content),
    now: () => '2026-05-30T00:00:00.000Z',
    env: makeEnv(),
  });
}

// --- each personal-path shape → warning, exit 0 ------------------------------

describe('narrative-guard: each generic personal-path shape warns (never blocks)', () => {
  const cases = [
    ['Windows user-profile', 'C:\\Users\\alice\\Desktop\\Claude-LFE'],
    ['macOS home', '/Users/bob/projects/claude-lfe'],
    ['Linux home', '/home/carol/work/repo'],
    ['home shorthand', '~/Desktop/Claude-LFE'],
  ];
  for (const [name, leak] of cases) {
    test(`${name} → warn + exit 0 + no deny envelope`, async () => {
      const card = `# card\n| **Active Mission** | path leaked: ${leak} here |\n`;
      const res = await run(`${PROJ}/pipeline_status.md`, card);
      assert.equal(res.exitCode, 0, 'always exit 0');
      assert.equal(res.stdout, '', 'no stdout → no permissionDecision envelope (never blocks)');
      assert.match(res.stderr, /narrative-guard/);
      assert.match(res.stderr, /warn-only/);
    });
  }
});

// --- clean narrative → silent ------------------------------------------------

test('clean narrative (generic placeholder only) → silent, exit 0', async () => {
  const res = await run(`${PROJ}/pipeline_status.md`, CLEAN_CARD);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stderr, '', 'clean card produces no warning');
  assert.equal(res.stdout, '');
});

// --- no-false-positive: legitimate repo-relative paths -----------------------

test('legitimate repo-relative paths do NOT trigger (no false positive)', async () => {
  const card = `# card
| **Pipeline** | .claude/lib/plan-linter.mjs + src/foo/bar.mjs touched; see .docs/quality/. |
| **Note** | Users of the framework should run npm test. The /home page is unrelated prose? no. |
`;
  // Note: "/home page" would be a false trigger only if it were "/home/<seg>";
  // "/home page" has a space after /home so it must NOT match.
  const res = await run(`${PROJ}/pipeline_status.md`, card);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stderr, '', `legit paths must stay silent; got: ${res.stderr}`);
});

// --- scope guard: non-pipeline_status.md write → silent no-op ----------------

test('a non-pipeline_status.md write is a silent no-op even if it contains a personal path', async () => {
  const res = await run(`${PROJ}/.plans/02_prd.md`, 'C:\\Users\\dave\\x');
  assert.equal(res.exitCode, 0);
  assert.equal(res.stderr, '', 'out-of-scope file must not be scanned');
  assert.equal(res.stdout, '');
});

// --- never-block guarantee (explicit) ----------------------------------------

test('NEVER-BLOCK: a positive hit still yields exit 0 and no deny envelope', async () => {
  const card = `# card\n| x | C:\\Users\\eve\\repo and /home/eve/repo and ~/eve |\n`;
  const res = await run(`${PROJ}/pipeline_status.md`, card);
  assert.equal(res.exitCode, 0, 'exit code is 0 even with findings');
  assert.equal(res.stdout, '', 'no JSON on stdout → cannot be a permissionDecision deny');
  assert.doesNotMatch(res.stderr, /permissionDecision|deny/i, 'no deny semantics');
});

// --- read error → silent-ALLOW + stderr --------------------------------------

test('read error → exit 0 + informative stderr (never block)', async () => {
  const res = await main({
    stdinText: payloadFor(`${PROJ}/pipeline_status.md`),
    readFileText: async () => { throw new Error('EACCES'); },
    now: () => '2026-05-30T00:00:00.000Z',
    env: makeEnv(),
  });
  assert.equal(res.exitCode, 0);
  assert.match(res.stderr, /could not read/);
});

// --- malformed stdin → silent-ALLOW ------------------------------------------

test('unparseable stdin → silent ALLOW (exit 0, no output)', async () => {
  const res = await main({
    stdinText: 'not json',
    readFileText: readerReturning('whatever'),
    now: () => '2026-05-30T00:00:00.000Z',
    env: makeEnv(),
  });
  assert.equal(res.exitCode, 0);
  assert.equal(res.stderr, '');
});

// --- pure helper: scanForPersonalPaths ---------------------------------------

describe('scanForPersonalPaths (pure)', () => {
  test('detects each shape with correct line numbers', () => {
    const text = [
      'line 1 clean',
      'C:\\Users\\frank\\x',
      '/home/grace/y',
      '/Users/heidi/z',
      '~/ivan/w',
    ].join('\n');
    const f = scanForPersonalPaths(text);
    assert.equal(f.length, 4);
    assert.deepEqual(f.map((x) => x.line).sort((a, b) => a - b), [2, 3, 4, 5]);
  });

  test('clean text → empty array', () => {
    assert.deepEqual(scanForPersonalPaths('just prose, .claude/lib paths, src/x'), []);
  });

  test('null/undefined input → empty array (defensive)', () => {
    assert.deepEqual(scanForPersonalPaths(null), []);
    assert.deepEqual(scanForPersonalPaths(undefined), []);
  });

  test('does NOT match bare /home or /Users without a name segment', () => {
    assert.deepEqual(scanForPersonalPaths('the /home page and /Users listing'), []);
  });

  test('NO hardcoded username — detector is shape-based (matches any name)', () => {
    const a = scanForPersonalPaths('/home/aaaaa/x');
    const b = scanForPersonalPaths('/home/zzzzz/x');
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  });

  test('PERSONAL_PATH_PATTERNS exports 4 shape detectors', () => {
    assert.equal(PERSONAL_PATH_PATTERNS.length, 4);
  });

  test('Windows forward-slash path counts once (not double-counted as /Users/)', () => {
    // `C:/Users/jane` must register as ONE Windows-shape hit, not also as a
    // macOS /Users/ hit — the /Users/ pattern's negative lookbehind excludes a
    // preceding drive-letter. Pins the disambiguation hot spot.
    const f = scanForPersonalPaths('C:/Users/jane/repo');
    assert.equal(f.length, 1, `expected exactly 1 hit, got ${JSON.stringify(f)}`);
    assert.match(f[0].label, /Windows/);
  });

  test('a genuine macOS /Users/ path (no drive letter) still matches', () => {
    const f = scanForPersonalPaths('see /Users/karl/x for the leak');
    assert.equal(f.length, 1);
    assert.match(f[0].label, /macOS/);
  });
});
