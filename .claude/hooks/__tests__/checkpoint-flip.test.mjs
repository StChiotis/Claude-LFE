// Checkpoint-Flip PostToolUse Hook test suite.
// Mirrors the dependency-injection pattern established by Cat D and the
// BE-posture gates: every fixture passes mocks to main(); no real disk I/O. The
// hook is a state mutator (silent-ALLOW always; informative stderr) — there
// is no JSON envelope on stdout for permissionDecision, so assertions key off
// writeFileSpy calls + stderr text.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  main,
  CHECKPOINT_MAP,
  FLIP_ELIGIBLE_STATUSES,
  flipCheckbox,
} from '../checkpoint-flip.mjs';

// --- Shared fixtures ----------------------------------------------------------

const PROJ = '/proj';

const DEFAULT_COORDINATION_ROW =
  '01 ⬜  02 ⬜  03 ⬜  plan ⬜  plan_critique ⬜  build ⬜  tdd ⬜  critique ⬜  inspect ⬜';

function makeEntranceCard({ coordinationFiles = DEFAULT_COORDINATION_ROW } = {}) {
  return `# 🏛️ LFE Mission Control

| Category | Status / Value |
| :--- | :--- |
| **Integrity Score** | 🟢 [Integrity: 100%] |
| **Active Persona** | Builder |
| **Coordination Files** | ${coordinationFiles} |
| **Session Count** | 9 |

---
`;
}

function makePlansFile({
  status = 'complete',
  step = 'builder',
  phase = 'builder',
  source = 'n/a',
  timestamp = '2026-05-17T10:00:00.000Z',
  slice = '1',
  extraFields = '',
} = {}) {
  const sliceLine = slice ? `slice: ${slice}\n` : '';
  return `---
phase: ${phase}
step: ${step}
status: ${status}
timestamp: ${timestamp}
source: ${source}
${sliceLine}${extraFields}---

# Body content
`;
}

function makeWriteFileSpy() {
  const calls = [];
  const fn = async (path, content) => {
    calls.push({ path, content });
  };
  fn.calls = calls;
  return fn;
}

function makeThrowingWriteFileSpy(errMsg = 'disk full') {
  const fn = async () => {
    throw new Error(errMsg);
  };
  fn.calls = [];
  return fn;
}

async function runMain({
  stdin = {},
  files = {},
  writeFileSpy,
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
    now: () => '2026-05-17T10:00:00.000Z',
    env,
  });
  return { result, writeFileSpy: spy };
}

function makeRequest({
  target = '.plans/active_plan.md',
  status = 'complete',
  step = 'architect',
  plansBody,
  coordinationFiles,
  toolName = 'Write',
} = {}) {
  return {
    stdin: {
      session_id: 'sess-1',
      hook_event_name: 'PostToolUse',
      tool_name: toolName,
      tool_input: { file_path: `${PROJ}/${target}` },
      cwd: PROJ,
    },
    files: {
      [`${PROJ}/${target}`]: plansBody ?? makePlansFile({ status, step }),
      [`${PROJ}/pipeline_status.md`]: makeEntranceCard({ coordinationFiles }),
    },
  };
}

// --- Describe: CHECKPOINT_MAP + FLIP_ELIGIBLE_STATUSES sanity ----------------

describe('CHECKPOINT_MAP', () => {
  test('contains exactly 9 entries matching the entrance card row', () => {
    assert.equal(Object.keys(CHECKPOINT_MAP).length, 9);
  });

  test('label set matches the canonical Coordination Files slots', () => {
    const labels = Object.values(CHECKPOINT_MAP).sort();
    const expected = ['01', '02', '03', 'build', 'critique', 'inspect', 'plan', 'plan_critique', 'tdd'].sort();
    assert.deepEqual(labels, expected);
  });

  test('every filename maps to a distinct label', () => {
    const labels = Object.values(CHECKPOINT_MAP);
    assert.equal(new Set(labels).size, labels.length);
  });
});

