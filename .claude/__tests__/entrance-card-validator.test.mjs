// Entrance-card conformance validator suite (framework ADR 103).
// node:test translation of the proven downstream suite (a private production
// adopter runs it under vitest; this scaffold's runner discovers .claude/**/__tests__).
// Fixture-driven over the pure core, plus the LIVE guard: the shipped template
// card must itself conform (the repo's own artifact is a permanent fixture).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkEntranceCard,
  BUDGET_HARD_CHARS,
  MAX_RECENT_MISSIONS,
  PERSONA_SET,
} from '../../scripts/check-entrance-card.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Minimal conformant card; each violation test breaks exactly one clause.
function makeCard({
  state = '[BLANK CANVAS] — fresh scaffold.',
  persona = 'Architect',
  count = '0',
  checkboxCell = '01 ⬜  02 ⬜  03 ⬜  plan ⬜  plan_critique ⬜  build ⬜  tdd ⬜  critique ⬜  inspect ⬜',
  missions = ['- (none yet — grows at mission closes) → CHANGELOG'],
  routingHeader = '## 🧭 Navigation — where what lives',
  padding = 0,
} = {}) {
  const lines = [
    '# 🏛️ LFE Mission Control (Entrance Card)',
    '',
    '| Category | Status / Value |',
    '| :--- | :--- |',
    '| **Integrity Score** | 🟢 [Integrity: 100%] |',
    `| **Mission State** | ${state} |`,
    `| **Active Persona** | ${persona} |`,
    '| **Active Mission** | Sample charter. |',
    '| **Pipeline Phase** | Sample cursor. |',
    `| **Coordination Files** | ${checkboxCell} |`,
    `| **Session Count** | ${count} |`,
    '| **Authorized Scope** | (none) |',
    '| **Last Architecture Sweep** | Never |',
    '',
    '## 📜 Recent Missions (max 3)',
    ...missions,
    '',
    routingHeader,
    '| Looking for… | Go to |',
    '| :--- | :--- |',
    '| Full mission history | CHANGELOG.md |',
  ];
  let card = lines.join('\n') + '\n';
  if (padding > 0) card += '<!-- ' + 'x'.repeat(padding) + ' -->\n';
  return card;
}

const rules = (text) => checkEntranceCard(text).violations.map((v) => v.rule);

describe('checkEntranceCard — conformant fixtures', () => {
  test('minimal conformant card → 0 violations', () => {
    assert.deepEqual(checkEntranceCard(makeCard()).violations, []);
  });

  test('every legal state token is accepted', () => {
    for (const state of [
      '[BLANK CANVAS]',
      '[DOMAIN LOADED]',
      '[IN-FLIGHT: architect] · detail',
      '[MISSION COMPLETE] · detail',
    ]) {
      assert.deepEqual(rules(makeCard({ state })), []);
    }
  });

  test('every bare persona name is accepted', () => {
    for (const persona of PERSONA_SET) {
      assert.deepEqual(rules(makeCard({ persona })), []);
    }
  });
});

describe('checkEntranceCard — violations', () => {
  test('R8: over-budget card is flagged', () => {
    assert.ok(rules(makeCard({ padding: BUDGET_HARD_CHARS })).includes('R8-budget'));
  });

  test('R8: the hard budget is EXACTLY 12,000 chars (exact-literal pin)', () => {
    // Fixtures that derive from the imported constant mutate in sympathy with it
    // (table-echo circularity), so the contract number is pinned as a literal
    // AND proven with a literal-padded fixture.
    assert.equal(BUDGET_HARD_CHARS, 12_000);
    assert.ok(rules(makeCard({ padding: 13_000 })).includes('R8-budget'));
    assert.ok(!rules(makeCard({ padding: 1_000 })).includes('R8-budget'));
  });

  test('R1: a missing consumer row is flagged', () => {
    const card = makeCard().replace(/^\| \*\*Pipeline Phase\*\* \|.*\|\n/m, '');
    assert.ok(rules(card).includes('R1-rows'));
  });

  test('R2: an illegal leading state token is flagged', () => {
    assert.ok(rules(makeCard({ state: 'NOW WORKING' })).includes('R2-state-token'));
  });

  test('R2: a legal token NOT at the start is still flagged', () => {
    assert.ok(rules(makeCard({ state: 'setup · [BLANK CANVAS]' })).includes('R2-state-token'));
  });

  test('R3: a non-numeric Session Count is flagged', () => {
    assert.ok(rules(makeCard({ count: 'zero-ish' })).includes('R3-session-numeric'));
  });

  test('R4: an emoji-decorated persona cell is flagged', () => {
    assert.ok(rules(makeCard({ persona: '🏛️ Architect' })).includes('R4-bare-persona'));
  });

  test('R4: an annotated persona cell is flagged', () => {
    assert.ok(rules(makeCard({ persona: 'Architect (retained)' })).includes('R4-bare-persona'));
  });

  test('R5: a missing checkbox label is flagged', () => {
    const cell =
      '01 ⬜  02 ⬜  03 ⬜  plan ⬜  plan_critique ⬜  build ⬜  critique ⬜  inspect ⬜'; // tdd dropped
    assert.ok(rules(makeCard({ checkboxCell: cell })).includes('R5-checkboxes'));
  });

  test('R6: more than 3 Recent Missions pointers is flagged', () => {
    const missions = ['- a → C', '- b → C', '- c → C', '- d → C'];
    assert.equal(missions.length, MAX_RECENT_MISSIONS + 1);
    assert.ok(rules(makeCard({ missions })).includes('R6-recent-missions'));
  });

  test('R6: a missing Recent Missions section is flagged', () => {
    const card = makeCard().replace(/^## 📜 Recent Missions.*$/m, '## Something Else');
    assert.ok(rules(card).includes('R6-recent-missions'));
  });

  test('R7: a missing routing table is flagged', () => {
    assert.ok(rules(makeCard({ routingHeader: '## 🧭 Navigation' })).includes('R7-routing'));
  });
});

describe('checkEntranceCard — encoding + live', () => {
  test('CRLF and LF encodings of the same card yield identical verdicts', () => {
    const lf = makeCard();
    const crlf = lf.replace(/\n/g, '\r\n');
    assert.deepEqual(checkEntranceCard(crlf).violations, checkEntranceCard(lf).violations);
    const lfBad = makeCard({ persona: '🏛️ Architect' });
    assert.deepEqual(rules(lfBad.replace(/\n/g, '\r\n')), rules(lfBad));
  });

  test('R8 measures AFTER normalization — budget-boundary card verdicts identically in both encodings', () => {
    const base = makeCard();
    const lf = makeCard({ padding: BUDGET_HARD_CHARS - base.length - 15 });
    const crlf = lf.replace(/\n/g, '\r\n');
    assert.ok(lf.length <= BUDGET_HARD_CHARS);
    assert.ok(crlf.length > BUDGET_HARD_CHARS);
    assert.deepEqual(rules(lf), []);
    assert.deepEqual(rules(crlf), []);
  });

  test('LIVE: the shipped template entrance card conforms to the contract', () => {
    const card = readFileSync(join(REPO_ROOT, 'pipeline_status.md'), 'utf8');
    assert.deepEqual(checkEntranceCard(card).violations, []);
  });
});
