// Tests for bash-posture-gate.mjs — the C1 terminal git posture gate.
// Common-contract cells live in the shared gate-harness; this file declares
// the descriptor + retains C1's distinctive tier-0/1/2 + MERGE-OK + classifier cells.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, hasActiveMission } from '../bash-posture-gate.mjs';
import { runCommonGateContract, captureAppend } from './gate-harness.mjs';

function card({ state = '[IN-FLIGHT: builder]', persona = 'Builder', mission = 'Enforcement Hardening' } = {}) {
  return [
    `| **Mission State** | ${state} |`,
    `| **Active Persona** | ${persona} |`,
    `| **Active Mission** | ${mission} |`,
  ].join('\n');
}

function transcript(userMessages) {
  return userMessages.map((t) => JSON.stringify({ role: 'user', content: t })).join('\n');
}

function makeRead({ cardText = card(), posture = '{}', transcript: tx = null } = {}) {
  return async (p) => {
    const s = String(p);
    if (s.endsWith('pipeline_status.md')) {
      if (cardText === null) throw new Error('no card');
      return cardText;
    }
    if (s.endsWith('enforcement-posture.json')) return posture;
    if (s.endsWith('.jsonl')) {
      if (tx === null) throw new Error('no transcript');
      return tx;
    }
    if (s.endsWith('.session-id') || s.endsWith('.session-booted')) throw new Error('absent');
    throw new Error('unexpected read: ' + s);
  };
}

function stdin({ command = 'git commit -m x', tx = '/repo/transcript.jsonl' } = {}) {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
    cwd: '/repo',
    session_id: 'sess-1',
    transcript_path: tx,
  });
}

const ENV = { CLAUDE_PROJECT_DIR: '/repo' };
const noTrail = async () => ['.gitkeep'];
const withTrail = async () => ['.gitkeep', '01_grill_summary.md'];

// --- Common contract (shared harness) ----------------------------------------
// Trigger = a tier-1 `git commit` with no active mission ([MISSION COMPLETE] + noTrail).
// gatedTool is Bash, so the harness wrong-tool cell uses a Write payload.

runCommonGateContract(test, {
  main,
  gateName: 'bash-posture',
  env: ENV,
  listPlans: noTrail,
  makeRead,
  wrongToolStdin: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'x' }, cwd: '/repo' }),
  triggerStdin: stdin({ command: 'git commit -m x' }),
  triggerReadOpts: { cardText: card({ state: '[MISSION COMPLETE]' }) },
  reasonOnTrigger: 'git-mutation-no-mission',
});

// --- Distinctive rule cells ---------------------------------------------------

test('hasActiveMission: in-flight state OR coordination trail', () => {
  assert.equal(hasActiveMission({ missionState: '[IN-FLIGHT: builder]', hasCoordinationTrail: false }), true);
  assert.equal(hasActiveMission({ missionState: '[MISSION COMPLETE]', hasCoordinationTrail: true }), true);
  assert.equal(hasActiveMission({ missionState: '[MISSION COMPLETE]', hasCoordinationTrail: false }), false);
});

test('empty command => ALLOW', async () => {
  const r = await main({
    stdinText: stdin({ command: '   ' }), readFileText: makeRead(), appendFileText: async () => {},
    listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
});

test('tier-0 command (git status) => silent ALLOW, no telemetry', async () => {
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin({ command: 'git status' }), readFileText: makeRead(), appendFileText: append,
    listPlans: withTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, ''); assert.equal(calls.length, 0);
});

test('tier-0 non-git (npm test) => silent ALLOW', async () => {
  const r = await main({
    stdinText: stdin({ command: 'npm test' }), readFileText: makeRead(), appendFileText: async () => {},
    listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
});

test('tier-1 + active mission (in-flight) => ALLOW', async () => {
  const r = await main({
    stdinText: stdin({ command: 'git commit -m x' }), readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: builder]' }) }),
    appendFileText: async () => {}, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
});

test('tier-1 + active mission (trail, card complete) => ALLOW', async () => {
  const r = await main({
    stdinText: stdin({ command: 'git commit -m x' }), readFileText: makeRead({ cardText: card({ state: '[MISSION COMPLETE]' }) }),
    appendFileText: async () => {}, listPlans: withTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
});

test('tier-1 + no mission => warn + telemetry (reason)', async () => {
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin({ command: 'git commit -m x' }), readFileText: makeRead({ cardText: card({ state: '[MISSION COMPLETE]' }) }),
    appendFileText: append, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /warn-and-log/);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].c.trim()).reason, 'git-mutation-no-mission');
});

test('tier-2 + mission + MERGE-OK in transcript => ALLOW', async () => {
  const r = await main({
    stdinText: stdin({ command: 'git push origin main' }),
    readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: archivist]' }), transcript: transcript(['go ahead MERGE-OK please']) }),
    appendFileText: async () => {}, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
});

test('tier-2 + mission + NO token => warn (needs-confirmation)', async () => {
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin({ command: 'git push origin main' }),
    readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: archivist]' }), transcript: transcript(['just push it']) }),
    appendFileText: append, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /MERGE-OK/);
  assert.equal(JSON.parse(calls[0].c.trim()).reason, 'git-tier2-needs-confirmation');
});

test('tier-2 + no mission => warn (tier2-no-mission)', async () => {
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin({ command: 'git merge dev' }), readFileText: makeRead({ cardText: card({ state: '[MISSION COMPLETE]' }) }),
    appendFileText: append, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.match(r.stderr, /no active mission/i);
  assert.equal(JSON.parse(calls[0].c.trim()).reason, 'git-tier2-no-mission');
});

test('tier-2 + mission + unreadable transcript => warn (not confirmed)', async () => {
  const { calls, append } = captureAppend();
  const r = await main({
    stdinText: stdin({ command: 'git push origin main' }),
    readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: archivist]' }), transcript: null }), // transcript read throws
    appendFileText: append, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.match(r.stderr, /warn-and-log/);
  assert.equal(JSON.parse(calls[0].c.trim()).reason, 'git-tier2-needs-confirmation');
});

test('tier-2 MERGE-OK confirmation reads the transcript via injected readFileTail (AC1)', async () => {
  // makeRead is given transcript:null, so a transcript read THROUGH readFileText would
  // throw → not-confirmed → warn. A silent ALLOW proves the bounded readFileTail seam
  // (returning MERGE-OK) is the one consulted for the transcript.
  const tailCalls = [];
  const r = await main({
    stdinText: stdin({ command: 'git push origin main' }),
    readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: archivist]' }), transcript: null }),
    readFileTail: async (p) => { tailCalls.push(String(p)); return transcript(['go ahead MERGE-OK please']); },
    appendFileText: async () => {}, listPlans: noTrail, now: () => 'T', env: ENV,
  });
  assert.equal(r.stdout, ''); // ALLOW — confirmed via the tail reader
  assert.equal(r.stderr, '');
  assert.equal(tailCalls.length, 1, 'transcript read exactly once via readFileTail');
  assert.match(tailCalls[0], /\.jsonl$/);
});
