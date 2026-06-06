import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import {
  parseEntranceCard,
  classifyState,
  pickResumeTarget,
  render,
  main,
  RESUME_LADDER,
  computeHygieneDue,
} from '../session-start-reminder.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, '..', 'session-start-reminder.mjs');

function runCliWithStdin(stdinText, envOverrides = {}) {
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, [SCRIPT_PATH], {
      env: { ...process.env, ...envOverrides },
      cwd: process.cwd(),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolveP({ code, stdout, stderr }));
    child.stdin.end(stdinText);
  });
}

const SAMPLE_CARD = `# 🏛️ LFE Mission Control (Entrance Card)
| Category | Status / Value |
| :--- | :--- |
| **Integrity Score** | 🟢 [Integrity: 100%] |
| **Mission State** | [DOMAIN LOADED] |
| **Active Persona** | Architect |
| **Pipeline Phase** | Ready |
| **Coordination Files** | 01 ⬜ |
| **Session Count** | 3 |
| **Last Architecture Sweep** | Never (due in 2 sessions) |`;

// ─── parseEntranceCard ────────────────────────────────────────────────

test('parseEntranceCard extracts all expected fields', () => {
  const e = parseEntranceCard(SAMPLE_CARD);
  assert.equal(e.missionState, '[DOMAIN LOADED]');
  assert.equal(e.activePersona, 'Architect');
  assert.equal(e.pipelinePhase, 'Ready');
  assert.equal(e.sessionCount, '3');
  assert.equal(e.lastArchSweep, 'Never (due in 2 sessions)');
});

test('parseEntranceCard returns "unknown" for missing fields', () => {
  const e = parseEntranceCard('| **Other** | x |');
  assert.equal(e.missionState, 'unknown');
  assert.equal(e.activePersona, 'unknown');
  assert.equal(e.sessionCount, 'unknown');
});

test('parseEntranceCard tolerates extra whitespace', () => {
  const card = '|   **Mission State**   |   [BLANK CANVAS]   |';
  const e = parseEntranceCard(card);
  assert.equal(e.missionState, '[BLANK CANVAS]');
});

// ─── classifyState ────────────────────────────────────────────────────

test('classifyState — Variant A on BLANK CANVAS', () => {
  const c = classifyState({ missionState: '[BLANK CANVAS]' }, []);
  assert.equal(c.variant, 'A');
});

test('classifyState — Variant B on DOMAIN LOADED with empty plans', () => {
  const c = classifyState({ missionState: '[DOMAIN LOADED]' }, []);
  assert.equal(c.variant, 'B');
});

test('classifyState — Variant B on DOMAIN LOADED with only .gitkeep', () => {
  const c = classifyState({ missionState: '[DOMAIN LOADED]' }, ['.gitkeep']);
  assert.equal(c.variant, 'B');
});

test('classifyState — Variant C on IN-FLIGHT', () => {
  const c = classifyState(
    { missionState: '[IN-FLIGHT: Builder]' },
    ['active_plan.md', '.gitkeep'],
  );
  assert.equal(c.variant, 'C');
  assert.deepEqual(c.planFiles, ['active_plan.md']);
});

test('classifyState — Variant C on DOMAIN LOADED when plans present', () => {
  const c = classifyState(
    { missionState: '[DOMAIN LOADED]' },
    ['01_grill_summary.md'],
  );
  assert.equal(c.variant, 'C');
});

test('classifyState — Variant D on MISSION COMPLETE with no plans', () => {
  const c = classifyState({ missionState: '[MISSION COMPLETE]' }, ['.gitkeep']);
  assert.equal(c.variant, 'D');
});

test("classifyState — Variant D' on MISSION COMPLETE with plans (anomaly)", () => {
  const c = classifyState(
    { missionState: '[MISSION COMPLETE]' },
    ['active_plan.md'],
  );
  assert.equal(c.variant, "D'");
});

