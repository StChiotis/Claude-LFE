// Tests for persona-transition-guard.mjs — the C3 (light) persona-transition guard.
// Common-contract cells live in the shared gate-harness; this file declares
// the descriptor + retains C3's distinctive cells (pure helpers, before/after detection,
// marker matching, and the BLOCK-path telemetry-failure invariant).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  main,
  leadingPersonaName,
  personaFromText,
  buildWarnMessage,
} from '../persona-transition-guard.mjs';
import { runCommonGateContract, captureAppend } from './gate-harness.mjs';

const ENV = { CLAUDE_PROJECT_DIR: '/repo' };

function card({ persona = 'Builder', state = '[IN-FLIGHT: builder]' } = {}) {
  return [
    `| **Mission State** | ${state} |`,
    `| **Active Persona** | ${persona} |`,
    `| **Active Mission** | n/a |`,
  ].join('\n');
}

// Active Persona row fragment (what an Edit's new_string / a Write's content carries).
function personaRow(persona) {
  return `| **Active Persona** | ${persona} |`;
}

function makeRead({ cardText = card(), posture = '{}', marker = null } = {}) {
  return async (p) => {
    const s = String(p).replace(/\\/g, '/');
    if (s.endsWith('.session-id') || s.endsWith('.session-booted')) {
      throw new Error('no boot file');
    }
    if (s.endsWith('.persona-transition')) {
      if (marker === null) throw new Error('no marker');
      return marker;
    }
    if (s.endsWith('enforcement-posture.json')) return posture;
    if (s.endsWith('pipeline_status.md')) {
      if (cardText === null) throw new Error('no card');
      return cardText;
    }
    throw new Error('unexpected read: ' + s);
  };
}

function stdin({ tool = 'Edit', file = 'pipeline_status.md', newString, content } = {}) {
  const tool_input = { file_path: file };
  if (newString !== undefined) tool_input.new_string = newString;
  if (content !== undefined) tool_input.content = content;
  return JSON.stringify({ tool_name: tool, tool_input, cwd: '/repo', session_id: 'sess-1' });
}

const noTrail = async () => ['.gitkeep'];

function run({ stdinText, read, append, now = () => 'T' }) {
  return main({
    stdinText,
    readFileText: read,
    appendFileText: append,
    listPlans: noTrail,
    now,
    env: ENV,
  });
}

// --- Common contract (shared harness) ----------------------------------------
// Trigger = an Edit changing the Active Persona row to Inspector with no marker
// (before=Builder from the card default). makeRead's gate-specific key is `marker`.

runCommonGateContract(test, {
  main,
  gateName: 'persona-transition',
  env: ENV,
  listPlans: noTrail,
  makeRead,
  wrongToolStdin: stdin({ tool: 'Bash' }),
  triggerStdin: stdin({ newString: personaRow('Inspector') }),
  triggerReadOpts: { marker: null },
  reasonOnTrigger: 'persona-transition-no-marker',
});

// --- distinctive: pure-helper unit tests --------------------------------------

test('leadingPersonaName extracts the leading name and ignores the *(...)* note', () => {
  assert.equal(leadingPersonaName('Builder *(in flight)*'), 'builder');
  assert.equal(leadingPersonaName('  Inspector  '), 'inspector');
  assert.equal(leadingPersonaName('Archivist'), 'archivist');
  assert.equal(leadingPersonaName('SCOUT *(minor fix)*'), 'scout');
});

test('leadingPersonaName returns null for non-persona / empty / word-boundary near-misses', () => {
  assert.equal(leadingPersonaName('Architecture rework'), null); // \b after Architect
  assert.equal(leadingPersonaName('unknown'), null);
  assert.equal(leadingPersonaName(''), null);
  assert.equal(leadingPersonaName(null), null);
  assert.equal(leadingPersonaName(undefined), null);
});

test('personaFromText finds the Active Persona row in an arbitrary blob, else null', () => {
  assert.equal(personaFromText(card({ persona: 'Inspector *(x)*' })), 'inspector');
  assert.equal(personaFromText(personaRow('Archivist')), 'archivist');
  assert.equal(personaFromText('some unrelated edit with no persona row'), null);
  assert.equal(personaFromText(''), null);
});

test('buildWarnMessage names the transition and the marker path', () => {
  const m = buildWarnMessage({ before: 'builder', after: 'inspector', target: 'pipeline_status.md' });
  assert.match(m, /builder/);
  assert.match(m, /inspector/);
  assert.match(m, /\.plans\/\.persona-transition/);
});

// --- distinctive: pass-through edges (indeterminate before/after, non-target) --

