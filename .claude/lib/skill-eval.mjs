// skill-eval.mjs — deterministic grader for the LFE skill-accuracy eval harness.
//
// Why this exists: LFE's five prompt-based reasoning skills (lfe-security /
// perf / complexity / mutation-check + lfe-plan-critique) have never had their
// catch-rate measured. This module is the harness's deterministic CORE: given a
// skill's raw output text and an expected-outcome sidecar, it decides whether the
// skill produced the right result. The LLM-driven runner (/lfe-skill-eval, a later
// slice) executes the skills in isolated subagents and feeds their output here;
// this module performs no LLM work and runs nothing.
//
// Contract: PURE + FAIL-SOFT. gradeSkillOutput() never throws; on malformed input
// or an internal error it returns { pass:false, score:0, parseError:true, reasons }.
// The graded core takes an ALREADY-PARSED sidecar object — the on-disk
// serialization + loader are a later-slice concern, keeping this core FS-free and
// serialization-agnostic (the same dependency-injection discipline as
// plan-linter.mjs's injected globResolver).
//
// Three skill FAMILIES, matching the three confirmed output shapes:
//   - verdict  (lfe-plan-critique)         → a PASS|WARN|BLOCK verdict
//   - severity (security / perf / complexity) → findings bucketed by severity section
//   - outcome  (lfe-mutation-verify)       → escaped-mutation count
// Across all families: every mustMention substring must appear and every
// mustNotMention substring must be absent (the latter is the false-positive guard
// that makes known-good controls meaningful).
//
// ADR 98: the harness decision + the rationale for
// running evals in isolated Agent/Task-tool subagents (distinct from the
// .claude/agents/ persona registration ADR 93 found unreliable).

import { readFile } from 'node:fs/promises';
import process from 'node:process';

// --- Stable surfaces (tests + the runner key off these) -----------------------

export const FAMILY = {
  VERDICT: 'verdict',
  SEVERITY: 'severity',
  OUTCOME: 'outcome',
};

// Maps each measured skill to its output family.
export const FAMILIES = {
  'lfe-plan-critique': FAMILY.VERDICT,
  'lfe-security-check': FAMILY.SEVERITY,
  'lfe-perf-check': FAMILY.SEVERITY,
  'lfe-complexity-check': FAMILY.SEVERITY,
  'lfe-mutation-verify': FAMILY.OUTCOME,
};

export const VALID_VERDICTS = ['PASS', 'WARN', 'BLOCK'];

// Severity buckets the grader counts. The check skills emit a combined
// "Low / Informational" section, so low and informational are one bucket here.
export const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'lowInfo'];

// Heading-prefix matchers per severity bucket (case-insensitive, leading word).
const SEVERITY_HEADING = {
  critical: /^critical\b/i,
  high: /^high\b/i,
  medium: /^medium\b/i,
  lowInfo: /^low\b/i, // "Low / Informational"
};

// A list bullet whose payload is one of these is an explicit "nothing here"
// marker, not a finding — do not count it.
const NONE_SENTINEL_RE = /^(none|n\/?a|—|-)\.?$/i;

const HEADING_RE = /^#{2,6}\s+(.*\S)\s*$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const TABLE_ROW_RE = /^\s*\|/;
const TABLE_SEPARATOR_RE = /^[\s|:_-]+$/;
const VERDICT_RE = /verdict\s*:?\s*\**\s*(PASS|WARN|BLOCK)\b/i;

// --- Pure helpers (exported for direct unit coverage) -------------------------

/**
 * Return the body lines of the FIRST section whose heading text matches `matcher`.
 * A section runs from its heading to the next heading of any level.
 */
export function sectionLines(text, matcher) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  let inSection = false;
  for (const line of lines) {
    const h = line.match(HEADING_RE);
    if (h) {
      if (inSection) break; // next heading closes the section
      if (matcher(h[1].trim())) inSection = true;
      continue;
    }
    if (inSection) out.push(line);
  }
  return out;
}

/** Count real finding bullets in a set of section lines (skip "none"/"n/a"/empty). */
function countFindingBullets(lines) {
  let n = 0;
  for (const line of lines) {
    const b = line.match(BULLET_RE);
    if (!b) continue;
    const payload = b[1].trim().replace(/^<|>$/g, '').trim(); // tolerate <placeholder>
    if (payload === '' || NONE_SENTINEL_RE.test(payload)) continue;
    n += 1;
  }
  return n;
}

