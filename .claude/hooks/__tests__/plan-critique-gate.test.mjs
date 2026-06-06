// Plan-Critique Gate PreToolUse Hook test suite.
// Mirrors the persona-lock gate's dependency-injection pattern: every fixture passes mocks to
// main(); no real disk I/O. Pins the 7 Brain-mandated Lens-1 X/Y pairs from
// active_plan.md + stage-by-stage edge cases + verdict classification matrix.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  main,
  PLAN_CRITIQUE_PATH,
  GATED_TOOL,
  SRC_GLOB,
  ISO_8601_RE,
  isUnderSrc,
  isIsoTimestamp,
  classifyVerdict,
  buildPlanCritiqueDenyMessage,
} from '../plan-critique-gate.mjs';
import { PROTOCOL_DEBT_PATH } from '../../lib/be-escape.mjs';

// --- Shared fixtures ----------------------------------------------------------

const PROJ = '/proj';

function makePlanCritique({
  verdict = 'PASS',
  brain_confirmation = null,
  revision = 1,
  slice = 1,
  timestamp = '2026-05-17T20:40:00Z',
} = {}) {
  const confLine = brain_confirmation === null ? 'brain_confirmation: null' : `brain_confirmation: ${brain_confirmation}`;
  return `---
phase: architect
step: plan_critique
status: complete
timestamp: ${timestamp}
source: .plans/active_plan.md
slice: ${slice}
verdict: ${verdict}
revision: ${revision}
${confLine}
---

## Verdict: ${verdict}
(body omitted for fixture)
`;
}

function makeEntranceCard({ persona = 'Builder', mission = 'Sample Mission' } = {}) {
  return `# 🏛️ LFE Mission Control

| Category | Status / Value |
| :--- | :--- |
| **Integrity Score** | 🟢 [Integrity: 100%] |
| **Mission State** | [IN-FLIGHT: builder] |
| **Active Persona** | ${persona} |
| **Active Mission** | ${mission} |
| **Pipeline Phase** | Builder |
| **Session Count** | 8 |
| **Last Architecture Sweep** | 5 |

---
`;
}

function makeTranscript({ userMessages = [] } = {}) {
  return userMessages
    .map((text) => JSON.stringify({ role: 'user', content: text }))
    .join('\n');
}

function makeWriteFileSpy() {
  const calls = [];
  const fn = async (path, content) => {
    calls.push({ path, content });
  };
  fn.calls = calls;
  return fn;
}

const PROTOCOL_DEBT_FIXTURE = `# LFE Protocol Debt Log

> [!WARNING]
> All entries in this log must be resolved in the very next session.

| Date | Mission | Reason for LFE-FORCE | Resolution Status |
| :--- | :--- | :--- | :--- |
| 2026-05-15 | Sample Mission | Bootstrap | resolved (session 2) |

---

**Archive:** Older entries are in [archive/protocol-debt-history.md](../archive/protocol-debt-history.md). Last archive sweep: session 5.
`;

async function runMain({
  stdin = {},
  files = {},
  writeFileSpy,
  now = '2026-05-17T20:50:00.000Z',
  env = { CLAUDE_PROJECT_DIR: PROJ },
} = {}) {
  const spy = writeFileSpy ?? makeWriteFileSpy();
  const normalizedFiles = {};
  for (const [k, v] of Object.entries(files)) {
    normalizedFiles[String(k).replace(/\\/g, '/')] = v;
  }
  const readFileText = async (path) => {
    const key = String(path).replace(/\\/g, '/');
    if (key in normalizedFiles) {
      const v = normalizedFiles[key];
      if (v instanceof Error) throw v;
      return v;
    }
    const err = new Error(`ENOENT: ${key}`);
    err.code = 'ENOENT';
    throw err;
  };
  const stdinText = typeof stdin === 'string' ? stdin : JSON.stringify(stdin);
  const result = await main({
    stdinText,
    readFileText,
    writeFileText: spy,
    now: typeof now === 'function' ? now : () => now,
    env,
  });
  return { result, writeFileSpy: spy };
}

