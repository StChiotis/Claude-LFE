// skill-eval-report.mjs — deterministic aggregation + scorecard render for the
// LFE skill-accuracy eval harness.
//
// Why this exists: skill-eval.mjs grades ONE captured skill output. The LLM
// runner (/lfe-skill-eval) executes each reasoning skill against each corpus
// fixture in isolated subagents, k times, grading every run. This module is the
// deterministic FINISHER: it turns the collected per-run grader verdicts into
// per-fixture pass-rates and per-skill metrics (catch-rate, false-positive rate,
// saturation ceiling, pass/fail), renders the human-readable scorecard, hashes
// each evaluated prompt, and builds the machine results record the
// pre-commit gate reads. Like skill-eval.mjs / plan-linter.mjs it is PURE +
// FAIL-SOFT and joins `npm test`; the CLI is the seam the (LLM, can't-import)
// runner calls so the math stays tested rather than improvised in prose.
//
// Metric semantics (the subtle part — ADR 98):
//   A grader verdict (boolean) means "this run produced the RIGHT result":
//     - known-bad  fixture: true = the skill CAUGHT the planted defect.
//     - known-good fixture: true = the skill correctly reported CLEAN (no false alarm).
//   So per skill:
//     catchRate         = mean pass-rate over its known-BAD fixtures.
//     falsePositiveRate = fraction of known-GOOD runs that FLAGGED (grader != true).
//     saturated         = every fixture (bad AND good) at pass-rate 1.0 → the suite
//                         no longer discriminates (the anti-overfit ceiling flag).
//     passed            = catchRate >= PASS_THRESHOLD AND falsePositiveRate <= FP_THRESHOLD.
//   catchRate/falsePositiveRate are null when unmeasurable (a skill with no
//   known-bad / no known-good runs); a null on either side makes `passed` false
//   (a skill we could not fully measure is not certified).
//
// Contract: aggregate()/renderScorecard()/buildResultsRecord()/hashPrompt() never
// throw; malformed input degrades to a safe empty/zero result + parseError flag.
// The CLI always exits 0 (advisory), same posture as skill-eval.mjs / plan-linter.mjs.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

// --- Named thresholds (no magic numbers; opts/CLI-overridable) -----------------

export const DEFAULT_K = 5;            // runs per fixture (consistency sample size)
export const RELIABLE_THRESHOLD = 0.8; // a fixture is a "reliable-pass" at pass-rate >= this (4/5)
export const PASS_THRESHOLD = 0.8;     // a skill "passes" at catch-rate >= this
export const FP_THRESHOLD = 0.2;       // ... AND false-positive-rate <= this

export const KIND = { BAD: 'known-bad', GOOD: 'known-good' };

// --- Pure helpers (exported for direct unit coverage) -------------------------

function num(v, dflt) {
  return Number.isFinite(v) ? v : dflt;
}

