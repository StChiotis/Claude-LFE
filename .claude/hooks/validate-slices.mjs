// Cat D specialist — typed-field validation for .plans/03_slices.md.
// Dispatched by .claude/hooks/validate-frontmatter.mjs's dispatchSpecialist
// when the base validator sees a Write to a file named 03_slices.md.
//
// Per the specialist contract: receives `fields`
// already base-validated by the dispatcher. This specialist adds typed-field
// checks ONLY — `approved_by_human` (type-strict boolean) and `total_slices`
// (positive integer ≥ 1). Both fields are emitted by the canonical writer
// .agents/skills/lfe-to-issues/SKILL.md:53-63; the ≥1 boundary on
// total_slices was resolved by convention (the framework's slicing
// semantic always yields ≥1 cut for Major Changes; total_slices = 0 has no
// legitimate use case).
//
// Posture: signal-strict per ADR 82. Result-style return; no throws.
// Caller (dispatchSpecialist) formats the message into the educational
// stderr template defined in validate-frontmatter.mjs's formatError().
//
// Runtime: zero-dep per ADR 83. No imports beyond what the contract
// requires (none — pure function over pre-parsed fields).
//
// Deliberate decision: DUPLICATE the isNonNegativeInteger
// pattern from validate-tdd-report.mjs into a parallel
// isPositiveInteger helper here. Helpers differ by boundary value
// (≥0 vs ≥1); extraction would yield negligible LOC win at the cost of
// indirection. Named local helpers are more readable at the call site.
//
// Cat D validator — the 03_slices.md specialist.

function isPositiveInteger(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

export function validate(fields) {
  // approved_by_human: type-strict boolean (literal true|false, NOT string "true")
  if (typeof fields.approved_by_human !== 'boolean') {
    return {
      ok: false,
      message: `Invalid value for approved_by_human: got ${JSON.stringify(fields.approved_by_human)} (${typeof fields.approved_by_human}), expected boolean`,
    };
  }

  // total_slices: positive integer (≥ 1; framework slicing always produces ≥1 cut)
  if (!isPositiveInteger(fields.total_slices)) {
    return {
      ok: false,
      message: `Invalid value for total_slices: got ${JSON.stringify(fields.total_slices)}, expected integer ≥ 1`,
    };
  }

  return { ok: true };
}