describe('FLIP_ELIGIBLE_STATUSES', () => {
  test('is exactly {complete, passed, escalated} per COORDINATION_FILES.md', () => {
    assert.deepEqual([...FLIP_ELIGIBLE_STATUSES].sort(), ['complete', 'escalated', 'passed']);
  });

  test('does NOT include failed (verification-skill semantic per COORDINATION_FILES.md:19)', () => {
    assert.equal(FLIP_ELIGIBLE_STATUSES.includes('failed'), false);
  });
});

// --- Describe: flipCheckbox pure helper --------------------------------------

describe('flipCheckbox', () => {
  const ROW =
    '| **Coordination Files** | 01 ⬜  02 ⬜  03 ⬜  plan ⬜  plan_critique ⬜  build ⬜  tdd ⬜  critique ⬜  inspect ⬜ |';

  test('flips a simple label ⬜ → ✅', () => {
    const r = flipCheckbox(ROW, 'plan');
    assert.equal(r.status, 'flipped');
    assert.match(r.text, /plan ✅/);
  });

  test('flips underscore label (plan_critique) without disturbing plan', () => {
    const r = flipCheckbox(ROW, 'plan_critique');
    assert.equal(r.status, 'flipped');
    assert.match(r.text, /plan_critique ✅/);
    assert.match(r.text, /plan ⬜/);
  });

  test('plan flip does NOT match the `plan` prefix in plan_critique (word boundary)', () => {
    const r = flipCheckbox(ROW, 'plan');
    assert.equal(r.status, 'flipped');
    assert.match(r.text, /plan_critique ⬜/);
    assert.match(r.text, /plan ✅/);
    assert.doesNotMatch(r.text, /plan_critique ✅/);
  });

  test('already-✅ → status="already", text unchanged', () => {
    const flipped = ROW.replace('plan ⬜', 'plan ✅');
    const r = flipCheckbox(flipped, 'plan');
    assert.equal(r.status, 'already');
    assert.equal(r.text, flipped);
  });

  test('label-not-present → status="no_label"', () => {
    const r = flipCheckbox('| **Coordination Files** | 01 ⬜  02 ⬜ |', 'plan');
    assert.equal(r.status, 'no_label');
  });

  test('no Coordination Files row → status="no_row"', () => {
    const r = flipCheckbox('# different file\n\n| Other | Row |\n', 'plan');
    assert.equal(r.status, 'no_row');
  });

  test('⬚ (intentional invalid) slot is preserved on no_label', () => {
    const withInvalid = ROW.replace('plan ⬜', 'plan ⬚');
    const r = flipCheckbox(withInvalid, 'plan');
    assert.equal(r.status, 'no_label');
    assert.equal(r.text, withInvalid);
  });

  test('flipping one slot preserves all other slots unchanged', () => {
    const r = flipCheckbox(ROW, 'build');
    assert.equal(r.status, 'flipped');
    for (const label of ['01', '02', '03', 'plan', 'plan_critique', 'tdd', 'critique', 'inspect']) {
      assert.match(r.text, new RegExp(`${label} ⬜`), `${label} should remain ⬜`);
    }
    assert.match(r.text, /build ✅/);
  });

  test('mixed ⬜/✅/⬚ state preserves non-flipped slots verbatim', () => {
    const mixed =
      '| **Coordination Files** | 01 ✅  02 ⬜  03 ⬚  plan ⬜  plan_critique ⬜  build ⬜  tdd ⬜  critique ⬜  inspect ⬜ |';
    const r = flipCheckbox(mixed, 'plan');
    assert.equal(r.status, 'flipped');
    assert.match(r.text, /01 ✅/);
    assert.match(r.text, /02 ⬜/);
    assert.match(r.text, /03 ⬚/);
    assert.match(r.text, /plan ✅/);
  });

  test('null/undefined input → no_row (defensive)', () => {
    assert.equal(flipCheckbox(null, 'plan').status, 'no_row');
    assert.equal(flipCheckbox(undefined, 'plan').status, 'no_row');
  });
});

// --- Describe: main() — 9 happy-path checkpoint flips ------------------------

