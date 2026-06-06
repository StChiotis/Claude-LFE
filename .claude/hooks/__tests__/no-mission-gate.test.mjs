// Tests for no-mission-gate.mjs — the C4 "no work without a mission" gate.
// The five common-contract cells (wrong-tool, malformed-stdin, unreadable-card,
// telemetry-failure, block-posture) live in the shared gate-harness;
// file declares the descriptor + retains only C4's distinctive rule cells.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, GATE_NAME, GATED_TOOLS, C4_CARVE_OUT } from '../no-mission-gate.mjs';
import { runCommonGateContract, captureAppend } from './gate-harness.mjs';

function card({ state = '[MISSION COMPLETE]', persona = 'Architect', mission = 'n/a' } = {}) {
  return [
    `| **Mission State** | ${state} |`,
    `| **Active Persona** | ${persona} |`,
    `| **Active Mission** | ${mission} |`,
  ].join('\n');
}

function makeRead({ cardText = card(), posture = '{}', booted = false } = {}) {
  return async (p) => {
    const s = String(p);
    if (s.endsWith('pipeline_status.md')) {
      if (cardText === null) throw new Error('no card');
      return cardText;
    }
    if (s.endsWith('enforcement-posture.json')) return posture;
    if (s.endsWith('.session-booted')) {
      if (booted) return 'sess';
      throw new Error('no sentinel');
    }
    throw new Error('unexpected read: ' + s);
  };
}

function stdin({ tool = 'Write', file = 'src/foo.js' } = {}) {
  return JSON.stringify({
    tool_name: tool,
    tool_input: { file_path: file },
    cwd: '/repo',
    session_id: 'sess-1',
  });
}

const ENV = { CLAUDE_PROJECT_DIR: '/repo' };
const noTrail = async () => ['.gitkeep'];
const withTrail = async () => ['.gitkeep', '01_grill_summary.md'];

// --- Common contract (shared harness) ----------------------------------------

runCommonGateContract(test, {
  main,
  gateName: 'no-mission',
  env: ENV,
  listPlans: noTrail,
  makeRead,
  wrongToolStdin: stdin({ tool: 'Bash' }),
  triggerStdin: stdin(),
  triggerReadOpts: {}, // card [MISSION COMPLETE] + noTrail + not-booted => mission-complete-idle
  reasonOnTrigger: 'mission-complete-idle-no-trail',
});

// --- Distinctive rule cells ---------------------------------------------------

test('C4_CARVE_OUT includes .plans/** (coordination-trail writes are never gated)', () => {
  assert.ok(C4_CARVE_OUT.includes('.plans/**'));
  // GATE_NAME / GATED_TOOLS identity is exercised behaviorally by the harness
  // wrong-tool cell + the Edit-gated cell below; not re-asserted here.
  assert.deepEqual(GATED_TOOLS, ['Write', 'Edit']);
  assert.equal(GATE_NAME, 'no-mission');
});

test('missing file_path => silent ALLOW', async () => {
  const r = await main({
    stdinText: JSON.stringify({ tool_name: 'Write', tool_input: {}, cwd: '/repo' }),
    readFileText: makeRead(), appendFileText: async () => {}, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
});

test('carve-out: .plans/ write => silent ALLOW, no telemetry', async () => {
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin({ file: '.plans/01_grill_summary.md' }), readFileText: makeRead(),
    appendFileText: append, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

test('carve-out: .claude/ write => silent ALLOW', async () => {
  const r = await main({
    stdinText: stdin({ file: '.claude/hooks/x.mjs' }), readFileText: makeRead(),
    appendFileText: async () => {}, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('carve-out: pipeline_status.md => silent ALLOW', async () => {
  const r = await main({
    stdinText: stdin({ file: 'pipeline_status.md' }), readFileText: makeRead(),
    appendFileText: async () => {}, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('active Scout session => ALLOW', async () => {
  const r = await main({
    stdinText: stdin(), readFileText: makeRead({ cardText: card({ persona: 'Scout' }) }),
    appendFileText: async () => {}, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('coordination trail present (mission in flight) => ALLOW', async () => {
  const r = await main({
    stdinText: stdin(), readFileText: makeRead(), appendFileText: async () => {},
    listPlans: withTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('not MISSION COMPLETE (in-flight state) => ALLOW', async () => {
  const r = await main({
    stdinText: stdin(), readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: build]' }) }),
    appendFileText: async () => {}, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('trigger + default (warn) posture => ALLOW + stderr warn + telemetry warn (reason + target)', async () => {
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin(), readFileText: makeRead({ posture: '{}' }), appendFileText: append,
    listPlans: noTrail, now: () => '2026-01-01T00:00:00Z', env: ENV,
  });
  assert.equal(r.stdout, ''); // warn => allow (no deny envelope)
  assert.match(r.stderr, /warn-and-log/);
  assert.equal(calls.length, 1);
  const rec = JSON.parse(calls[0].c.trim());
  assert.equal(rec.gate, 'no-mission');
  assert.equal(rec.decision, 'warn');
  assert.equal(rec.reason, 'mission-complete-idle-no-trail');
  assert.equal(rec.target, 'src/foo.js');
});

test('Edit tool is also gated (trigger warns)', async () => {
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin({ tool: 'Edit' }), readFileText: makeRead(), appendFileText: append,
    listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.match(r.stderr, /warn-and-log/);
  assert.equal(calls.length, 1);
});
