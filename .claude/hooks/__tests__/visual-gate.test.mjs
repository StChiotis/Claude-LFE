// Tests for visual-gate.mjs — the hard visual-confirmation floor (ADR 102).
//
// This gate has its OWN injected-I/O seam: it reads builder_done.md and
// inspection_report.md, which the shared persona-transition harness's makeRead
// rejects ("unexpected read"). It also does NOT reuse runCommonGateContract — that
// harness's telemetry-failure + block-posture cells assume `warn → ALLOW`, which
// is FALSE for this floor (it denies even under warn). The cells below are
// self-contained; only captureAppend is borrowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  main,
  parseChangedFiles,
  isVisualSlice,
  isFieldPresent,
  personaFromText,
  buildDenyMessage,
  UI_GLOBS,
  GATE_NAME,
} from '../visual-gate.mjs';
import { captureAppend } from './gate-harness.mjs';

const ENV = { CLAUDE_PROJECT_DIR: '/repo' };

function card({ persona = 'Inspector', state = '[IN-FLIGHT: inspector]' } = {}) {
  return [
    `| **Mission State** | ${state} |`,
    `| **Active Persona** | ${persona} |`,
    `| **Active Mission** | n/a |`,
  ].join('\n');
}

function personaRow(persona) {
  return `| **Active Persona** | ${persona} |`;
}

// builder_done.md body with a `## Files Touched` list. `files` are raw bullet
// bodies (e.g. "styles/main.css: tweak"); pass [] for an empty section.
function builderDone(files = ['styles/main.css: restyle the header']) {
  const out = [
    '---', 'phase: builder', 'step: builder', 'status: complete',
    'timestamp: T', 'source: .plans/active_plan.md', 'slice: 2', '---',
    '', '## Files Touched',
  ];
  for (const f of files) out.push(`- ${f}`);
  out.push('', '## Plan Adherence', '- yes');
  return out.join('\n');
}

function inspectionReport({ status = 'passed', visual_confirmed, visual_signoff } = {}) {
  const fm = [
    '---', 'phase: inspector', 'step: inspection', `status: ${status}`,
    'timestamp: T', 'source: .plans/tdd_report.md', 'slice: 2',
  ];
  if (visual_confirmed !== undefined) fm.push(`visual_confirmed: ${visual_confirmed}`);
  if (visual_signoff !== undefined) fm.push(`visual_signoff: ${visual_signoff}`);
  fm.push('---', '', '## Verification Results', '- Logic match: PASS');
  return fm.join('\n');
}

function makeRead({
  cardText = card(),
  builderDoneText = builderDone(),
  reportText = inspectionReport({ status: 'passed' }),
  posture = '{}',
} = {}) {
  return async (p) => {
    const s = String(p).replace(/\\/g, '/');
    if (s.endsWith('.session-id') || s.endsWith('.session-booted')) throw new Error('no boot file');
    if (s.endsWith('builder_done.md')) {
      if (builderDoneText === null) throw new Error('no builder_done');
      return builderDoneText;
    }
    if (s.endsWith('inspection_report.md')) {
      if (reportText === null) throw new Error('no report');
      return reportText;
    }
    if (s.endsWith('pipeline_status.md')) {
      if (cardText === null) throw new Error('no card');
      return cardText;
    }
    if (s.endsWith('enforcement-posture.json')) return posture;
    throw new Error('unexpected read: ' + s);
  };
}

function stdin({ tool = 'Edit', file = 'pipeline_status.md', newString, content } = {}) {
  const tool_input = { file_path: file };
  if (newString !== undefined) tool_input.new_string = newString;
  if (content !== undefined) tool_input.content = content;
  return JSON.stringify({ tool_name: tool, tool_input, cwd: '/repo', session_id: 'sess-1' });
}

const noTrail = async () => ['.gitkeep', 'builder_done.md', 'inspection_report.md'];

function run({ stdinText, read, append = async () => {}, now = () => 'T' }) {
  return main({ stdinText, readFileText: read, appendFileText: append, listPlans: noTrail, now, env: ENV });
}

// The canonical floor trigger: Inspector→Archivist edit, visual builder_done,
// report missing both visual fields.
function triggerStdin() {
  return stdin({ newString: personaRow('Archivist') });
}

// --- pure helpers -------------------------------------------------------------

test('parseChangedFiles extracts paths from the Files Touched bullets (strips summary + backticks)', () => {
  const body = builderDone(['`styles/main.css`: restyle', '.claude/hooks/x.mjs: code', 'no-summary-path.tsx']);
  const files = parseChangedFiles(body);
  assert.deepEqual(files, ['styles/main.css', '.claude/hooks/x.mjs', 'no-summary-path.tsx']);
});