function round(x, dp = 2) {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Fraction of a fixture's k runs the grader passed. Non-array / empty → 0. */
export function passRate(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return 0;
  const passes = runs.reduce((n, r) => n + (r === true ? 1 : 0), 0);
  return passes / runs.length;
}

/** Percentage string for display; non-finite → em-dash. */
export function pct(x) {
  return Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—';
}

function pctOrNa(x) {
  return x === null || x === undefined ? '—' : pct(x);
}

// --- Core: aggregate ----------------------------------------------------------

/**
 * Aggregate per-run grader verdicts into per-fixture + per-skill metrics.
 * @param {Array<{fixture:string,skill:string,kind:string,runs:boolean[]}>} runResults
 * @param {{reliableThreshold?:number,passThreshold?:number,fpThreshold?:number}} [opts]
 * @returns {{fixtures:object[],skills:object,thresholds:object,parseError:boolean}}
 * Never throws.
 */
export function aggregate(runResults, opts = {}) {
  const reliableThreshold = num(opts.reliableThreshold, RELIABLE_THRESHOLD);
  const passThreshold = num(opts.passThreshold, PASS_THRESHOLD);
  const fpThreshold = num(opts.fpThreshold, FP_THRESHOLD);
  const thresholds = { reliableThreshold, passThreshold, fpThreshold };
  try {
    const rows = Array.isArray(runResults) ? runResults : [];
    const normKind = (k) => (k === KIND.GOOD ? KIND.GOOD : k === KIND.BAD ? KIND.BAD : String(k ?? '(unknown)'));

    const fixtures = rows.map((r) => {
      const pr = round(passRate(r?.runs));
      return {
        fixture: String(r?.fixture ?? '(unnamed)'),
        skill: String(r?.skill ?? '(unknown)'),
        kind: normKind(r?.kind),
        runCount: Array.isArray(r?.runs) ? r.runs.length : 0,
        passRate: pr,
        reliablePass: pr >= reliableThreshold,
      };
    });

    const skills = {};
    for (const skill of [...new Set(fixtures.map((f) => f.skill))]) {
      const own = fixtures.filter((f) => f.skill === skill);
      const badFixtures = own.filter((f) => f.kind === KIND.BAD);
      // false-positive rate is a RUN-level fraction over the known-good fixtures.
      const goodRuns = rows
        .filter((r) => String(r?.skill ?? '(unknown)') === skill && normKind(r?.kind) === KIND.GOOD)
        .flatMap((r) => (Array.isArray(r.runs) ? r.runs : []));

      const catchRate = badFixtures.length ? round(mean(badFixtures.map((f) => f.passRate))) : null;
      const flagged = goodRuns.reduce((n, r) => n + (r === true ? 0 : 1), 0);
      const falsePositiveRate = goodRuns.length ? round(flagged / goodRuns.length) : null;
      const saturated = own.length > 0 && own.every((f) => f.passRate === 1);
      const passed =
        catchRate !== null && catchRate >= passThreshold &&
        falsePositiveRate !== null && falsePositiveRate <= fpThreshold;

      skills[skill] = {
        catchRate,
        falsePositiveRate,
        saturated,
        passed,
        knownBad: badFixtures.length,
        knownGoodRuns: goodRuns.length,
      };
    }
    return { fixtures, skills, thresholds, parseError: false };
  } catch (err) {
    return { fixtures: [], skills: {}, thresholds, parseError: true, error: String(err?.message ?? err) };
  }
}

// --- Core: renderScorecard ----------------------------------------------------

/** Render the human-readable scorecard markdown from an aggregate. Never throws. */
export function renderScorecard(agg, meta = {}) {
  try {
    const k = num(meta.k, DEFAULT_K);
    const session = num(meta.session, 0);
    const timestamp = meta.timestamp ?? '(unset)';
    const model = meta.model ?? '(unrecorded)';
    const th = agg?.thresholds ?? { reliableThreshold: RELIABLE_THRESHOLD, passThreshold: PASS_THRESHOLD, fpThreshold: FP_THRESHOLD };
    const skills = agg?.skills ?? {};
    const fixtures = agg?.fixtures ?? [];
    const L = [];
    L.push('# Skill-Accuracy Scorecard');
    L.push('');
    L.push(`> **Retention policy:** 15 most recent eval sessions in this hot file; older entries roll to [\`.docs/archive/skill-eval-scorecard-history.md\`](../archive/skill-eval-scorecard-history.md). Measures whether LFE's five prompt-based reasoning skills actually catch planted defects (catch-rate), how often they false-alarm on clean controls (false-positive rate), and whether the corpus has saturated.`);
    L.push('');
    L.push(`**Run parameters:** k = ${k} run(s)/fixture · session ${session} · generated ${timestamp} · model ${model} · thresholds: reliable-pass ≥ ${pct(th.reliableThreshold)}, skill-pass catch-rate ≥ ${pct(th.passThreshold)} and false-positive ≤ ${pct(th.fpThreshold)}.`);
    L.push('');
    L.push('## Per-Skill Results');
    L.push('');
    L.push('| Skill | Catch-rate | False-positive | Saturated | Passed |');
    L.push('|---|---|---|---|---|');
    const skillKeys = Object.keys(skills);
    if (skillKeys.length === 0) {
      L.push('| _(no eval run yet — run `/lfe-skill-eval` to populate)_ | — | — | — | — |');
    } else {
      for (const s of skillKeys) {
        const m = skills[s];
        L.push(`| \`${s}\` | ${pctOrNa(m.catchRate)} | ${pctOrNa(m.falsePositiveRate)} | ${m.saturated ? '⚠ yes' : 'no'} | ${m.passed ? '✅' : '❌'} |`);
      }
    }
    L.push('');
    L.push('## Raw Per-Fixture Pass-Rates');
    L.push('');
    L.push(`| Fixture | Skill | Kind | Pass-rate | Reliable-pass (≥ ${pct(th.reliableThreshold)}) |`);
    L.push('|---|---|---|---|---|');
    if (fixtures.length === 0) {
      L.push('| _(none yet)_ | — | — | — | — |');
    } else {
      for (const f of fixtures) {
        L.push(`| \`${f.fixture}\` | \`${f.skill}\` | ${f.kind} | ${pct(f.passRate)} | ${f.reliablePass ? '✅' : '—'} |`);
      }
    }
    L.push('');
    L.push('---');
    L.push('');
    L.push(`**Archive:** Older entries are in [archive/skill-eval-scorecard-history.md](../archive/skill-eval-scorecard-history.md). Last archive sweep: session ${session}.`);
    L.push('');
    return L.join('\n');
  } catch (err) {
    return `# Skill-Accuracy Scorecard\n\n_(render error — fail-soft: ${String(err?.message ?? err)})_\n`;
  }
}

// --- Core: hashPrompt + buildResultsRecord ------------------------------------

/** Stable sha256 hex of a skill's prompt text. Non-string tolerated; error → null. */
export function hashPrompt(text) {
  try {
    return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
  } catch {
    return null;
  }
}

/**
 * Build the machine-readable results record the pre-commit gate reads.
 * Keyed per skill: { promptHash, catchRate, falsePositiveRate, saturated, passed, k, session }.
 * Never throws.
 */
export function buildResultsRecord(agg, promptHashes = {}, meta = {}) {
  try {
    const k = num(meta.k, DEFAULT_K);
    const session = num(meta.session, 0);
    const skills = agg?.skills ?? {};
    const out = {
      generatedAt: meta.timestamp ?? null,
      k,
      session,
      model: meta.model ?? null,
      thresholds: agg?.thresholds ?? { reliableThreshold: RELIABLE_THRESHOLD, passThreshold: PASS_THRESHOLD, fpThreshold: FP_THRESHOLD },
      skills: {},
    };
    for (const s of Object.keys(skills)) {
      const m = skills[s];
      out.skills[s] = {
        promptHash: promptHashes && Object.hasOwn(promptHashes, s) ? promptHashes[s] : null,
        catchRate: m.catchRate,
        falsePositiveRate: m.falsePositiveRate,
        saturated: m.saturated,
        passed: m.passed,
        k,
        session,
      };
    }
    return out;
  } catch (err) {
    return { generatedAt: null, k: DEFAULT_K, session: 0, thresholds: {}, skills: {}, parseError: true, error: String(err?.message ?? err) };
  }
}

// --- CLI boundary (advisory; always exits 0) ----------------------------------
// The LLM runner cannot import JS, so it shells out to this CLI to turn the
// runResults it assembled (per-fixture grader booleans) into the scorecard + the
// machine record — keeping the aggregate math tested instead of improvised.

async function runCli(argv) {
  const args = argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const asJson = args.includes('--json');
  const runsPath = get('--runs');
  const scorecardOut = get('--scorecard');
  const resultsOut = get('--results');
  const k = get('--k') !== null ? Number.parseInt(get('--k'), 10) : DEFAULT_K;
  const session = get('--session') !== null ? Number.parseInt(get('--session'), 10) : 0;
  const timestamp = get('--timestamp');
  const model = get('--model');
  const root = process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const promptDir = get('--prompt-dir') || join(root, '.agents', 'skills');

  if (!runsPath) {
    process.stderr.write('[skill-eval-report] usage: node skill-eval-report.mjs --runs <runResults.json> [--scorecard out.md] [--results out.json] [--k N] [--session N] [--timestamp ISO] [--model id] [--prompt-dir dir] [--json]\n');
    process.exit(0);
    return;
  }

  let runResults = [];
  try {
    runResults = JSON.parse(await readFile(runsPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`[skill-eval-report] cannot read/parse ${runsPath} (${err?.message ?? err})\n`);
    process.exit(0);
    return;
  }

  const meta = { k, session, timestamp: timestamp ?? undefined, model: model ?? undefined };
  const agg = aggregate(runResults);

  const promptHashes = {};
  for (const skill of Object.keys(agg.skills)) {
    try {
      promptHashes[skill] = hashPrompt(await readFile(join(promptDir, skill, 'SKILL.md'), 'utf8'));
    } catch {
      promptHashes[skill] = null;
    }
  }

  const record = buildResultsRecord(agg, promptHashes, meta);
  const scorecard = renderScorecard(agg, meta);

  if (scorecardOut) {
    try {
      await writeFile(scorecardOut, scorecard, 'utf8');
      process.stderr.write(`[skill-eval-report] wrote scorecard → ${scorecardOut}\n`);
    } catch (err) {
      process.stderr.write(`[skill-eval-report] could not write scorecard (${err?.message ?? err})\n`);
    }
  }
  if (resultsOut) {
    try {
      await writeFile(resultsOut, JSON.stringify(record, null, 2) + '\n', 'utf8');
      process.stderr.write(`[skill-eval-report] wrote results → ${resultsOut}\n`);
    } catch (err) {
      process.stderr.write(`[skill-eval-report] could not write results (${err?.message ?? err})\n`);
    }
  }
  if (asJson) {
    process.stdout.write(JSON.stringify({ aggregate: agg, record }, null, 2) + '\n');
  } else if (!scorecardOut && !resultsOut) {
    process.stdout.write(scorecard + '\n');
  }
  process.exit(0);
}

const invokedAsCli =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /skill-eval-report\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli(process.argv).catch((err) => {
    process.stderr.write(`[skill-eval-report] infrastructure error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
