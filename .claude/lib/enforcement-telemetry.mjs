// Enforcement-telemetry — private warn-event log for the enforcement gates.
//
// Per ADR 95. Every gate ships warn-and-log first; this is
// the durable evidence base the Brain reviews before promoting a rule from
// "warn" to "block". Records are appended as JSONL to a gitignored local file
// (.claude/enforcement-telemetry.jsonl) — local observation, never committed,
// no repo-history noise, no risk of leaking local paths upstream.
//
// Posture: zero-dep (ADR 83), ESM (ADR 81), pure helper + injected I/O.
//
// Load-bearing invariant: telemetry is OBSERVABILITY, never CONTROL. A logging
// failure must never change a gate's allow/deny decision — recordWarn swallows
// every error. A gate that can't write its log still makes the same call.

export const TELEMETRY_PATH = '.claude/enforcement-telemetry.jsonl';

// Pure record builder (exported for unit tests). `now` is an injected ISO-8601
// string so tests are deterministic.
export function buildRecord({ now, gate, decision, reason, target, sessionId, persona, missionState }) {
  return {
    ts: typeof now === 'function' ? now() : (now ?? null),
    gate: gate ?? null,
    decision: decision ?? null, // 'warn' | 'deny'
    reason: reason ?? null,
    target: target ?? null,
    sessionId: sessionId ?? null,
    persona: persona ?? null,
    missionState: missionState ?? null,
  };
}

// Appends one JSONL line. Swallows ALL errors by design — telemetry must never
// alter control flow. `appendFileText(path, text)` and `path` (already resolved
// to an absolute/repo-relative location) are injected by the caller.
export async function recordWarn({ appendFileText, path, record }) {
  try {
    await appendFileText(path, JSON.stringify(record) + '\n');
    return true;
  } catch {
    return false;
  }
}
