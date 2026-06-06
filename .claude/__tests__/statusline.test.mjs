// Tests for .claude/statusline.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStdinPayload,
  parseEntranceCard,
  resolveProjectDir,
  formatPersona,
  formatState,
  render,
  main,
  PERSONA_TABLE,
  STATE_VARIANTS,
  FALLBACK_TEXT,
  capLine,
} from '../statusline.mjs';
import { ELLIPSIS } from '../lib/text-format.mjs';

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s) => s.replace(ANSI_RE, '');

const CANONICAL_ENTRANCE = `# LFE Mission Control (Entrance Card)

| Category | Status / Value |
| :--- | :--- |
| **Integrity Score** | 100% |
| **Mission State** | [MISSION COMPLETE] |
| **Active Persona** | Architect |
| **Pipeline Phase** | Ready |
| **Session Count** | 4 |
| **Last Architecture Sweep** | Never (due in 1 session) |
`;

// =============================================================================
// Block A — parseStdinPayload
// =============================================================================
describe('parseStdinPayload', () => {
  test('parses valid JSON', () => {
    const obj = parseStdinPayload('{"workspace":{"project_dir":"/repo"}}');
    assert.equal(obj?.workspace?.project_dir, '/repo');
  });

  test('returns null on malformed JSON', () => {
    assert.equal(parseStdinPayload('{not json'), null);
  });

  test('returns null on empty string', () => {
    assert.equal(parseStdinPayload(''), null);
  });

  test('returns null on whitespace-only string', () => {
    assert.equal(parseStdinPayload('   \n\t  '), null);
  });

  test('returns null on null/undefined input', () => {
    assert.equal(parseStdinPayload(null), null);
    assert.equal(parseStdinPayload(undefined), null);
  });

  test('handles CRLF-terminated valid JSON', () => {
    const obj = parseStdinPayload('{"a":1}\r\n');
    assert.equal(obj.a, 1);
  });

  test('handles LF-terminated valid JSON', () => {
    const obj = parseStdinPayload('{"a":1}\n');
    assert.equal(obj.a, 1);
  });
});

// =============================================================================
// Block B — parseEntranceCard
// =============================================================================
describe('parseEntranceCard', () => {
  test('extracts all rows from canonical fixture', () => {
    const parsed = parseEntranceCard(CANONICAL_ENTRANCE);
    assert.equal(parsed.missionState, '[MISSION COMPLETE]');
    assert.equal(parsed.activePersona, 'Architect');
    assert.equal(parsed.pipelinePhase, 'Ready');
    assert.equal(parsed.sessionCount, '4');
    assert.equal(parsed.lastArchSweep, 'Never (due in 1 session)');
  });

  test('returns "unknown" for missing row', () => {
    const fixture = CANONICAL_ENTRANCE.replace(/\| \*\*Active Persona\*\* \|.*\|/m, '');
    const parsed = parseEntranceCard(fixture);
    assert.equal(parsed.activePersona, 'unknown');
    assert.equal(parsed.missionState, '[MISSION COMPLETE]');
  });

  test('returns all unknown for non-table input', () => {
    const parsed = parseEntranceCard('# Just prose, no table');
    assert.equal(parsed.missionState, 'unknown');
    assert.equal(parsed.activePersona, 'unknown');
    assert.equal(parsed.pipelinePhase, 'unknown');
    assert.equal(parsed.sessionCount, 'unknown');
  });

  test('handles null input gracefully', () => {
    const parsed = parseEntranceCard(null);
    assert.equal(parsed.missionState, 'unknown');
    assert.equal(parsed.activePersona, 'unknown');
  });

  test('handles undefined input gracefully', () => {
    const parsed = parseEntranceCard(undefined);
    assert.equal(parsed.sessionCount, 'unknown');
  });

  test('trims surrounding whitespace from values', () => {
    const fixture = '| **Session Count** |    7   |';
    const parsed = parseEntranceCard(fixture);
    assert.equal(parsed.sessionCount, '7');
  });

  test('preserves brackets on Mission State for formatState consumption', () => {
    const parsed = parseEntranceCard(CANONICAL_ENTRANCE);
    assert.ok(parsed.missionState.startsWith('['));
    assert.ok(parsed.missionState.endsWith(']'));
  });
});

