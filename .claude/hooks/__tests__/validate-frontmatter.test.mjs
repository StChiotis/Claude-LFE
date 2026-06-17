// Test suite for the Cat D base frontmatter validator
// (.claude/hooks/validate-frontmatter.mjs). The Cat D base validator tests.
// Falsifiable AC X/Y pair from the validator's acceptance criteria is
// pinned verbatim in this file — see the two tests tagged
// "[Falsifiable AC X]" and "[Falsifiable AC Y]".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  main,
  normalizePath,
  isExecutionTier,
  validateBase,
  dispatchSpecialist,
  formatSpecialistError,
} from '../validate-frontmatter.mjs';

// --- helpers ---------------------------------------------------------------

const VALID_PLANNING_FILE = `---
phase: architect
step: 1_grill
status: complete
timestamp: 2026-05-16T16:38:01Z
source: n/a
---

# Body
`;

const VALID_EXECUTION_TIER_FILE = `---
phase: builder
step: builder
status: complete
timestamp: 2026-05-16T17:00:00Z
source: .plans/active_plan.md
slice: 1
---

# Body
`;

function makeStdin(filePath) {
  return JSON.stringify({ tool_input: { file_path: filePath } });
}

function fakeReader(content) {
  return async () => content;
}

function neverDispatchSpecialist() {
  return async () => {
    throw new Error('resolveSpecialist should not be called in this test');
  };
}

function specialistNotInstalled() {
  return async () => {
    const err = new Error('Cannot find module');
    err.code = 'ERR_MODULE_NOT_FOUND';
    throw err;
  };
}

function specialistRejects(message) {
  return async () => ({
    validate: () => ({ ok: false, message }),
  });
}

function specialistAccepts() {
  return async () => ({
    validate: () => ({ ok: true }),
  });
}

// --- helper exports --------------------------------------------------------

test('helper: normalizePath converts backslashes to forward slashes', () => {
  assert.equal(normalizePath('.plans\\01_grill_summary.md'), '.plans/01_grill_summary.md');
  assert.equal(normalizePath('.plans/01_grill_summary.md'), '.plans/01_grill_summary.md');
});

test('helper: isExecutionTier returns true for execution-tier filenames', () => {
  assert.equal(isExecutionTier('.plans/active_plan.md'), true);
  assert.equal(isExecutionTier('.plans/builder_done.md'), true);
  assert.equal(isExecutionTier('.plans/tdd_report.md'), true);
  assert.equal(isExecutionTier('.plans/inspection_report.md'), true);
  assert.equal(isExecutionTier('.plans/diagnosis_report.md'), true);
  assert.equal(isExecutionTier('.plans/rework_directive.md'), true);
  assert.equal(isExecutionTier('.plans/checks/security_findings.md'), true);
});

test('helper: isExecutionTier returns false for planning-tier filenames', () => {
  assert.equal(isExecutionTier('.plans/01_grill_summary.md'), false);
  assert.equal(isExecutionTier('.plans/02_prd.md'), false);
  assert.equal(isExecutionTier('.plans/03_slices.md'), false);
  assert.equal(isExecutionTier('.plans/plan_critique.md'), false);
  assert.equal(isExecutionTier('.plans/critique.md'), false);
  assert.equal(isExecutionTier('.plans/hygiene_report.md'), false);
});

// --- extracted helpers: validateBase ----------------------------
// Direct unit tests of the validateBase helper, pinning its contract
// independently of main(). Extracted from main to keep it unit-testable.
// The 33 existing main()-targeted tests continue to assert against
// main's observable contract; these new tests target the helper directly,
// so future refactors of main don't have to drag along helper-internal
// assertions.

test('validateBase: all 5 mandatory fields present + valid status + planning-tier (no slice required) → returns null', () => {
  const fields = {
    phase: 'architect',
    step: '1_grill',
    status: 'complete',
    timestamp: '2026-05-16T16:38:01Z',
    source: 'n/a',
  };
  assert.equal(validateBase(fields, '.plans/01_grill_summary.md'), null);
});

