// Unit tests for the UserPromptSubmit skill-invocation gate.
//
// Mirrors the persona-lock gate's DI test seam pattern: pure main({stdinText, readFileText, env})
// with mocked file I/O. The CLI wrapper is not exercised here (Claude Code's
// real harness exercises that path during the Inspector smoke walk).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  main,
  parseDirective,
  buildDenyMessage,
  buildUnknownSkillMessage,
  BRAIN_TYPEABLE_SKILLS,
  AGENT_ONLY_PREDECESSORS,
  ALL_KNOWN_SKILLS,
  LFE_FORCE_KEYWORD,
  DIRECTIVE_REGEX,
  formatField,
} from '../skill-invocation-gate.mjs';

// --- Fixture builders ---------------------------------------------------------

function makeFrontmatter(fields) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) lines.push(`${k}: null`);
    else if (typeof v === 'boolean') lines.push(`${k}: ${v ? 'true' : 'false'}`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push('---', '', '# Body content', '');
  return lines.join('\n');
}

function makeEntranceCard(persona = 'Architect', mission = 'Test mission') {
  return [
    '# Test entrance card',
    '',
    '| Category | Status / Value |',
    '| :--- | :--- |',
    '| **Integrity Score** | 🟢 [Integrity: 100%] |',
    '| **Mission State** | [IN-FLIGHT] |',
    `| **Active Persona** | ${persona} |`,
    `| **Active Mission** | ${mission} |`,
    '| **Pipeline Phase** | Test |',
    '| **Coordination Files** | 01 ⬜ |',
    '| **Session Count** | 7 |',
    '| **Last Architecture Sweep** | 5 |',
    '',
    '---',
    '',
  ].join('\n');
}

async function runMain({ stdin = null, files = {}, env = {} } = {}) {
  const fileMap = new Map(Object.entries(files));
  const readFileText = async (p) => {
    const normalized = String(p).replace(/\\/g, '/');
    if (fileMap.has(normalized)) return fileMap.get(normalized);
    const err = new Error(`ENOENT: ${normalized}`);
    err.code = 'ENOENT';
    throw err;
  };
  const stdinText = stdin === null ? '' : (typeof stdin === 'string' ? stdin : JSON.stringify(stdin));
  return await main({ stdinText, readFileText, env });
}

