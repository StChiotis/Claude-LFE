// Cat D specialist — typed-field validation for .plans/tdd_report.md.
// Dispatched by .claude/hooks/validate-frontmatter.mjs's dispatchSpecialist
// when the base validator sees a Write to a file named tdd_report.md.
//
// Per the specialist contract: receives `fields`
// already base-validated by the dispatcher (mandatory base fields present,
// status enum valid, slice present on execution-tier). This specialist
// adds typed-field checks ONLY — tests_passed, tests_failed, and the
// sum > 0 structural constraint — per COORDINATION_FILES.md:28 and the
// plan brief §10.2 spec ("non-negative integers and the sum > 0").
//
// Posture: signal-strict per ADR 82. Result-style return; no throws.
// Caller (dispatchSpecialist) formats the message into the educational
// stderr template defined in validate-frontmatter.mjs's formatError().
//
// Runtime: zero-dep per ADR 83. No imports beyond what the contract
// requires (none — pure function over pre-parsed fields).
//
// Cat D validator — the tdd_report specialist.

function isNonNegativeInteger(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

export function validate(fields) {
  // tests_passed: non-negative integer
  if (!isNonNegativeInteger(fields.tests_passed)) {
    return {
      ok: false,
      message: `Invalid value for tests_passed: got ${JSON.stringify(fields.tests_passed)}, expected non-negative integer`,
    };
  }

  // tests_failed: non-negative integer
  if (!isNonNegativeInteger(fields.tests_failed)) {
    return {
      ok: false,
      message: `Invalid value for tests_failed: got ${JSON.stringify(fields.tests_failed)}, expected non-negative integer`,
    };
  }

  // Sum constraint: tests_passed + tests_failed > 0.
  // At this point both values are confirmed non-negative integers (checks
  // above passed), so the only way the sum is not strictly positive is
  // when both are exactly 0 — the canonical "no tests ran" structural
  // error a malformed TDD phase would produce.
  if (fields.tests_passed + fields.tests_failed <= 0) {
    return {
      ok: false,
      message: `tests_passed + tests_failed must be > 0 (got tests_passed: ${fields.tests_passed}, tests_failed: ${fields.tests_failed}); a tdd_report with zero total tests indicates a broken TDD phase`,
    };
  }

  return { ok: true };
}
