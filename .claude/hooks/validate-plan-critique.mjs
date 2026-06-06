// Cat D specialist — typed-field validation for .plans/plan_critique.md.
// Dispatched by .claude/hooks/validate-frontmatter.mjs's dispatchSpecialist
// when the base validator sees a Write to a file named plan_critique.md.
//
// Per the specialist contract: receives `fields`
// already base-validated by the dispatcher (mandatory base fields present,
// status enum valid, slice present on execution-tier). This specialist
// adds typed-field checks ONLY — verdict, revision, brain_confirmation —
// per COORDINATION_FILES.md:29-31.
//
// Posture: signal-strict per ADR 82. Result-style return; no throws.
// Caller (dispatchSpecialist) formats the message into the educational
// stderr template defined in validate-frontmatter.mjs's formatError().
//
// Runtime: zero-dep per ADR 83. No imports beyond what the contract
// requires (none — pure function over pre-parsed fields).
//
// Cat D validator — the plan_critique specialist.

const VERDICT_ALLOWED = ['PASS', 'WARN', 'BLOCK'];
const REVISION_ALLOWED = [1, 2];
// ISO-8601 UTC timestamp: YYYY-MM-DDTHH:MM:SSZ (no fractional seconds; matches
// the project convention used by all coordination-file writers).
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function validate(fields) {
  // verdict ∈ {PASS, WARN, BLOCK}
  if (!VERDICT_ALLOWED.includes(fields.verdict)) {
    return {
      ok: false,
      message: `Invalid value for verdict: got "${fields.verdict}", expected one of ${VERDICT_ALLOWED.join(', ')}`,
    };
  }

  // revision ∈ {1, 2} (integer)
  if (!REVISION_ALLOWED.includes(fields.revision)) {
    return {
      ok: false,
      message: `Invalid value for revision: got ${JSON.stringify(fields.revision)}, expected 1 or 2 (integer)`,
    };
  }

  // brain_confirmation: null OR ISO-8601 string
  if (fields.brain_confirmation !== null) {
    if (typeof fields.brain_confirmation !== 'string' || !ISO_8601_REGEX.test(fields.brain_confirmation)) {
      return {
        ok: false,
        message: `Invalid value for brain_confirmation: got ${JSON.stringify(fields.brain_confirmation)}, expected null or ISO-8601 timestamp string (YYYY-MM-DDTHH:MM:SSZ)`,
      };
    }
  }

  return { ok: true };
}
