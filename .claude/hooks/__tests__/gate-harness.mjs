// Shared gate-test harness.
//
// The four live ADR-95 enforcement gates (bash-posture / boot-precondition /
// persona-transition / no-mission) sit on one substrate (enforcement-context +
// enforcement-telemetry + posture). Their suites therefore repeated the SAME five
// common-contract cells. This module expresses those five once, parameterized by a
// small per-gate descriptor, so each gate's `*.test.mjs` keeps only its distinctive
// rule cells. See ADR (shared gate-test-harness pattern) + `.plans/checks/
// gate-mutation-baseline.md` for the discrimination set this preserves.
//
// This file is NOT a `*.test.mjs` suite — the runner (`tests/run-tests.mjs`) only
// discovers `*.test.mjs`, so it is never executed standalone; it is imported by the
// four gate suites, which pass their own `node:test` `test` in (registering the cells
// in the importing file's context).
//
// Posture: zero-dep (ADR 83 — node:assert/strict only); ESM (ADR 81).

import assert from 'node:assert/strict';

// Telemetry-append spy shared across gate suites (was duplicated per file).
export function captureAppend() {
  const calls = [];
  return { calls, append: async (p, c) => { calls.push({ p, c }); } };
}

// Register the five common-contract cells for one gate.
//
// descriptor = {
//   main,             // the gate's main()
//   gateName,         // posture key + telemetry gate id, e.g. 'no-mission'
//   env,              // { CLAUDE_PROJECT_DIR: '/repo' }
//   listPlans,        // async () => string[]  (the no-trail factory)
//   makeRead,         // (opts) => readFileText mock; MUST accept { cardText, posture, ...extras }
//   wrongToolStdin,   // a stdin JSON string whose tool_name is NOT gated → skip
//   triggerStdin,     // a stdin JSON string that, with triggerReadOpts, fires the gate (warn)
//   triggerReadOpts,  // makeRead opts that make triggerStdin actually trigger
//   reasonOnTrigger,  // expected telemetry `reason` recorded on the trigger
// }
export function runCommonGateContract(test, d) {
  const base = () => ({ listPlans: d.listPlans, now: () => 'T', env: d.env });

  test(`[harness:${d.gateName}] wrong / non-gated tool => silent ALLOW, no telemetry`, async () => {
    const { calls, append } = captureAppend();
    const r = await d.main({
      ...base(), appendFileText: append,
      stdinText: d.wrongToolStdin, readFileText: d.makeRead(d.triggerReadOpts),
    });
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
    assert.equal(calls.length, 0);
  });

  test(`[harness:${d.gateName}] malformed stdin => silent ALLOW`, async () => {
    const r = await d.main({
      ...base(), appendFileText: async () => {},
      stdinText: 'not json at all', readFileText: d.makeRead(d.triggerReadOpts),
    });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, '');
  });

  test(`[harness:${d.gateName}] unreadable entrance card => fail-safe ALLOW + stderr`, async () => {
    const r = await d.main({
      ...base(), appendFileText: async () => {},
      stdinText: d.triggerStdin, readFileText: d.makeRead({ ...d.triggerReadOpts, cardText: null }),
    });
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /fail-safe ALLOW/);
  });

  test(`[harness:${d.gateName}] telemetry append failure => decision unchanged (warn still ALLOWs)`, async () => {
    const r = await d.main({
      ...base(), appendFileText: async () => { throw new Error('disk full'); },
      stdinText: d.triggerStdin, readFileText: d.makeRead(d.triggerReadOpts),
    });
    assert.equal(r.stdout, '');           // warn => allow (no deny envelope) even when logging fails
    assert.match(r.stderr, /warn-and-log/);
  });

  test(`[harness:${d.gateName}] block posture => DENY envelope + telemetry decision=deny`, async () => {
    const { calls, append } = captureAppend();
    const blockOpts = { ...d.triggerReadOpts, posture: JSON.stringify({ [d.gateName]: 'block' }) };
    const r = await d.main({
      ...base(), appendFileText: append,
      stdinText: d.triggerStdin, readFileText: d.makeRead(blockOpts),
    });
    const envelope = JSON.parse(r.stdout);
    assert.equal(envelope.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(calls.length >= 1, 'block decision must be recorded to telemetry');
    const rec = JSON.parse(calls[0].c.trim());
    assert.equal(rec.decision, 'deny');
    assert.equal(rec.reason, d.reasonOnTrigger);
  });
}
