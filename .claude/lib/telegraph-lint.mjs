// telegraph-lint.mjs — anti-overfit guard for the skill-eval fixture corpus.
//
// A fair fixture carries its planted defect in CODE that the skill must REASON
// about. A "telegraphed" fixture instead announces the defect — a `// BUG`
// marker, or the expected defect-signature word sitting in a comment — letting a
// skill "pass" by reading the hint rather than detecting it. This lint flags such
// giveaways so saturation / overfit cannot creep into the corpus.
//
// Contract: PURE + FAIL-SOFT. scanTelegraph() never throws; on internal error it
// returns { telegraphed:false, hits:[], parseError:true }. The marker set is
// injected (DI seam) so tests stay deterministic — same discipline as the grader.
// Pure module (no CLI); consumed by the corpus test and the eval runner.

// Generic giveaway markers that should never appear in a fair fixture (anywhere).
export const DEFAULT_MARKERS = [
  'BUG', 'FIXME', 'VULNERABLE', 'INSECURE', 'EXPLOIT',
  'OFF-BY-ONE', 'PLANTED', 'INTENTIONAL', 'DEFECT', 'FLAW', 'TODO: FIX',
];

// A line that begins a comment in the fixture languages we author (JS //, /* *,
// markdown <!--, and # for completeness). Used to scope the mustMention check:
// a defect-signature word in a COMMENT announces the answer; the same word in
// CODE is the legitimate defect the skill must reason about.
const COMMENT_RE = /^\s*(\/\/|\/\*|\*|<!--|#)/;

/**
 * Scan a fixture's text for telegraphing.
 * @param {string} fixtureText
 * @param {{mustMention?: string[], markers?: string[]}} [opts]
 * @returns {{telegraphed:boolean, hits:Array<{line:number, kind:string, text:string}>, parseError:boolean}}
 * Never throws.
 */
export function scanTelegraph(fixtureText, { mustMention = [], markers = DEFAULT_MARKERS } = {}) {
  try {
    const lines = String(fixtureText ?? '').split(/\r?\n/);
    const markerSet = (markers ?? []).map((m) => String(m).toLowerCase()).filter(Boolean);
    const mentions = (mustMention ?? []).map((m) => String(m).toLowerCase()).filter(Boolean);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      // (a) generic giveaway markers — never legitimate in a fixture, anywhere.
      for (const m of markerSet) {
        if (lower.includes(m)) hits.push({ line: i + 1, kind: 'marker', text: m });
      }
      // (b) a defect-signature mustMention term sitting INSIDE a comment.
      if (COMMENT_RE.test(line)) {
        for (const term of mentions) {
          if (lower.includes(term)) hits.push({ line: i + 1, kind: 'mention-in-comment', text: term });
        }
      }
    }
    return { telegraphed: hits.length > 0, hits, parseError: false };
  } catch (err) {
    return { telegraphed: false, hits: [], parseError: true, error: String(err?.message ?? err) };
  }
}
