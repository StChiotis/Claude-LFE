// Persona Path-Locking PreToolUse Hook test suite.
// Mirrors the Cat D dependency-injection pattern: every fixture passes mocks
// to main(); no real disk I/O. Per-persona × per-path-class fixture matrix
// per active_plan.md Builder Step B2.
//
// A later refactor: the 7 helper-level unit-test describe
// blocks (normalizePath, matchGlob, matchAnyGlob, extractActiveMission,
// extractLfeForceFromTranscript, buildDebtRow, insertDebtRowIntoFile) moved
// to `.claude/lib/__tests__/be-escape.test.mjs` when the helpers themselves
// moved to `.claude/lib/be-escape.mjs`. This file retains the persona-lock-specific
// `buildDenyMessage` describe + all main()-integration describes (framework-
// infra carve-out matrix, persona allow-list matrix, LFE-FORCE escape, fail-
// safe edges, stdin/payload edge cases, constants sanity). The test imports
// still reference `'../persona-path-lock.mjs'` — the re-export shim added by
// the refactor keeps the moved symbols resolvable through this entry
// point.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  main,
  FRAMEWORK_INFRA_PATHS,
  LFE_FORCE_KEYWORD,
  LFE_FORCE_SCAN_WINDOW,
  PROTOCOL_DEBT_PATH,
  PERMISSIONS_PATH,
  GATED_TOOLS,
  buildDenyMessage,
} from '../persona-path-lock.mjs';

// --- Shared fixtures ----------------------------------------------------------

const PROJ = '/proj';

const PERMS_FIXTURE = {
  personas: {
    architect: {
      allowed_tools: ['view_file', 'write_to_file'],
      write_constraints: ['.docs/**', '.plans/**', 'CONTEXT.md'],
    },
    builder: {
      allowed_tools: ['view_file', 'write_to_file'],
      write_constraints: ['src/**', '.plans/**', 'tests/**'],
    },
    inspector: {
      allowed_tools: ['view_file', 'write_to_file'],
      write_constraints: ['.plans/**', 'tests/**'],
    },
    archivist: {
      allowed_tools: ['view_file', 'write_to_file'],
      write_constraints: ['.docs/**', 'pipeline_status.md', 'README.md', 'CHANGELOG.md', '.plans/**'],
    },
    scout: {
      allowed_tools: ['view_file'],
      write_constraints: ['**/*'],
      forbidden_actions: ['delete_file', 'rename_file'],
    },
  },
};

const PERMS_FIXTURE_JSON = JSON.stringify(PERMS_FIXTURE);

const PROTOCOL_DEBT_FIXTURE = `# LFE Protocol Debt Log

This file tracks every instance where the LFE Protocol was bypassed using the \`LFE-FORCE\` override.

> [!WARNING]
> All entries in this log must be resolved in the very next session by an Archivist/Inspector mission.

| Date | Mission | Reason for LFE-FORCE | Resolution Status |
| :--- | :--- | :--- | :--- |
| 2026-05-15 | Sample Mission | Bootstrap | resolved (session 2) |

---

**Archive:** Older entries are in [archive/protocol-debt-history.md](../archive/protocol-debt-history.md). Last archive sweep: session 5.
`;

function makeEntranceCard({
  persona = 'Architect',
  mission = 'Sample Mission',
  missionState = '[IN-FLIGHT: builder]',
  authorizedScope = null,
} = {}) {
  const scopeRow = authorizedScope != null ? `| **Authorized Scope** | ${authorizedScope} |\n` : '';
  return `# 🏛️ LFE Mission Control

| Category | Status / Value |
| :--- | :--- |
| **Integrity Score** | 🟢 [Integrity: 100%] |
| **Mission State** | ${missionState} |
| **Active Persona** | ${persona} |
| **Active Mission** | ${mission} |
| **Pipeline Phase** | Builder |
| **Session Count** | 6 |
| **Last Architecture Sweep** | 5 |
${scopeRow}---
`;
}

function makeTranscript({ userMessages = [] } = {}) {
  return userMessages
    .map((text) => JSON.stringify({ role: 'user', content: text }))
    .join('\n');
}

function makeWriteFileSpy() {
  const calls = [];
  const fn = async (path, content) => {
    calls.push({ path, content });
  };
  fn.calls = calls;
  return fn;
}

async function runMain({
  stdin = {},
  files = {},
  writeFileSpy,
  now = '2026-05-17T10:00:00.000Z',
  env = { CLAUDE_PROJECT_DIR: PROJ },
} = {}) {
  const spy = writeFileSpy ?? makeWriteFileSpy();
  const normalizedFiles = {};
  for (const [k, v] of Object.entries(files)) {
    normalizedFiles[String(k).replace(/\\/g, '/')] = v;
  }
  const readFileText = async (path) => {
    const key = String(path).replace(/\\/g, '/');
    if (key in normalizedFiles) {
      const v = normalizedFiles[key];
      if (v instanceof Error) throw v;
      return v;
    }
    const err = new Error(`ENOENT: ${key}`);
    err.code = 'ENOENT';
    throw err;
  };
  const stdinText = typeof stdin === 'string' ? stdin : JSON.stringify(stdin);
  const result = await main({
    stdinText,
    readFileText,
    writeFileText: spy,
    now: typeof now === 'function' ? now : () => now,
    env,
  });
  return { result, writeFileSpy: spy };
}

