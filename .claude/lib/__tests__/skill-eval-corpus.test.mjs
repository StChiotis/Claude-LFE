// Corpus-integrity test for the skill-eval fixture corpus (.agents/skills/_evals/).
// Integration-style (reads the real corpus from disk): proves every sidecar is
// JSON-valid + schema-conformant, the per-skill 2-bad/1-good tally holds, no
// fixture telegraphs its defect, and the grader+sidecar pairing works offline
// for a representative output per family. Live skill runs happen in the runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeSkillOutput, FAMILIES, FAMILY } from '../skill-eval.mjs';
import { scanTelegraph } from '../telegraph-lint.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EVALS = join(REPO_ROOT, '.agents', 'skills', '_evals');
const EXPECTED_DIR = join(EVALS, 'expected');
const FIXTURES_DIR = join(EVALS, 'fixtures');
const VALID_KINDS = new Set(['known-bad', 'known-good']);

function loadSidecars() {
  return readdirSync(EXPECTED_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: basename(f, '.json'), sidecar: JSON.parse(readFileSync(join(EXPECTED_DIR, f), 'utf8')) }));
}

function fixtureIndex() {
  const idx = new Map();
  for (const entry of readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(FIXTURES_DIR, entry.name);
    for (const f of readdirSync(dir)) {
      if (statSync(join(dir, f)).isFile()) idx.set(basename(f, extname(f)), join(dir, f));
    }
  }
  return idx;
}

test('every sidecar is valid JSON and schema-conformant', () => {
  const sidecars = loadSidecars();
  assert.ok(sidecars.length >= 14, `expected >= 14 sidecars, got ${sidecars.length}`);
  for (const { name, sidecar } of sidecars) {
    assert.ok(FAMILIES[sidecar.skill], `${name}: unknown skill "${sidecar.skill}"`);
    assert.ok(VALID_KINDS.has(sidecar.kind), `${name}: bad kind "${sidecar.kind}"`);
    const fam = FAMILIES[sidecar.skill];
    if (fam === FAMILY.VERDICT) {
      assert.ok(['PASS', 'WARN', 'BLOCK'].includes(sidecar.expectedVerdict), `${name}: needs a valid expectedVerdict`);
    }
    if (fam === FAMILY.OUTCOME) {
      assert.ok(sidecar.escaped && typeof sidecar.escaped === 'object', `${name}: needs an escaped band`);
    }
    if (sidecar.kind === 'known-bad') {
      const hasMention = Array.isArray(sidecar.mustMention) && sidecar.mustMention.length > 0;
      const hasFamilySignal = sidecar.severities || sidecar.escaped || sidecar.expectedVerdict;
      assert.ok(hasMention || hasFamilySignal, `${name}: known-bad needs a catch signal (mustMention or family band)`);
    }
    if (sidecar.kind === 'known-good' && fam === FAMILY.SEVERITY) {
      assert.ok(sidecar.severities, `${name}: known-good severity fixture needs zero-bands`);
    }
  }
});

test('each skill has the expected known-bad/known-good fixture tally', () => {
  const tally = {};
  for (const { sidecar } of loadSidecars()) {
    tally[sidecar.skill] ??= { 'known-bad': 0, 'known-good': 0 };
    tally[sidecar.skill][sidecar.kind] += 1;
  }
  // Most skills carry two known-bad + one known-good. plan-critique carries one
  // known-bad (the obvious BLOCK) + one known-good (the obvious PASS): its
  // WARN/BLOCK borderline is a subjective judgment delegated to the human gate,
  // not auto-graded.
  const expectedTally = (skill) =>
    skill === 'lfe-plan-critique'
      ? { 'known-bad': 1, 'known-good': 1 }
      : { 'known-bad': 2, 'known-good': 1 };
  for (const skill of Object.keys(FAMILIES)) {
    assert.deepEqual(tally[skill], expectedTally(skill), `${skill} tally`);
  }
});

test('every fixture has a matching file and is NOT telegraphed', () => {
  const idx = fixtureIndex();
  for (const { name, sidecar } of loadSidecars()) {
    const fpath = idx.get(name);
    assert.ok(fpath, `${name}: no matching fixture file under fixtures/`);
    const text = readFileSync(fpath, 'utf8');
    const res = scanTelegraph(text, { mustMention: sidecar.mustMention ?? [] });
    assert.equal(res.telegraphed, false, `${name} telegraphs its defect: ${JSON.stringify(res.hits)}`);
  }
});

test('representative grading per family: known-bad caught, known-good clean', () => {
  const sidecar = (n) => JSON.parse(readFileSync(join(EXPECTED_DIR, `${n}.json`), 'utf8'));

  // severity family — bad caught, good clean
  const sevBad = '### Critical\n- A03 SQL injection via string concatenation\n\n### Summary\n- Critical issues: 1';
  assert.equal(gradeSkillOutput(sevBad, sidecar('sec-bad-1')).pass, true, 'sec-bad-1');
  const sevGood = 'No security concerns identified across all OWASP Top-10 categories.';
  assert.equal(gradeSkillOutput(sevGood, sidecar('sec-good-1')).pass, true, 'sec-good-1');

  // outcome family — bad caught
  const outBad = '### Escaped Mutations\n| Function | Mutation | Why |\n|---|---|---|\n| isEligible | > to >= | boundary 18 not asserted |';
  assert.equal(gradeSkillOutput(outBad, sidecar('mut-bad-1')).pass, true, 'mut-bad-1');

  // verdict family — bad caught
  const verdictBad = '## Verdict: BLOCK\n- introduces undocumented discount math';
  assert.equal(gradeSkillOutput(verdictBad, sidecar('plan-bad-2')).pass, true, 'plan-bad-2');

  // known-good clean for the remaining families
  const verdictGood = '---\nverdict: PASS\n---\n## Verdict: PASS\n- clean, falsifiable plan';
  assert.equal(gradeSkillOutput(verdictGood, sidecar('plan-good-1')).pass, true, 'plan-good-1');
  const outGood = '### Escaped Mutations\n| Function | Mutation | Why |\n|---|---|---|\n\n### Summary\n- Escaped mutations: 0';
  assert.equal(gradeSkillOutput(outGood, sidecar('mut-good-1')).pass, true, 'mut-good-1');
});