test('parseChangedFiles returns [] when the section is absent or empty', () => {
  assert.deepEqual(parseChangedFiles('## Other\n- x'), []);
  assert.deepEqual(parseChangedFiles(builderDone([])), []);
  assert.deepEqual(parseChangedFiles(''), []);
});

test('parseChangedFiles stops at the next ## heading', () => {
  const body = ['## Files Touched', '- a.css: x', '## Plan Adherence', '- b.css: should NOT count'].join('\n');
  assert.deepEqual(parseChangedFiles(body), ['a.css']);
});

test('isVisualSlice: true for a stylesheet / TSX / nested component / image; false for code+docs', () => {
  assert.equal(isVisualSlice(['styles/main.css']), true);
  assert.equal(isVisualSlice(['src/components/Foo.tsx']), true);
  assert.equal(isVisualSlice(['deep/nested/path/widget.vue']), true);
  assert.equal(isVisualSlice(['public/logo.png']), true);
  assert.equal(isVisualSlice(['index.html']), true); // top-level
  assert.equal(isVisualSlice(['app/views/page.ejs']), true);
  assert.equal(isVisualSlice(['.claude/hooks/x.mjs', 'docs/readme.md', 'config.json']), false);
});

test('isVisualSlice: a mixed set with one visual file is visual', () => {
  assert.equal(isVisualSlice(['.claude/hooks/visual-gate.mjs', 'src/components/Foo.tsx']), true);
});

test('isVisualSlice: non-array → false', () => {
  assert.equal(isVisualSlice(null), false);
  assert.equal(isVisualSlice(undefined), false);
});

test('isFieldPresent: only a non-empty non-null value counts', () => {
  assert.equal(isFieldPresent('2026-06-17T12:00:00Z'), true);
  assert.equal(isFieldPresent('TOKEN'), true);
  assert.equal(isFieldPresent(null), false);
  assert.equal(isFieldPresent(undefined), false);
  assert.equal(isFieldPresent(''), false);
  assert.equal(isFieldPresent(false), false);
});

test('personaFromText finds the Active Persona row, else null', () => {
  assert.equal(personaFromText(personaRow('Archivist')), 'archivist');
  assert.equal(personaFromText(card({ persona: 'Inspector' })), 'inspector');
  assert.equal(personaFromText('| **Pipeline Phase** | x |'), null);
  assert.equal(personaFromText(''), null);
});

test('buildDenyMessage names the missing field(s) and the sign-off ritual', () => {
  const m = buildDenyMessage({ missing: ['visual_signoff'], target: 'pipeline_status.md' });
  assert.match(m, /visual_signoff/);
  assert.match(m, /sign-off/i);
  assert.match(m, /Archivist/);
});

test('UI_GLOBS is a non-trivial exported literal (single source of truth)', () => {
  assert.ok(Array.isArray(UI_GLOBS));
  assert.ok(UI_GLOBS.length >= 10);
});

// --- ALLOW pass-through edges -------------------------------------------------

test('non-gated tool (Bash) => silent ALLOW', async () => {
  const { calls, append } = captureAppend();
  const r = await run({ stdinText: stdin({ tool: 'Bash' }), read: makeRead(), append });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(calls.length, 0);
});

test('malformed stdin => silent ALLOW', async () => {
  const r = await run({ stdinText: 'not json at all', read: makeRead() });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
});

