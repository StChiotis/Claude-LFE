// Test suite for the eval report core (.claude/lib/skill-eval-report.mjs).
// Behaviour-first: feed canned runResults (per-fixture grader booleans) through
// the pure aggregate / render / record core (FS-free), mirroring the DI /
// fail-soft style of skill-eval.test.mjs + plan-linter.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate,
  renderScorecard,
  hashPrompt,
  buildResultsRecord,
  passRate,
  pct,
  DEFAULT_K,
  RELIABLE_THRESHOLD,
  PASS_THRESHOLD,
  FP_THRESHOLD,
} from '../skill-eval-report.mjs';

// --- Canned run sets ----------------------------------------------------------

// Strong skill: high catch on its known-bad, clean on its known-good control → passes.
const STRONG = [
  { fixture: 'sec-bad-1', skill: 'lfe-security-check', kind: 'known-bad', runs: [true, true, true, true, true] },   // 1.0
  { fixture: 'sec-bad-2', skill: 'lfe-security-check', kind: 'known-bad', runs: [true, true, true, true, false] },  // 0.8
  { fixture: 'sec-good-1', skill: 'lfe-security-check', kind: 'known-good', runs: [true, true, true, true, true] }, // 0 flags
];
// catchRate = mean(1.0, 0.8) = 0.9 ; fp = 0/5 = 0 ; saturated = false (0.8 fixture) ; passed = true

// Weak skill: low catch + a false alarm at the FP ceiling → fails on catch-rate.
const WEAK = [
  { fixture: 'perf-bad-1', skill: 'lfe-perf-check', kind: 'known-bad', runs: [true, false, false, false, false] },  // 0.2
  { fixture: 'perf-bad-2', skill: 'lfe-perf-check', kind: 'known-bad', runs: [false, false, false, false, false] }, // 0.0
  { fixture: 'perf-good-1', skill: 'lfe-perf-check', kind: 'known-good', runs: [false, true, true, true, true] },   // 1 flag / 5 = 0.2
];
// catchRate = mean(0.2, 0.0) = 0.1 ; fp = 0.2 ; passed = false

// Saturated skill: every fixture (bad + good) at pass-rate 1.0.
const SATURATED = [
  { fixture: 'cx-bad-1', skill: 'lfe-complexity-check', kind: 'known-bad', runs: [true, true, true, true, true] },
  { fixture: 'cx-bad-2', skill: 'lfe-complexity-check', kind: 'known-bad', runs: [true, true, true, true, true] },
  { fixture: 'cx-good-1', skill: 'lfe-complexity-check', kind: 'known-good', runs: [true, true, true, true, true] },
];

const POINTER = '**Archive:** Older entries are in [archive/skill-eval-scorecard-history.md](../archive/skill-eval-scorecard-history.md). Last archive sweep: session 0.';

// --- passRate + reliable-pass -------------------------------------------------

test('passRate: fraction of true runs; non-array/empty → 0', () => {
  assert.equal(passRate([true, true, true, true, true]), 1);
  assert.equal(passRate([true, true, true, true, false]), 0.8);
  assert.equal(passRate([]), 0);
  assert.equal(passRate(null), 0);
  assert.equal(passRate('nope'), 0);
});

test('reliable-pass at >= 4/5; 3/5 is not reliable', () => {
  const agg = aggregate([
    { fixture: 'a', skill: 's', kind: 'known-bad', runs: [true, true, true, true, false] },  // 0.8
    { fixture: 'b', skill: 's', kind: 'known-bad', runs: [true, true, true, false, false] },  // 0.6
  ]);
  const a = agg.fixtures.find((f) => f.fixture === 'a');
  const b = agg.fixtures.find((f) => f.fixture === 'b');
  assert.equal(a.passRate, 0.8);
  assert.equal(a.reliablePass, true);
  assert.equal(b.passRate, 0.6);
  assert.equal(b.reliablePass, false);
});

// --- Per-skill metrics --------------------------------------------------------

test('catch-rate is the mean pass-rate over a skill\'s known-bad fixtures', () => {
  const agg = aggregate(STRONG);
  assert.equal(agg.skills['lfe-security-check'].catchRate, 0.9);
});

test('false-positive rate is the run-level fraction of known-good flags', () => {
  // 1 flagged run of 5 known-good runs → 0.2
  assert.equal(aggregate(WEAK).skills['lfe-perf-check'].falsePositiveRate, 0.2);
  // pooled across two good fixtures: 2 flags of 10 runs → 0.2
  const pooled = aggregate([
    { fixture: 'g1', skill: 'x', kind: 'known-good', runs: [false, true, true, true, true] },
    { fixture: 'g2', skill: 'x', kind: 'known-good', runs: [false, true, true, true, true] },
  ]);
  assert.equal(pooled.skills.x.falsePositiveRate, 0.2);
});

