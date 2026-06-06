// Shared parser for the pipeline_status.md entrance-card markdown table.
//
// Consolidates the previously-duplicated entrance-card table parsers that
// lived in two consumers:
// in:
//   .claude/hooks/session-start-reminder.mjs
//   .claude/statusline.mjs
//
// Both files re-export `parseEntranceCard` from this module so their test
// interfaces remain unchanged.

export const ENTRANCE_CARD_FILENAME = 'pipeline_status.md';

export function parseEntranceCard(text) {
  const source = String(text ?? '');
  const row = (label) => {
    const re = new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*([^|]+?)\\s*\\|`, 'i');
    const m = source.match(re);
    if (!m) return 'unknown';
    // Strip ANSI escape bytes from parsed values — defangs any injection
    // from a malicious or corrupted entrance card — an ANSI passthrough
    // vulnerability at the parser boundary.
    return m[1].replace(/\x1b/g, '').trim();
  };
  return {
    missionState: row('Mission State'),
    activePersona: row('Active Persona'),
    pipelinePhase: row('Pipeline Phase'),
    sessionCount: row('Session Count'),
    lastArchSweep: row('Last Architecture Sweep'),
  };
}