describe('main: 9 happy-path checkpoint flips', () => {
  for (const [filename, label] of Object.entries(CHECKPOINT_MAP)) {
    test(`${filename} status=complete → ${label} ⬜ → ✅`, async () => {
      const req = makeRequest({ target: `.plans/${filename}`, status: 'complete' });
      const { result, writeFileSpy } = await runMain(req);
      assert.equal(result.exitCode, 0);
      assert.equal(writeFileSpy.calls.length, 1);
      assert.match(String(writeFileSpy.calls[0].path).replace(/\\/g, '/'), /pipeline_status\.md$/);
      const labelEscaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(writeFileSpy.calls[0].content, new RegExp(`${labelEscaped} ✅`));
      assert.match(result.stderr, /⬜ → ✅/);
    });
  }
});

// --- Describe: main() — status-gate negatives + positives --------------------

describe('main: status gate', () => {
  for (const status of ['failed', 'in_progress', 'draft', 'unknown_value']) {
    test(`status=${status} → no flip, stderr cites status`, async () => {
      const req = makeRequest({ target: '.plans/active_plan.md', status });
      const { result, writeFileSpy } = await runMain(req);
      assert.equal(result.exitCode, 0);
      assert.equal(writeFileSpy.calls.length, 0);
      assert.match(result.stderr, new RegExp(`status=${status}`));
    });
  }

  test('status=passed → flips (Inspector verdict semantic)', async () => {
    const req = makeRequest({
      target: '.plans/inspection_report.md',
      status: 'passed',
      step: 'inspector',
    });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(writeFileSpy.calls.length, 1);
    assert.match(writeFileSpy.calls[0].content, /inspect ✅/);
  });

  test('status=escalated → flips (Cycle Guard halt semantic)', async () => {
    const req = makeRequest({
      target: '.plans/inspection_report.md',
      status: 'escalated',
      step: 'inspector',
    });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(writeFileSpy.calls.length, 1);
    assert.match(writeFileSpy.calls[0].content, /inspect ✅/);
  });

  test('missing status field → no flip, stderr cites undefined', async () => {
    const req = makeRequest({ target: '.plans/active_plan.md' });
    req.files[`${PROJ}/.plans/active_plan.md`] = `---
phase: architect
step: architect
timestamp: 2026-05-17T10:00:00.000Z
source: n/a
slice: 1
---
body
`;
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(writeFileSpy.calls.length, 0);
    assert.match(result.stderr, /status=undefined/);
  });
});

// --- Describe: main() — idempotency ------------------------------------------

describe('main: idempotency', () => {
  test('already-✅ slot → no write, stderr "already ✅"', async () => {
    const req = makeRequest({
      target: '.plans/active_plan.md',
      status: 'complete',
      coordinationFiles:
        '01 ⬜  02 ⬜  03 ⬜  plan ✅  plan_critique ⬜  build ⬜  tdd ⬜  critique ⬜  inspect ⬜',
    });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(writeFileSpy.calls.length, 0);
    assert.match(result.stderr, /already ✅/);
  });
});

// --- Describe: main() — non-mapped files silent no-op ------------------------

describe('main: non-mapped files', () => {
  const nonMapped = [
    '.plans/checks/security_findings.md',
    '.plans/checks/perf_findings.md',
    '.plans/diagnosis_report.md',
    '.plans/hygiene_report.md',
    '.plans/.gitkeep',
    '.plans/random.md',
  ];

  for (const path of nonMapped) {
    test(`${path} → silent no-op (no flip, no stderr)`, async () => {
      const req = {
        stdin: {
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: `${PROJ}/${path}` },
          cwd: PROJ,
        },
        files: {
          [`${PROJ}/${path}`]: 'irrelevant content',
          [`${PROJ}/pipeline_status.md`]: makeEntranceCard(),
        },
      };
      const { result, writeFileSpy } = await runMain(req);
      assert.equal(result.exitCode, 0);
      assert.equal(writeFileSpy.calls.length, 0);
      assert.equal(result.stderr, '');
    });
  }
});

// --- Describe: main() — path normalization + defensive guard -----------------

