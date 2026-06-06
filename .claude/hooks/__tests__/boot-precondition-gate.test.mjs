// Tests for boot-precondition-gate.mjs — the C2a "session not booted" gate.
// Common-contract cells live in the shared gate-harness; this file declares
// the descriptor (triggered via MISMATCHED markers) + retains C2a's distinctive cells.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../boot-precondition-gate.mjs';
import { runCommonGateContract, captureAppend } from './gate-harness.mjs';

function card({ state = '[IN-FLIGHT: builder]', persona = 'Builder', mission = 'Enforcement Hardening' } = {}) {
  return [
    `| **Mission State** | ${state} |`,
    `| **Active Persona** | ${persona} |`,
    `| **Active Mission** | ${mission} |`,
  ].join('\n');
}

// sessionId / booted are file contents; null => that file read throws (absent).
function makeRead({ cardText = card(), posture = '{}', sessionId = null, booted = null } = {}) {
  return async (p) => {
    const s = String(p);
    if (s.endsWith('pipeline_status.md')) {
      if (cardText === null) throw new Error('no card');
      return cardText;
    }
    if (s.endsWith('enforcement-posture.json')) return posture;
    if (s.endsWith('.session-id')) {
      if (sessionId === null) throw new Error('no id');
      return sessionId;
    }
    if (s.endsWith('.session-booted')) {
      if (booted === null) throw new Error('no booted');
      return booted;
    }
    throw new Error('unexpected read: ' + s);
  };
}

function stdin({ tool = 'Write', file = 'src/foo.js' } = {}) {
  return JSON.stringify({ tool_name: tool, tool_input: { file_path: file }, cwd: '/repo', session_id: 'sess-1' });
}

const ENV = { CLAUDE_PROJECT_DIR: '/repo' };
const noTrail = async () => ['.gitkeep'];

// --- Common contract (shared harness) ----------------------------------------
// Trigger via primed + MISMATCHED markers (sessionId 'new' ≠ booted 'old') → the
// gate's `not booted` branch. This makes the harness block cell exercise the same
// mismatch scenario the hand-written block cell used to. The ABSENT-marker warn path
// is kept as a distinctive cell below (absent vs mismatch catch different mutations
// of the `sentinel === id` comparison).

runCommonGateContract(test, {
  main,
  gateName: 'boot-precondition',
  env: ENV,
  listPlans: noTrail,
  makeRead,
  wrongToolStdin: stdin({ tool: 'Bash' }),
  triggerStdin: stdin(),
  triggerReadOpts: { sessionId: 'new', booted: 'old' },
  reasonOnTrigger: 'session-not-booted',
});

// --- Distinctive rule cells ---------------------------------------------------

test('carve-out: .plans/ write => silent ALLOW, no telemetry', async () => {
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin({ file: '.plans/active_plan.md' }),
    readFileText: makeRead({ sessionId: 'abc', booted: null }), // primed + not booted, but carve-out wins
    appendFileText: append, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

test('carve-out: .claude/ write => silent ALLOW', async () => {
  const r = await main({
    stdinText: stdin({ file: '.claude/hooks/x.mjs' }),
    readFileText: makeRead({ sessionId: 'abc', booted: null }),
    appendFileText: async () => {}, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('active Scout session => ALLOW', async () => {
  const r = await main({
    stdinText: stdin(),
    readFileText: makeRead({ cardText: card({ persona: 'Scout' }), sessionId: 'abc', booted: null }),
    appendFileText: async () => {}, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('mechanism not primed (.session-id absent) => silent fail-safe ALLOW', async () => {
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin(), readFileText: makeRead({ sessionId: null, booted: null }),
    appendFileText: append, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, ''); // no warn noise when mechanism unprimed
  assert.equal(calls.length, 0);
});

test('booted (markers match) => ALLOW', async () => {
  const r = await main({
    stdinText: stdin(), readFileText: makeRead({ sessionId: 'sess-1', booted: 'sess-1' }),
    appendFileText: async () => {}, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('primed + not booted (marker ABSENT) + warn posture => warn + telemetry', async () => {
  // Distinct from the harness mismatch trigger: absent-sentinel vs mismatched-sentinel
  // exercise different sub-conditions of `booted = primed && sentinel === id`.
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin(), readFileText: makeRead({ sessionId: 'sess-1', booted: null, posture: '{}' }),
    appendFileText: append, listPlans: noTrail, now: () => '2026-01-01T00:00:00Z', env: ENV,
  });
  assert.equal(r.stdout, ''); // warn => allow
  assert.match(r.stderr, /warn-and-log/);
  assert.equal(calls.length, 1);
  const rec = JSON.parse(calls[0].c.trim());
  assert.equal(rec.gate, 'boot-precondition');
  assert.equal(rec.decision, 'warn');
  assert.equal(rec.reason, 'session-not-booted');
});

test('Edit tool is also gated (primed + not booted warns)', async () => {
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin({ tool: 'Edit' }), readFileText: makeRead({ sessionId: 'sess-1', booted: null }),
    appendFileText: append, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.match(r.stderr, /warn-and-log/);
  assert.equal(calls.length, 1);
});