function expectAllow(result) {
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

function expectDeny(result, opts = {}) {
  assert.equal(result.exitCode, 0);
  assert.notEqual(result.stdout, '');
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(parsed.hookSpecificOutput.permissionDecisionReason);
  if (opts.includes) {
    for (const needle of opts.includes) {
      assert.ok(
        parsed.hookSpecificOutput.permissionDecisionReason.includes(needle),
        `Expected deny message to include "${needle}". Got:\n${parsed.hookSpecificOutput.permissionDecisionReason}`,
      );
    }
  }
  return parsed.hookSpecificOutput.permissionDecisionReason;
}

// --- 1. Stdin fail-safe (3 cases) ----------------------------------------------

describe('Stage 1 — stdin parse fail-safe', () => {
  test('empty stdin → ALLOW (no parseable directive)', async () => {
    const result = await runMain({ stdin: '' });
    expectAllow(result);
  });

  test('invalid JSON stdin → ALLOW (infra-level pass-through)', async () => {
    const result = await runMain({ stdin: 'not-json{[' });
    expectAllow(result);
  });

  test('valid JSON without user_message → ALLOW (no directive to parse)', async () => {
    const result = await runMain({ stdin: { transcript_path: '/tmp/x', cwd: '/p' } });
    expectAllow(result);
  });
});

// --- 2. Brain-typeable allow (5 cases) ----------------------------------------

describe('Stage 3 — Brain-typeable allow', () => {
  for (const skill of BRAIN_TYPEABLE_SKILLS) {
    test(`/${skill} → ALLOW unconditionally (no predecessor needed)`, async () => {
      const result = await runMain({ stdin: { user_message: `/${skill}` }, files: {} });
      expectAllow(result);
    });
  }

  test('LFE-FORCE keyword (standalone prompt) → ALLOW pass-through', async () => {
    const result = await runMain({
      stdin: { user_message: 'LFE-FORCE: please bypass for emergency hotfix' },
    });
    expectAllow(result);
  });
});

// --- 3. Normal conversation pass-through (3 cases) ----------------------------

describe('Stage 2 — normal conversation pass-through', () => {
  test('no slash directive → ALLOW', async () => {
    const result = await runMain({ stdin: { user_message: 'Hello, what does this code do?' } });
    expectAllow(result);
  });

  test('non-/lfe-* slash command (e.g. /help) → ALLOW', async () => {
    const result = await runMain({ stdin: { user_message: '/help me' } });
    expectAllow(result);
  });

  test('/lfe-* embedded mid-message (not at start) → ALLOW', async () => {
    const result = await runMain({
      stdin: { user_message: 'when should I use /lfe-builder vs /lfe-architect?' },
    });
    expectAllow(result);
  });
});

// --- 4. Agent-only allow with valid predecessor (14 cases) --------------------

describe('Stage 4 — agent-only ALLOW with valid predecessor', () => {
  const validFixtures = {
    'lfe-to-prd': {
      file: '.plans/01_grill_summary.md',
      fm: { phase: 'architect', step: '1_grill', status: 'complete', timestamp: 't', source: 'n/a' },
    },
    'lfe-to-issues': {
      file: '.plans/02_prd.md',
      fm: { phase: 'architect', step: '2_prd', status: 'complete', timestamp: 't', source: 'x' },
    },
    'lfe-architect': {
      file: '.plans/03_slices.md',
      fm: { phase: 'architect', step: '3_slices', status: 'complete', timestamp: 't', source: 'x', total_slices: 1, approved_by_human: true },
    },
    'lfe-plan-critique': {
      file: '.plans/active_plan.md',
      fm: { phase: 'architect', step: '4_active_plan', status: 'complete', timestamp: 't', source: 'x', slice: 1 },
    },
    'lfe-tdd': {
      file: '.plans/builder_done.md',
      fm: { phase: 'builder', step: 'builder', status: 'complete', timestamp: 't', source: 'x', slice: 1 },
    },
    'lfe-zoom-out': {
      file: '.plans/tdd_report.md',
      fm: { phase: 'builder', step: '2_tdd', status: 'complete', timestamp: 't', source: 'x', tests_passed: 1, tests_failed: 0 },
    },
    'lfe-inspector': {
      file: '.plans/tdd_report.md',
      fm: { phase: 'builder', step: '2_tdd', status: 'complete', timestamp: 't', source: 'x', tests_passed: 1, tests_failed: 0 },
    },
    'lfe-diagnose': {
      file: '.plans/inspection_report.md',
      fm: { phase: 'inspector', step: 'inspect', status: 'failed', timestamp: 't', source: 'x' },
    },
    'lfe-archivist': {
      file: '.plans/inspection_report.md',
      fm: { phase: 'inspector', step: 'inspect', status: 'passed', timestamp: 't', source: 'x' },
    },
    'lfe-improve-architecture': {
      file: '.plans/hygiene_report.md',
      fm: { phase: 'hygiene', step: '5_hygiene', status: 'complete', timestamp: 't', source: 'x' },
    },
  };

  for (const [skill, fixture] of Object.entries(validFixtures)) {
    test(`/${skill} with valid predecessor → ALLOW`, async () => {
      const files = { [fixture.file]: makeFrontmatter(fixture.fm) };
      const result = await runMain({ stdin: { user_message: `/${skill}` }, files });
      expectAllow(result);
    });
  }

  test('/lfe-builder with plan_critique PASS → ALLOW', async () => {
    const files = {
      '.plans/plan_critique.md': makeFrontmatter({
        phase: 'architect', step: 'plan_critique', status: 'complete', timestamp: 't', source: 'x', slice: 1,
        verdict: 'PASS', revision: 1, brain_confirmation: null,
      }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files });
    expectAllow(result);
  });

  test('/lfe-builder with plan_critique WARN + brain_confirmation set → ALLOW', async () => {
    const files = {
      '.plans/plan_critique.md': makeFrontmatter({
        phase: 'architect', step: 'plan_critique', status: 'complete', timestamp: 't', source: 'x', slice: 1,
        verdict: 'WARN', revision: 1, brain_confirmation: '2026-05-17T20:00:00Z',
      }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files });
    expectAllow(result);
  });

  test('/lfe-builder with diagnosis_report status=complete (retry path) → ALLOW', async () => {
    const files = {
      '.plans/diagnosis_report.md': makeFrontmatter({
        phase: 'inspector', step: '3_diagnose', status: 'complete', timestamp: 't', source: 'x', slice: 1,
      }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files });
    expectAllow(result);
  });

  for (const subSkill of ['lfe-security-check', 'lfe-perf-check', 'lfe-complexity-check', 'lfe-dep-audit', 'lfe-mutation-verify']) {
    test(`/${subSkill} with builder_done + tdd_report both complete → ALLOW`, async () => {
      const files = {
        '.plans/builder_done.md': makeFrontmatter({ phase: 'builder', step: 'builder', status: 'complete', timestamp: 't', source: 'x', slice: 1 }),
        '.plans/tdd_report.md': makeFrontmatter({ phase: 'builder', step: '2_tdd', status: 'complete', timestamp: 't', source: 'x', tests_passed: 1, tests_failed: 0 }),
      };
      const result = await runMain({ stdin: { user_message: `/${subSkill}` }, files });
      expectAllow(result);
    });
  }
});

// --- 5. Agent-only deny with missing predecessor (14 cases) -------------------

describe('Stage 4 — agent-only DENY with missing predecessor', () => {
  const missingFixtures = {
    'lfe-to-prd': '.plans/01_grill_summary.md',
    'lfe-to-issues': '.plans/02_prd.md',
    'lfe-architect': '.plans/03_slices.md',
    'lfe-plan-critique': '.plans/active_plan.md',
    'lfe-builder': '.plans/plan_critique.md',  // primary path cited
    'lfe-tdd': '.plans/builder_done.md',
    'lfe-zoom-out': '.plans/tdd_report.md',
    'lfe-inspector': '.plans/tdd_report.md',
    'lfe-diagnose': '.plans/inspection_report.md',
    'lfe-archivist': '.plans/inspection_report.md',
    'lfe-improve-architecture': '.plans/hygiene_report.md',
    'lfe-security-check': '.plans/builder_done.md',  // all_of first-part cited
    'lfe-perf-check': '.plans/builder_done.md',
    'lfe-complexity-check': '.plans/builder_done.md',
  };

  for (const [skill, expectedFile] of Object.entries(missingFixtures)) {
    test(`/${skill} cold (no predecessor) → DENY citing ${expectedFile}`, async () => {
      const result = await runMain({ stdin: { user_message: `/${skill}` }, files: {} });
      expectDeny(result, { includes: [expectedFile, 'not found'] });
    });
  }
});

// --- 6. Agent-only deny with wrong-state predecessor (6 cases) ----------------

describe('Stage 4 — agent-only DENY with wrong-state predecessor', () => {
  test('/lfe-to-prd with status=pending → DENY (wrong state)', async () => {
    const files = {
      '.plans/01_grill_summary.md': makeFrontmatter({ phase: 'architect', step: '1_grill', status: 'pending', timestamp: 't', source: 'n/a' }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-to-prd' }, files });
    expectDeny(result, { includes: ['wrong state', 'status=pending'] });
  });

  test('/lfe-architect with approved_by_human=false → DENY', async () => {
    const files = {
      '.plans/03_slices.md': makeFrontmatter({ phase: 'architect', step: '3_slices', status: 'complete', timestamp: 't', source: 'x', total_slices: 1, approved_by_human: false }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-architect' }, files });
    expectDeny(result, { includes: ['approved_by_human'] });
  });

  test('/lfe-builder with plan_critique verdict=BLOCK → DENY', async () => {
    const files = {
      '.plans/plan_critique.md': makeFrontmatter({
        phase: 'architect', step: 'plan_critique', status: 'complete', timestamp: 't', source: 'x', slice: 1,
        verdict: 'BLOCK', revision: 1, brain_confirmation: null,
      }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files });
    expectDeny(result, { includes: ['verdict=BLOCK'] });
  });

  test('/lfe-builder with WARN + brain_confirmation null → DENY', async () => {
    const files = {
      '.plans/plan_critique.md': makeFrontmatter({
        phase: 'architect', step: 'plan_critique', status: 'complete', timestamp: 't', source: 'x', slice: 1,
        verdict: 'WARN', revision: 1, brain_confirmation: null,
      }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files });
    expectDeny(result, { includes: ['brain_confirmation'] });
  });

  test('/lfe-diagnose with status=passed → DENY (must be failed)', async () => {
    const files = {
      '.plans/inspection_report.md': makeFrontmatter({ phase: 'inspector', step: 'inspect', status: 'passed', timestamp: 't', source: 'x' }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-diagnose' }, files });
    expectDeny(result, { includes: ['status=failed required'] });
  });

  test('/lfe-archivist with status=failed → DENY (must be passed)', async () => {
    const files = {
      '.plans/inspection_report.md': makeFrontmatter({ phase: 'inspector', step: 'inspect', status: 'failed', timestamp: 't', source: 'x' }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-archivist' }, files });
    expectDeny(result, { includes: ['status=passed'] });
  });
});

// --- 7. Entry-point ALLOW when output absent (2 cases) ------------------------

describe('Stage 4 — entry-point ALLOW when output file absent', () => {
  test('/lfe-grill-with-docs when no 01_grill_summary.md → ALLOW', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-grill-with-docs' }, files: {} });
    expectAllow(result);
  });

  test('/lfe-hygiene when no hygiene_report.md → ALLOW', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-hygiene' }, files: {} });
    expectAllow(result);
  });
});

// --- 8. Entry-point DENY when output present (2 cases) ------------------------

describe('Stage 4 — entry-point DENY when output already exists', () => {
  test('/lfe-grill-with-docs when 01_grill_summary.md exists → DENY (re-invocation guard)', async () => {
    const files = {
      '.plans/01_grill_summary.md': '# any content',
    };
    const result = await runMain({ stdin: { user_message: '/lfe-grill-with-docs' }, files });
    expectDeny(result, { includes: ['re-invocation guard', '01_grill_summary.md', 'already exists'] });
  });

  test('/lfe-hygiene when hygiene_report.md exists → DENY', async () => {
    const files = {
      '.plans/hygiene_report.md': '# any content',
    };
    const result = await runMain({ stdin: { user_message: '/lfe-hygiene' }, files });
    expectDeny(result, { includes: ['hygiene_report.md', 'already exists'] });
  });
});

// --- 9. Unknown directive deny (3 cases) --------------------------------------

describe('Stage 5 — unknown /lfe-* directive', () => {
  test('typo: /lfe-buildr → DENY listing known skills', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-buildr' }, files: {} });
    expectDeny(result, { includes: ['Unknown skill', '/lfe-buildr', 'Brain-typeable', 'Agent-only'] });
  });

  test('hallucinated: /lfe-frobnicate → DENY', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-frobnicate' }, files: {} });
    expectDeny(result, { includes: ['/lfe-frobnicate'] });
  });

  test('case variation: /LFE-BOOT → ALLOWED (normalizes to lfe-boot)', async () => {
    // Verifies case-insensitive directive detection + skill-name lowercasing.
    const result = await runMain({ stdin: { user_message: '/LFE-BOOT' }, files: {} });
    expectAllow(result);
  });
});

// --- 10. Plan-critique double-predecessor OR-logic (3 cases) ------------------

describe('any_of OR-logic — /lfe-builder predecessor selection', () => {
  test('plan_critique=BLOCK + diagnosis_report=complete → ALLOW (diagnosis path wins)', async () => {
    const files = {
      '.plans/plan_critique.md': makeFrontmatter({ phase: 'architect', step: 'plan_critique', status: 'complete', timestamp: 't', source: 'x', slice: 1, verdict: 'BLOCK', revision: 1, brain_confirmation: null }),
      '.plans/diagnosis_report.md': makeFrontmatter({ phase: 'inspector', step: '3_diagnose', status: 'complete', timestamp: 't', source: 'x', slice: 1 }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files });
    expectAllow(result);
  });

  test('plan_critique=PASS + diagnosis_report absent → ALLOW (primary path wins)', async () => {
    const files = {
      '.plans/plan_critique.md': makeFrontmatter({ phase: 'architect', step: 'plan_critique', status: 'complete', timestamp: 't', source: 'x', slice: 1, verdict: 'PASS', revision: 1, brain_confirmation: null }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files });
    expectAllow(result);
  });

  test('plan_critique=BLOCK + no diagnosis → DENY citing plan_critique wrong-state (informative-failure preference)', async () => {
    const files = {
      '.plans/plan_critique.md': makeFrontmatter({ phase: 'architect', step: 'plan_critique', status: 'complete', timestamp: 't', source: 'x', slice: 1, verdict: 'BLOCK', revision: 1, brain_confirmation: null }),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files });
    const msg = expectDeny(result, { includes: ['plan_critique.md'] });
    // Should prefer wrong_state over missing (verdict=BLOCK is more informative than diagnosis_report missing)
    assert.ok(msg.includes('wrong state') || msg.includes('verdict=BLOCK'), `Expected wrong-state message, got:\n${msg}`);
  });
});

// --- 11. Sub-skill dual-predecessor check (5 cases) ---------------------------

describe('all_of AND-logic — sub-skills require both builder_done and tdd_report', () => {
  for (const subSkill of ['lfe-security-check', 'lfe-perf-check', 'lfe-complexity-check', 'lfe-dep-audit', 'lfe-mutation-verify']) {
    test(`/${subSkill} with only builder_done (no tdd_report) → DENY citing tdd_report.md`, async () => {
      const files = {
        '.plans/builder_done.md': makeFrontmatter({ phase: 'builder', step: 'builder', status: 'complete', timestamp: 't', source: 'x', slice: 1 }),
      };
      const result = await runMain({ stdin: { user_message: `/${subSkill}` }, files });
      expectDeny(result, { includes: ['tdd_report.md'] });
    });
  }
});

// --- 12. Asymmetric fail-safe predecessor read I/O error (2 cases) ------------

describe('predecessor read I/O error handling', () => {
  test('readFileText throws non-ENOENT on present_with_check predecessor → DENY (treat as missing)', async () => {
    const readFileText = async () => {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    };
    const result = await main({
      stdinText: JSON.stringify({ user_message: '/lfe-to-prd' }),
      readFileText,
      env: {},
    });
    expectDeny(result, { includes: ['01_grill_summary.md'] });
  });

  test('readFileText throws on absent_when descriptor → ALLOW (any read failure == "absent")', async () => {
    const readFileText = async () => {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    };
    const result = await main({
      stdinText: JSON.stringify({ user_message: '/lfe-grill-with-docs' }),
      readFileText,
      env: {},
    });
    expectAllow(result);
  });
});

// --- 13. Message content checks (6 cases) -------------------------------------

describe('educational deny-message content', () => {
  test('deny message cites the exact predecessor path verbatim', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files: {} });
    const msg = expectDeny(result);
    assert.ok(msg.includes('.plans/plan_critique.md'), `Missing exact path. Got:\n${msg}`);
  });

  test('deny message names the upstream skill for routing', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-to-issues' }, files: {} });
    const msg = expectDeny(result);
    assert.ok(msg.includes('/lfe-to-prd'), `Missing upstream skill routing. Got:\n${msg}`);
  });

  test('deny message describes the requirement (frontmatter state)', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-architect' }, files: {} });
    const msg = expectDeny(result);
    assert.ok(msg.includes('approved_by_human=true') || msg.includes('step=3_slices'), `Missing requirement description. Got:\n${msg}`);
  });

  test('unknown-skill message includes all 5 Brain-typeable names', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-frobnicate' } });
    const msg = expectDeny(result);
    for (const s of BRAIN_TYPEABLE_SKILLS) {
      assert.ok(msg.includes(s), `Missing Brain-typeable ${s}. Got:\n${msg}`);
    }
    assert.ok(msg.includes('LFE-FORCE'), `Missing LFE-FORCE in skill listing. Got:\n${msg}`);
  });

  test('unknown-skill message includes all 17 agent-only names', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-frobnicate' } });
    const msg = expectDeny(result);
    for (const s of Object.keys(AGENT_ONLY_PREDECESSORS)) {
      assert.ok(msg.includes(s), `Missing agent-only ${s}. Got:\n${msg}`);
    }
  });

  test('absent_when DENY message routes to /lfe-archivist for cleanup', async () => {
    const files = { '.plans/01_grill_summary.md': '# anything' };
    const result = await runMain({ stdin: { user_message: '/lfe-grill-with-docs' }, files });
    const msg = expectDeny(result);
    assert.ok(msg.includes('/lfe-archivist'), `Missing archivist routing. Got:\n${msg}`);
  });
});