test('classifyState — Variant E on unrecognised state', () => {
  const c = classifyState({ missionState: 'GARBAGE' }, []);
  assert.equal(c.variant, 'E');
  assert.equal(c.rawState, 'GARBAGE');
});

// ─── pickResumeTarget ─────────────────────────────────────────────────

test('pickResumeTarget — picks inspection_report when present', () => {
  const t = pickResumeTarget(['inspection_report.md', 'active_plan.md']);
  assert.equal(t.file, 'inspection_report.md');
});

test('pickResumeTarget — picks tdd_report over builder_done', () => {
  const t = pickResumeTarget(['builder_done.md', 'tdd_report.md']);
  assert.equal(t.file, 'tdd_report.md');
});

test('pickResumeTarget — picks active_plan over 03_slices', () => {
  const t = pickResumeTarget(['03_slices.md', 'active_plan.md']);
  assert.equal(t.file, 'active_plan.md');
});

test('pickResumeTarget — picks 01_grill_summary alone', () => {
  const t = pickResumeTarget(['01_grill_summary.md']);
  assert.equal(t.file, '01_grill_summary.md');
});

test('pickResumeTarget — returns null on empty / unknown listing', () => {
  assert.equal(pickResumeTarget([]), null);
  assert.equal(pickResumeTarget(['random.md', '.gitkeep']), null);
});

test('pickResumeTarget — full ladder order matches LOOP_ARCHITECTURE §4', () => {
  // All eight ladder targets, in canonical order
  const allFiles = RESUME_LADDER.map((e) => e.file).reverse();
  // pickResumeTarget should always return the most-recent (first in ladder)
  const t = pickResumeTarget(allFiles);
  assert.equal(t.file, 'inspection_report.md');
});

// ─── render — variant text + 400-char cap ─────────────────────────────

const ENTRANCE_DEFAULT = {
  missionState: '[DOMAIN LOADED]',
  activePersona: 'Architect',
  sessionCount: '3',
};

test('render — Variant A cites /lfe-extract-domain', () => {
  const text = render(
    { ...ENTRANCE_DEFAULT, missionState: '[BLANK CANVAS]' },
    { variant: 'A', planFiles: [] },
  );
  assert.ok(text.includes('/lfe-extract-domain'));
  assert.ok(text.includes('BLANK CANVAS'));
  assert.ok(text.length <= 400);
});

test('render — Variant B cites /lfe-boot and Complexity Gate', () => {
  const text = render(ENTRANCE_DEFAULT, { variant: 'B', planFiles: [] });
  assert.ok(text.includes('/lfe-boot'));
  assert.ok(text.includes('Complexity Gate'));
  assert.ok(text.length <= 400);
});

test('render — Variant C with tdd_report cites /lfe-inspector', () => {
  const text = render(
    { ...ENTRANCE_DEFAULT, missionState: '[IN-FLIGHT: Builder]', activePersona: 'Builder' },
    { variant: 'C', planFiles: ['tdd_report.md', 'active_plan.md'] },
  );
  assert.ok(text.includes('tdd_report.md'));
  assert.ok(text.includes('/lfe-inspector'));
  assert.ok(text.length <= 400);
});

test('render — Variant C with plan_critique cites LOOP_ARCHITECTURE sub-states', () => {
  const text = render(
    { ...ENTRANCE_DEFAULT, missionState: '[IN-FLIGHT: Architect]' },
    { variant: 'C', planFiles: ['plan_critique.md', 'active_plan.md'] },
  );
  assert.ok(text.includes('LOOP_ARCHITECTURE'));
  assert.ok(text.includes('PASS'));
  assert.ok(text.includes('BLOCK'));
  assert.ok(text.length <= 400);
});

test('render — Variant C with inspection_report names failed / escalated branches', () => {
  const text = render(
    { ...ENTRANCE_DEFAULT, missionState: '[IN-FLIGHT: Inspector]', activePersona: 'Inspector' },
    { variant: 'C', planFiles: ['inspection_report.md'] },
  );
  assert.ok(text.includes('/lfe-archivist'));
  assert.ok(text.includes('failed'));
  assert.ok(text.includes('escalated') || text.includes('triage'));
  assert.ok(text.length <= 400);
});