test('a clean known-good control yields a zero false-positive rate (not conflated with catch)', () => {
  assert.equal(aggregate(STRONG).skills['lfe-security-check'].falsePositiveRate, 0);
});

test('saturation flag: true only when EVERY fixture (bad + good) is at pass-rate 1.0', () => {
  assert.equal(aggregate(SATURATED).skills['lfe-complexity-check'].saturated, true);
  assert.equal(aggregate(STRONG).skills['lfe-security-check'].saturated, false); // a 0.8 fixture breaks the ceiling
});

test('passed: catch-rate >= 0.8 AND false-positive <= 0.2', () => {
  assert.equal(aggregate(STRONG).skills['lfe-security-check'].passed, true);   // 0.9 catch, 0 fp
  assert.equal(aggregate(WEAK).skills['lfe-perf-check'].passed, false);        // 0.1 catch
  assert.equal(aggregate(SATURATED).skills['lfe-complexity-check'].passed, true);
});

test('passed fails when the false-positive rate exceeds the ceiling even with perfect catch', () => {
  const agg = aggregate([
    { fixture: 'b1', skill: 's', kind: 'known-bad', runs: [true, true, true, true, true] },   // catch 1.0
    { fixture: 'g1', skill: 's', kind: 'known-good', runs: [false, false, true, true, true] }, // 2/5 = 0.4 fp
  ]);
  assert.equal(agg.skills.s.catchRate, 1);
  assert.equal(agg.skills.s.falsePositiveRate, 0.4);
  assert.equal(agg.skills.s.passed, false);
});

test('unmeasurable metric → null → not passed (a skill we could not fully measure is not certified)', () => {
  // No known-good runs → fp null.
  const noGood = aggregate([{ fixture: 'b', skill: 's', kind: 'known-bad', runs: [true, true, true, true, true] }]);
  assert.equal(noGood.skills.s.falsePositiveRate, null);
  assert.equal(noGood.skills.s.passed, false);
  // No known-bad fixtures → catchRate null.
  const noBad = aggregate([{ fixture: 'g', skill: 's', kind: 'known-good', runs: [true, true, true, true, true] }]);
  assert.equal(noBad.skills.s.catchRate, null);
  assert.equal(noBad.skills.s.passed, false);
});

test('thresholds are config-overridable via opts', () => {
  const runs = [{ fixture: 'b', skill: 's', kind: 'known-bad', runs: [true, true, true, false, false] }, // 0.6
    { fixture: 'g', skill: 's', kind: 'known-good', runs: [true, true, true, true, true] }];
  assert.equal(aggregate(runs).skills.s.passed, false);                          // default 0.8 → 0.6 fails
  assert.equal(aggregate(runs, { passThreshold: 0.5 }).skills.s.passed, true);   // lowered → passes
  assert.equal(aggregate(runs).thresholds.reliableThreshold, RELIABLE_THRESHOLD);
});

// --- renderScorecard ----------------------------------------------------------

test('renderScorecard: populated table from a canned aggregate (proves render population)', () => {
  const md = renderScorecard(aggregate(STRONG), { k: 5, session: 0, timestamp: '2026-06-03T18:40:00+02:00' });
  assert.match(md, /# Skill-Accuracy Scorecard/);
  assert.match(md, /`lfe-security-check`/);
  assert.match(md, /90%/);              // catch-rate
  assert.match(md, /k = 5 run\(s\)\/fixture/);
  assert.match(md, /sec-bad-1/);        // raw per-fixture row present
  assert.ok(md.includes(POINTER), 'must carry the exact mandated hot-tier archive pointer');
});

test('renderScorecard: empty aggregate → placeholder row, still carries the retention pointer', () => {
  const md = renderScorecard(aggregate([]), { k: 5, session: 0 });
  assert.match(md, /no eval run yet/);
  assert.ok(md.includes(POINTER), 'an unpopulated scorecard still ends with the canonical pointer');
});

test('renderScorecard: session count flows into the pointer line', () => {
  const md = renderScorecard(aggregate([]), { session: 7 });
  assert.match(md, /Last archive sweep: session 7\./);
});

// --- hashPrompt ---------------------------------------------------------------

test('hashPrompt: stable, deterministic, sha256-hex; distinct text → distinct hash', () => {
  const h1 = hashPrompt('the canonical prompt body');
  assert.equal(h1, hashPrompt('the canonical prompt body'));
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, hashPrompt('the canonical prompt body.')); // one extra char
});