// =============================================================================
// Block C — resolveProjectDir
// =============================================================================
describe('resolveProjectDir', () => {
  test('prefers stdin workspace.project_dir when present', () => {
    const r = resolveProjectDir({
      stdinPayload: { workspace: { project_dir: '/from/stdin' } },
      env: { CLAUDE_PROJECT_DIR: '/from/env' },
      cwd: '/from/cwd',
    });
    assert.equal(r, '/from/stdin');
  });

  test('falls back to env when stdin payload missing project_dir', () => {
    const r = resolveProjectDir({
      stdinPayload: { workspace: {} },
      env: { CLAUDE_PROJECT_DIR: '/from/env' },
      cwd: '/from/cwd',
    });
    assert.equal(r, '/from/env');
  });

  test('falls back to cwd when stdin payload is null', () => {
    const r = resolveProjectDir({ stdinPayload: null, env: {}, cwd: '/from/cwd' });
    assert.equal(r, '/from/cwd');
  });

  test('falls back to cwd when stdin and env both empty', () => {
    const r = resolveProjectDir({
      stdinPayload: { workspace: {} },
      env: {},
      cwd: '/cwd',
    });
    assert.equal(r, '/cwd');
  });

  test('rejects empty-string stdin project_dir, falls to env', () => {
    const r = resolveProjectDir({
      stdinPayload: { workspace: { project_dir: '' } },
      env: { CLAUDE_PROJECT_DIR: '/env' },
      cwd: '/cwd',
    });
    assert.equal(r, '/env');
  });

  test('rejects empty-string env, falls to cwd', () => {
    const r = resolveProjectDir({
      stdinPayload: null,
      env: { CLAUDE_PROJECT_DIR: '' },
      cwd: '/cwd',
    });
    assert.equal(r, '/cwd');
  });
});