// --- 14. Educational-message persona context (2 cases) ------------------------

describe('persona context in deny messages', () => {
  test('persona resolved from entrance card → included in message', async () => {
    const files = {
      'pipeline_status.md': makeEntranceCard('Builder', 'Sample Mission'),
    };
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files });
    const msg = expectDeny(result);
    assert.ok(msg.includes('Builder') || msg.includes('builder'), `Missing persona context. Got:\n${msg}`);
  });

  test('persona unparseable → message omits persona tag gracefully (no crash)', async () => {
    const files = {
      'pipeline_status.md': '# malformed entrance card (no table)',
    };
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files });
    // Should still produce a deny without crashing
    const msg = expectDeny(result);
    assert.ok(msg.includes('plan_critique.md'));
  });
});

// --- 15. parseDirective unit tests --------------------------------------------

describe('parseDirective helper', () => {
  test('empty string → normal', () => {
    assert.deepEqual(parseDirective(''), { type: 'normal' });
  });

  test('null → normal', () => {
    assert.deepEqual(parseDirective(null), { type: 'normal' });
  });

  test('/lfe-boot → lfe-skill', () => {
    assert.deepEqual(parseDirective('/lfe-boot'), { type: 'lfe-skill', skillName: 'lfe-boot' });
  });

  test('   /lfe-builder with leading whitespace → lfe-skill', () => {
    assert.deepEqual(parseDirective('   /lfe-builder'), { type: 'lfe-skill', skillName: 'lfe-builder' });
  });

  test('/LFE-BOOT case-insensitive → normalized to lowercase', () => {
    assert.deepEqual(parseDirective('/LFE-BOOT'), { type: 'lfe-skill', skillName: 'lfe-boot' });
  });

  test('LFE-FORCE alone → lfe-force', () => {
    assert.deepEqual(parseDirective('LFE-FORCE: emergency'), { type: 'lfe-force' });
  });

  test('/lfe-builder takes precedence over embedded LFE-FORCE keyword (BS posture, no escape)', () => {
    // Combined prompt: /lfe-builder + LFE-FORCE token. The directive at start wins.
    assert.deepEqual(parseDirective('/lfe-builder LFE-FORCE bypass please'), { type: 'lfe-skill', skillName: 'lfe-builder' });
  });

  test('embedded /lfe-* not at start → normal', () => {
    assert.deepEqual(parseDirective('see /lfe-builder docs'), { type: 'normal' });
  });

  test('non-/lfe-* slash → normal', () => {
    assert.deepEqual(parseDirective('/help'), { type: 'normal' });
  });
});