function parseEnvelope(stdout) {
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function makeWriteRequest({
  target = 'src/foo.ts',
  toolName = 'Write',
  critique = makePlanCritique({ verdict: 'PASS' }),
  hasCritique = true,
  userMessages = ['regular prompt without keyword'],
  persona = 'Builder',
  hasEntranceCard = true,
  hasDebt = false,
} = {}) {
  const files = {
    '/tmp/transcript.jsonl': makeTranscript({ userMessages }),
  };
  if (hasCritique) files[`${PROJ}/${PLAN_CRITIQUE_PATH}`] = critique;
  if (hasEntranceCard) files[`${PROJ}/pipeline_status.md`] = makeEntranceCard({ persona });
  if (hasDebt) files[`${PROJ}/${PROTOCOL_DEBT_PATH}`] = PROTOCOL_DEBT_FIXTURE;
  return {
    stdin: {
      session_id: 'sess-1',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: PROJ,
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
      tool_input: { file_path: `${PROJ}/${target}` },
      tool_use_id: 'tu-1',
    },
    files,
  };
}

// --- Pure helpers -------------------------------------------------------------

describe('isUnderSrc', () => {
  test('returns true for src/foo.ts', () => {
    assert.ok(isUnderSrc('src/foo.ts'));
  });
  test('returns true for nested src/core/golden-engine.js', () => {
    assert.ok(isUnderSrc('src/core/golden-engine.js'));
  });
  test('returns false for .docs/foo.md', () => {
    assert.ok(!isUnderSrc('.docs/foo.md'));
  });
  test('returns false for srcfoo/x.js (prefix without slash)', () => {
    assert.ok(!isUnderSrc('srcfoo/x.js'));
  });
  test('returns false for empty string', () => {
    assert.ok(!isUnderSrc(''));
  });
});

describe('isIsoTimestamp', () => {
  test('accepts canonical ISO-8601 UTC', () => {
    assert.ok(isIsoTimestamp('2026-05-17T10:00:00Z'));
  });
  test('rejects null', () => {
    assert.ok(!isIsoTimestamp(null));
  });
  test('rejects number', () => {
    assert.ok(!isIsoTimestamp(1234567890));
  });
  test('rejects boolean true', () => {
    assert.ok(!isIsoTimestamp(true));
  });
  test('rejects string "null"', () => {
    assert.ok(!isIsoTimestamp('null'));
  });
  test('rejects ISO-8601 with fractional seconds (parser regex strict)', () => {
    assert.ok(!isIsoTimestamp('2026-05-17T10:00:00.000Z'));
  });
  test('rejects ISO-8601 with non-Z timezone', () => {
    assert.ok(!isIsoTimestamp('2026-05-17T10:00:00+02:00'));
  });
  test('rejects empty string', () => {
    assert.ok(!isIsoTimestamp(''));
  });
});

describe('classifyVerdict', () => {
  test('PASS → PASS', () => {
    assert.equal(classifyVerdict({ verdict: 'PASS', brain_confirmation: null }), 'PASS');
  });
  test('BLOCK → BLOCK', () => {
    assert.equal(classifyVerdict({ verdict: 'BLOCK', brain_confirmation: null }), 'BLOCK');
  });
  test('WARN + ISO-8601 string → WARN_CONFIRMED', () => {
    assert.equal(
      classifyVerdict({ verdict: 'WARN', brain_confirmation: '2026-05-17T10:00:00Z' }),
      'WARN_CONFIRMED',
    );
  });
  test('WARN + null → WARN_NULL', () => {
    assert.equal(classifyVerdict({ verdict: 'WARN', brain_confirmation: null }), 'WARN_NULL');
  });
  test('WARN + boolean true → WARN_NULL (defensive non-ISO handling)', () => {
    assert.equal(classifyVerdict({ verdict: 'WARN', brain_confirmation: true }), 'WARN_NULL');
  });
  test('WARN + integer → WARN_NULL (defensive non-ISO handling)', () => {
    assert.equal(classifyVerdict({ verdict: 'WARN', brain_confirmation: 1234567890 }), 'WARN_NULL');
  });
  test('WARN + string "null" (parser quirk) → WARN_NULL', () => {
    assert.equal(classifyVerdict({ verdict: 'WARN', brain_confirmation: 'null' }), 'WARN_NULL');
  });
  test('WARN + non-ISO string → WARN_NULL', () => {
    assert.equal(classifyVerdict({ verdict: 'WARN', brain_confirmation: 'yesterday' }), 'WARN_NULL');
  });
  test('unknown verdict (MAYBE) → UNKNOWN', () => {
    assert.equal(classifyVerdict({ verdict: 'MAYBE', brain_confirmation: null }), 'UNKNOWN');
  });
  test('missing verdict field → UNKNOWN', () => {
    assert.equal(classifyVerdict({}), 'UNKNOWN');
  });
  test('null fields → UNKNOWN', () => {
    assert.equal(classifyVerdict(null), 'UNKNOWN');
  });
});

describe('buildPlanCritiqueDenyMessage', () => {
  test('BLOCK verdict message cites BLOCK + /lfe-architect revision routing', () => {
    const msg = buildPlanCritiqueDenyMessage({
      verdict: 'BLOCK',
      brainConfirmation: null,
      target: 'src/foo.ts',
      criticPath: PLAN_CRITIQUE_PATH,
      missionName: 'Sample Mission',
    });
    assert.match(msg, /verdict=BLOCK/);
    assert.match(msg, /\/lfe-architect/);
    assert.match(msg, /src\/foo\.ts/);
    assert.match(msg, /Sample Mission/);
    assert.match(msg, /LFE-FORCE/);
    assert.match(msg, /settings\.local\.json/);
  });
  test('WARN verdict message cites missing brain_confirmation + /lfe-plan-critique routing', () => {
    const msg = buildPlanCritiqueDenyMessage({
      verdict: 'WARN',
      brainConfirmation: null,
      target: 'src/foo.ts',
      criticPath: PLAN_CRITIQUE_PATH,
      missionName: 'Sample Mission',
    });
    assert.match(msg, /verdict=WARN/);
    assert.match(msg, /brain_confirmation: null/);
    assert.match(msg, /\/lfe-plan-critique/);
    assert.match(msg, /ISO-8601/);
  });
  test('WARN with non-null non-ISO brain_confirmation is rendered as its JSON shape', () => {
    const msg = buildPlanCritiqueDenyMessage({
      verdict: 'WARN',
      brainConfirmation: true,
      target: 'src/foo.ts',
      criticPath: PLAN_CRITIQUE_PATH,
      missionName: 'Sample Mission',
    });
    assert.match(msg, /brain_confirmation: true/);
  });
  test('unknown verdict message routes to file-delete/regenerate', () => {
    const msg = buildPlanCritiqueDenyMessage({
      verdict: 'MAYBE',
      brainConfirmation: null,
      target: 'src/foo.ts',
      criticPath: PLAN_CRITIQUE_PATH,
      missionName: 'n/a',
    });
    assert.match(msg, /verdict="MAYBE"/);
    assert.match(msg, /Delete or fix/);
  });
  test('omits mission tag when n/a', () => {
    const msg = buildPlanCritiqueDenyMessage({
      verdict: 'BLOCK',
      brainConfirmation: null,
      target: 'src/foo.ts',
      criticPath: PLAN_CRITIQUE_PATH,
      missionName: 'n/a',
    });
    assert.doesNotMatch(msg, /\(mission:/);
  });
  test('defangs ESC in interpolated values (Sec-G3.L1); structure otherwise unchanged', () => {
    const ESC = '\x1b';
    const hostile = buildPlanCritiqueDenyMessage({
      verdict: 'BLOCK',
      brainConfirmation: null,
      target: `src/${ESC}[31mfoo.ts`,
      criticPath: `${ESC}[1m${PLAN_CRITIQUE_PATH}`,
      missionName: `${ESC}[2JSample Mission`,
    });
    assert.ok(!hostile.includes(ESC), 'no ESC byte survives in the deny message');
    // Every defanged param carries ESC, so dropping the strip on ANY one of
    // target / criticPath / missionName breaks the equality below (mutation-
    // verify in-cycle closure). Already-stripped inputs → byte-identical output.
    const expected = buildPlanCritiqueDenyMessage({
      verdict: 'BLOCK',
      brainConfirmation: null,
      target: 'src/[31mfoo.ts',
      criticPath: `[1m${PLAN_CRITIQUE_PATH}`,
      missionName: '[2JSample Mission',
    });
    assert.equal(hostile, expected);
    assert.match(hostile, /verdict=BLOCK/);
  });
});

// --- Brain-mandated X/Y pairs (Lens 1, 7 cells) -------------------------------

describe('Brain-mandated X/Y pairs (Lens 1)', () => {
  test('X1: src/foo.ts Write + verdict=BLOCK → DENY, stderr cites BLOCK verdict', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'BLOCK' }),
    });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected JSON envelope on deny');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /verdict=BLOCK/);
    assert.match(result.stderr, /verdict=BLOCK/);
    assert.equal(writeFileSpy.calls.length, 0);
  });

  test('Y2: src/foo.ts Write + verdict=PASS → silent ALLOW', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'PASS' }),
    });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  test('X3: src/foo.ts Write + verdict=WARN, brain_confirmation=null → DENY citing missing confirmation', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'WARN', brain_confirmation: null }),
    });
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /verdict=WARN/);
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /brain_confirmation: null/);
  });

  test('Y4: src/foo.ts Write + verdict=WARN, brain_confirmation=ISO-8601 → ALLOW envelope citing timestamp', async () => {
    const ts = '2026-05-17T10:00:00Z';
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'WARN', brain_confirmation: ts }),
    });
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected ALLOW envelope on confirmed-WARN');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'allow');
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /confirmed by Brain at 2026-05-17T10:00:00Z/);
  });

  test('Y5: src/foo.ts Write + no plan_critique.md (FAIL-OPEN regression) → silent ALLOW', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      hasCritique: false,
    });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  test('Y6: .docs/foo.md Write (out of src/** scope) → silent ALLOW', async () => {
    const req = makeWriteRequest({
      target: '.docs/foo.md',
      critique: makePlanCritique({ verdict: 'BLOCK' }), // even with BLOCK, .docs/** is out of scope
    });
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  test('Y7: LFE-FORCE in transcript + src/foo.ts Write + verdict=BLOCK → ALLOW envelope + debt row', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'BLOCK' }),
      userMessages: ['proceed LFE-FORCE'],
      hasDebt: true,
    });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected ALLOW envelope on escape');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'allow');
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /LFE-FORCE/);
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /verdict was BLOCK/);
    assert.equal(writeFileSpy.calls.length, 1, 'PROTOCOL_DEBT.md must be written once');
    const call = writeFileSpy.calls[0];
    assert.match(String(call.path).replace(/\\/g, '/'), /PROTOCOL_DEBT\.md$/);
    assert.match(call.content, /LFE-FORCE write to `[^`]+` by .+ persona/);
    // Original baseline row preserved
    assert.match(call.content, /Sample Mission \| Bootstrap/);
  });
});

// --- Stage 1: stdin parse -----------------------------------------------------

describe('Stage 1: stdin parse', () => {
  test('non-JSON stdin → silent ALLOW', async () => {
    const { result } = await runMain({ stdin: 'not json' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });
  test('empty stdin → silent ALLOW', async () => {
    const { result } = await runMain({ stdin: '' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });
});

// --- Stage 2: tool-name pre-filter --------------------------------------------

describe('Stage 2: tool-name pre-filter', () => {
  test('Edit on src/** → silent ALLOW (plan-critique gate covers Write; path-lock covers Edit)', async () => {
    const req = makeWriteRequest({ target: 'src/foo.ts', toolName: 'Edit', critique: makePlanCritique({ verdict: 'BLOCK' }) });
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });
  test('Read on src/** → silent ALLOW', async () => {
    const req = makeWriteRequest({ target: 'src/foo.ts', toolName: 'Read' });
    const { result } = await runMain(req);
    assert.equal(result.stdout, '');
  });
  test('MultiEdit on src/** → silent ALLOW', async () => {
    const req = makeWriteRequest({ target: 'src/foo.ts', toolName: 'MultiEdit' });
    const { result } = await runMain(req);
    assert.equal(result.stdout, '');
  });
  test('GATED_TOOL constant equals Write', () => {
    assert.equal(GATED_TOOL, 'Write');
  });
});

// --- Stage 3: path scope check ------------------------------------------------

describe('Stage 3: path scope check (silent ALLOW on out-of-scope)', () => {
  test('.docs/quality/CHANGELOG.md → silent ALLOW', async () => {
    const req = makeWriteRequest({ target: '.docs/quality/CHANGELOG.md', critique: makePlanCritique({ verdict: 'BLOCK' }) });
    const { result } = await runMain(req);
    assert.equal(result.stdout, '');
  });
  test('.plans/active_plan.md → silent ALLOW', async () => {
    const req = makeWriteRequest({ target: '.plans/active_plan.md', critique: makePlanCritique({ verdict: 'BLOCK' }) });
    const { result } = await runMain(req);
    assert.equal(result.stdout, '');
  });
  test('.claude/hooks/foo.mjs → silent ALLOW (Cat I carve-out falls in path-scope check)', async () => {
    const req = makeWriteRequest({ target: '.claude/hooks/foo.mjs', critique: makePlanCritique({ verdict: 'BLOCK' }) });
    const { result } = await runMain(req);
    assert.equal(result.stdout, '');
  });
  test('scripts/setup-foo.mjs → silent ALLOW', async () => {
    const req = makeWriteRequest({ target: 'scripts/setup-foo.mjs', critique: makePlanCritique({ verdict: 'BLOCK' }) });
    const { result } = await runMain(req);
    assert.equal(result.stdout, '');
  });
  test('empty file_path → silent ALLOW', async () => {
    const req = makeWriteRequest({ target: 'src/foo.ts' });
    req.stdin.tool_input.file_path = '';
    const { result } = await runMain(req);
    assert.equal(result.stdout, '');
  });
  test('missing file_path → silent ALLOW', async () => {
    const req = makeWriteRequest({ target: 'src/foo.ts' });
    req.stdin.tool_input = {};
    const { result } = await runMain(req);
    assert.equal(result.stdout, '');
  });
  test('SRC_GLOB constant equals src/**', () => {
    assert.equal(SRC_GLOB, 'src/**');
  });
});

// --- Stage 4: critique file presence (FAIL-OPEN) ------------------------------

describe('Stage 4: critique file presence (FAIL-OPEN)', () => {
  test('ENOENT on critique read → silent ALLOW', async () => {
    const req = makeWriteRequest({ target: 'src/foo.ts', hasCritique: false });
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });
  test('arbitrary read error (EACCES) on critique → silent ALLOW', async () => {
    const req = makeWriteRequest({ target: 'src/foo.ts', hasCritique: false });
    const err = new Error('EACCES: permission denied');
    err.code = 'EACCES';
    req.files[`${PROJ}/${PLAN_CRITIQUE_PATH}`] = err;
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });
});

// --- Stage 5: frontmatter parse failure ---------------------------------------

describe('Stage 5: frontmatter parse failure (Cat D guards write-time)', () => {
  test('critique file with no frontmatter delimiter → silent ALLOW', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: '# just a heading, no frontmatter\n',
    });
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });
  test('critique with malformed frontmatter (missing colon) → silent ALLOW', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: '---\nphase architect\n---\nbody\n',
    });
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });
});

// --- Stage 5: verdict classification matrix -----------------------------------

describe('Stage 5: verdict classification on src/ Write', () => {
  test('verdict field absent → DENY (UNKNOWN)', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      // Manually craft frontmatter missing the verdict field
      critique: `---