test('validateBase: missing phase → returns { message: /Missing required field: phase/ }', () => {
  const fields = {
    step: '1_grill',
    status: 'complete',
    timestamp: '2026-05-16T16:38:01Z',
    source: 'n/a',
  };
  const result = validateBase(fields, '.plans/01_grill_summary.md');
  assert.ok(result);
  assert.match(result.message, /Missing required field: phase/);
});

test('validateBase: invalid status enum → returns { message: /Invalid value for status/ }', () => {
  const fields = {
    phase: 'architect',
    step: '1_grill',
    status: 'invalid_value',
    timestamp: '2026-05-16T16:38:01Z',
    source: 'n/a',
  };
  const result = validateBase(fields, '.plans/01_grill_summary.md');
  assert.ok(result);
  assert.match(result.message, /Invalid value for status: got "invalid_value"/);
  assert.match(result.message, /complete, failed, passed, escalated/);
});

test('validateBase: execution-tier file without slice → returns { message: /Missing required field: slice/ }', () => {
  const fields = {
    phase: 'architect',
    step: '4_active_plan',
    status: 'complete',
    timestamp: '2026-05-16T16:38:01Z',
    source: '.plans/03_slices.md',
  };
  const result = validateBase(fields, '.plans/active_plan.md');
  assert.ok(result);
  assert.match(result.message, /Missing required field: slice/);
});

test('validateBase: planning-tier file without slice → returns null (slice not required)', () => {
  const fields = {
    phase: 'architect',
    step: '1_grill',
    status: 'complete',
    timestamp: '2026-05-16T16:38:01Z',
    source: 'n/a',
  };
  // 01_grill_summary.md is planning-tier; no slice required
  assert.equal(validateBase(fields, '.plans/01_grill_summary.md'), null);
});

// --- extracted helpers: dispatchSpecialist ----------------------
// Direct unit tests of dispatchSpecialist pinning the dispatcher's contract
// independently of main(). The dispatcher mediates between main (caller) and
// specialists (callee); these tests verify each branch of the resolve →
// contract-check → invoke flow without going through main's stdin/file-read
// layers.

test('dispatchSpecialist: filename not in SPECIALIST_MAP → returns { exitCode: 0, stderr: "" }', async () => {
  let resolveCalled = false;
  const result = await dispatchSpecialist(
    '01_grill_summary.md',
    {},
    async () => {
      resolveCalled = true;
      return {};
    },
    '.plans/01_grill_summary.md',
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  assert.equal(resolveCalled, false, 'unmapped filenames must not invoke resolveSpecialist');
});

test('dispatchSpecialist: specialist throws ERR_MODULE_NOT_FOUND → returns { exitCode: 0, stderr: /not yet installed/ }', async () => {
  const result = await dispatchSpecialist(
    'plan_critique.md',
    {},
    async () => {
      const err = new Error('Cannot find module');
      err.code = 'ERR_MODULE_NOT_FOUND';
      throw err;
    },
    '.plans/plan_critique.md',
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /specialist validate-plan-critique not yet installed — skipping/);
});

test('dispatchSpecialist: specialist throws other error → returns { exitCode: 2, stderr cites failed to load }', async () => {
  const result = await dispatchSpecialist(
    'plan_critique.md',
    {},
    async () => {
      throw new Error('Syntax error in specialist module');
    },
    '.plans/plan_critique.md',
  );
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Specialist validate-plan-critique failed to load: Syntax error in specialist module/);
});

test('dispatchSpecialist: specialist loaded but missing validate() → returns { exitCode: 2, stderr: /does not export validate/ }', async () => {
  const result = await dispatchSpecialist(
    'plan_critique.md',
    {},
    async () => ({ notValidate: () => {} }),
    '.plans/plan_critique.md',
  );
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /does not export validate\(fields\)/);
});

