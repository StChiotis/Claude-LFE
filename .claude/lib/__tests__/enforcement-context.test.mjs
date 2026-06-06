// Tests for enforcement-context.mjs — the shared state-reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMissionCompleteIdle,
  isScoutPersona,
  readPosture,
  readEnforcementContext,
  DEFAULT_POSTURE,
  SUBSTRATE_CARVE_OUT,
} from '../enforcement-context.mjs';

// --- pure helpers ------------------------------------------------------------

test('isMissionCompleteIdle: true only for MISSION COMPLETE states', () => {
  assert.equal(isMissionCompleteIdle('[MISSION COMPLETE]'), true);
  assert.equal(isMissionCompleteIdle('[MISSION COMPLETE] extra narrative'), true);
  assert.equal(isMissionCompleteIdle('mission complete'), true); // pins the /i flag
  assert.equal(isMissionCompleteIdle('[IN-FLIGHT: build]'), false);
  assert.equal(isMissionCompleteIdle('[BLANK CANVAS]'), false);
  assert.equal(isMissionCompleteIdle('[DOMAIN LOADED]'), false);
  assert.equal(isMissionCompleteIdle(''), false);
  assert.equal(isMissionCompleteIdle(null), false);
});

test('isScoutPersona: true only when persona is Scout (anchored)', () => {
  assert.equal(isScoutPersona('Scout'), true);
  assert.equal(isScoutPersona('Scout (Flyweight)'), true);
  assert.equal(isScoutPersona('Architect'), false);
  assert.equal(isScoutPersona('Builder *(in flight)*'), false);
  assert.equal(isScoutPersona('Architect scout'), false); // ^ anchor
  assert.equal(isScoutPersona('scoutmaster'), false); // \b boundary
  assert.equal(isScoutPersona(null), false);
});

test('isScoutPersona: detects an emoji-decorated Scout cell', () => {
  assert.equal(isScoutPersona('🚀 Scout'), true);
  assert.equal(isScoutPersona('🚀 Scout *(minor fix)*'), true);
  assert.equal(isScoutPersona('🏛️ Architect'), false);
  assert.equal(isScoutPersona('🏛️ Architect *(mentions scout)*'), false);
});

test('SUBSTRATE_CARVE_OUT contains .plans/** and the framework-infra set', () => {
  assert.ok(SUBSTRATE_CARVE_OUT.includes('.plans/**'));
  assert.ok(SUBSTRATE_CARVE_OUT.includes('.claude/**'));
  assert.ok(SUBSTRATE_CARVE_OUT.includes('pipeline_status.md'));
});

// --- readPosture -------------------------------------------------------------

function readerFor(map) {
  return async (p) => {
    const s = String(p);
    for (const [suffix, value] of Object.entries(map)) {
      if (s.endsWith(suffix)) {
        if (value === null) throw new Error('not found');
        return value;
      }
    }
    throw new Error('unexpected read: ' + s);
  };
}

test('readPosture returns configured value', async () => {
  const readFileText = readerFor({ 'enforcement-posture.json': '{"no-mission":"block"}' });
  assert.equal(await readPosture('no-mission', { readFileText, projectRoot: '/repo' }), 'block');
});

test('readPosture defaults to warn on missing file', async () => {
  const readFileText = readerFor({ 'enforcement-posture.json': null });
  assert.equal(await readPosture('no-mission', { readFileText, projectRoot: '/repo' }), DEFAULT_POSTURE);
});

test('readPosture defaults to warn on missing key', async () => {
  const readFileText = readerFor({ 'enforcement-posture.json': '{"other":"block"}' });
  assert.equal(await readPosture('no-mission', { readFileText, projectRoot: '/repo' }), 'warn');
});

test('readPosture defaults to warn on invalid value', async () => {
  const readFileText = readerFor({ 'enforcement-posture.json': '{"no-mission":"nonsense"}' });
  assert.equal(await readPosture('no-mission', { readFileText, projectRoot: '/repo' }), 'warn');
});

test('readPosture defaults to warn on malformed JSON', async () => {
  const readFileText = readerFor({ 'enforcement-posture.json': '{not json' });
  assert.equal(await readPosture('no-mission', { readFileText, projectRoot: '/repo' }), 'warn');
});

// --- readEnforcementContext --------------------------------------------------

function card({ state = '[MISSION COMPLETE]', persona = 'Architect', mission = 'n/a' } = {}) {
  return [
    `| **Mission State** | ${state} |`,
    `| **Active Persona** | ${persona} |`,
    `| **Active Mission** | ${mission} |`,
  ].join('\n');
}