test('hashPrompt: non-string tolerated (hashes the empty string), never throws', () => {
  assert.doesNotThrow(() => hashPrompt(null));
  assert.match(hashPrompt(null), /^[0-9a-f]{64}$/);
});

// --- buildResultsRecord -------------------------------------------------------

test('buildResultsRecord: keyed per skill with promptHash + metrics + k + session', () => {
  const agg = aggregate(STRONG);
  const rec = buildResultsRecord(agg, { 'lfe-security-check': 'deadbeef' }, { k: 5, session: 3, timestamp: 'TS' });
  assert.equal(rec.generatedAt, 'TS');
  assert.equal(rec.k, 5);
  assert.equal(rec.session, 3);
  const s = rec.skills['lfe-security-check'];
  assert.equal(s.promptHash, 'deadbeef');
  assert.equal(s.catchRate, 0.9);
  assert.equal(s.falsePositiveRate, 0);
  assert.equal(s.passed, true);
  assert.equal(s.k, 5);
  assert.equal(s.session, 3);
});

test('buildResultsRecord: a skill with no recorded prompt hash → null promptHash', () => {
  const rec = buildResultsRecord(aggregate(STRONG), {}, {});
  assert.equal(rec.skills['lfe-security-check'].promptHash, null);
  assert.equal(rec.k, DEFAULT_K);
});

// --- Model field (record which model produced the scores) --------

test('renderScorecard: meta.model is surfaced on the Run-parameters line', () => {
  const md = renderScorecard(aggregate(STRONG), { k: 5, session: 0, timestamp: '2026-06-04T21:00:00+02:00', model: 'test-model-x' });
  assert.match(md, /· model test-model-x ·/);
  assert.match(md, /k = 5 run\(s\)\/fixture/);                  // pre-existing token undisturbed
  assert.ok(md.includes(POINTER), 'archive pointer still present after adding the model token');
});

test('renderScorecard: absent model degrades to the (unrecorded) placeholder, no throw', () => {
  let md;
  assert.doesNotThrow(() => { md = renderScorecard(aggregate(STRONG), { k: 5, session: 0 }); });
  assert.match(md, /· model \(unrecorded\) ·/);
  assert.match(md, /k = 5 run\(s\)\/fixture/);                  // k-line intact on the placeholder path
  assert.ok(md.includes(POINTER), 'pointer intact on the placeholder path');
});

test('renderScorecard: the model token sits between the generated-timestamp and thresholds (render-format symmetry; kills a position mutation)', () => {
  const md = renderScorecard(aggregate(STRONG), { k: 5, session: 0, timestamp: '2026-06-04T21:00:00+02:00', model: 'test-model-x' });
  // order pins parity with the committed scorecard's documented Run-parameters layout (… run-status · model · thresholds …)
  assert.match(md, /· generated 2026-06-04T21:00:00\+02:00 · model test-model-x · thresholds:/);
});

test('buildResultsRecord: meta.model is recorded as a top-level field', () => {
  const rec = buildResultsRecord(aggregate(STRONG), { 'lfe-security-check': 'deadbeef' }, { k: 5, session: 3, timestamp: 'TS', model: 'test-model-x' });
  assert.equal(rec.model, 'test-model-x');
  // it is a run-level fact, not duplicated onto the per-skill objects
  assert.equal(Object.hasOwn(rec.skills['lfe-security-check'], 'model'), false);
});

test('buildResultsRecord: absent model → top-level model is null (safe placeholder)', () => {
  const rec = buildResultsRecord(aggregate(STRONG), {}, { k: 5, session: 0 });
  assert.equal(rec.model, null);
});

// --- Fail-soft contract -------------------------------------------------------

test('fail-soft: aggregate never throws on malformed input', () => {
  for (const bad of [null, undefined, 42, 'str', {}, [null], [{ runs: 'x' }], [{ skill: 1, kind: 2, runs: [1, 0] }]]) {
    assert.doesNotThrow(() => aggregate(bad));
    const agg = aggregate(bad);
    assert.equal(typeof agg.parseError, 'boolean');
    assert.ok(Array.isArray(agg.fixtures));
    assert.equal(typeof agg.skills, 'object');
  }
});