test('dispatchSpecialist: specialist accepts ({ ok: true }) → returns { exitCode: 0, stderr: "" }', async () => {
  const result = await dispatchSpecialist(
    'plan_critique.md',
    { verdict: 'PASS', revision: 1, brain_confirmation: null },
    async () => ({ validate: (fields) => ({ ok: true }) }),
    '.plans/plan_critique.md',
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

test('dispatchSpecialist: specialist rejects ({ ok: false, message }) → returns { exitCode: 2, stderr contains message }', async () => {
  const result = await dispatchSpecialist(
    'plan_critique.md',
    { verdict: 'MAYBE' },
    async () => ({
      validate: () => ({ ok: false, message: 'Invalid value for verdict: got "MAYBE"' }),
    }),
    '.plans/plan_critique.md',
  );
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Invalid value for verdict: got "MAYBE"/);
});

test('dispatchSpecialist: specialist rejects with no message → returns { exitCode: 2, stderr cites fallback }', async () => {
  const result = await dispatchSpecialist(
    'plan_critique.md',
    {},
    async () => ({ validate: () => ({ ok: false }) }),
    '.plans/plan_critique.md',
  );
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Specialist validation failed \(no message provided\)/);
});

// --- falsifiable AC pair (pinned verbatim from the validator's AC) -------

test('[Falsifiable AC X] missing timestamp → exit 2 + stderr matches /Missing required field: timestamp/ + file persists', async () => {
  const malformed = `---
phase: architect
step: 1_grill
status: complete
source: n/a
---
`;
  let fileDeleted = false;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: async (p) => {
      // Assert the hook reads the file but does not touch it
      return malformed;
    },
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Missing required field: timestamp/);
  // ADR 82 signal-strict pinning: hook performs no file-modifying action.
  // The "file persists" property is asserted by virtue of the hook never
  // calling fs.unlink, fs.writeFile, or any other write operation. The
  // readFileText injection is the ONLY filesystem touch.
  assert.equal(fileDeleted, false);
});

test('[Falsifiable AC Y] all 5 mandatory fields valid → exit 0 + zero stderr + file unchanged', async () => {
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(VALID_PLANNING_FILE),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

// --- mandatory base fields ------------------------------------------------

test('base: missing phase → exit 2 + stderr cites missing phase', async () => {
  const text = `---
step: 1_grill
status: complete
timestamp: 2026-05-16T16:38:01Z
source: n/a
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Missing required field: phase/);
});

test('base: missing step → exit 2', async () => {
  const text = `---
phase: architect
status: complete
timestamp: 2026-05-16T16:38:01Z
source: n/a
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Missing required field: step/);
});

test('base: missing status → exit 2', async () => {
  const text = `---
phase: architect
step: 1_grill
timestamp: 2026-05-16T16:38:01Z
source: n/a
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Missing required field: status/);
});

test('base: missing source → exit 2', async () => {
  const text = `---
phase: architect
step: 1_grill
status: complete
timestamp: 2026-05-16T16:38:01Z
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Missing required field: source/);
});

// --- status enum ----------------------------------------------------------

test('base: status="invalid_value" → exit 2 + stderr cites enum violation with allowed values', async () => {
  const text = `---
phase: architect
step: 1_grill
status: invalid_value
timestamp: 2026-05-16T16:38:01Z
source: n/a
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Invalid value for status: got "invalid_value"/);
  assert.match(result.stderr, /complete, failed, passed, escalated/);
});

test('base: status=passed (valid enum) → exit 0', async () => {
  const text = `---
phase: inspector
step: inspector
status: passed
timestamp: 2026-05-16T16:38:01Z
source: .plans/tdd_report.md
slice: 1
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/inspection_report.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
});

// --- execution-tier `slice` rule ------------------------------------------

test('base: execution-tier (active_plan.md) without slice → exit 2 + stderr cites missing slice', async () => {
  const text = `---
phase: architect
step: 4_active_plan
status: complete
timestamp: 2026-05-16T16:38:01Z
source: .plans/03_slices.md
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/active_plan.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Missing required field: slice/);
});

test('base: planning-tier (01_grill_summary.md) without slice → exit 0 (slice not required)', async () => {
  // VALID_PLANNING_FILE has no `slice:` field — verifies the slice rule
  // does NOT fire on planning-tier files.
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(VALID_PLANNING_FILE),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
});

test('base: .plans/checks/security_findings.md without slice → exit 2 (checks/*_findings is execution-tier)', async () => {
  const text = `---
phase: inspector
step: security_check
status: complete
timestamp: 2026-05-16T16:38:01Z
source: .plans/builder_done.md
kind: sub-skill
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/checks/security_findings.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Missing required field: slice/);
});