// --- 16. Constants integrity ---------------------------------------------------

describe('constants invariants', () => {
  test('BRAIN_TYPEABLE_SKILLS has exactly 4 entries (LFE-FORCE keyword is not a skill)', () => {
    assert.equal(BRAIN_TYPEABLE_SKILLS.length, 4);
  });

  test('AGENT_ONLY_PREDECESSORS has 18 entries (17 distinct skills, 5 sub-skills + 13 others)', () => {
    assert.equal(Object.keys(AGENT_ONLY_PREDECESSORS).length, 18);
  });

  test('ALL_KNOWN_SKILLS = Brain-typeable + agent-only', () => {
    assert.equal(ALL_KNOWN_SKILLS.length, BRAIN_TYPEABLE_SKILLS.length + Object.keys(AGENT_ONLY_PREDECESSORS).length);
  });

  test('No skill name appears in both lists', () => {
    const agentOnlyNames = new Set(Object.keys(AGENT_ONLY_PREDECESSORS));
    for (const s of BRAIN_TYPEABLE_SKILLS) {
      assert.ok(!agentOnlyNames.has(s), `Skill ${s} appears in both Brain-typeable and agent-only lists`);
    }
  });

  test('every agent-only descriptor has the required shape fields', () => {
    for (const [skill, desc] of Object.entries(AGENT_ONLY_PREDECESSORS)) {
      assert.ok(['absent_when', 'present_with_check', 'any_of', 'all_of'].includes(desc.kind), `Skill ${skill} has unknown kind: ${desc.kind}`);
      assert.ok(typeof desc.upstream === 'string' && desc.upstream.length > 0, `Skill ${skill} missing upstream string`);
      if (desc.kind === 'present_with_check') {
        assert.ok(typeof desc.path === 'string', `Skill ${skill} (present_with_check) missing path`);
        assert.ok(typeof desc.check === 'function', `Skill ${skill} (present_with_check) missing check fn`);
        assert.ok(typeof desc.requirement === 'string', `Skill ${skill} missing requirement string`);
      }
      if (desc.kind === 'absent_when') {
        assert.ok(typeof desc.path === 'string', `Skill ${skill} (absent_when) missing path`);
      }
      if (desc.kind === 'any_of') {
        assert.ok(Array.isArray(desc.options) && desc.options.length >= 2, `Skill ${skill} (any_of) needs ≥2 options`);
      }
      if (desc.kind === 'all_of') {
        assert.ok(Array.isArray(desc.parts) && desc.parts.length >= 2, `Skill ${skill} (all_of) needs ≥2 parts`);
      }
    }
  });

  test('LFE_FORCE_KEYWORD is "LFE-FORCE"', () => {
    assert.equal(LFE_FORCE_KEYWORD, 'LFE-FORCE');
  });

  test('DIRECTIVE_REGEX is case-insensitive and anchored', () => {
    assert.match('/lfe-boot', DIRECTIVE_REGEX);
    assert.match('/LFE-BOOT', DIRECTIVE_REGEX);
    assert.doesNotMatch('see /lfe-boot', DIRECTIVE_REGEX);
  });
});

