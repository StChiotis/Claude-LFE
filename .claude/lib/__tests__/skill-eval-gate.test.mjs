// Test suite for the hash-pinned pre-commit freshness gate (.claude/lib/skill-eval-gate.mjs).
// Behaviour-first + DI: the pure core (skillForStagedPath / stagedReasoningSkills /
// parseRecord / isProven / evaluateGate / decide / buildGateMessage) is exercised with
// canned staged-path lists, records, and an injected hashForSkill — no filesystem, no git.
// Mirrors the DI / fail-soft style of skill-eval-report.test.mjs + plan-linter.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REASONING_SKILLS,
  RESULTS_REL,
  GATE_NAME,
  ACTION,
  skillForStagedPath,
  stagedReasoningSkills,
  parseRecord,
  isProven,
  evaluateGate,
  decide,
  buildGateMessage,
} from '../skill-eval-gate.mjs';

// --- Canned record + current-hash resolver ------------------------------------
// security: proven (passed + hash match). perf: measured-but-failed. plan-critique:
// passed on record but the staged hash has DRIFTED. complexity: absent from record.
const RECORD = {
  skills: {
    'lfe-security-check': { promptHash: 'hash-sec', passed: true },
    'lfe-perf-check': { promptHash: 'hash-perf', passed: false },
    'lfe-plan-critique': { promptHash: 'hash-plan-OLD', passed: true },
  },
};
const CURRENT = {
  'lfe-security-check': 'hash-sec', // matches → proven
  'lfe-perf-check': 'hash-perf', // hash matches but passed:false → not-passed
  'lfe-plan-critique': 'hash-plan-NEW', // differs from record → hash-mismatch
  'lfe-complexity-check': 'hash-cx', // absent from record → no-record
};
const hashForSkill = (s) => (Object.hasOwn(CURRENT, s) ? CURRENT[s] : null);

// --- Constants / coverage-hole guard -----------------------------------------------

test('REASONING_SKILLS is EXACTLY the five measured skills (the results-record key space)', () => {
  assert.deepEqual(
    [...REASONING_SKILLS].sort(),
    ['lfe-complexity-check', 'lfe-mutation-verify', 'lfe-perf-check', 'lfe-plan-critique', 'lfe-security-check'],
    'a divergence from the corpus sidecar `skill` keys would be a silent coverage hole',
  );
  assert.equal(REASONING_SKILLS.length, 5);
  assert.ok(Object.isFrozen(REASONING_SKILLS));
});

test('exported substrate constants are the documented values', () => {
  assert.equal(GATE_NAME, 'skill-eval');
  assert.equal(RESULTS_REL, '.claude/lib/__eval__/results.json');
  assert.deepEqual(ACTION, { ALLOW: 'allow', WARN: 'warn', REFUSE: 'refuse' });
});

// --- skillForStagedPath -------------------------------------------------------

test('skillForStagedPath: canonical + mirror SKILL.md both map to the skill', () => {
  assert.equal(skillForStagedPath('.agents/skills/lfe-security-check/SKILL.md'), 'lfe-security-check');
  assert.equal(skillForStagedPath('.claude/skills/lfe-plan-critique/SKILL.md'), 'lfe-plan-critique');
});

test('skillForStagedPath: backslash paths and ./ prefixes are normalized', () => {
  assert.equal(skillForStagedPath('.agents\\skills\\lfe-perf-check\\SKILL.md'), 'lfe-perf-check');
  assert.equal(skillForStagedPath('./.agents/skills/lfe-mutation-verify/SKILL.md'), 'lfe-mutation-verify');
});

test('skillForStagedPath: a non-reasoning skill dir is NOT watched', () => {
  assert.equal(skillForStagedPath('.agents/skills/lfe-boot/SKILL.md'), null);
  assert.equal(skillForStagedPath('.agents/skills/lfe-builder/SKILL.md'), null);
  assert.equal(skillForStagedPath('.agents/skills/lfe-skill-eval/SKILL.md'), null);
});

test('skillForStagedPath: a non-SKILL.md file under a reasoning dir is ignored', () => {
  assert.equal(skillForStagedPath('.agents/skills/lfe-security-check/README.md'), null);
  assert.equal(skillForStagedPath('.agents/skills/lfe-security-check/extra/SKILL.md'), null);
});