describe('main: path normalization + defensive guard', () => {
  test('Windows backslash path normalizes correctly', async () => {
    const req = makeRequest({ target: '.plans/active_plan.md', status: 'complete' });
    req.stdin.tool_input.file_path = `${PROJ}\\.plans\\active_plan.md`;
    // The hook's readFileText is called with the raw path; our test readFileText
    // normalizes its lookup key so the backslash form resolves to the same fixture.
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(writeFileSpy.calls.length, 1);
    assert.match(writeFileSpy.calls[0].content, /plan ✅/);
  });

  test('non-.plans/ target → silent no-op (defensive prefix guard)', async () => {
    const req = {
      stdin: {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: `${PROJ}/src/foo.js` },
        cwd: PROJ,
      },
      files: {
        [`${PROJ}/src/foo.js`]: 'console.log("hi");',
        [`${PROJ}/pipeline_status.md`]: makeEntranceCard(),
      },
    };
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(writeFileSpy.calls.length, 0);
    assert.equal(result.stderr, '');
  });
});

// --- Describe: main() — infrastructure failures (silent-ALLOW + stderr) ------

describe('main: infrastructure failures all exit 0', () => {
  test('written file unreadable → exit 0 + stderr "could not read"', async () => {
    const req = makeRequest({ target: '.plans/active_plan.md', status: 'complete' });
    delete req.files[`${PROJ}/.plans/active_plan.md`];
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(writeFileSpy.calls.length, 0);
    assert.match(result.stderr, /could not read/);
  });

  test('frontmatter parse error → exit 0 + stderr "parse failed"', async () => {
    const req = makeRequest({ target: '.plans/active_plan.md', status: 'complete' });
    req.files[`${PROJ}/.plans/active_plan.md`] = '# no frontmatter at all\n';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(writeFileSpy.calls.length, 0);
    assert.match(result.stderr, /parse failed/);
  });

  test('pipeline_status.md missing → exit 0 + stderr "unreadable"', async () => {
    const req = makeRequest({ target: '.plans/active_plan.md', status: 'complete' });
    delete req.files[`${PROJ}/pipeline_status.md`];
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(writeFileSpy.calls.length, 0);
    assert.match(result.stderr, /pipeline_status\.md unreadable/);
  });

  test('Coordination Files row missing → exit 0 + stderr "not found"', async () => {
    const req = makeRequest({ target: '.plans/active_plan.md', status: 'complete' });
    req.files[`${PROJ}/pipeline_status.md`] = '# different shape\n\n| Other | Stuff |\n';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(writeFileSpy.calls.length, 0);
    assert.match(result.stderr, /Coordination Files row not found/);
  });

  test('label not present in row → exit 0 + stderr "not present"', async () => {
    const req = makeRequest({
      target: '.plans/active_plan.md',
      status: 'complete',
      coordinationFiles: '01 ⬜  02 ⬜  03 ⬜  plan_critique ⬜  build ⬜  tdd ⬜  critique ⬜  inspect ⬜',
    });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(writeFileSpy.calls.length, 0);
    assert.match(result.stderr, /label "plan" not present/);
  });

  test('pipeline_status.md write failure → exit 0 + stderr "write failed"', async () => {
    const req = makeRequest({ target: '.plans/active_plan.md', status: 'complete' });
    const throwingSpy = makeThrowingWriteFileSpy('disk full');
    const { result } = await runMain({ ...req, writeFileSpy: throwingSpy });
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /write failed.*manual flip required/);
  });
});

// --- Describe: main() — stdin / payload edge cases ---------------------------

describe('main: stdin and payload edge cases', () => {
  test('non-JSON stdin → silent ALLOW', async () => {
    const { result, writeFileSpy } = await runMain({ stdin: 'not json at all' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  test('missing tool_input → silent ALLOW', async () => {
    const { result } = await runMain({
      stdin: { tool_name: 'Write', hook_event_name: 'PostToolUse' },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
  });

  test('missing tool_input.file_path → silent ALLOW', async () => {
    const req = makeRequest({ target: '.plans/active_plan.md' });
    req.stdin.tool_input = {};
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
  });

  test('empty file_path → silent ALLOW', async () => {
    const req = makeRequest({ target: '.plans/active_plan.md' });
    req.stdin.tool_input.file_path = '';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
  });

  test('non-string file_path → silent ALLOW', async () => {
    const req = makeRequest({ target: '.plans/active_plan.md' });
    req.stdin.tool_input.file_path = 42;
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
  });
});