// --- 17. Helper unit tests -----------------------------------------------------

describe('buildDenyMessage helper', () => {
  test('absent_when produces re-invocation guard message', () => {
    const msg = buildDenyMessage({
      skillName: 'lfe-grill-with-docs',
      descriptor: { kind: 'absent_when', path: '.plans/01_grill_summary.md', upstream: '(Phase 1 entry-point)' },
      validation: { reason: 'already_exists', citedPath: '.plans/01_grill_summary.md' },
      persona: 'Architect',
    });
    assert.match(msg, /re-invocation guard/);
    assert.match(msg, /already exists/);
    assert.match(msg, /Architect/);
  });

  test('missing reason produces "not found" message', () => {
    const msg = buildDenyMessage({
      skillName: 'lfe-to-prd',
      descriptor: AGENT_ONLY_PREDECESSORS['lfe-to-prd'],
      validation: { reason: 'missing', citedPath: '.plans/01_grill_summary.md' },
      persona: 'Architect',
    });
    assert.match(msg, /not found/);
    assert.match(msg, /\/lfe-grill-with-docs/);
  });

  test('wrong_state reason includes detail', () => {
    const msg = buildDenyMessage({
      skillName: 'lfe-to-prd',
      descriptor: AGENT_ONLY_PREDECESSORS['lfe-to-prd'],
      validation: { reason: 'wrong_state', citedPath: '.plans/01_grill_summary.md', detail: 'status=pending' },
      persona: 'Architect',
    });
    assert.match(msg, /wrong state/);
    assert.match(msg, /status=pending/);
  });

  test('malformed_frontmatter reason includes parse error detail', () => {
    const msg = buildDenyMessage({
      skillName: 'lfe-to-prd',
      descriptor: AGENT_ONLY_PREDECESSORS['lfe-to-prd'],
      validation: { reason: 'malformed_frontmatter', citedPath: '.plans/01_grill_summary.md', detail: 'no closing delimiter' },
      persona: 'Architect',
    });
    assert.match(msg, /malformed/);
    assert.match(msg, /no closing delimiter/);
  });

  test('defangs ESC in skillName / persona / citedPath / detail (Sec-G2.L2); structure unchanged', () => {
    const ESC = '\x1b';
    const hostile = buildDenyMessage({
      skillName: `lfe-to-prd${ESC}[31m`,
      descriptor: AGENT_ONLY_PREDECESSORS['lfe-to-prd'],
      validation: { reason: 'wrong_state', citedPath: `${ESC}[1m.plans/01_grill_summary.md`, detail: `status=${ESC}[2Jpending` },
      persona: `Architect${ESC}[0m`,
    });
    assert.ok(!hostile.includes(ESC), 'no ESC byte survives in the deny message');
    // Every defanged param carries ESC, so dropping the strip on ANY one of
    // skillName / persona / citedPath / detail breaks the equality below
    // (mutation-verify in-cycle closure). Already-stripped → byte-identical.
    const expected = buildDenyMessage({
      skillName: 'lfe-to-prd[31m',
      descriptor: AGENT_ONLY_PREDECESSORS['lfe-to-prd'],
      validation: { reason: 'wrong_state', citedPath: '[1m.plans/01_grill_summary.md', detail: 'status=[2Jpending' },
      persona: 'Architect[0m',
    });
    assert.equal(hostile, expected);
    assert.match(hostile, /wrong state/);
  });
});