test('skillForStagedPath: unrelated paths and non-strings → null', () => {
  assert.equal(skillForStagedPath('README.md'), null);
  assert.equal(skillForStagedPath('.claude/lib/skill-eval-gate.mjs'), null);
  assert.equal(skillForStagedPath('.agents/skills/_evals/fixtures/security/sec-bad-1.js'), null);
  assert.equal(skillForStagedPath(null), null);
  assert.equal(skillForStagedPath(42), null);
});

// --- stagedReasoningSkills ----------------------------------------------------

test('stagedReasoningSkills: dedupes the canonical + mirror of the same skill', () => {
  const skills = stagedReasoningSkills([
    '.agents/skills/lfe-security-check/SKILL.md',
    '.claude/skills/lfe-security-check/SKILL.md',
    'README.md',
  ]);
  assert.deepEqual(skills, ['lfe-security-check']);
});

test('stagedReasoningSkills: order-stable across multiple skills; ignores noise', () => {
  const skills = stagedReasoningSkills([
    '.agents/skills/lfe-plan-critique/SKILL.md',
    'src/whatever.js',
    '.agents/skills/lfe-security-check/SKILL.md',
  ]);
  assert.deepEqual(skills, ['lfe-plan-critique', 'lfe-security-check']);
});

test('stagedReasoningSkills: empty / non-array input → []', () => {
  assert.deepEqual(stagedReasoningSkills([]), []);
  assert.deepEqual(stagedReasoningSkills(null), []);
  assert.deepEqual(stagedReasoningSkills('nope'), []);
});

// --- parseRecord --------------------------------------------------------------

test('parseRecord: a valid object (including {}) is READABLE, not a fail-safe state', () => {
  assert.deepEqual(parseRecord('{"skills":{}}'), { record: { skills: {} }, unreadable: false });
  assert.deepEqual(parseRecord('{}'), { record: {}, unreadable: false });
});

test('parseRecord: non-JSON / null / array → unreadable (fail-safe substrate)', () => {
  assert.equal(parseRecord('not json').unreadable, true);
  assert.equal(parseRecord('null').unreadable, true);
  assert.equal(parseRecord('[1,2]').unreadable, true);
  assert.equal(parseRecord('').unreadable, true);
  assert.equal(parseRecord(undefined).unreadable, true);
});

// --- isProven -----------------------------------------------------------------

test('isProven: passed + matching hash → true; every other combination → false', () => {
  assert.equal(isProven({ passed: true, promptHash: 'h' }, 'h'), true);
  assert.equal(isProven({ passed: true, promptHash: 'h' }, 'OTHER'), false); // hash drift
  assert.equal(isProven({ passed: false, promptHash: 'h' }, 'h'), false); // not passed
  assert.equal(isProven(undefined, 'h'), false); // no entry
  assert.equal(isProven({ passed: true, promptHash: 'h' }, null), false); // unreadable current hash
  assert.equal(isProven({ passed: true }, 'h'), false); // no recorded hash
});

// --- evaluateGate -------------------------------------------------------------

test('evaluateGate: a proven skill is not offending', () => {
  const { offending } = evaluateGate({ skills: ['lfe-security-check'], record: RECORD, hashForSkill });
  assert.deepEqual(offending, []);
});

test('evaluateGate: hash drift → offending(hash-mismatch)', () => {
  const { offending } = evaluateGate({ skills: ['lfe-plan-critique'], record: RECORD, hashForSkill });
  assert.deepEqual(offending, [{ skill: 'lfe-plan-critique', reason: 'hash-mismatch' }]);
});

test('evaluateGate: recorded-but-failed verdict → offending(not-passed)', () => {
  const { offending } = evaluateGate({ skills: ['lfe-perf-check'], record: RECORD, hashForSkill });
  assert.deepEqual(offending, [{ skill: 'lfe-perf-check', reason: 'not-passed' }]);
});

test('evaluateGate: skill absent from record → offending(no-record)', () => {
  const { offending } = evaluateGate({ skills: ['lfe-complexity-check'], record: RECORD, hashForSkill });
  assert.deepEqual(offending, [{ skill: 'lfe-complexity-check', reason: 'no-record' }]);
});

