// Tests for the C2b Scout-boundary guard added to skill-invocation-gate.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, checkScoutBoundary, SCOUT_GATE_NAME } from '../skill-invocation-gate.mjs';

function card({ state = '[MISSION COMPLETE]', persona = 'Architect', mission = 'n/a' } = {}) {
  return [
    `| **Mission State** | ${state} |`,
    `| **Active Persona** | ${persona} |`,
    `| **Active Mission** | ${mission} |`,
  ].join('\n');
}

function makeRead({ cardText = card(), posture = '{}' } = {}) {
  return async (p) => {
    const s = String(p);
    if (s.endsWith('pipeline_status.md')) {
      if (cardText === null) throw new Error('no card');
      return cardText;
    }
    if (s.endsWith('enforcement-posture.json')) return posture;
    if (s.endsWith('.session-id') || s.endsWith('.session-booted')) throw new Error('absent');
    throw new Error('unexpected read: ' + s);
  };
}

const ENV = { CLAUDE_PROJECT_DIR: '/repo' };
const noTrail = async () => ['.gitkeep'];
const withTrail = async () => ['.gitkeep', '01_grill_summary.md'];
const payload = { cwd: '/repo', session_id: 'sess-1' };

function captureAppend() {
  const calls = [];
  return { calls, append: async (p, c) => { calls.push({ p, c }); } };
}

test('SCOUT_GATE_NAME identity', () => {
  assert.equal(SCOUT_GATE_NAME, 'scout-boundary');
});

// --- checkScoutBoundary (direct) --------------------------------------------

test('clean boundary (MISSION COMPLETE + no trail) => ALLOW', async () => {
  const { calls, append } = captureAppend();
  const r = await checkScoutBoundary({
    payload, readFileText: makeRead(), listPlans: noTrail, appendFileText: append, now: () => 'T', projectRoot: '/repo',
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, ''); assert.equal(calls.length, 0);
});

test('in-flight mission => warn + telemetry', async () => {
  const { calls, append } = captureAppend();
  const r = await checkScoutBoundary({
    payload, readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: builder]' }) }),
    listPlans: noTrail, appendFileText: append, now: () => 'T', projectRoot: '/repo',
  });
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /warn-and-log/);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].c.trim()).reason, 'scout-mid-mission');
});

test('coordination trail present (card complete) => warn', async () => {
  const { calls, append } = captureAppend();
  const r = await checkScoutBoundary({
    payload, readFileText: makeRead({ cardText: card({ state: '[MISSION COMPLETE]' }) }),
    listPlans: withTrail, appendFileText: append, now: () => 'T', projectRoot: '/repo',
  });
  assert.match(r.stderr, /warn-and-log/);
  assert.equal(calls.length, 1);
});

test('block posture => DENY envelope', async () => {
  const r = await checkScoutBoundary({
    payload, readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: builder]' }), posture: '{"scout-boundary":"block"}' }),
    listPlans: noTrail, appendFileText: async () => {}, now: () => 'T', projectRoot: '/repo',
  });
  const env = JSON.parse(r.stdout);
  assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(env.hookSpecificOutput.permissionDecisionReason, /Scout/);
});

test('listPlans absent => ALLOW (legacy/fail-safe)', async () => {
  const r = await checkScoutBoundary({
    payload, readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: builder]' }) }),
    listPlans: undefined, appendFileText: async () => {}, now: () => 'T', projectRoot: '/repo',
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
});

test('unreadable card => fail-safe ALLOW', async () => {
  const r = await checkScoutBoundary({
    payload, readFileText: makeRead({ cardText: null }), listPlans: noTrail, appendFileText: async () => {}, now: () => 'T', projectRoot: '/repo',
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
});

test('telemetry failure does not change decision', async () => {
  const r = await checkScoutBoundary({
    payload, readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: builder]' }) }),
    listPlans: noTrail, appendFileText: async () => { throw new Error('disk'); }, now: () => 'T', projectRoot: '/repo',
  });
  assert.equal(r.stdout, ''); assert.match(r.stderr, /warn-and-log/);
});

// --- main() routing ----------------------------------------------------------

function stdinScout() {
  return JSON.stringify({ user_message: '/lfe-scout', cwd: '/repo', session_id: 'sess-1' });
}

test('main: /lfe-scout at clean boundary => ALLOW', async () => {
  const r = await main({
    stdinText: stdinScout(), readFileText: makeRead(), env: ENV, listPlans: noTrail, appendFileText: async () => {}, now: () => 'T',
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
});

test('main: /lfe-scout mid-mission => warn', async () => {
  const r = await main({
    stdinText: stdinScout(), readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: builder]' }) }),
    env: ENV, listPlans: noTrail, appendFileText: async () => {}, now: () => 'T',
  });
  assert.match(r.stderr, /warn-and-log/);
});

test('main: /lfe-scout with no listPlans (legacy) => ALLOW unchanged', async () => {
  const r = await main({
    stdinText: stdinScout(), readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: builder]' }) }), env: ENV,
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
});

test('main: /lfe-boot (other Brain-typeable) => ALLOW unchanged even mid-mission', async () => {
  const r = await main({
    stdinText: JSON.stringify({ user_message: '/lfe-boot', cwd: '/repo' }),
    readFileText: makeRead({ cardText: card({ state: '[IN-FLIGHT: builder]' }) }), env: ENV, listPlans: withTrail, appendFileText: async () => {}, now: () => 'T',
  });
  assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
});