describe('buildUnknownSkillMessage helper', () => {
  test('lists all 5 Brain-typeable + LFE-FORCE', () => {
    const msg = buildUnknownSkillMessage({ skillName: 'lfe-frobnicate' });
    for (const s of BRAIN_TYPEABLE_SKILLS) assert.match(msg, new RegExp(s));
    assert.match(msg, /LFE-FORCE/);
  });

  test('defangs ESC in skillName (Sec-G2.L2; mutation-verify in-cycle closure)', () => {
    const ESC = '\x1b';
    const msg = buildUnknownSkillMessage({ skillName: `frob${ESC}[31m` });
    assert.ok(!msg.includes(ESC), 'no ESC byte survives in the unknown-skill message');
    assert.equal(msg, buildUnknownSkillMessage({ skillName: 'frob[31m' }));
  });

  test('lists every agent-only skill name', () => {
    const msg = buildUnknownSkillMessage({ skillName: 'lfe-frobnicate' });
    for (const s of Object.keys(AGENT_ONLY_PREDECESSORS)) {
      assert.match(msg, new RegExp(s), `missing ${s}`);
    }
  });

  test('includes the typed unknown skill name', () => {
    const msg = buildUnknownSkillMessage({ skillName: 'lfe-frobnicate' });
    assert.match(msg, /\/lfe-frobnicate/);
  });
});