test('missing file_path => silent ALLOW', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: JSON.stringify({ tool_name: 'Edit', tool_input: {}, cwd: '/repo' }),
    read: makeRead(),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

test('non-pipeline_status target => silent ALLOW even with a persona-looking new_string', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ file: 'src/foo.js', newString: personaRow('Inspector') }),
    read: makeRead({ cardText: card({ persona: 'Builder' }) }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

test('same-persona re-note edit (only the *(...)* changes) => silent ALLOW', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ newString: personaRow('Builder *(new note)*') }),
    read: makeRead({ cardText: card({ persona: 'Builder *(old note)*' }) }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

test('edit whose new_string has no persona row (indeterminate "after") => silent ALLOW', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ newString: '| **Pipeline Phase** | something else |' }),
    read: makeRead({ cardText: card({ persona: 'Builder' }) }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

test('card with a non-standard current persona (indeterminate "before") => silent ALLOW', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ newString: personaRow('Inspector') }),
    read: makeRead({ cardText: card({ persona: 'TBD' }) }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

// --- distinctive: transition detection ----------------------------------------

test('persona change (Edit) with no marker => WARN + telemetry, no deny envelope', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ newString: personaRow('Inspector *(x)*') }),
    read: makeRead({ cardText: card({ persona: 'Builder' }), marker: null }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, ''); // no deny envelope under warn posture
  assert.match(r.stderr, /\[LFE C3 warn-and-log\]/);
  assert.match(r.stderr, /builder/i);
  assert.match(r.stderr, /inspector/i);
  assert.equal(calls.length, 1);
  const rec = JSON.parse(calls[0].c);
  assert.equal(rec.gate, 'persona-transition');
  assert.equal(rec.decision, 'warn');
  assert.equal(rec.reason, 'persona-transition-no-marker');
});

test('persona change + matching marker => silent ALLOW (official transition)', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ newString: personaRow('Inspector') }),
    read: makeRead({ cardText: card({ persona: 'Builder' }), marker: 'Inspector' }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

test('matching marker comparison is case-insensitive', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ newString: personaRow('Archivist') }),
    read: makeRead({ cardText: card({ persona: 'Inspector' }), marker: 'archivist' }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

test('persona change + mismatched marker => WARN', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ newString: personaRow('Inspector') }),
    read: makeRead({ cardText: card({ persona: 'Builder' }), marker: 'Archivist' }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /\[LFE C3 warn-and-log\]/);
  assert.equal(calls.length, 1);
});

test('Write-content persona change is detected (before from disk, after from content)', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ tool: 'Write', content: card({ persona: 'Architect' }) }),
    read: makeRead({ cardText: card({ persona: 'Builder' }), marker: null }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /\[LFE C3 warn-and-log\]/);
  assert.match(r.stderr, /architect/i);
  assert.equal(calls.length, 1);
});

test('Write-content persona change + matching marker => silent ALLOW', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ tool: 'Write', content: card({ persona: 'Architect' }) }),
    read: makeRead({ cardText: card({ persona: 'Builder' }), marker: 'Architect' }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

// --- distinctive: telemetry-is-observability-never-control (BLOCK path) --------
// (the WARN-path telemetry-failure invariant is covered by the shared harness)

test('telemetry write failure never alters a BLOCK decision (still DENY)', async () => {
  const failingAppend = async () => { throw new Error('disk full'); };
  const r = await run({
    stdinText: stdin({ newString: personaRow('Inspector') }),
    read: makeRead({
      cardText: card({ persona: 'Builder' }),
      posture: JSON.stringify({ 'persona-transition': 'block' }),
      marker: null,
    }),
    append: failingAppend,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('transition to Scout is detected through main() like any other persona change', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ newString: personaRow('Scout *(minor fix)*') }),
    read: makeRead({ cardText: card({ persona: 'Builder' }), marker: null }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.match(r.stderr, /scout/i);
  assert.equal(calls.length, 1);
});

// --- distinctive: decorated (emoji) cell ----------------------------
// The live card is `<emoji> <Name>`. C3's old local leadingPersonaName returned
// null on the emoji → indeterminate → it silently allowed EVERY transition. Wired
// to the shared emoji-tolerant reader, C3 now reads the real decorated card.

test('decorated transition 🏛️ Architect → 🔨 Builder + matching marker => silent ALLOW', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ newString: personaRow('🔨 Builder') }),
    read: makeRead({ cardText: card({ persona: '🏛️ Architect *(in flight)*' }), marker: 'Builder' }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

test('decorated transition 🏛️ Architect → 🔨 Builder + NO marker => WARN (C3 now reads the emoji cell)', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ newString: personaRow('🔨 Builder') }),
    read: makeRead({ cardText: card({ persona: '🏛️ Architect *(in flight)*' }), marker: null }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /\[LFE C3 warn-and-log\]/);
  assert.match(r.stderr, /architect/i);
  assert.match(r.stderr, /builder/i);
  assert.equal(calls.length, 1);
});

test('decorated same-persona re-note (🔨 Builder *(old)* → 🔨 Builder *(new)*) => silent ALLOW', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: stdin({ newString: personaRow('🔨 Builder *(new note)*') }),
    read: makeRead({ cardText: card({ persona: '🔨 Builder *(old note)*' }), marker: null }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});