test('render — Variant C with active_plan cites /lfe-plan-critique', () => {
  const text = render(
    { ...ENTRANCE_DEFAULT, missionState: '[IN-FLIGHT: Architect]' },
    { variant: 'C', planFiles: ['03_slices.md', 'active_plan.md'] },
  );
  assert.ok(text.includes('/lfe-plan-critique'));
});

test('render — Variant C with 03_slices cites /lfe-architect', () => {
  const text = render(
    { ...ENTRANCE_DEFAULT, missionState: '[IN-FLIGHT: Architect]' },
    { variant: 'C', planFiles: ['03_slices.md'] },
  );
  assert.ok(text.includes('/lfe-architect'));
});

test('render — Variant C with 01_grill_summary cites /lfe-to-prd', () => {
  const text = render(
    { ...ENTRANCE_DEFAULT, missionState: '[IN-FLIGHT: Architect]' },
    { variant: 'C', planFiles: ['01_grill_summary.md'] },
  );
  assert.ok(text.includes('/lfe-to-prd'));
});

test('render — Variant D cites clean slate and /lfe-boot', () => {
  const text = render(
    { ...ENTRANCE_DEFAULT, missionState: '[MISSION COMPLETE]', activePersona: 'Archivist', sessionCount: '4' },
    { variant: 'D', planFiles: [] },
  );
  assert.ok(text.includes('MISSION COMPLETE'));
  assert.ok(text.includes('/lfe-boot'));
  assert.ok(text.length <= 400);
});

test("render — Variant D' flags State Anomaly and cites /lfe-zoom-out", () => {
  const text = render(
    { ...ENTRANCE_DEFAULT, missionState: '[MISSION COMPLETE]', activePersona: 'Archivist', sessionCount: '4' },
    { variant: "D'", planFiles: ['active_plan.md', 'tdd_report.md'] },
  );
  assert.ok(text.includes('State Anomaly'));
  assert.ok(text.includes('/lfe-zoom-out'));
  assert.ok(text.length <= 400);
});

test('render — Variant E surfaces the raw unparsed state', () => {
  const text = render(
    { missionState: 'GARBAGE', activePersona: 'unknown', sessionCount: 'unknown' },
    { variant: 'E', planFiles: [], rawState: 'GARBAGE' },
  );
  assert.ok(text.includes('GARBAGE'));
  assert.ok(text.length <= 400);
});

test('render — unknown variant id falls back to the unparsed renderer (does not throw)', () => {
  // Refactor regression guard: the VARIANT_RENDERERS lookup
  // uses `?? renderUnparsed`, so any id classifyState never emits still degrades
  // gracefully — exactly as the pre-extraction switch `default` arm did.
  const text = render(
    { missionState: 'GARBAGE', activePersona: 'unknown', sessionCount: 'unknown' },
    { variant: 'Z', planFiles: [], rawState: 'GARBAGE' },
  );
  assert.ok(text.includes('could not be parsed'));
  assert.ok(text.length <= 400);
});

test('render — caps text at 400 chars under long persona', () => {
  const longPersona = 'X'.repeat(800);
  const text = render(
    { ...ENTRANCE_DEFAULT, activePersona: longPersona },
    { variant: 'B', planFiles: [] },
  );
  assert.ok(text.length <= 400);
});

// ─── main — end-to-end + degradation paths ────────────────────────────

test('main — end-to-end DOMAIN LOADED clean state hits Variant B', async () => {
  const text = await main({
    projectDir: '/fake',
    readFileText: async () => SAMPLE_CARD,
    listPlansFn: async () => ['.gitkeep'],
  });
  assert.ok(text.includes('/lfe-boot'));
  assert.ok(text.includes('Complexity Gate'));
});