/** Parse the PASS|WARN|BLOCK verdict from output text (frontmatter or body). null if absent. */
export function parseVerdict(text) {
  const m = String(text ?? '').match(VERDICT_RE);
  return m ? m[1].toUpperCase() : null;
}

/** Count findings per severity bucket → { critical, high, medium, lowInfo }. */
export function countSeverityFindings(text) {
  const counts = {};
  for (const level of SEVERITY_LEVELS) {
    counts[level] = countFindingBullets(sectionLines(text, (h) => SEVERITY_HEADING[level].test(h)));
  }
  return counts;
}

/** Count escaped-mutation rows in the "Escaped Mutations" section (table rows or bullets). */
export function countEscapedMutations(text) {
  const lines = sectionLines(text, (h) => /^escaped\b/i.test(h));
  let n = 0;
  for (const line of lines) {
    if (TABLE_ROW_RE.test(line)) {
      const row = line.trim();
      if (TABLE_SEPARATOR_RE.test(row)) continue; // |---|---| separator
      if (/\bfunction\b/i.test(row) && /\bmutation\b/i.test(row)) continue; // header row
      n += 1;
      continue;
    }
    const b = line.match(BULLET_RE);
    if (b) {
      const payload = b[1].trim();
      if (payload !== '' && !NONE_SENTINEL_RE.test(payload)) n += 1;
    }
  }
  return n;
}

/**
 * The text of a report's FLAGGED findings — scopes the negative (mustNotMention)
 * check so a term named only in clean-category / summary prose does NOT count as
 * the skill having raised that finding (the false-positive artefact this fixes).
 *   - severity: bullet payloads under the severity sections.
 *   - outcome:  the escaped-mutations section's rows.
 *   - verdict:  no finding-bullet concept ⇒ whole text (no fixture scopes a
 *               negative mention here; preserves prior behaviour).
 */
export function findingsText(text, family) {
  if (family === FAMILY.SEVERITY) {
    const out = [];
    for (const level of SEVERITY_LEVELS) {
      for (const line of sectionLines(text, (h) => SEVERITY_HEADING[level].test(h))) {
        const b = line.match(BULLET_RE);
        if (!b) continue;
        const payload = b[1].trim().replace(/^<|>$/g, '').trim();
        if (payload === '' || NONE_SENTINEL_RE.test(payload)) continue;
        out.push(payload);
      }
    }
    return out.join('\n');
  }
  if (family === FAMILY.OUTCOME) {
    return sectionLines(text, (h) => /^escaped\b/i.test(h)).join('\n');
  }
  return String(text ?? '');
}

/** Check mustMention / mustNotMention substrings (case-insensitive). Returns check rows. */
export function checkMentions(text, mustMention = [], mustNotMention = []) {
  const hay = String(text ?? '').toLowerCase();
  const rows = [];
  for (const term of mustMention ?? []) {
    const present = hay.includes(String(term).toLowerCase());
    rows.push({
      name: `mustMention:${term}`,
      ok: present,
      detail: present ? 'present' : `required mention "${term}" absent`,
    });
  }
  for (const term of mustNotMention ?? []) {
    const absent = !hay.includes(String(term).toLowerCase());
    rows.push({
      name: `mustNotMention:${term}`,
      ok: absent,
      detail: absent ? 'absent' : `forbidden mention "${term}" present`,
    });
  }
  return rows;
}

// --- Family check builders ----------------------------------------------------

/** A count is in-band when min ≤ n ≤ max; missing bound ⇒ open on that side. */
function inBand(n, band) {
  const min = Number.isFinite(band?.min) ? band.min : 0;
  const max = Number.isFinite(band?.max) ? band.max : Number.POSITIVE_INFINITY;
  return n >= min && n <= max;
}