test('evaluateGate: an empty {} record makes every staged skill offending (the shipped template state)', () => {
  const { offending } = evaluateGate({ skills: ['lfe-security-check'], record: {}, hashForSkill });
  assert.deepEqual(offending, [{ skill: 'lfe-security-check', reason: 'no-record' }]);
});

test('evaluateGate: partitions a mixed staged set correctly', () => {
  const { offending } = evaluateGate({
    skills: ['lfe-security-check', 'lfe-perf-check', 'lfe-plan-critique', 'lfe-complexity-check'],
    record: RECORD,
    hashForSkill,
  });
  // security proven → excluded; the other three each carry their own reason.
  assert.deepEqual(offending, [
    { skill: 'lfe-perf-check', reason: 'not-passed' },
    { skill: 'lfe-plan-critique', reason: 'hash-mismatch' },
    { skill: 'lfe-complexity-check', reason: 'no-record' },
  ]);
});

test('evaluateGate: fail-soft — malformed record / entries never throw', () => {
  for (const bad of [null, undefined, 42, 'str', {}, { skills: null }, { skills: { 'lfe-security-check': 7 } }]) {
    assert.doesNotThrow(() => evaluateGate({ skills: ['lfe-security-check'], record: bad, hashForSkill }));
  }
  // a non-object entry is treated as no-record, not a crash.
  const { offending } = evaluateGate({
    skills: ['lfe-security-check'],
    record: { skills: { 'lfe-security-check': 7 } },
    hashForSkill,
  });
  assert.deepEqual(offending, [{ skill: 'lfe-security-check', reason: 'no-record' }]);
});

test('evaluateGate: a throwing hashForSkill degrades to parseError + empty offending (→ allow)', () => {
  const r = evaluateGate({
    skills: ['lfe-security-check'],
    record: RECORD,
    hashForSkill: () => {
      throw new Error('boom');
    },
  });
  assert.equal(r.parseError, true);
  assert.deepEqual(r.offending, []);
});

// --- decide -------------------------------------------------------------------

test('decide: an unreadable record → ALLOW (ADR-85 fail-safe), regardless of staged edits', () => {
  assert.equal(decide({ offending: [{ skill: 'x', reason: 'no-record' }], recordUnreadable: true, posture: 'block' }).action, ACTION.ALLOW);
});

test('decide: no offending → ALLOW', () => {
  assert.equal(decide({ offending: [], recordUnreadable: false, posture: 'block' }).action, ACTION.ALLOW);
});

test('decide: offending under default warn posture → WARN (commit proceeds)', () => {
  const d = decide({ offending: [{ skill: 'x', reason: 'no-record' }], recordUnreadable: false, posture: 'warn' });
  assert.equal(d.action, ACTION.WARN);
});

test('decide: offending defaults to WARN when posture is unset/unknown', () => {
  assert.equal(decide({ offending: [{ skill: 'x', reason: 'no-record' }], recordUnreadable: false }).action, ACTION.WARN);
  assert.equal(decide({ offending: [{ skill: 'x', reason: 'no-record' }], recordUnreadable: false, posture: 'nonsense' }).action, ACTION.WARN);
});

test('decide: offending under promoted block posture → REFUSE (commit refused)', () => {
  const d = decide({ offending: [{ skill: 'x', reason: 'no-record' }], recordUnreadable: false, posture: 'block' });
  assert.equal(d.action, ACTION.REFUSE);
});

// --- buildGateMessage ---------------------------------------------------------

test('buildGateMessage: always names the skill(s) AND directs the re-run (AC1), on warn and refuse', () => {
  const offending = [{ skill: 'lfe-security-check', reason: 'hash-mismatch' }];
  for (const action of [ACTION.WARN, ACTION.REFUSE]) {
    const msg = buildGateMessage({ offending, action });
    assert.match(msg, /lfe-security-check/);
    assert.match(msg, /\/lfe-skill-eval/, 'must direct the committer to re-run the eval');
  }
});

test('buildGateMessage: refuse vs warn head differ (refused vs warn-and-log)', () => {
  const offending = [{ skill: 'lfe-perf-check', reason: 'no-record' }];
  assert.match(buildGateMessage({ offending, action: ACTION.REFUSE }), /Commit refused/);
  assert.match(buildGateMessage({ offending, action: ACTION.WARN }), /warn-and-log/);
});