test('main — end-to-end IN-FLIGHT picks the highest ladder target', async () => {
  const inFlightCard = SAMPLE_CARD.replace(
    '[DOMAIN LOADED]',
    '[IN-FLIGHT: Builder]',
  ).replace('Architect |\n| **Pipeline Phase**', 'Builder |\n| **Pipeline Phase**');
  const text = await main({
    projectDir: '/fake',
    readFileText: async () => inFlightCard,
    listPlansFn: async () => ['active_plan.md', 'builder_done.md', '.gitkeep'],
  });
  assert.ok(text.includes('builder_done.md'));
  assert.ok(text.includes('/lfe-tdd'));
});

test('main — fallback text when pipeline_status.md cannot be read', async () => {
  const text = await main({
    projectDir: '/fake',
    readFileText: async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    listPlansFn: async () => [],
  });
  assert.ok(text.includes('Run /lfe-boot'));
});

test('main — degradation: renamed Active Persona row falls back to "unknown"', async () => {
  const renamedCard = `| **Mission State** | [DOMAIN LOADED] |
| **Persona** | Architect |
| **Pipeline Phase** | Ready |
| **Session Count** | 3 |`;
  const text = await main({
    projectDir: '/fake',
    readFileText: async () => renamedCard,
    listPlansFn: async () => [],
  });
  // activePersona renders as "unknown" because we look for "Active Persona"
  assert.ok(text.includes('unknown'));
  assert.ok(text.length <= 400);
});

test('main — degradation: missing Mission State row degrades to Variant E', async () => {
  const card = `| **Active Persona** | Architect |
| **Session Count** | 3 |`;
  const text = await main({
    projectDir: '/fake',
    readFileText: async () => card,
    listPlansFn: async () => [],
  });
  // missionState becomes "unknown", which is not BLANK/DOMAIN/IN-FLIGHT/MISSION → Variant E
  assert.ok(text.includes('could not be parsed'));
  assert.ok(text.length <= 400);
});

// ─── CLI integration (real child-process spawn, real fs reads) ────────