// booted/sessionId are file contents (null => that file read throws / absent).
function ctxReader({ cardText = card(), sessionId = null, booted = null } = {}) {
  return async (p) => {
    const s = String(p);
    if (s.endsWith('pipeline_status.md')) {
      if (cardText === null) throw new Error('no card');
      return cardText;
    }
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

const payload = { tool_name: 'Write', tool_input: { file_path: 'src/foo.js' }, cwd: '/repo', session_id: 'sess-1' };

test('readEnforcementContext: unreadable card => fail-safe shape', async () => {
  const ctx = await readEnforcementContext({
    payload,
    readFileText: ctxReader({ cardText: null }),
    listPlans: async () => ['.gitkeep'],
    projectRoot: '/repo',
  });
  assert.equal(ctx.unreadable, true);
  assert.equal(ctx.missionCompleteIdle, false);
  assert.equal(ctx.hasCoordinationTrail, false);
  assert.equal(ctx.booted, false);
  assert.equal(ctx.bootMechanismPrimed, false);
});

test('readEnforcementContext: parses state, no trail, idle, not booted/primed', async () => {
  const ctx = await readEnforcementContext({
    payload,
    readFileText: ctxReader(),
    listPlans: async () => ['.gitkeep'],
    projectRoot: '/repo',
  });
  assert.equal(ctx.unreadable, false);
  assert.equal(ctx.target, 'src/foo.js');
  assert.equal(ctx.sessionId, 'sess-1');
  assert.equal(ctx.missionCompleteIdle, true);
  assert.equal(ctx.hasCoordinationTrail, false);
  assert.equal(ctx.scoutActive, false);
  assert.equal(ctx.booted, false);
  assert.equal(ctx.bootMechanismPrimed, false);
});

test('readEnforcementContext: detects coordination trail (.md beyond .gitkeep)', async () => {
  const ctx = await readEnforcementContext({
    payload,
    readFileText: ctxReader(),
    listPlans: async () => ['.gitkeep', '01_grill_summary.md'],
    projectRoot: '/repo',
  });
  assert.equal(ctx.hasCoordinationTrail, true);
});

test('readEnforcementContext: booted true when .session-id === .session-booted', async () => {
  const ctx = await readEnforcementContext({
    payload,
    readFileText: ctxReader({ sessionId: 'abc', booted: 'abc' }),
    listPlans: async () => ['.gitkeep'],
    projectRoot: '/repo',
  });
  assert.equal(ctx.bootMechanismPrimed, true);
  assert.equal(ctx.booted, true);
});

test('readEnforcementContext: primed but not booted when markers mismatch', async () => {
  const ctx = await readEnforcementContext({
    payload,
    readFileText: ctxReader({ sessionId: 'new', booted: 'old' }),
    listPlans: async () => ['.gitkeep'],
    projectRoot: '/repo',
  });
  assert.equal(ctx.bootMechanismPrimed, true);
  assert.equal(ctx.booted, false);
});

test('readEnforcementContext: primed but not booted when marker absent', async () => {
  const ctx = await readEnforcementContext({
    payload,
    readFileText: ctxReader({ sessionId: 'abc', booted: null }),
    listPlans: async () => ['.gitkeep'],
    projectRoot: '/repo',
  });
  assert.equal(ctx.bootMechanismPrimed, true);
  assert.equal(ctx.booted, false);
});

test('readEnforcementContext: not primed when .session-id absent', async () => {
  const ctx = await readEnforcementContext({
    payload,
    readFileText: ctxReader({ sessionId: null, booted: 'abc' }),
    listPlans: async () => ['.gitkeep'],
    projectRoot: '/repo',
  });
  assert.equal(ctx.bootMechanismPrimed, false);
  assert.equal(ctx.booted, false);
});

test('readEnforcementContext: scout persona + booted handshake', async () => {
  const ctx = await readEnforcementContext({
    payload,
    readFileText: ctxReader({ cardText: card({ persona: 'Scout' }), sessionId: 'sess', booted: 'sess' }),
    listPlans: async () => ['.gitkeep'],
    projectRoot: '/repo',
  });
  assert.equal(ctx.scoutActive, true);
  assert.equal(ctx.booted, true);
});

test('readEnforcementContext: in-flight mission => not idle', async () => {
  const ctx = await readEnforcementContext({
    payload,
    readFileText: ctxReader({ cardText: card({ state: '[IN-FLIGHT: build]' }) }),
    listPlans: async () => ['.gitkeep'],
    projectRoot: '/repo',
  });
  assert.equal(ctx.missionCompleteIdle, false);
});

test('readEnforcementContext: listPlans failure => no trail, not unreadable', async () => {
  const ctx = await readEnforcementContext({
    payload,
    readFileText: ctxReader(),
    listPlans: async () => { throw new Error('enoent'); },
    projectRoot: '/repo',
  });
  assert.equal(ctx.unreadable, false);
  assert.equal(ctx.hasCoordinationTrail, false);
});