phase: architect
step: plan_critique
status: complete
timestamp: 2026-05-17T20:40:00Z
source: .plans/active_plan.md
slice: 1
revision: 1
brain_confirmation: null
---
body
`,
    });
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /not one of PASS \/ WARN \/ BLOCK/);
  });
  test('non-enum verdict value (MAYBE) → DENY (UNKNOWN)', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'MAYBE' }),
    });
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });
  test('WARN + brain_confirmation: true (boolean) → DENY (defensive non-ISO)', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'WARN', brain_confirmation: 'true' }),
      // parseFrontmatter will read `true` as JS boolean
    });
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /brain_confirmation: true/);
  });
});

// --- Stage 6: LFE-FORCE escape ------------------------------------------------

describe('Stage 6: LFE-FORCE escape', () => {
  test('case-insensitive lfe-force triggers escape', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'BLOCK' }),
      userMessages: ['lfe-force this'],
      hasDebt: true,
    });
    const { result, writeFileSpy } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal(writeFileSpy.calls.length, 1);
  });

  test('WARN_NULL + LFE-FORCE → ALLOW + debt row (not just BLOCK case)', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'WARN', brain_confirmation: null }),
      userMessages: ['LFE-FORCE'],
      hasDebt: true,
    });
    const { result, writeFileSpy } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'allow');
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /verdict was WARN/);
    assert.equal(writeFileSpy.calls.length, 1);
  });

  test('transcript read failure on DENY-candidate → DENY (asymmetric fail-safe)', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'BLOCK' }),
    });
    delete req.files['/tmp/transcript.jsonl'];
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('PROTOCOL_DEBT.md write failure → still ALLOW + stderr warning', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'BLOCK' }),
      userMessages: ['LFE-FORCE'],
      hasDebt: true,
    });
    // Inject a writeFileSpy that throws on write
    const failingSpy = makeWriteFileSpy();
    const original = failingSpy;
    const throwingSpy = async (path, content) => {
      original.calls.push({ path, content });
      throw new Error('EROFS: read-only filesystem');
    };
    throwingSpy.calls = original.calls;
    const { result } = await runMain({ ...req, writeFileSpy: throwingSpy });
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'allow');
    assert.match(result.stderr, /PROTOCOL_DEBT\.md write failed/);
  });

  test('LFE-FORCE in OLD message (outside scan window) does NOT trigger escape', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'BLOCK' }),
      userMessages: ['LFE-FORCE', 'one', 'two', 'three'],
    });
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });
});

// --- Entrance card resolution for debt-row persona field ----------------------

describe('Entrance card resolution on escape path', () => {
  test('missing entrance card → still ALLOW with persona: unknown', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'BLOCK' }),
      userMessages: ['LFE-FORCE'],
      hasEntranceCard: false,
      hasDebt: true,
    });
    const { result, writeFileSpy } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal(writeFileSpy.calls.length, 1);
    assert.match(writeFileSpy.calls[0].content, /by unknown persona/);
  });

  test('valid entrance card → debt row cites persona from card', async () => {
    const req = makeWriteRequest({
      target: 'src/foo.ts',
      critique: makePlanCritique({ verdict: 'BLOCK' }),
      userMessages: ['LFE-FORCE'],
      hasDebt: true,
      persona: 'Builder',
    });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(parseEnvelope(result.stdout).hookSpecificOutput.permissionDecision, 'allow');
    assert.match(writeFileSpy.calls[0].content, /by Builder persona/);
  });
});

// --- Exported constants sanity ------------------------------------------------

describe('exported constants', () => {
  test('PLAN_CRITIQUE_PATH is canonical', () => {
    assert.equal(PLAN_CRITIQUE_PATH, '.plans/plan_critique.md');
  });
  test('GATED_TOOL is Write only', () => {
    assert.equal(GATED_TOOL, 'Write');
  });
  test('SRC_GLOB is src/**', () => {
    assert.equal(SRC_GLOB, 'src/**');
  });
  test('ISO_8601_RE matches canonical UTC timestamps', () => {
    assert.ok(ISO_8601_RE.test('2026-05-17T10:00:00Z'));
    assert.ok(!ISO_8601_RE.test('2026-05-17T10:00:00.000Z'));
    assert.ok(!ISO_8601_RE.test('2026-05-17 10:00:00Z'));
  });
});

// --- bounded transcript tail reader (AC1) ---------------------------

describe('main: escape-path transcript is read via injected readFileTail (AC1)', () => {
  test('on a BLOCK verdict, LFE-FORCE escape fires via readFileTail; readFileText never reads the transcript', async () => {
    const tailCalls = [];
    const readFileText = async (path) => {
      const key = String(path).replace(/\\/g, '/');
      if (key.endsWith(PLAN_CRITIQUE_PATH)) return makePlanCritique({ verdict: 'BLOCK' });
      if (key.endsWith('pipeline_status.md')) return makeEntranceCard({ persona: 'Builder' });
      if (key.endsWith('PROTOCOL_DEBT.md')) return PROTOCOL_DEBT_FIXTURE;
      if (key.endsWith('.jsonl')) throw new Error('transcript must be read via readFileTail, not readFileText');
      const err = new Error(`ENOENT: ${key}`);
      err.code = 'ENOENT';
      throw err;
    };
    const readFileTail = async (path) => {
      tailCalls.push(String(path));
      return makeTranscript({ userMessages: ['proceed LFE-FORCE'] });
    };
    const spy = makeWriteFileSpy();
    const result = await main({
      stdinText: JSON.stringify({
        tool_name: 'Write',
        transcript_path: '/tmp/transcript.jsonl',
        cwd: PROJ,
        tool_input: { file_path: `${PROJ}/src/foo.ts` },
      }),
      readFileText,
      readFileTail,
      writeFileText: spy,
      now: () => '2026-06-01T11:00:00.000Z',
      env: { CLAUDE_PROJECT_DIR: PROJ },
    });
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected an escape envelope');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal(tailCalls.length, 1, 'transcript read exactly once via readFileTail');
    assert.match(tailCalls[0], /\.jsonl$/);
    assert.equal(spy.calls.length, 1, 'debt row written on escape');
  });
});