test('fail-soft: renderScorecard + buildResultsRecord never throw on junk', () => {
  for (const bad of [null, undefined, 42, {}, { skills: null }, { fixtures: 'x' }]) {
    assert.doesNotThrow(() => renderScorecard(bad, {}));
    assert.doesNotThrow(() => buildResultsRecord(bad, null, null));
    assert.match(renderScorecard(bad, {}), /# Skill-Accuracy Scorecard/);
  }
});

test('fail-soft: a runResults entry whose runs throw on access degrades safely', () => {
  const evil = [{ fixture: 'x', skill: 's', kind: 'known-bad', get runs() { throw new Error('boom'); } }];
  let agg;
  assert.doesNotThrow(() => { agg = aggregate(evil); });
  assert.equal(agg.parseError, true);
});

// --- Exported constants sanity ------------------------------------------------

test('exported thresholds are the documented defaults', () => {
  assert.equal(DEFAULT_K, 5);
  assert.equal(RELIABLE_THRESHOLD, 0.8);
  assert.equal(PASS_THRESHOLD, 0.8);
  assert.equal(FP_THRESHOLD, 0.2);
  assert.equal(pct(0.9), '90%');
  assert.equal(pct(null), '—');
});

// --- TDD pass: multi-skill characterization (the real full-run shape) ---------
// Every set above is single-skill; the live run aggregates all five skills at
// once. These pin per-skill PARTITIONING — the class of bug single-skill tests
// (and the single-skill smoke) cannot catch: one skill's fixtures bleeding into
// another's catch-rate / false-positive / passed.

test('TDD: aggregate partitions metrics per skill with no cross-skill leakage', () => {
  const agg = aggregate([...STRONG, ...WEAK]);
  assert.equal(Object.keys(agg.skills).length, 2);
  // security stays strong; perf stays weak — neither contaminates the other.
  assert.equal(agg.skills['lfe-security-check'].catchRate, 0.9);
  assert.equal(agg.skills['lfe-security-check'].passed, true);
  assert.equal(agg.skills['lfe-perf-check'].catchRate, 0.1);   // NOT pulled up by security's 0.9
  assert.equal(agg.skills['lfe-perf-check'].falsePositiveRate, 0.2);
  assert.equal(agg.skills['lfe-perf-check'].passed, false);
});

test('TDD: renderScorecard emits a per-skill row for every skill + every raw fixture row', () => {
  const md = renderScorecard(aggregate([...STRONG, ...WEAK]), { k: 5, session: 0 });
  assert.ok(md.includes('`lfe-security-check`'), 'security row present');
  assert.ok(md.includes('`lfe-perf-check`'), 'perf row present');
  // 6 fixtures across the two skills → 6 raw per-fixture rows.
  assert.equal((md.match(/known-bad|known-good/g) || []).length, 6);
});

test('TDD: buildResultsRecord keys each skill with its own prompt hash + verdict', () => {
  const rec = buildResultsRecord(
    aggregate([...STRONG, ...WEAK]),
    { 'lfe-security-check': 'aaa', 'lfe-perf-check': 'bbb' },
    { k: 5, session: 0 },
  );
  assert.equal(rec.skills['lfe-security-check'].promptHash, 'aaa');
  assert.equal(rec.skills['lfe-security-check'].passed, true);
  assert.equal(rec.skills['lfe-perf-check'].promptHash, 'bbb');
  assert.equal(rec.skills['lfe-perf-check'].passed, false);
});

// --- Mutation-pass: passed-threshold BOUNDARY pins (kill escaped mutations) ----
// /lfe-mutation-verify found two escaped mutations — both `passed`-threshold
// boundaries that no prior test exercised exactly-on-the-line. These two pin them.

test('mutation: catch-rate exactly at the 0.80 threshold passes (kills >= → >)', () => {
  const agg = aggregate([
    { fixture: 'b1', skill: 's', kind: 'known-bad', runs: [true, true, true, true, false] },  // 0.8
    { fixture: 'b2', skill: 's', kind: 'known-bad', runs: [true, true, true, true, false] },  // 0.8
    { fixture: 'g1', skill: 's', kind: 'known-good', runs: [true, true, true, true, true] },   // fp 0
  ]);
  assert.equal(agg.skills.s.catchRate, 0.8);
  assert.equal(agg.skills.s.falsePositiveRate, 0);
  assert.equal(agg.skills.s.passed, true, 'catch-rate exactly 0.80 must satisfy the >= threshold');
});

test('mutation: false-positive exactly at the 0.20 ceiling still passes (kills <= → <)', () => {
  const agg = aggregate([
    { fixture: 'b1', skill: 's', kind: 'known-bad', runs: [true, true, true, true, true] },    // 1.0
    { fixture: 'b2', skill: 's', kind: 'known-bad', runs: [true, true, true, true, true] },    // 1.0
    { fixture: 'g1', skill: 's', kind: 'known-good', runs: [false, true, true, true, true] },   // 1/5 = 0.2 fp
  ]);
  assert.equal(agg.skills.s.catchRate, 1);
  assert.equal(agg.skills.s.falsePositiveRate, 0.2);
  assert.equal(agg.skills.s.passed, true, 'false-positive exactly 0.20 must satisfy the <= ceiling');
});