function familyChecks(text, sidecar, family) {
  const rows = [];
  if (family === FAMILY.VERDICT) {
    const got = parseVerdict(text);
    const want = sidecar.expectedVerdict;
    rows.push({ name: 'verdict', ok: got === want, detail: `expected ${want ?? '(unset)'}, got ${got ?? 'none'}` });
  } else if (family === FAMILY.SEVERITY) {
    const counts = countSeverityFindings(text);
    const bands = sidecar.severities ?? {};
    for (const level of Object.keys(bands)) {
      const n = counts[level] ?? 0;
      rows.push({ name: `severity:${level}`, ok: inBand(n, bands[level]), detail: `${n} finding(s) vs band ${JSON.stringify(bands[level])}` });
    }
  } else if (family === FAMILY.OUTCOME) {
    const n = countEscapedMutations(text);
    rows.push({ name: 'escaped', ok: inBand(n, sidecar.escaped), detail: `${n} escaped vs band ${JSON.stringify(sidecar.escaped)}` });
  }
  return rows;
}

// --- Core ---------------------------------------------------------------------

/**
 * Grade a skill's output text against an expected-outcome sidecar.
 * @param {string} outputText raw skill output (markdown).
 * @param {object} sidecar parsed expected-outcome object (see schema in the eval fixtures).
 * @returns {{pass:boolean, score:number, reasons:string[], parseError:boolean}}
 * Never throws. Unknown skill / malformed sidecar ⇒ parseError result.
 */
export function gradeSkillOutput(outputText, sidecar) {
  try {
    if (!sidecar || typeof sidecar !== 'object') {
      return { pass: false, score: 0, parseError: true, reasons: ['sidecar is not an object'] };
    }
    // Own-property check (not bare lookup): a prototype-chain key like
    // "__proto__" / "constructor" / "toString" would otherwise resolve to a
    // truthy inherited value and slip past the guard into a vacuous pass.
    if (!Object.hasOwn(FAMILIES, sidecar.skill)) {
      return { pass: false, score: 0, parseError: true, reasons: [`unknown or missing sidecar.skill "${sidecar.skill}" — no family`] };
    }
    const family = FAMILIES[sidecar.skill];
    // Positive mentions are checked against the whole report; negative mentions
    // (the false-positive guard) are scoped to the FLAGGED findings only, so a
    // cleared category named in prose ("no injection here") is not counted as
    // the skill having raised that finding.
    const checks = [
      ...familyChecks(outputText, sidecar, family),
      ...checkMentions(outputText, sidecar.mustMention, []),
      ...checkMentions(findingsText(outputText, family), [], sidecar.mustNotMention),
    ];
    const passed = checks.filter((c) => c.ok).length;
    const score = checks.length === 0 ? 1 : passed / checks.length;
    const pass = checks.every((c) => c.ok);
    const reasons = checks.length === 0
      ? ['sidecar declared no criteria — vacuous pass']
      : checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
    return { pass, score, reasons, parseError: false };
  } catch (err) {
    return { pass: false, score: 0, parseError: true, reasons: [`grader error (fail-soft): ${err?.message ?? err}`] };
  }
}

// --- CLI boundary (advisory; always exits 0) ----------------------------------

async function runCli(argv) {
  const args = argv.slice(2);
  const asJson = args.includes('--json');
  const files = args.filter((a) => !a.startsWith('--'));
  const [outputPath, sidecarPath] = files;
  if (!outputPath || !sidecarPath) {
    process.stderr.write('[skill-eval] usage: node skill-eval.mjs <output.md> <sidecar.json> [--json]\n');
    process.exit(0);
    return;
  }
  let outputText = '';
  try {
    outputText = await readFile(outputPath, 'utf8');
  } catch (err) {
    process.stderr.write(`[skill-eval] cannot read ${outputPath} (${err?.message ?? err})\n`);
    process.exit(0);
    return;
  }
  let sidecar = null;
  try {
    sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`[skill-eval] cannot read/parse ${sidecarPath} (${err?.message ?? err})\n`);
    process.exit(0);
    return;
  }
  const result = gradeSkillOutput(outputText, sidecar);
  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`[skill-eval] ${result.pass ? 'PASS' : 'FAIL'} (score ${result.score.toFixed(2)})${result.parseError ? ' [parseError]' : ''}\n`);
    for (const r of result.reasons) process.stdout.write(`  - ${r}\n`);
  }
  process.exit(0);
}

const invokedAsCli =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /skill-eval\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli(process.argv).catch((err) => {
    process.stderr.write(`[skill-eval] infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