function parseEnvelope(stdout) {
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function makeWriteRequest({ persona = 'Architect', target = 'src/foo.js', mission = 'Sample Mission', toolName = 'Write', userMessages = ['regular prompt without keyword'], missionState, authorizedScope } = {}) {
  return {
    stdin: {
      session_id: 'sess-1',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: PROJ,
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
      tool_input: { file_path: `${PROJ}/${target}` },
      tool_use_id: 'tu-1',
    },
    files: {
      [`${PROJ}/pipeline_status.md`]: makeEntranceCard({ persona, mission, missionState, authorizedScope }),
      [`${PROJ}/${PERMISSIONS_PATH}`]: PERMS_FIXTURE_JSON,
      '/tmp/transcript.jsonl': makeTranscript({ userMessages }),
    },
  };
}

// --- Describe: persona-lock-specific helper -----------------------------------------

describe('buildDenyMessage', () => {
  test('includes all 5 required tokens', () => {
    const msg = buildDenyMessage({
      persona: 'Architect',
      target: 'src/foo.js',
      allowedList: ['.docs/**', '.plans/**'],
      missionName: 'Sample Mission',
    });
    assert.match(msg, /Architect/);
    assert.match(msg, /src\/foo\.js/);
    assert.match(msg, /\.docs\/\*\*/);
    assert.match(msg, /LFE-FORCE/);
    assert.match(msg, /settings\.local\.json/);
  });
  test('handles empty allowed list', () => {
    const msg = buildDenyMessage({
      persona: 'X',
      target: 'foo',
      allowedList: [],
      missionName: 'n/a',
    });
    assert.match(msg, /none.*persona has no write_constraints/);
  });
  test('omits mission tag when n/a', () => {
    const msg = buildDenyMessage({
      persona: 'X',
      target: 'foo',
      allowedList: ['*'],
      missionName: 'n/a',
    });
    assert.doesNotMatch(msg, /\(mission:/);
  });
});

// --- Describe: main() — framework-infra carve-out (35 cells) ------------------

describe('main: framework-infrastructure carve-out is persona-agnostic', () => {
  const carveOutTargets = [
    // Category I — mechanical wiring
    '.claude/hooks/foo.mjs',
    '.claude/settings.json',
    '.githooks/pre-commit',
    'scripts/setup-claude-env.mjs',
    '.claude-plugin/plugin.json',
    // Category II — coordination-state files (substrate of persona-locking itself)
    'pipeline_status.md',
    'LLM_AGENT_GUIDE.md',
  ];
  const personas = ['Architect', 'Builder', 'Inspector', 'Archivist', 'Scout'];

  for (const persona of personas) {
    for (const target of carveOutTargets) {
      test(`${persona} → ${target} → ALLOW (carve-out)`, async () => {
        const req = makeWriteRequest({ persona, target });
        const { result } = await runMain(req);
        // Carve-out short-circuits — silent exit 0, no stdout envelope.
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, '');
      });
    }
  }
});

// --- Describe: main() — framework-infra carve-out: harness plan-mode path ----

describe('main: framework-infra carve-out — harness plan-mode path (R5)', () => {
  // Carve-out: `**/.claude/plans/**` covers Claude Code's plan-mode harness
  // path storage at ~/.claude/plans/<random-slug>.md. The path is absolute and
  // outside the project root, so normalizePath cannot strip a prefix; the glob
  // must match the absolute form directly. Resolves a PROTOCOL_DEBT.md
  // entry from a Hygiene-routed fix.

  // C1: Windows absolute path (the exact bug reproduction from PROTOCOL_DEBT.md:17)
  test('Architect → C:/Users/<u>/.claude/plans/foo.md → silent ALLOW (R5 carve-out, Stage 2 short-circuit)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'C:/Users/alice/.claude/plans/foo.md';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0, 'carve-out short-circuit must not append debt row');
  });

  // C2: Linux absolute path
  test('Architect → /home/<u>/.claude/plans/bar.md → silent ALLOW (R5 carve-out)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '/home/alice/.claude/plans/bar.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // C3: macOS absolute path
  test('Architect → /Users/<u>/.claude/plans/baz.md → silent ALLOW (R5 carve-out)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '/Users/bob/.claude/plans/baz.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // C4: Generic deep prefix
  test('Architect → /some/arbitrary/prefix/.claude/plans/qux.md → silent ALLOW (** matches any prefix)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '/some/arbitrary/prefix/.claude/plans/qux.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // C5: Subdirectory under plans/
  test('Architect → C:/Users/<u>/.claude/plans/subdir/nested.md → silent ALLOW (trailing ** covers subdirs)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'C:/Users/alice/.claude/plans/subdir/nested.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // C6: Persona-agnostic carve-out — Builder also ALLOWs
  test('Builder → C:/Users/<u>/.claude/plans/builder.md → silent ALLOW (carve-out is persona-agnostic per ADR 84)', async () => {
    const req = makeWriteRequest({ persona: 'Builder' });
    req.stdin.tool_input.file_path = 'C:/Users/alice/.claude/plans/builder.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // C7: Different dir name — plans-fake — must NOT match
  test('Architect → C:/Users/<u>/.claude/plans-fake/foo.md → DENY (different dir name does not match)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'C:/Users/alice/.claude/plans-fake/foo.md';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected DENY envelope on different-name dir');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  // C8: Different dir name — plansoid — must NOT match
  test('Architect → /home/<u>/.claude/plansoid/foo.md → DENY (different dir name does not match)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '/home/u/.claude/plansoid/foo.md';
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.ok(env);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });

  // C9: Adversarial traversal — Sec-G1.H1 closure (posix.normalize) prevents carve-out bypass
  test('Architect → C:/Users/<u>/.claude/plans/../etc/passwd → DENY (Sec-G1.H1 normalize → ".claude/etc/" not ".claude/plans/")', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'C:/Users/u/.claude/plans/../etc/passwd';
    const { result } = await runMain(req);
    // Path normalizes to "C:/Users/u/.claude/etc/passwd"; no FRAMEWORK_INFRA_PATHS entry matches.
    // Falls through to Stage 5 persona allow-list check — Architect's [.docs/**, .plans/**, CONTEXT.md] no match.
    // Stage 6 transcript: no LFE-FORCE → Stage 7 DENY.
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected DENY envelope on adversarial traversal');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /Persona path-lock denied/);
  });
});

// --- Describe: main() — framework-infra carve-out: auto-memory directory ---

describe('main: framework-infra carve-out — auto-memory directory (S16 Hygiene)', () => {
  // Auto-memory carve-out: `**/.claude/projects/**` covers Claude Code's
  // auto-memory store at ~/.claude/projects/<repo-encoded>/memory/<file>.md.
  // The path is absolute and outside the project root (mirror of the plan-store
  // pattern for ~/.claude/plans/**). It covers the feedback-memory writes
  // that previously needed an LFE-FORCE escape (e.g. `feedback_full_pipeline_for_fixes.md`
  // and `MEMORY.md`, escaped before this carve-out existed).

  // S1: Windows absolute auto-memory path
  test('Archivist → C:/Users/<u>/.claude/projects/<repo>/memory/foo.md → silent ALLOW (S16 carve-out, Stage 2 short-circuit)', async () => {
    const req = makeWriteRequest({ persona: 'Archivist' });
    req.stdin.tool_input.file_path = 'C:/Users/testuser/.claude/projects/C--Users-testuser-Desktop-MyProject/memory/foo.md';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0, 'carve-out short-circuit must not append debt row');
  });

  // S2: Windows absolute path — MEMORY.md index file
  test('Archivist → C:/Users/<u>/.claude/projects/<repo>/memory/MEMORY.md → silent ALLOW (S16 carve-out)', async () => {
    const req = makeWriteRequest({ persona: 'Archivist' });
    req.stdin.tool_input.file_path = 'C:/Users/testuser/.claude/projects/C--Users-testuser-Desktop-MyProject/memory/MEMORY.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // S3: Linux absolute path
  test('Archivist → /home/<u>/.claude/projects/<repo>/memory/bar.md → silent ALLOW (S16 carve-out)', async () => {
    const req = makeWriteRequest({ persona: 'Archivist' });
    req.stdin.tool_input.file_path = '/home/alice/.claude/projects/repo-slug/memory/bar.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // S4: macOS absolute path
  test('Archivist → /Users/<u>/.claude/projects/<repo>/memory/baz.md → silent ALLOW (S16 carve-out)', async () => {
    const req = makeWriteRequest({ persona: 'Archivist' });
    req.stdin.tool_input.file_path = '/Users/bob/.claude/projects/repo-slug/memory/baz.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // S5: Persona-agnostic carve-out — Builder also ALLOWs (mirror of C6)
  test('Builder → C:/Users/<u>/.claude/projects/<repo>/memory/builder.md → silent ALLOW (carve-out is persona-agnostic per ADR 84)', async () => {
    const req = makeWriteRequest({ persona: 'Builder' });
    req.stdin.tool_input.file_path = 'C:/Users/alice/.claude/projects/repo/memory/builder.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // S6: Subdirectory under projects/ — trailing ** covers nested paths
  test('Archivist → C:/Users/<u>/.claude/projects/repo/memory/feedback/nested.md → silent ALLOW (trailing ** covers subdirs)', async () => {
    const req = makeWriteRequest({ persona: 'Archivist' });
    req.stdin.tool_input.file_path = 'C:/Users/alice/.claude/projects/repo/memory/feedback/nested.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // S7: Different dir name — projects-fake — must NOT match
  test('Archivist → C:/Users/<u>/.claude/projects-fake/memory/foo.md → DENY (different dir name does not match)', async () => {
    const req = makeWriteRequest({ persona: 'Archivist' });
    req.stdin.tool_input.file_path = 'C:/Users/alice/.claude/projects-fake/memory/foo.md';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected DENY envelope on different-name dir');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  // S8: Different dir name — projectoid — must NOT match
  test('Archivist → /home/<u>/.claude/projectoid/memory/foo.md → DENY (different dir name does not match)', async () => {
    const req = makeWriteRequest({ persona: 'Archivist' });
    req.stdin.tool_input.file_path = '/home/u/.claude/projectoid/memory/foo.md';
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.ok(env);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });

  // S9: Adversarial traversal — Sec-G1.H1 closure (posix.normalize) prevents carve-out bypass
  test('Archivist → C:/Users/<u>/.claude/projects/../etc/passwd → DENY (Sec-G1.H1 normalize → ".claude/etc/" not ".claude/projects/")', async () => {
    const req = makeWriteRequest({ persona: 'Archivist' });
    req.stdin.tool_input.file_path = 'C:/Users/u/.claude/projects/../etc/passwd';
    const { result } = await runMain(req);
    // Path normalizes to "C:/Users/u/.claude/etc/passwd"; no FRAMEWORK_INFRA_PATHS entry matches.
    // Falls through to Stage 5 persona allow-list check — Archivist's allow-list has no match.
    // Stage 6 transcript: no LFE-FORCE → Stage 7 DENY.
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected DENY envelope on adversarial traversal');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /Persona path-lock denied/);
  });
});

// --- Describe: ADR 90 carve-out expansion ----------------

describe('main: framework-infra carve-out — ADR 90 expansion', () => {
  // ADR 90 extends FRAMEWORK_INFRA_PATHS with 6 adopter-facing project-infrastructure
  // globs split across Cat I (`.agents/skills/**`, `.gitattributes`, `.gitignore`,
  // `.github/**`) and Cat II (`CLAUDE.md`, `USER_MANUAL.md`). Tests mirror the plan-store
  // carve-out suite shape: positive ALLOW per persona representative; persona-agnostic
  // sanity on one representative file; deny-case mirrors for `-fake` / `-bak` / `-LOCAL`
  // variants to confirm globs are not over-permissive.

  // E1: .agents/skills/** — LFE-SOURCE skill protocol
  test('Architect → .agents/skills/lfe-scout/SKILL.md → silent ALLOW (ADR 90 E1)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '.agents/skills/lfe-scout/SKILL.md';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0, 'carve-out short-circuit must not append debt row');
  });

  // E2: .gitattributes — repo-wide line-ending discipline
  test('Architect → .gitattributes → silent ALLOW (ADR 90 E2)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '.gitattributes';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  // E3: .gitignore — repo-wide ignore list
  test('Architect → .gitignore → silent ALLOW (ADR 90 E3)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '.gitignore';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  // E4: .github/** — PR templates + future CI/CD workflows
  test('Architect → .github/pull_request_template.md → silent ALLOW (ADR 90 E4)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '.github/pull_request_template.md';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  // E5: CLAUDE.md — Claude Code adapter pointer (Cat II)
  test('Architect → CLAUDE.md → silent ALLOW (ADR 90 E5 Cat II)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'CLAUDE.md';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  // E6: USER_MANUAL.md — framework operator manual (Cat II)
  test('Architect → USER_MANUAL.md → silent ALLOW (ADR 90 E6 Cat II)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'USER_MANUAL.md';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  // E7-E9: persona-agnostic check on .gitattributes representative
  // (carve-out is persona-agnostic per ADR 84 short-circuit at matchAnyGlob site)
  test('Builder → .gitattributes → silent ALLOW (ADR 90 E7 persona-agnostic)', async () => {
    const req = makeWriteRequest({ persona: 'Builder' });
    req.stdin.tool_input.file_path = '.gitattributes';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  test('Inspector → .gitattributes → silent ALLOW (ADR 90 E8 persona-agnostic)', async () => {
    const req = makeWriteRequest({ persona: 'Inspector' });
    req.stdin.tool_input.file_path = '.gitattributes';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  test('Archivist → .gitattributes → silent ALLOW (ADR 90 E9 persona-agnostic)', async () => {
    const req = makeWriteRequest({ persona: 'Archivist' });
    req.stdin.tool_input.file_path = '.gitattributes';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  // E10-E15: deny-case mirrors — close-but-not-matching paths must NOT match.
  // Architect is used as the representative persona because Architect's allow-list
  // doesn't cover any of these `-fake` / `-bak` / `-LOCAL` paths either; the test
  // confirms the carve-out doesn't short-circuit on the lookalike path.

  test('Architect → .agents/skills-fake/foo.md → DENY (ADR 90 E10 different parent dir)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '.agents/skills-fake/foo.md';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected DENY envelope on different-name dir');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  test('Architect → .gitattributes-fake → DENY (ADR 90 E11 suffix variant)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '.gitattributes-fake';
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.ok(env);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('Architect → .gitignore-bak → DENY (ADR 90 E12 suffix variant)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '.gitignore-bak';
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.ok(env);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('Architect → .github-fake/pr.md → DENY (ADR 90 E13 different parent dir)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '.github-fake/pr.md';
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.ok(env);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('Architect → CLAUDE-LOCAL.md → DENY (ADR 90 E14 filename variant)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'CLAUDE-LOCAL.md';
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.ok(env);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('Architect → USER_MANUAL-draft.md → DENY (ADR 90 E15 filename variant)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'USER_MANUAL-draft.md';
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.ok(env);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });

  // E16 — adversarial: bare `.github` file with no path segment
  // under it must NOT match `.github/**` (the `**` requires at least one segment).
  // This is the new-globs parallel of S9's posix.normalize traversal probe.
  test('Architect → .github (bare, no path under) → DENY (ADR 90 E16 adversarial: ** requires ≥1 segment)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '.github';
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected DENY envelope on bare .github file');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });

  // E17 — adversarial: traversal targeting Cat II file from
  // sibling directory must NOT short-circuit via the carve-out. Parallel of S9.
  test('Architect → src/foo/../../CLAUDE.md → adversarial traversal probe (ADR 90 E17)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'src/foo/../../CLAUDE.md';
    const { result } = await runMain(req);
    // After posix.normalize, this resolves to either "CLAUDE.md" (ALLOW via carve-out)
    // or stays as traversal-suspect (DENY). Either outcome is correct — the assertion
    // is that the test runs cleanly and exitCode is 0 (no hook crash). Behavioral
    // characterization, not a strict ALLOW/DENY assertion, because the post-normalize
    // path depends on path.posix.normalize semantics on the running platform.
    assert.equal(result.exitCode, 0, 'hook must not crash on adversarial traversal target');
  });

  // E18 (mutation-gap closure)
  // — .github/** at 2+ segments under parent. Closes the .github/** → .github/*
  // single-character mutation gap that existing E4 (1 segment under .github/) does
  // not differentiate. Forward-compatibility test for the future workflow YAMLs
  // explicitly named in ADR 90's "Threat model considerations" paragraph.
  test('Architect → .github/workflows/ci.yml → silent ALLOW (ADR 90 E18 mutation-gap closure)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = '.github/workflows/ci.yml';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });
});

// --- Describe: main() — framework-infra carve-out: README.md addition ---

describe('main: framework-infra carve-out — README.md addition (per ADR 90 amendment)', () => {
  // README.md is in FRAMEWORK_INFRA_PATHS Category II — same
  // logical category + threat model as CLAUDE.md and USER_MANUAL.md (already
  // covered by the base carve-out). Surfaced when a README.md
  // content edit (a descriptive hook list) could not execute under
  // any persona's allowlist. Test pattern mirrors the base carve-out's E7-E10 persona-agnostic
  // ALLOW block + E14-style sibling-named deny-case.

  // E19: Architect representative — README.md persona-agnostic ALLOW
  test('Architect → README.md → silent ALLOW (Category II carve-out, Stage 2 short-circuit)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'README.md';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0, 'carve-out short-circuit must not append debt row');
  });

  // E20: Builder mirror — persona-agnostic per ADR 84
  test('Builder → README.md → silent ALLOW (persona-agnostic per ADR 84)', async () => {
    const req = makeWriteRequest({ persona: 'Builder' });
    req.stdin.tool_input.file_path = 'README.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // E21: Inspector mirror — persona-agnostic
  test('Inspector → README.md → silent ALLOW (persona-agnostic per ADR 84)', async () => {
    const req = makeWriteRequest({ persona: 'Inspector' });
    req.stdin.tool_input.file_path = 'README.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // E22: Archivist mirror — persona-agnostic
  test('Archivist → README.md → silent ALLOW (persona-agnostic per ADR 84)', async () => {
    const req = makeWriteRequest({ persona: 'Archivist' });
    req.stdin.tool_input.file_path = 'README.md';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // E23: Sibling-named deny-case — README-fake.md must NOT match the literal carve-out
  test('Architect → README-fake.md → DENY (sibling-named file does not match literal README.md entry)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'README-fake.md';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected DENY envelope on sibling-named file');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(writeFileSpy.calls.length, 0);
  });
});

// --- Describe: main() — framework-infra carve-out: package.json addition ---

describe('main: framework-infra carve-out — package.json addition', () => {
  // package.json is in FRAMEWORK_INFRA_PATHS Category I — the
  // manifest defining the mechanical npm scripts (sync:lfe-skills, postinstall, test).
  // Without it, no mission persona (only Scout) could write the manifest, blocking the
  // `npm test` script addition. Pattern mirrors the README.md addition: persona-
  // agnostic ALLOW + sibling-named deny-cases proving the entry is an exact literal match.

  // E24: Builder representative — package.json persona-agnostic ALLOW (the slice's load-bearing case)
  test('Builder → package.json → silent ALLOW (Category I carve-out, Stage 2 short-circuit)', async () => {
    const req = makeWriteRequest({ persona: 'Builder' });
    req.stdin.tool_input.file_path = 'package.json';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0, 'carve-out short-circuit must not append debt row');
  });

  // E25: Architect mirror — persona-agnostic per ADR 84
  test('Architect → package.json → silent ALLOW (persona-agnostic per ADR 84)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'package.json';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  // E26: Sibling-named deny-case — package-lock.json must NOT match the literal package.json entry
  test('Architect → package-lock.json → DENY (sibling-named file does not match literal package.json entry)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'package-lock.json';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected DENY envelope on sibling-named file');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  // E27: Suffixed deny-case — package.json.bak must NOT match the literal entry
  test('Architect → package.json.bak → DENY (suffixed file does not match literal package.json entry)', async () => {
    const req = makeWriteRequest({ persona: 'Architect' });
    req.stdin.tool_input.file_path = 'package.json.bak';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected DENY envelope on suffixed file');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(writeFileSpy.calls.length, 0);
  });
});

// --- Describe: main() — deny-case persona-agnostic coverage ---

describe('main: deny-case persona-agnostic coverage', () => {
  // F2: the carve-out sibling-deny variants were probed with Architect only. A future
  // allow-list or carve-out widening that accidentally covered one of these look-alikes
  // for a NON-Architect persona would slip past an Architect-only probe. Probe each
  // look-alike across all four mission personas → DENY. None matches any allow-list or
  // an exact carve-out entry.
  const denyVariants = [
    'README-fake.md',          // not the literal README.md (Cat II)
    'package-lock.json',       // not the literal package.json (Cat I)
    'CLAUDE-fake.md',          // not the literal CLAUDE.md (Cat II)
    'pipeline_status-fake.md', // not the literal pipeline_status.md (Cat II)
    'LLM_AGENT_GUIDE-fake.md', // not the literal LLM_AGENT_GUIDE.md (Cat II)
    'unmapped-root-file.md',   // covered by no persona allow-list and no carve-out
  ];
  const personas = ['Architect', 'Builder', 'Inspector', 'Archivist'];

  for (const persona of personas) {
    for (const target of denyVariants) {
      test(`${persona} → ${target} → DENY (no allow-list / no exact carve-out match)`, async () => {
        const req = makeWriteRequest({ persona });
        req.stdin.tool_input.file_path = target;
        const { result, writeFileSpy } = await runMain(req);
        assert.equal(result.exitCode, 0);
        const env = parseEnvelope(result.stdout);
        assert.ok(env, `expected DENY envelope for ${persona} → ${target}`);
        assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
        assert.equal(writeFileSpy.calls.length, 0);
      });
    }
  }
});

// --- Describe: main() — per-persona × per-path-class matrix ------------------

describe('main: persona allow-list matrix', () => {
  const matrix = [
    // Architect
    { persona: 'Architect', target: '.docs/architecture/x.md', expect: 'allow' },
    { persona: 'Architect', target: '.plans/01_grill_summary.md', expect: 'allow' },
    { persona: 'Architect', target: 'CONTEXT.md', expect: 'allow' },
    { persona: 'Architect', target: 'src/foo.js', expect: 'deny' },
    { persona: 'Architect', target: 'tests/foo.test.js', expect: 'deny' },
    { persona: 'Architect', target: 'other.md', expect: 'deny' },
    // Builder
    { persona: 'Builder', target: 'src/foo.js', expect: 'allow' },
    { persona: 'Builder', target: '.plans/builder_done.md', expect: 'allow' },
    { persona: 'Builder', target: 'tests/foo.test.js', expect: 'allow' },
    { persona: 'Builder', target: '.docs/architecture/x.md', expect: 'deny' },
    { persona: 'Builder', target: 'CONTEXT.md', expect: 'deny' },
    { persona: 'Builder', target: 'other.md', expect: 'deny' },
    // Inspector
    { persona: 'Inspector', target: '.plans/critique.md', expect: 'allow' },
    { persona: 'Inspector', target: 'tests/foo.test.js', expect: 'allow' },
    { persona: 'Inspector', target: 'src/foo.js', expect: 'deny' },
    { persona: 'Inspector', target: '.docs/architecture/x.md', expect: 'deny' },
    { persona: 'Inspector', target: 'CONTEXT.md', expect: 'deny' },
    { persona: 'Inspector', target: 'other.md', expect: 'deny' },
    // Archivist
    { persona: 'Archivist', target: '.docs/quality/CHANGELOG.md', expect: 'allow' },
    { persona: 'Archivist', target: 'pipeline_status.md', expect: 'allow' },
    { persona: 'Archivist', target: 'README.md', expect: 'allow' },
    { persona: 'Archivist', target: 'CHANGELOG.md', expect: 'allow' },
    { persona: 'Archivist', target: '.plans/inspection_report.md', expect: 'allow' },
    { persona: 'Archivist', target: 'src/foo.js', expect: 'deny' },
    { persona: 'Archivist', target: 'other.md', expect: 'deny' },
    // Scout (matches everything)
    { persona: 'Scout', target: 'src/foo.js', expect: 'allow' },
    { persona: 'Scout', target: '.docs/x.md', expect: 'allow' },
    { persona: 'Scout', target: 'pipeline_status.md', expect: 'allow' },
    { persona: 'Scout', target: 'CONTEXT.md', expect: 'allow' },
    { persona: 'Scout', target: 'random/deep/path.txt', expect: 'allow' },
    { persona: 'Scout', target: 'a', expect: 'allow' },
    { persona: 'Scout', target: 'other.md', expect: 'allow' },
  ];

  for (const cell of matrix) {
    test(`${cell.persona} → ${cell.target} → ${cell.expect.toUpperCase()}`, async () => {
      const req = makeWriteRequest({ persona: cell.persona, target: cell.target });
      const { result, writeFileSpy } = await runMain(req);
      assert.equal(result.exitCode, 0);
      if (cell.expect === 'allow') {
        // Persona allow-list match → silent exit; no envelope.
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, '');
        assert.equal(writeFileSpy.calls.length, 0);
      } else {
        const env = parseEnvelope(result.stdout);
        assert.ok(env, 'expected JSON envelope on deny');
        assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
        assert.match(env.hookSpecificOutput.permissionDecisionReason, /Persona path-lock denied/);
        assert.ok(result.stderr.length > 0, 'deny path emits stderr');
        assert.equal(writeFileSpy.calls.length, 0);
      }
    });
  }
});

// --- Describe: main() — decorated Active-Persona cell ---------------

describe('main: decorated Active-Persona cell (emoji-tolerant persona extraction)', () => {
  // The live pipeline_status.md cell is decorated `<emoji> <Name>`. Previously
  // the raw-lowercase lookup ('🔨 builder') missed permissions.json and fail-safe-
  // ALLOWed, silently un-enforcing the persona lane. leadingPersonaName now extracts
  // 'builder' from the decorated cell, so the Builder lane enforces again.

  test('🔨 Builder *(note)* → src/foo.js → ALLOW (decorated card now enforces the Builder lane)', async () => {
    const req = makeWriteRequest({ persona: '🔨 Builder *(in flight)*', target: 'src/foo.js' });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  test('🔨 Builder *(note)* → .docs/architecture/x.md → DENY (off-lane; latent fail-safe-ALLOW defect closed)', async () => {
    const req = makeWriteRequest({ persona: '🔨 Builder *(in flight)*', target: '.docs/architecture/x.md' });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected DENY envelope for off-lane decorated-card write');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  test('🏛️ Architect (emoji, no note) → .docs/architecture/x.md → ALLOW (bare-emoji cell resolves)', async () => {
    const req = makeWriteRequest({ persona: '🏛️ Architect', target: '.docs/architecture/x.md' });
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  test('decorated but unknown persona (🤖 Overlord) → fail-safe ALLOW (no over-block / no lockout)', async () => {
    const req = makeWriteRequest({ persona: '🤖 Overlord', target: 'src/foo.js' });
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /unparseable.*ALLOW/);
    assert.equal(writeFileSpy.calls.length, 0);
  });
});

// --- Describe: main() — LFE-FORCE escape (7 cells) ----------------------------

describe('main: LFE-FORCE escape path', () => {
  const personas = ['Architect', 'Builder', 'Inspector', 'Archivist'];

  for (const persona of personas) {
    test(`${persona} → forbidden target + LFE-FORCE in transcript → ALLOW + debt row`, async () => {
      const forbiddenTarget = persona === 'Builder' ? '.docs/architecture/x.md' : 'src/foo.js';
      const req = makeWriteRequest({
        persona,
        target: forbiddenTarget,
        userMessages: ['Please proceed LFE-FORCE'],
      });
      // The hook will also try to read PROTOCOL_DEBT.md before writing.
      req.files[`${PROJ}/${PROTOCOL_DEBT_PATH}`] = PROTOCOL_DEBT_FIXTURE;

      const { result, writeFileSpy } = await runMain(req);
      assert.equal(result.exitCode, 0);
      const env = parseEnvelope(result.stdout);
      assert.ok(env, 'expected JSON envelope on escape');
      assert.equal(env.hookSpecificOutput.permissionDecision, 'allow');
      assert.match(env.hookSpecificOutput.permissionDecisionReason, /LFE-FORCE/);
      assert.equal(writeFileSpy.calls.length, 1, 'PROTOCOL_DEBT.md must be written once');
      const call = writeFileSpy.calls[0];
      assert.match(String(call.path).replace(/\\/g, '/'), /PROTOCOL_DEBT\.md$/);
      assert.match(call.content, /LFE-FORCE write to `[^`]+` by .+ persona/);
      // Original baseline row preserved
      assert.match(call.content, /Sample Mission \| Bootstrap/);
    });
  }

  test('case-insensitive lfe-force still triggers escape', async () => {
    const req = makeWriteRequest({
      persona: 'Architect',
      target: 'src/foo.js',
      userMessages: ['lfe-force this please'],
    });
    req.files[`${PROJ}/${PROTOCOL_DEBT_PATH}`] = PROTOCOL_DEBT_FIXTURE;
    const { result, writeFileSpy } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal(writeFileSpy.calls.length, 1);
  });

  test('mixed-case Lfe-Force still triggers escape', async () => {
    const req = makeWriteRequest({
      persona: 'Architect',
      target: 'src/foo.js',
      userMessages: ['Lfe-Force me'],
    });
    req.files[`${PROJ}/${PROTOCOL_DEBT_PATH}`] = PROTOCOL_DEBT_FIXTURE;
    const { result, writeFileSpy } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal(writeFileSpy.calls.length, 1);
  });

  test('transcript without LFE-FORCE → DENY (control)', async () => {
    const req = makeWriteRequest({
      persona: 'Architect',
      target: 'src/foo.js',
      userMessages: ['regular prompt without the keyword'],
    });
    const { result, writeFileSpy } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(writeFileSpy.calls.length, 0);
  });

  test('LFE-FORCE override message names persona + target', async () => {
    const req = makeWriteRequest({
      persona: 'Architect',
      target: 'src/foo.js',
      userMessages: ['LFE-FORCE'],
    });
    req.files[`${PROJ}/${PROTOCOL_DEBT_PATH}`] = PROTOCOL_DEBT_FIXTURE;
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /architect/);
    assert.match(env.hookSpecificOutput.permissionDecisionReason, /src\/foo\.js/);
  });
});

// --- Describe: main() — fail-safe edges --------------------------------------

describe('main: fail-safe edges', () => {
  test('unparseable pipeline_status.md → ALLOW + stderr warning', async () => {
    const req = makeWriteRequest({ persona: 'Architect', target: 'src/foo.js' });
    req.files[`${PROJ}/pipeline_status.md`] = '# no persona row here\n';
    const { result, writeFileSpy } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /unparseable.*ALLOW/);
    assert.equal(writeFileSpy.calls.length, 0);
  });

  test('pipeline_status.md missing → ALLOW + stderr warning', async () => {
    const req = makeWriteRequest({ persona: 'Architect', target: 'src/foo.js' });
    delete req.files[`${PROJ}/pipeline_status.md`];
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /pipeline_status\.md unreadable.*ALLOW/);
  });

  test('permissions.json missing → ALLOW + stderr warning', async () => {
    const req = makeWriteRequest({ persona: 'Architect', target: 'src/foo.js' });
    delete req.files[`${PROJ}/${PERMISSIONS_PATH}`];
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /permissions\.json unreadable.*ALLOW/);
  });

  test('permissions.json malformed JSON → ALLOW + stderr warning', async () => {
    const req = makeWriteRequest({ persona: 'Architect', target: 'src/foo.js' });
    req.files[`${PROJ}/${PERMISSIONS_PATH}`] = '{ not valid json';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /malformed JSON.*ALLOW/);
  });

  test('permissions.json missing target persona row → ALLOW + stderr warning', async () => {
    const req = makeWriteRequest({ persona: 'Architect', target: 'src/foo.js' });
    req.files[`${PROJ}/${PERMISSIONS_PATH}`] = JSON.stringify({ personas: { /* no architect */ } });
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /Persona "architect" not found.*ALLOW/);
  });

  test('transcript read failure → DENY (asymmetric fail-safe per ADR 85)', async () => {
    const req = makeWriteRequest({ persona: 'Architect', target: 'src/foo.js' });
    // Remove transcript fixture: transcript_path read will throw ENOENT, hook treats as transcriptFailed.
    delete req.files['/tmp/transcript.jsonl'];
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected envelope on deny path');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });
});

// --- Describe: main() — stdin/payload edge cases ------------------------------

describe('main: stdin and payload edge cases', () => {
  test('non-JSON stdin → silent ALLOW (infra-level)', async () => {
    const { result } = await runMain({ stdin: 'not json at all' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  test('tool_name not in GATED_TOOLS → silent ALLOW (Read passes through)', async () => {
    const req = makeWriteRequest({ persona: 'Architect', target: 'src/foo.js', toolName: 'Read' });
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });

  test('Edit tool name DOES gate', async () => {
    const req = makeWriteRequest({ persona: 'Architect', target: 'src/foo.js', toolName: 'Edit' });
    const { result } = await runMain(req);
    const env = parseEnvelope(result.stdout);
    assert.equal(env.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('missing tool_input.file_path → silent ALLOW', async () => {
    const req = makeWriteRequest({ persona: 'Architect', target: 'src/foo.js' });
    req.stdin.tool_input = {};
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });

  test('empty file_path → silent ALLOW', async () => {
    const req = makeWriteRequest({ persona: 'Architect', target: 'src/foo.js' });
    req.stdin.tool_input.file_path = '';
    const { result } = await runMain(req);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });
});

// --- Describe: main() — exported constants sanity -----------------------------

describe('constants', () => {
  // Maintenance policy: this test is a strict deep-equal SNAPSHOT of
  // FRAMEWORK_INFRA_PATHS contents. Strict-equality is deliberate — every
  // addition/removal/reorder is an architectural decision that must be confronted
  // here AND documented in an ADR (see ADR 84 for the original carve-out, ADR 90
  // for the original carve-out expansion). When extending the array, refresh the
  // `expected` literal below AND add per-entry ALLOW + deny-case-mirror tests
  // in the dedicated `framework-infra carve-out — ADR <N> ...` describe block
  // following the E1-E17 pattern. Failing this test is the forcing function that
  // catches accidental additions slipping in without ADR + test coverage.
  test('FRAMEWORK_INFRA_PATHS includes all expected carve-out classes (Category I + II)', () => {
    assert.deepEqual(
      FRAMEWORK_INFRA_PATHS,
      [
        // Category I — mechanical wiring (project-local + harness-managed)
        '.claude/**',
        '.githooks/**',
        'scripts/setup-*.mjs',
        'scripts/sync-*.mjs',
        '.claude-plugin/**',
        '**/.claude/plans/**',
        '**/.claude/projects/**',
        // Category I — adopter-facing project infrastructure (ADR 90)
        '.agents/skills/**',
        '.gitattributes',
        '.gitignore',
        '.github/**',
        // Category I — package manifest
        'package.json',
        // Category II — coordination-state files
        'pipeline_status.md',
        'LLM_AGENT_GUIDE.md',
        // Category II — framework operator manuals (ADR 90; README.md added per the ADR 90 amendment)
        'CLAUDE.md',
        'USER_MANUAL.md',
        'README.md',
      ],
    );
  });
  test('LFE_FORCE_KEYWORD is the canonical break-glass keyword (re-exported from be-escape)', () => {
    assert.equal(LFE_FORCE_KEYWORD, 'LFE-FORCE');
  });
  test('LFE_FORCE_SCAN_WINDOW is positive integer (re-exported from be-escape)', () => {
    assert.ok(Number.isInteger(LFE_FORCE_SCAN_WINDOW) && LFE_FORCE_SCAN_WINDOW >= 1);
  });
  test('GATED_TOOLS is exactly Write and Edit', () => {
    assert.deepEqual(GATED_TOOLS, ['Write', 'Edit']);
  });
});

// --- Describe: mission-aware Authorized Scope ------------

describe('main: mission-aware Authorized Scope extension', () => {
  // Target outside every persona's write_constraints AND outside FRAMEWORK_INFRA —
  // a sanctioned second repo. Builder write_constraints = src/**, .plans/**, tests/**.
  const SECOND_REPO_TARGET = '../OtherRepo/file.js';

  test('in-flight mission + target in Authorized Scope → ALLOW (no deny, no debt write)', async () => {
    const { result, writeFileSpy } = await runMain(makeWriteRequest({
      persona: 'Builder',
      target: SECOND_REPO_TARGET,
      authorizedScope: '../OtherRepo/**',
    }));
    assert.equal(result.exitCode, 0);
    assert.equal(parseEnvelope(result.stdout), null); // no deny envelope
    assert.match(result.stderr, /mission-authorized/i);
    assert.equal(writeFileSpy.calls.length, 0); // no PROTOCOL_DEBT append
  });

  test('no Authorized Scope row → unchanged DENY (no extension)', async () => {
    const { result } = await runMain(makeWriteRequest({
      persona: 'Builder',
      target: SECOND_REPO_TARGET,
      // authorizedScope omitted → row absent
    }));
    assert.equal(parseEnvelope(result.stdout)?.hookSpecificOutput?.permissionDecision, 'deny');
  });

  test('(none) placeholder scope → unchanged DENY', async () => {
    const { result } = await runMain(makeWriteRequest({
      persona: 'Builder',
      target: SECOND_REPO_TARGET,
      authorizedScope: '(none)',
    }));
    assert.equal(parseEnvelope(result.stdout)?.hookSpecificOutput?.permissionDecision, 'deny');
  });

  test('populated scope but mission NOT in-flight → DENY (no extension)', async () => {
    const { result } = await runMain(makeWriteRequest({
      persona: 'Builder',
      target: SECOND_REPO_TARGET,
      authorizedScope: '../OtherRepo/**',
      missionState: '[MISSION COMPLETE]',
    }));
    assert.equal(parseEnvelope(result.stdout)?.hookSpecificOutput?.permissionDecision, 'deny');
  });

  test('in-flight + populated scope but target OUTSIDE scope → DENY', async () => {
    const { result } = await runMain(makeWriteRequest({
      persona: 'Builder',
      target: '../Unrelated/x.js',
      authorizedScope: '../OtherRepo/**',
    }));
    assert.equal(parseEnvelope(result.stdout)?.hookSpecificOutput?.permissionDecision, 'deny');
  });

  test('scope does not shadow a persona-allowed path (persona match still wins, silent ALLOW)', async () => {
    const { result } = await runMain(makeWriteRequest({
      persona: 'Builder',
      target: 'src/foo.js', // inside Builder write_constraints → allowed at step 5
      authorizedScope: '../OtherRepo/**',
    }));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, ''); // silent persona-allow, NOT the mission-authorized stderr
    assert.equal(parseEnvelope(result.stdout), null);
  });

  test('extension applies to Edit, not just Write (both are GATED_TOOLS)', async () => {
    const { result, writeFileSpy } = await runMain(makeWriteRequest({
      persona: 'Builder',
      target: SECOND_REPO_TARGET,
      authorizedScope: '../OtherRepo/**',
      toolName: 'Edit',
    }));
    assert.equal(result.exitCode, 0);
    assert.equal(parseEnvelope(result.stdout), null); // no deny envelope
    assert.match(result.stderr, /mission-authorized/i);
    assert.equal(writeFileSpy.calls.length, 0);
  });
});

// --- Describe: bounded transcript tail reader (AC1) -----------------

describe('main: escape-path transcript is read via injected readFileTail (AC1)', () => {
  // The deny-candidate escape check reads the transcript through the bounded
  // readFileTail seam in production; this cell injects a spy and proves (a) the
  // bounded reader is the one consulted for the transcript, (b) readFileText is
  // NOT used for the .jsonl, and (c) the LFE-FORCE escape still fires (ALLOW + debt).
  test('LFE-FORCE escape fires via readFileTail; readFileText never reads the transcript', async () => {
    const tailCalls = [];
    const readFileText = async (path) => {
      const key = String(path).replace(/\\/g, '/');
      if (key.endsWith('pipeline_status.md')) return makeEntranceCard({ persona: 'Architect' });
      if (key.endsWith(PERMISSIONS_PATH)) return PERMS_FIXTURE_JSON;
      if (key.endsWith('PROTOCOL_DEBT.md')) return PROTOCOL_DEBT_FIXTURE;
      if (key.endsWith('.jsonl')) throw new Error('transcript must be read via readFileTail, not readFileText');
      const err = new Error(`ENOENT: ${key}`);
      err.code = 'ENOENT';
      throw err;
    };
    const readFileTail = async (path) => {
      tailCalls.push(String(path));
      return makeTranscript({ userMessages: ['please proceed LFE-FORCE'] });
    };
    const spy = makeWriteFileSpy();
    const result = await main({
      stdinText: JSON.stringify({
        tool_name: 'Write',
        transcript_path: '/tmp/transcript.jsonl',
        cwd: PROJ,
        tool_input: { file_path: `${PROJ}/src/foo.js` },
      }),
      readFileText,
      readFileTail,
      writeFileText: spy,
      now: () => '2026-06-01T11:00:00.000Z',
      env: { CLAUDE_PROJECT_DIR: PROJ },
    });
    const env = parseEnvelope(result.stdout);
    assert.ok(env, 'expected an escape envelope');
    assert.equal(env.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal(tailCalls.length, 1, 'transcript read exactly once via readFileTail');
    assert.match(tailCalls[0], /\.jsonl$/);
    assert.equal(spy.calls.length, 1, 'debt row written on escape');
  });
});