test('buildGateMessage: never throws on junk input', () => {
  for (const bad of [null, undefined, {}, { offending: 'x' }]) {
    assert.doesNotThrow(() => buildGateMessage(bad ?? {}));
  }
});

// --- TDD / mutation pass: boundary pins for escaped mutations ------------------
// The core above is green; these pin behaviours a single mutation could silently
// flip — the STRICT pass-equality and the ANCHORED path regex — the two places a
// weakening would open a coverage hole or a false certification. Mirrors the mutation
// pins in skill-eval-report.test.mjs.

test('mutation: `passed` must be STRICTLY true — a truthy non-true verdict is not proven', () => {
  // passed:1 / "true" are truthy but not === true → must NOT certify (kills a
  // `=== true` → truthy-coercion mutation). isProven and evaluateGate must agree.
  assert.equal(isProven({ passed: 1, promptHash: 'h' }, 'h'), false);
  assert.equal(isProven({ passed: 'true', promptHash: 'h' }, 'h'), false);
  const { offending } = evaluateGate({
    skills: ['lfe-security-check'],
    record: { skills: { 'lfe-security-check': { passed: 1, promptHash: 'hash-sec' } } },
    hashForSkill: () => 'hash-sec',
  });
  assert.deepEqual(offending, [{ skill: 'lfe-security-check', reason: 'not-passed' }]);
});

test('mutation: skillForStagedPath is ^-anchored — a deeper prefix is not a tracked prompt edit', () => {
  assert.equal(skillForStagedPath('vendor/.agents/skills/lfe-security-check/SKILL.md'), null);
  assert.equal(skillForStagedPath('x/.claude/skills/lfe-plan-critique/SKILL.md'), null);
});

test('mutation: skillForStagedPath is $-anchored — a look-alike suffix is not the prompt file', () => {
  assert.equal(skillForStagedPath('.agents/skills/lfe-security-check/SKILL.md.bak'), null);
  assert.equal(skillForStagedPath('.agents/skills/lfe-security-check/SKILL.markdown'), null);
});

test('mutation: a nested subdir between the skill and SKILL.md does not match (one path segment)', () => {
  assert.equal(skillForStagedPath('.agents/skills/lfe-security-check/sub/SKILL.md'), null);
});

test('buildGateMessage: every offending skill is named in a multi-skill commit', () => {
  const msg = buildGateMessage({
    offending: [
      { skill: 'lfe-security-check', reason: 'no-record' },
      { skill: 'lfe-plan-critique', reason: 'hash-mismatch' },
    ],
    action: ACTION.WARN,
  });
  assert.match(msg, /lfe-security-check/);
  assert.match(msg, /lfe-plan-critique/);
});

// --- Inspector-found escape closures (mutation_findings.md) --------------------
// Two LOW/cosmetic mutations survived the Builder/TDD suite; these two assertions
// close them so the gate has zero known mutation gaps.

test('mutation: parseRecord treats a non-object JSON PRIMITIVE as unreadable, not a record', () => {
  // A bare JSON number/string/bool is not a results record → unreadable (the CLI then
  // fail-safe-ALLOWs rather than mis-reading it as an empty record). Pins the
  // `typeof record !== 'object'` guard a deletion mutation would otherwise slip past.
  assert.equal(parseRecord('42').unreadable, true);
  assert.equal(parseRecord('"str"').unreadable, true);
  assert.equal(parseRecord('true').unreadable, true);
});

test('mutation: a recorded-but-failed entry whose hash ALSO drifted reports `not-passed` (ladder precedence)', () => {
  // passed:false takes precedence over a hash mismatch in the reason label — pins the
  // if/else-if ordering so a reason-ladder reorder mutation is caught.
  const { offending } = evaluateGate({
    skills: ['lfe-security-check'],
    record: { skills: { 'lfe-security-check': { passed: false, promptHash: 'OLD' } } },
    hashForSkill: () => 'NEW',
  });
  assert.deepEqual(offending, [{ skill: 'lfe-security-check', reason: 'not-passed' }]);
});