test('CLI — spawning with empty stdin produces a valid JSON envelope, exit 0, no stderr', async () => {
  const r = await runCliWithStdin('{}', { CLAUDE_PROJECT_DIR: process.cwd() });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  const env = JSON.parse(r.stdout);
  assert.equal(env.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(typeof env.hookSpecificOutput.additionalContext, 'string');
  assert.ok(env.hookSpecificOutput.additionalContext.length > 0);
  assert.ok(env.hookSpecificOutput.additionalContext.length <= 400);
});

test('CLI — missing CLAUDE_PROJECT_DIR falls back to cwd and still emits valid envelope', async () => {
  const envNoDir = { ...process.env };
  delete envNoDir.CLAUDE_PROJECT_DIR;
  const r = await new Promise((resolveP) => {
    const child = spawn(process.execPath, [SCRIPT_PATH], {
      env: envNoDir,
      cwd: process.cwd(),
    });
    let stdout = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.on('close', (code) => resolveP({ code, stdout }));
    child.stdin.end('{}');
  });
  assert.equal(r.code, 0);
  const env = JSON.parse(r.stdout);
  assert.equal(env.hookSpecificOutput.hookEventName, 'SessionStart');
});

// ─── computeHygieneDue (pure threshold function) ─────────────

test("computeHygieneDue — Never + session 3 → not overdue, gap 3", () => {
  const due = computeHygieneDue('3', 'Never');
  assert.equal(due.overdue, false);
  assert.equal(due.gapSessions, 3);
});

test("computeHygieneDue — Never + session 4 → not overdue (boundary -1)", () => {
  const due = computeHygieneDue('4', 'Never');
  assert.equal(due.overdue, false);
  assert.equal(due.gapSessions, 4);
});

test("computeHygieneDue — Never + session 5 → overdue at threshold", () => {
  const due = computeHygieneDue('5', 'Never');
  assert.equal(due.overdue, true);
  assert.equal(due.gapSessions, 5);
});

test("computeHygieneDue — Never + session 10 → overdue, gap 10", () => {
  const due = computeHygieneDue('10', 'Never');
  assert.equal(due.overdue, true);
  assert.equal(due.gapSessions, 10);
});

test("computeHygieneDue — Never with decorative parenthetical still parsed", () => {
  const due = computeHygieneDue('5', 'Never (due in 2 sessions)');
  assert.equal(due.overdue, true);
  assert.equal(due.gapSessions, 5);
});

test("computeHygieneDue — numeric lastSweep + same-session gap 0", () => {
  const due = computeHygieneDue('5', '5');
  assert.equal(due.overdue, false);
  assert.equal(due.gapSessions, 0);
});

test("computeHygieneDue — gap 4 (one below threshold) → not overdue", () => {
  const due = computeHygieneDue('9', '5');
  assert.equal(due.overdue, false);
  assert.equal(due.gapSessions, 4);
});

test("computeHygieneDue — gap exactly 5 → overdue", () => {
  const due = computeHygieneDue('10', '5');
  assert.equal(due.overdue, true);
  assert.equal(due.gapSessions, 5);
});

test("computeHygieneDue — numeric lastSweep with decoration parsed as int prefix", () => {
  const due = computeHygieneDue('10', '5 (due in 0 sessions)');
  assert.equal(due.overdue, true);
  assert.equal(due.gapSessions, 5);
});

test("computeHygieneDue — unparseable sessionCount → safe default", () => {
  const due = computeHygieneDue('unknown', 'Never');
  assert.equal(due.overdue, false);
  assert.equal(due.gapSessions, 0);
});

test("computeHygieneDue — unparseable lastSweep → safe default", () => {
  const due = computeHygieneDue('5', 'gibberish');
  assert.equal(due.overdue, false);
  assert.equal(due.gapSessions, 0);
});

test("computeHygieneDue — undefined inputs → safe default", () => {
  const due = computeHygieneDue(undefined, undefined);
  assert.equal(due.overdue, false);
  assert.equal(due.gapSessions, 0);
});

// ─── render integration — banner present / suppressed ────────

const OVERDUE_ENTRANCE = {
  missionState: '[DOMAIN LOADED]',
  activePersona: 'Architect',
  sessionCount: '5',
  lastArchSweep: 'Never',
};

test('render — Variant B with overdue hygiene appends banner', () => {
  const text = render(OVERDUE_ENTRANCE, { variant: 'B', planFiles: [] });
  assert.ok(text.includes('Architecture sweep overdue'));
  assert.ok(text.includes('/lfe-hygiene'));
  assert.ok(text.includes('5 sessions'));
  assert.ok(text.length <= 400);
});

test('render — Variant C with overdue hygiene appends banner', () => {
  const text = render(
    { ...OVERDUE_ENTRANCE, missionState: '[IN-FLIGHT: Builder]', activePersona: 'Builder' },
    { variant: 'C', planFiles: ['builder_done.md'] },
  );
  assert.ok(text.includes('builder_done.md'));
  assert.ok(text.includes('Architecture sweep overdue'));
  assert.ok(text.length <= 400);
});

test('render — Variant D with overdue hygiene appends banner', () => {
  const text = render(
    { ...OVERDUE_ENTRANCE, missionState: '[MISSION COMPLETE]', activePersona: 'Archivist' },
    { variant: 'D', planFiles: [] },
  );
  assert.ok(text.includes('MISSION COMPLETE'));
  assert.ok(text.includes('Architecture sweep overdue'));
  assert.ok(text.length <= 400);
});

test('render — Variant A suppresses hygiene banner (orientation priority)', () => {
  const text = render(
    { ...OVERDUE_ENTRANCE, missionState: '[BLANK CANVAS]' },
    { variant: 'A', planFiles: [] },
  );
  assert.ok(text.includes('/lfe-extract-domain'));
  assert.ok(!text.includes('Architecture sweep overdue'));
});

test("render — Variant D' suppresses hygiene banner (State Anomaly already cites /lfe-zoom-out)", () => {
  const text = render(
    { ...OVERDUE_ENTRANCE, missionState: '[MISSION COMPLETE]', activePersona: 'Archivist' },
    { variant: "D'", planFiles: ['active_plan.md'] },
  );
  assert.ok(text.includes('State Anomaly'));
  assert.ok(text.includes('/lfe-zoom-out'));
  assert.ok(!text.includes('Architecture sweep overdue'));
});

test('render — Variant E suppresses hygiene banner (unparsed state has bigger problems)', () => {
  const text = render(
    { ...OVERDUE_ENTRANCE, missionState: 'GARBAGE' },
    { variant: 'E', planFiles: [], rawState: 'GARBAGE' },
  );
  assert.ok(text.includes('could not be parsed'));
  assert.ok(!text.includes('Architecture sweep overdue'));
});

test('render — Variant B without overdue (gap < 5) does NOT append banner', () => {
  const text = render(
    { missionState: '[DOMAIN LOADED]', activePersona: 'Architect', sessionCount: '3', lastArchSweep: 'Never' },
    { variant: 'B', planFiles: [] },
  );
  assert.ok(text.includes('/lfe-boot'));
  assert.ok(!text.includes('Architecture sweep overdue'));
});

test('render — combined text + banner stays under 400 chars under pathological input', () => {
  const longPersona = 'X'.repeat(800);
  const text = render(
    { ...OVERDUE_ENTRANCE, activePersona: longPersona },
    { variant: 'B', planFiles: [] },
  );
  assert.ok(text.length <= 400);
});

test('main — end-to-end with overdue session 5 fires the hygiene banner', async () => {
  const card = `| **Mission State** | [DOMAIN LOADED] |
| **Active Persona** | Architect |
| **Pipeline Phase** | Ready |
| **Session Count** | 5 |
| **Last Architecture Sweep** | Never |`;
  const text = await main({
    projectDir: '/fake',
    readFileText: async () => card,
    listPlansFn: async () => ['.gitkeep'],
  });
  assert.ok(text.includes('/lfe-boot'));
  assert.ok(text.includes('Architecture sweep overdue by 5 sessions'));
});

test('main — end-to-end with session 4 + Never does NOT fire the banner', async () => {
  const card = `| **Mission State** | [DOMAIN LOADED] |
| **Active Persona** | Architect |
| **Session Count** | 4 |
| **Last Architecture Sweep** | Never |`;
  const text = await main({
    projectDir: '/fake',
    readFileText: async () => card,
    listPlansFn: async () => ['.gitkeep'],
  });
  assert.ok(!text.includes('Architecture sweep overdue'));
});

// ─── per-session id rotation side-effect (C2a) ───────────────

test('main — writes .session-id when sessionId + writeFileText provided', async () => {
  const writes = [];
  const text = await main({
    projectDir: '/fake',
    readFileText: async () => SAMPLE_CARD,
    listPlansFn: async () => ['.gitkeep'],
    writeFileText: async (p, c) => { writes.push({ p, c }); },
    sessionId: 'sess-xyz',
  });
  assert.equal(writes.length, 1);
  assert.ok(writes[0].p.endsWith('.session-id'));
  assert.equal(writes[0].c, 'sess-xyz');
  assert.ok(text.length > 0); // orientation still emitted
});

test('main — does NOT write .session-id when sessionId absent', async () => {
  const writes = [];
  await main({
    projectDir: '/fake',
    readFileText: async () => SAMPLE_CARD,
    listPlansFn: async () => ['.gitkeep'],
    writeFileText: async (p, c) => { writes.push({ p, c }); },
    sessionId: null,
  });
  assert.equal(writes.length, 0);
});

test('main — .session-id write failure does NOT break orientation (fail-safe)', async () => {
  const text = await main({
    projectDir: '/fake',
    readFileText: async () => SAMPLE_CARD,
    listPlansFn: async () => ['.gitkeep'],
    writeFileText: async () => { throw new Error('disk full'); },
    sessionId: 'sess-xyz',
  });
  assert.ok(text.includes('/lfe-boot')); // no throw; context still returned
});