// --- rework_directive.md execution-tier (ADR 101) -------------------------
// The finalization-rework sentinel is execution-tier: `slice` is mandatory
// (Builder matches it against active_plan's slice), while the rework typed
// fields (rework_round, directive_hash) ride below `source:` and are tolerated
// by the base validator with no status-enum change.

test('base: rework_directive.md with slice + rework typed fields → exit 0 (execution-tier, typed fields tolerated)', async () => {
  const text = `---
phase: inspector
step: rework
status: complete
timestamp: 2026-06-16T22:00:00Z
source: .plans/inspection_report.md
slice: 1
rework_round: 2
directive_hash: a1b2c3d4
---

## Rework Directive
Observed vs expected mismatch on the changed surface.
`;
  const result = await main({
    stdinText: makeStdin('.plans/rework_directive.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

test('base: rework_directive.md WITHOUT slice → exit 2 (execution-tier slice rule fires)', async () => {
  const text = `---
phase: inspector
step: rework
status: complete
timestamp: 2026-06-16T22:00:00Z
source: .plans/inspection_report.md
rework_round: 1
directive_hash: a1b2c3d4
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/rework_directive.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Missing required field: slice/);
});

// --- inspection_report.md visual typed fields (ADR 102) -------------------
// The visual-confirmation typed fields (visual_confirmed, visual_signoff) ride
// below source: on inspection_report.md and are tolerated by the base validator
// exactly like ADR 101's rework_round/directive_hash — no status-enum change, no
// specialist. inspection_report.md is execution-tier, so `slice` stays mandatory.

test('base: inspection_report.md with visual_confirmed + visual_signoff + slice → exit 0 (typed fields tolerated)', async () => {
  const text = `---
phase: inspector
step: inspection
status: passed
timestamp: 2026-06-17T12:00:00Z
source: .plans/tdd_report.md
slice: 2
visual_confirmed: 2026-06-17T12:00:00Z
visual_signoff: LGTM-2026-06-17
---

## Verification Results
- Logic match: PASS
`;
  const result = await main({
    stdinText: makeStdin('.plans/inspection_report.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

test('base: inspection_report.md with visual typed fields but WITHOUT slice → exit 2 (execution-tier slice rule fires)', async () => {
  const text = `---
phase: inspector
step: inspection
status: passed
timestamp: 2026-06-17T12:00:00Z
source: .plans/tdd_report.md
visual_confirmed: 2026-06-17T12:00:00Z
visual_signoff: LGTM-2026-06-17
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/inspection_report.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Missing required field: slice/);
});

// --- path filter (defensive fail-safe) ------------------------------------

test('path filter: non-.plans/ path → exit 0 silent (defensive guard fires)', async () => {
  // In production the harness `if: "Write(.plans/*)"` filter prevents this
  // code path from being reached. This test exercises the script's
  // defensive fail-safe guard directly by injecting a non-.plans/ file_path.
  const result = await main({
    stdinText: makeStdin('src/foo.js'),
    readFileText: async () => {
      throw new Error('readFileText must not be called when path filter rejects');
    },
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

test('path filter: backslash-separated Windows path normalized then filtered', async () => {
  const result = await main({
    stdinText: makeStdin('src\\foo.js'),
    readFileText: async () => {
      throw new Error('readFileText must not be called');
    },
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
});

// --- parser error pass-through --------------------------------------------

test('parser pass-through: no_frontmatter → exit 2 + stderr matches /No frontmatter block found/', async () => {
  const text = '# Just a markdown file with no frontmatter\n';
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /No frontmatter block found/);
});

test('parser pass-through: malformed_inside → exit 2 + stderr matches /malformed at line \\d+/', async () => {
  const text = `---
phase: architect
malformed-line
status: complete
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /malformed at line \d+/);
});

// --- specialist dispatch --------------------------------------------------

test('specialist dispatch: plan_critique.md without specialist installed → exit 0 + informational breadcrumb', async () => {
  const text = `---
phase: architect
step: plan_critique
status: complete
timestamp: 2026-05-16T16:57:10Z
source: .plans/active_plan.md
slice: 1
verdict: PASS
revision: 1
brain_confirmation: null
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/plan_critique.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: specialistNotInstalled(),
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /specialist validate-plan-critique not yet installed — skipping/);
});

test('specialist dispatch: plan_critique.md with specialist rejecting → exit 2 + stderr cites specialist message', async () => {
  const text = `---
phase: architect
step: plan_critique
status: complete
timestamp: 2026-05-16T16:57:10Z
source: .plans/active_plan.md
slice: 1
verdict: MAYBE
revision: 1
brain_confirmation: null
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/plan_critique.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: specialistRejects('Invalid value for verdict: got MAYBE, expected one of PASS, WARN, BLOCK'),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Invalid value for verdict: got MAYBE/);
});

test('specialist dispatch: plan_critique.md with specialist accepting → exit 0 silent', async () => {
  const text = `---
phase: architect
step: plan_critique
status: complete
timestamp: 2026-05-16T16:57:10Z
source: .plans/active_plan.md
slice: 1
verdict: PASS
revision: 1
brain_confirmation: null
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/plan_critique.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: specialistAccepts(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

test('specialist dispatch: specialist loaded but does not export validate() → exit 2', async () => {
  const text = `---
phase: architect
step: plan_critique
status: complete
timestamp: 2026-05-16T16:57:10Z
source: .plans/active_plan.md
slice: 1
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/plan_critique.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: async () => ({}),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /does not export validate\(fields\)/);
});

test('specialist dispatch: non-mapped filename (01_grill_summary.md) → no specialist dispatched, exit 0', async () => {
  let specialistCalled = false;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(VALID_PLANNING_FILE),
    resolveSpecialist: async () => {
      specialistCalled = true;
      return {};
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(specialistCalled, false);
});

test('specialist dispatch: tdd_report.md routes to validate-tdd-report specialist', async () => {
  const text = `---
phase: builder
step: tdd
status: complete
timestamp: 2026-05-16T16:38:01Z
source: .plans/active_plan.md
slice: 1
tests_passed: 12
tests_failed: 0
---
`;
  let dispatchedPath = null;
  const result = await main({
    stdinText: makeStdin('.plans/tdd_report.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: async (p) => {
      dispatchedPath = p;
      return { validate: () => ({ ok: true }) };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(dispatchedPath, './validate-tdd-report.mjs');
});

test('specialist dispatch: 03_slices.md routes to validate-slices specialist', async () => {
  const text = `---
phase: architect
step: 3_slices
status: complete
timestamp: 2026-05-16T16:38:01Z
source: .plans/02_prd.md
total_slices: 4
approved_by_human: true
---
`;
  let dispatchedPath = null;
  const result = await main({
    stdinText: makeStdin('.plans/03_slices.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: async (p) => {
      dispatchedPath = p;
      return { validate: () => ({ ok: true }) };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(dispatchedPath, './validate-slices.mjs');
});

// --- infrastructure-level silent paths ------------------------------------

test('infrastructure: malformed stdin JSON → exit 0 silent (not a validation failure)', async () => {
  const result = await main({
    stdinText: 'not valid JSON',
    readFileText: async () => {
      throw new Error('should not be called');
    },
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

test('infrastructure: missing tool_input.file_path → exit 0 silent', async () => {
  const result = await main({
    stdinText: JSON.stringify({ tool_input: {} }),
    readFileText: async () => {
      throw new Error('should not be called');
    },
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
});

test('infrastructure: file-read I/O error → exit 0 silent (not a validation failure)', async () => {
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: async () => {
      throw new Error('ENOENT: no such file or directory');
    },
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

// --- TDD pass: regression pins (no impl changes) --------------------------
// Added during the TDD red-green-refactor pass. Each test below
// targets an observable contract from active_plan / builder_done Notes for
// TDD. All pass on current code; they exist to catch hypothetical future
// regressions that the original 28-case matrix would miss.

test('TDD pin: no_frontmatter stderr does NOT contain the malformed_inside fragment (two-class disjoint)', async () => {
  // Builder note 2: pin that the two parser error classes produce disjoint
  // messages. If a future bug swapped or merged them, the agent's self-
  // correction would target the wrong fix path.
  const text = '# Just a markdown file with no frontmatter\n';
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /No frontmatter block found/);
  assert.doesNotMatch(result.stderr, /malformed at line/);
});

test('TDD pin: malformed_inside stderr does NOT contain the no_frontmatter fragment (two-class disjoint)', async () => {
  // Builder note 2 — opposite direction.
  const text = `---
phase: architect
not-a-key-value
status: complete
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /malformed at line 3/);
  assert.doesNotMatch(result.stderr, /No frontmatter block found/);
});

test('TDD pin: path filter is lexical-only — `.plans/../src/foo.js` passes the guard (harness `if` is authoritative)', async () => {
  // Builder note 3: documents the limit of the defensive script guard.
  // The script does string-prefix matching, not path canonicalization;
  // `.plans/../src/foo.js` starts with `.plans/` lexically and the read
  // proceeds. In production the harness `if: "Write(.plans/*)"` filter
  // pre-screens at permission-rule level and never invokes the script
  // with such a path. This test pins the script's lexical-only behavior
  // so future contributors don't mistake the guard for a canonicalization
  // fence — adding canonicalization would be redundant with the harness
  // and would break this test.
  let readCalled = false;
  const result = await main({
    stdinText: makeStdin('.plans/../src/foo.js'),
    readFileText: async () => {
      readCalled = true;
      return VALID_PLANNING_FILE;
    },
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(readCalled, true, 'lexical guard passes; read proceeds');
});

test('TDD pin: educational stderr has header + detail + footer-with-correction-options structure', async () => {
  // Builder note 6: pin the educational stderr template structure
  // (header / detail / footer) without locking the exact wording. A
  // future refactor that changes phrasing is fine; a refactor that
  // breaks the structure breaks this test.
  const text = `---
phase: architect
status: complete
timestamp: 2026-05-16T16:38:01Z
source: n/a
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  // Header line (begins with [LFE Cat D] and names the file)
  assert.match(
    result.stderr,
    /^\[LFE Cat D\] Frontmatter validation failed on \.plans\/01_grill_summary\.md:/m,
  );
  // Detail line — 2-space indent, names the specific violation
  assert.match(result.stderr, /^ {2}Missing required field: step/m);
  // Footer cites schema reference
  assert.match(result.stderr, /Expected schema per COORDINATION_FILES\.md:5-23/);
  // Footer offers correction options
  assert.match(result.stderr, /Rewrite with valid frontmatter, OR/);
  assert.match(result.stderr, /Delete the file if the write was a mistake/);
});

test('TDD pin: canonical dogfood — valid builder_done.md frontmatter (lfe-builder/SKILL.md template) passes the validator', async () => {
  // Pins the property that the lfe-builder skill's frontmatter shape (per
  // .agents/skills/lfe-builder/SKILL.md template) aligns with this
  // validator's schema interpretation. The canonical dogfood
  // moment was empirically verified (the Write of builder_done.md
  // succeeded silently in-session); this test makes the alignment a
  // regression guard for all future Builds. If either side drifts —
  // SKILL.md template changes OR validator schema changes — the test
  // fails until they're reconciled.
  const text = `---
phase: builder
step: builder
status: complete
timestamp: 2026-05-16T17:16:40Z
source: .plans/active_plan.md
slice: 1
---

# Body content
`;
  const result = await main({
    stdinText: makeStdin('.plans/builder_done.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

// ==========================================================================
// Cat-D validator hardening
// ==========================================================================

// --- formatSpecialistError extraction (AC1) -------------------------------
// Direct unit test of the extracted envelope helper. The three pre-existing
// dispatchSpecialist error-branch tests above (load-error / missing-validate /
// rejects-with-message) remain UNCHANGED as regression pins proving the
// extraction is behavior-identical.

test('formatSpecialistError: returns the exit-2 envelope with educational stderr structure', () => {
  const { exitCode, stderr } = formatSpecialistError('.plans/plan_critique.md', 'Some detail message');
  assert.equal(exitCode, 2);
  // Reuses the formatError template: header names the file, indented detail,
  // footer cites schema + correction options.
  assert.match(stderr, /^\[LFE Cat D\] Frontmatter validation failed on \.plans\/plan_critique\.md:/m);
  assert.match(stderr, /^ {2}Some detail message/m);
  assert.match(stderr, /Expected schema per COORDINATION_FILES\.md:5-23/);
  assert.match(stderr, /Delete the file if the write was a mistake/);
});

// --- ANSI defang at the formatError funnel (AC2 / AC3) --------------------
// Every error message in all four Cat-D validators is emitted through
// formatError (base-validation messages, parser pass-through, and the three
// specialists' messages wrapped by dispatchSpecialist). Defanging that single
// funnel strips the ESC introducer byte (0x1b) from attacker-influenceable
// interpolated values, neutralizing any ANSI/CSI/OSC/SGR terminal escape
// sequence in emitted stderr — without changing any accept/reject decision.

const ESC = '\x1b';

test('[Falsifiable AC X] crafted status value carrying an ESC sequence → exit 2 + stderr inert (no ESC byte) + enum violation still cited', async () => {
  const text = `---
phase: architect
step: 1_grill
status: ${ESC}[31mFAKE${ESC}[0m
timestamp: 2026-05-16T16:38:01Z
source: n/a
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  // The ESC introducer byte is stripped — the crafted value is rendered inert.
  assert.ok(!result.stderr.includes(ESC), 'emitted stderr must contain no ESC (0x1b) byte');
  // The accept/reject decision is unchanged: still rejected as an enum violation.
  assert.match(result.stderr, /Invalid value for status/);
});

test('[Falsifiable AC Y] valid planning file is unaffected by the defang → exit 0 + zero stderr', async () => {
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(VALID_PLANNING_FILE),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

test('defang: ESC in the file_path (stderr header) is stripped', async () => {
  // A crafted file_path still under .plans/ but carrying an ESC sequence; the
  // missing `step` field forces a validation failure so the header is emitted.
  const craftedPath = `.plans/${ESC}[31m01_grill_summary.md`;
  const text = `---
phase: architect
status: complete
timestamp: 2026-05-16T16:38:01Z
source: n/a
---
`;
  const result = await main({
    stdinText: makeStdin(craftedPath),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.ok(!result.stderr.includes(ESC), 'header filePath must be defanged');
  assert.match(result.stderr, /Missing required field: step/);
});

test('defang: ESC in a malformed parser rawLine is stripped, decision unchanged', async () => {
  const text = `---
phase: architect
not-a-key-value${ESC}[31m
status: complete
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.ok(!result.stderr.includes(ESC), 'parser rawLine must be defanged in stderr');
  assert.match(result.stderr, /malformed at line/);
});

test('defang: ESC in a specialist rejection message is stripped via the formatError funnel, decision unchanged', async () => {
  // Exercises the specialist path (covers the verdict message in
  // validate-plan-critique and, by the same funnel, the tdd/slices messages).
  const result = await dispatchSpecialist(
    'plan_critique.md',
    { verdict: 'MAYBE' },
    specialistRejects(`Invalid value for verdict: got "${ESC}[31mMAYBE${ESC}[0m"`),
    '.plans/plan_critique.md',
  );
  assert.equal(result.exitCode, 2);
  assert.ok(!result.stderr.includes(ESC), 'specialist message must be defanged');
  assert.match(result.stderr, /Invalid value for verdict/);
});

// --- mutation cell: status-enum case-sensitivity (AC4) --------------------
// Pins that STATUS_ALLOWED.includes is case-sensitive by construction. A
// mutant that lowercases the comparison would let COMPLETE / Passed through.

test('mutation cell: status="COMPLETE" (uppercase) → exit 2 (enum check is case-sensitive)', async () => {
  const text = `---
phase: architect
step: 1_grill
status: COMPLETE
timestamp: 2026-05-16T16:38:01Z
source: n/a
---
`;
  const result = await main({
    stdinText: makeStdin('.plans/01_grill_summary.md'),
    readFileText: fakeReader(text),
    resolveSpecialist: neverDispatchSpecialist(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Invalid value for status: got "COMPLETE"/);
  assert.match(result.stderr, /complete, failed, passed, escalated/);
});

test('mutation cell: validateBase status="Passed" (capitalized) → enum violation (case-sensitive includes)', () => {
  const fields = {
    phase: 'inspector',
    step: 'inspector',
    status: 'Passed',
    timestamp: '2026-05-16T16:38:01Z',
    source: '.plans/tdd_report.md',
  };
  const result = validateBase(fields, '.plans/01_grill_summary.md');
  assert.ok(result);
  assert.match(result.message, /Invalid value for status: got "Passed"/);
});