// =============================================================================
// Block D — formatPersona
// =============================================================================
describe('formatPersona', () => {
  for (const persona of ['Architect', 'Builder', 'Inspector', 'Archivist', 'Scout', 'Brain']) {
    test(`recognizes ${persona} with its canonical emoji and color`, () => {
      const r = formatPersona(persona);
      assert.equal(r.raw, persona);
      assert.equal(r.emoji, PERSONA_TABLE[persona].emoji);
      assert.match(r.color, /^\x1b\[\d+m$/);
    });
  }

  test('falls back on unknown persona', () => {
    const r = formatPersona('Wizard');
    assert.equal(r.raw, 'Unknown');
    assert.equal(r.emoji, '⚙️');
  });

  test('handles null gracefully', () => {
    assert.equal(formatPersona(null).raw, 'Unknown');
  });

  test('handles empty string gracefully', () => {
    assert.equal(formatPersona('').raw, 'Unknown');
  });

  test('trims surrounding whitespace before lookup', () => {
    const r = formatPersona('  Architect  ');
    assert.equal(r.raw, 'Architect');
  });
});

// =============================================================================
// Block E — formatState
// =============================================================================
describe('formatState', () => {
  const cases = [
    ['[BLANK CANVAS]', 'BLANK CANVAS'],
    ['[DOMAIN LOADED]', 'DOMAIN LOADED'],
    ['[IN-FLIGHT: Phase 1 — Architect — Plan approved]', 'IN-FLIGHT'],
    ['[MISSION COMPLETE]', 'MISSION COMPLETE'],
    ['[State Anomaly]', 'STATE ANOMALY'],
  ];

  for (const [input, label] of cases) {
    test(`matches variant ${label}`, () => {
      const r = formatState(input);
      assert.equal(r.label, label);
      assert.match(r.color, /^\x1b\[\d+m$/);
    });
  }

  test('falls back to UNPARSED on garbage', () => {
    assert.equal(formatState('garbage').label, 'UNPARSED');
  });

  test('falls back on null', () => {
    assert.equal(formatState(null).label, 'UNPARSED');
  });

  test('falls back on empty string', () => {
    assert.equal(formatState('').label, 'UNPARSED');
  });

  test('strips brackets implicitly via match (does not retain them in label)', () => {
    const r = formatState('[MISSION COMPLETE]');
    assert.ok(!r.label.includes('['));
    assert.ok(!r.label.includes(']'));
  });
});

// =============================================================================
// Block F — render
// =============================================================================
describe('render', () => {
  const baseEntrance = {
    missionState: '[MISSION COMPLETE]',
    activePersona: 'Architect',
    pipelinePhase: 'Ready',
    sessionCount: '4',
    lastArchSweep: 'Never',
  };

  test('renders all 4 fields with 3 separators', () => {
    const line = render({ entrance: baseEntrance });
    const visible = stripAnsi(line);
    assert.ok(visible.includes('Architect'));
    assert.ok(visible.includes('MISSION COMPLETE'));
    assert.ok(visible.includes('Ready'));
    assert.ok(visible.includes('#4'));
    const sepCount = (visible.match(/│/g) || []).length;
    assert.equal(sepCount, 3);
  });

  test('includes persona emoji', () => {
    const line = render({ entrance: baseEntrance });
    assert.ok(line.includes('🏛️'));
  });

  test('output contains ANSI color escape sequences', () => {
    const line = render({ entrance: baseEntrance });
    assert.match(line, /\x1b\[\d+m/);
  });

  for (const persona of Object.keys(PERSONA_TABLE)) {
    test(`renders persona ${persona} with its emoji and color`, () => {
      const line = render({ entrance: { ...baseEntrance, activePersona: persona } });
      assert.ok(line.includes(PERSONA_TABLE[persona].emoji));
      assert.ok(line.includes(PERSONA_TABLE[persona].color));
    });
  }

  for (const variant of STATE_VARIANTS) {
    const sample =
      variant.label === 'IN-FLIGHT' ? '[IN-FLIGHT: Phase 1]' :
      variant.label === 'STATE ANOMALY' ? '[State Anomaly]' :
      `[${variant.label}]`;
    test(`renders state variant ${variant.label} with its label and color`, () => {
      const line = render({ entrance: { ...baseEntrance, missionState: sample } });
      assert.ok(stripAnsi(line).includes(variant.label));
      assert.ok(line.includes(variant.color));
    });
  }

  test('width-cap truncates pathological input to exactly MAX visible chars ending in ...', () => {
    const huge = 'X'.repeat(500);
    const line = render({ entrance: { ...baseEntrance, pipelinePhase: huge } });
    const visible = stripAnsi(line);
    assert.equal(visible.length, 120);
    assert.ok(visible.endsWith('...'));
  });

  test('empty sessionCount renders as #?', () => {
    const line = render({ entrance: { ...baseEntrance, sessionCount: '' } });
    assert.ok(stripAnsi(line).includes('#?'));
  });

  test('empty pipelinePhase renders the — fallback', () => {
    const line = render({ entrance: { ...baseEntrance, pipelinePhase: '' } });
    assert.ok(stripAnsi(line).includes('—'));
  });

  test('returns FALLBACK_TEXT on internal failure (throwing proxy)', () => {
    const evilEntrance = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
      },
    );
    const r = render({ entrance: evilEntrance });
    assert.equal(r, FALLBACK_TEXT);
  });

  test('handles unknown persona gracefully (⚙️ + Unknown label)', () => {
    const line = render({ entrance: { ...baseEntrance, activePersona: 'Wizard' } });
    assert.ok(line.includes('⚙️'));
    assert.ok(stripAnsi(line).includes('Unknown'));
  });

  test('renders all 6 personas without throwing', () => {
    for (const p of Object.keys(PERSONA_TABLE)) {
      const line = render({ entrance: { ...baseEntrance, activePersona: p } });
      assert.notEqual(line, FALLBACK_TEXT);
    }
  });
});

// =============================================================================
// Block G — main end-to-end
// =============================================================================
describe('main', () => {
  test('happy path: stdin + readFileText → fully-formed line', async () => {
    const r = await main({
      stdinText: '{"workspace":{"project_dir":"/repo"}}',
      readFileText: async () => CANONICAL_ENTRANCE,
      env: {},
      cwd: '/cwd',
    });
    const visible = stripAnsi(r);
    assert.ok(visible.includes('Architect'));
    assert.ok(visible.includes('MISSION COMPLETE'));
    assert.ok(visible.includes('Ready'));
    assert.ok(visible.includes('#4'));
  });

  test('stdin parse failure: falls back to env path, still renders', async () => {
    let calledPath = '';
    const r = await main({
      stdinText: 'not json',
      readFileText: async (p) => {
        calledPath = p;
        return CANONICAL_ENTRANCE;
      },
      env: { CLAUDE_PROJECT_DIR: '/env-dir' },
      cwd: '/cwd',
    });
    assert.ok(calledPath.includes('env-dir'));
    assert.ok(stripAnsi(r).includes('Architect'));
  });

  test('readFileText throws ENOENT → FALLBACK_TEXT', async () => {
    const r = await main({
      stdinText: '{}',
      readFileText: async () => {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      },
      env: {},
      cwd: '/cwd',
    });
    assert.equal(r, FALLBACK_TEXT);
  });

  test('readFileText returns empty string → FALLBACK_TEXT', async () => {
    const r = await main({
      stdinText: '{}',
      readFileText: async () => '',
      env: {},
      cwd: '/cwd',
    });
    assert.equal(r, FALLBACK_TEXT);
  });

  test('readFileText returns non-table garbage → FALLBACK_TEXT', async () => {
    const r = await main({
      stdinText: '{}',
      readFileText: async () => '# Just prose\n\nNo table.',
      env: {},
      cwd: '/cwd',
    });
    assert.equal(r, FALLBACK_TEXT);
  });

  test('empty stdin still works via cwd fallback', async () => {
    const r = await main({
      stdinText: '',
      readFileText: async () => CANONICAL_ENTRANCE,
      env: {},
      cwd: '/cwd',
    });
    assert.ok(stripAnsi(r).includes('Architect'));
  });

  test('partial entrance card (only sessionCount known) still renders something', async () => {
    const partial = '| **Session Count** | 7 |';
    const r = await main({
      stdinText: '{}',
      readFileText: async () => partial,
      env: {},
      cwd: '/cwd',
    });
    // knownCount === 1 → render proceeds with partial fields
    assert.notEqual(r, FALLBACK_TEXT);
    assert.ok(stripAnsi(r).includes('#7'));
  });
});

// =============================================================================
// Block H — decorated Active-Persona cell + capLine boundary
// =============================================================================
describe('formatPersona — decorated cell', () => {
  test('resolves the real emoji-decorated cell to the canonical persona', () => {
    const r = formatPersona('🔨 Builder');
    assert.equal(r.raw, 'Builder');
    assert.equal(r.emoji, PERSONA_TABLE.Builder.emoji);
    assert.equal(r.color, PERSONA_TABLE.Builder.color);
  });

  test('resolves an emoji-decorated cell carrying a trailing note', () => {
    const r = formatPersona('🏛️ Architect *(in flight)*');
    assert.equal(r.raw, 'Architect');
    assert.equal(r.emoji, PERSONA_TABLE.Architect.emoji);
  });

  test('a decorated note mentioning another persona still resolves to the leading one', () => {
    const r = formatPersona('🏛️ Architect *(transitioned from Archivist)*');
    assert.equal(r.raw, 'Architect');
  });

  test('bare canonical names still resolve (fast path preserved)', () => {
    assert.equal(formatPersona('Scout').raw, 'Scout');
    assert.equal(formatPersona('  Inspector  ').raw, 'Inspector');
  });

  test('decorated unknown persona → ⚙️ Unknown without throwing', () => {
    const r = formatPersona('🤖 Overlord');
    assert.equal(r.raw, 'Unknown');
    assert.equal(r.emoji, '⚙️');
  });

  test('"Architecture rework" (word-boundary near-miss) → Unknown', () => {
    assert.equal(formatPersona('🏛️ Architecture rework').raw, 'Unknown');
  });
});

describe('render — decorated cell', () => {
  test('renders the real decorated cell with correct emoji + canonical name (not ⚙️ Unknown)', () => {
    const line = render({
      entrance: {
        missionState: '[IN-FLIGHT: builder]',
        activePersona: '🔨 Builder *(in flight)*',
        pipelinePhase: 'Builder',
        sessionCount: '6',
      },
    });
    const visible = stripAnsi(line);
    assert.ok(visible.includes('🔨'));
    assert.ok(visible.includes('Builder'));
    assert.ok(!visible.includes('Unknown'));
    assert.ok(!visible.includes('⚙️'));
  });
});

describe('capLine — boundary (FA-7)', () => {
  test('a line at exactly MAX visible chars is returned unchanged', () => {
    const exact = 'Y'.repeat(120);
    assert.equal(capLine(exact), exact);
  });

  test('a line at MAX+1 is truncated to MAX visible chars and ends with the ellipsis', () => {
    const over = 'Y'.repeat(121);
    const capped = capLine(over);
    assert.equal(stripAnsi(capped).length, 120);
    assert.ok(capped.endsWith(ELLIPSIS));
  });
});