// --- 18. Stderr defense-in-depth ----------------------------------------------

describe('stderr defense-in-depth (every deny path writes the message to stderr)', () => {
  test('missing-predecessor DENY writes stderr', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-builder' }, files: {} });
    assert.ok(result.stderr.length > 0);
    assert.ok(result.stderr.includes('.plans/plan_critique.md'));
  });

  test('absent_when DENY writes stderr', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-grill-with-docs' }, files: { '.plans/01_grill_summary.md': '#' } });
    assert.ok(result.stderr.includes('re-invocation guard'));
  });

  test('unknown-skill DENY writes stderr', async () => {
    const result = await runMain({ stdin: { user_message: '/lfe-frobnicate' } });
    assert.ok(result.stderr.includes('/lfe-frobnicate'));
  });
});

// --- 19. Frontmatter parse error path -----------------------------------------

describe('predecessor frontmatter parse error path', () => {
  test('predecessor file exists but has no frontmatter → DENY (malformed)', async () => {
    const files = {
      '.plans/01_grill_summary.md': '# just a body, no frontmatter at all',
    };
    const result = await runMain({ stdin: { user_message: '/lfe-to-prd' }, files });
    expectDeny(result, { includes: ['frontmatter', 'malformed'] });
  });

  test('predecessor file has opening delimiter but no closing → DENY', async () => {
    const files = {
      '.plans/02_prd.md': '---\nphase: architect\nstep: 2_prd\nstatus: complete\n\n# unclosed',
    };
    const result = await runMain({ stdin: { user_message: '/lfe-to-issues' }, files });
    expectDeny(result, { includes: ['frontmatter'] });
  });
});