test('missing file_path => silent ALLOW', async () => {
  const r = await run({
    stdinText: JSON.stringify({ tool_name: 'Edit', tool_input: {}, cwd: '/repo' }),
    read: makeRead(),
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, '');
});

test('non-pipeline_status target => silent ALLOW (even with a persona-looking new_string)', async () => {
  const r = await run({
    stdinText: stdin({ file: 'src/foo.js', newString: personaRow('Archivist') }),
    read: makeRead(),
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('transition with before≠Inspector (Builder→Archivist) => silent ALLOW', async () => {
  const r = await run({
    stdinText: stdin({ newString: personaRow('Archivist') }),
    read: makeRead({ cardText: card({ persona: 'Builder' }) }),
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('transition with after≠Archivist (Inspector→Builder) => silent ALLOW', async () => {
  const r = await run({
    stdinText: stdin({ newString: personaRow('Builder') }),
    read: makeRead({ cardText: card({ persona: 'Inspector' }) }),
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
});

test('incoming change with no persona row (after=null) => silent ALLOW', async () => {
  const r = await run({
    stdinText: stdin({ newString: '| **Pipeline Phase** | Phase 4 — Archivist |' }),
    read: makeRead(),
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
});

// --- fail-safe ALLOW (never deadlock) ----------------------------------------

test('unreadable entrance card => fail-safe ALLOW + stderr', async () => {
  const r = await run({ stdinText: triggerStdin(), read: makeRead({ cardText: null }) });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /fail-safe ALLOW/);
});

test('unreadable builder_done.md => fail-safe ALLOW + stderr (indeterminate visual-ness)', async () => {
  const r = await run({ stdinText: triggerStdin(), read: makeRead({ builderDoneText: null }) });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /fail-safe ALLOW/);
});

test('no changed files parsed => fail-safe ALLOW + stderr', async () => {
  const r = await run({ stdinText: triggerStdin(), read: makeRead({ builderDoneText: builderDone([]) }) });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /fail-safe ALLOW/);
});

test('non-visual slice => silent ALLOW', async () => {
  const r = await run({
    stdinText: triggerStdin(),
    read: makeRead({ builderDoneText: builderDone(['.claude/hooks/x.mjs: code', 'docs/readme.md: doc']) }),
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('unreadable inspection_report.md (visual slice) => fail-safe ALLOW + stderr', async () => {
  const r = await run({ stdinText: triggerStdin(), read: makeRead({ reportText: null }) });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /fail-safe ALLOW/);
});

test('visual slice + status escalated => ALLOW (debt/triage path, no deadlock)', async () => {
  const r = await run({
    stdinText: triggerStdin(),
    read: makeRead({ reportText: inspectionReport({ status: 'escalated' }) }),
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
});

test('visual slice + status failed => ALLOW (no deadlock)', async () => {
  const r = await run({
    stdinText: triggerStdin(),
    read: makeRead({ reportText: inspectionReport({ status: 'failed' }) }),
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
});

test('visual slice + both visual fields present => ALLOW', async () => {
  const r = await run({
    stdinText: triggerStdin(),
    read: makeRead({
      reportText: inspectionReport({
        status: 'passed',
        visual_confirmed: '2026-06-17T12:00:00Z',
        visual_signoff: 'LGTM-2026-06-17',
      }),
    }),
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

// --- the floor: DENY ----------------------------------------------------------

test('visual slice + missing visual_signoff => DENY + telemetry', async () => {
  const { calls, append } = captureAppend();
  const r = await run({
    stdinText: triggerStdin(),
    read: makeRead({ reportText: inspectionReport({ status: 'passed', visual_confirmed: '2026-06-17T12:00:00Z' }) }),
    append,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.stderr, /visual_signoff/);
  assert.equal(calls.length, 1);
  const rec = JSON.parse(calls[0].c);
  assert.equal(rec.gate, GATE_NAME);
  assert.equal(rec.decision, 'deny');
  assert.equal(rec.reason, 'visual-unconfirmed');
});

test('visual slice + visual_confirmed:null => DENY (explicit null is not present)', async () => {
  const r = await run({
    stdinText: triggerStdin(),
    read: makeRead({ reportText: inspectionReport({ status: 'passed', visual_confirmed: 'null', visual_signoff: 'TOKEN' }) }),
  });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.stderr, /visual_confirmed/);
});

test('visual slice + neither field => DENY naming both', async () => {
  const r = await run({ stdinText: triggerStdin(), read: makeRead() });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.stderr, /visual_confirmed/);
  assert.match(r.stderr, /visual_signoff/);
});

test('visual slice + status "complete" (not in the fail-safe set) + missing fields => DENY', async () => {
  // Mutation guard: only `escalated`/`failed` stand the floor down. A non-passed,
  // non-fail-safe status (e.g. `complete`) still enforces — so a mutant that
  // special-cased `passed` or widened the fail-safe set would be caught here.
  const r = await run({
    stdinText: triggerStdin(),
    read: makeRead({ reportText: inspectionReport({ status: 'complete' }) }),
  });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('Write-content transition (Inspector→Archivist via content) + missing fields => DENY', async () => {
  const r = await run({
    stdinText: stdin({ tool: 'Write', content: card({ persona: 'Archivist' }) }),
    read: makeRead({ cardText: card({ persona: 'Inspector' }) }),
  });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

// --- the floor is UNCONDITIONAL under posture (the ADR-102 departure) ---------

test('floor DENIES under warn posture (posture does not relax the floor)', async () => {
  const r = await run({
    stdinText: triggerStdin(),
    read: makeRead({ posture: JSON.stringify({ 'visual-gate': 'warn' }) }),
  });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('floor DENIES under block posture (same outcome — posture-invariant)', async () => {
  const r = await run({
    stdinText: triggerStdin(),
    read: makeRead({ posture: JSON.stringify({ 'visual-gate': 'block' }) }),
  });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('telemetry append failure never alters the DENY decision (still DENY)', async () => {
  const failingAppend = async () => { throw new Error('disk full'); };
  const r = await run({ stdinText: triggerStdin(), read: makeRead(), append: failingAppend });
  assert.equal(r.exitCode, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});