// --- 20. CLAUDE_PROJECT_DIR resolution (env-var ladder) -----------------------

describe('CLAUDE_PROJECT_DIR resolution', () => {
  test('env.CLAUDE_PROJECT_DIR is used to resolve predecessor path', async () => {
    const projectRoot = '/test/project';
    const files = {
      [`${projectRoot}/.plans/01_grill_summary.md`]: makeFrontmatter({
        phase: 'architect', step: '1_grill', status: 'complete', timestamp: 't', source: 'n/a',
      }),
    };
    const result = await runMain({
      stdin: { user_message: '/lfe-to-prd' },
      files,
      env: { CLAUDE_PROJECT_DIR: projectRoot },
    });
    expectAllow(result);
  });

  test('payload.cwd is used when CLAUDE_PROJECT_DIR is absent', async () => {
    const projectRoot = '/test/project';
    const files = {
      [`${projectRoot}/.plans/01_grill_summary.md`]: makeFrontmatter({
        phase: 'architect', step: '1_grill', status: 'complete', timestamp: 't', source: 'n/a',
      }),
    };
    const result = await runMain({
      stdin: { user_message: '/lfe-to-prd', cwd: projectRoot },
      files,
      env: {},
    });
    expectAllow(result);
  });

  test('CLAUDE_PROJECT_DIR wins over payload.cwd when both set', async () => {
    const projectRoot = '/test/project';
    const wrongRoot = '/wrong/path';
    const files = {
      [`${projectRoot}/.plans/01_grill_summary.md`]: makeFrontmatter({
        phase: 'architect', step: '1_grill', status: 'complete', timestamp: 't', source: 'n/a',
      }),
    };
    const result = await runMain({
      stdin: { user_message: '/lfe-to-prd', cwd: wrongRoot },
      files,
      env: { CLAUDE_PROJECT_DIR: projectRoot },
    });
    expectAllow(result);
  });
});

// --- formatField token-branch mutation cells -----------
// Pins each of formatField's three token branches plus the
// String() fall-through, so a mutant that swaps a token literal or drops a
// branch is caught. formatField is exported for this direct unit test.
describe('formatField token branches', () => {
  test('null → "<null>"', () => {
    assert.equal(formatField(null), '<null>');
  });
  test('undefined → "<missing>"', () => {
    assert.equal(formatField(undefined), '<missing>');
  });
  test('empty string → "<empty>"', () => {
    assert.equal(formatField(''), '<empty>');
  });
  test('non-empty string → passthrough', () => {
    assert.equal(formatField('complete'), 'complete');
  });
  test('false → "false" (falsy but not null/undefined/empty → stringified)', () => {
    assert.equal(formatField(false), 'false');
  });
});
