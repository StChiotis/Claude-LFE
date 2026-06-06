// skill-eval-gate.mjs — hash-pinned pre-commit freshness gate for the five
// prompt-based reasoning skills (the gating half of the skill-accuracy harness).
//
// Why this exists: the harness measures each reasoning skill's catch-rate and
// records it — per skill — in .claude/lib/__eval__/results.json, keyed by a sha256
// `promptHash` of that skill's canonical SKILL.md plus a `passed` verdict (written
// by skill-eval-report.mjs `buildResultsRecord`). Nothing yet stops a commit that
// EDITS one of those prompts from shipping without a fresh passing eval — a silent
// prompt regression that lowers a skill's catch-rate. This gate is that stop: a
// second, independent pre-commit check (beside the mirror-drift check) that, when a
// reasoning-skill prompt is staged, requires a recorded passing eval whose hash
// matches the prompt's on-disk content. NO LLM at commit time — pure content-hash compare.
//
// Posture: zero-dep beyond Node built-ins + sibling libs; ESM; pure-over-injected-I/O
// core + a thin invokedAsCli CLI seam; ADR-85 asymmetric fail-safe ALLOW.
//
// Decision model — warn-first per ADR 95, identical to every sibling gate
// (bash-posture-gate, boot-precondition, …):
//   warn  (default)  → loud advisory on stderr + telemetry; the commit PROCEEDS (exit 0).
//   block (promoted via .claude/enforcement-posture.json key `skill-eval`) → REFUSE (exit 1).
// A speed-bump, not a sandbox: `git commit --no-verify` bypasses by design.
//
// Fail-safe (ADR 85): an UNREADABLE/missing results record, a git failure, or any
// infra error → ALLOW (a broken substrate must never lock a commit). A READABLE but
// empty `{}` record is NOT a fail-safe state — it is the real "no proof on record"
// decision (the shipped template state), so it drives the gate normally.

import { readFile, appendFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { hashPrompt } from './skill-eval-report.mjs';
import { readPosture } from './enforcement-context.mjs';
import { buildRecord, recordWarn, TELEMETRY_PATH } from './enforcement-telemetry.mjs';

// --- Constants ----------------------------------------------------------------

export const GATE_NAME = 'skill-eval';

// The five prompt-based reasoning skills the harness measures — and the exact key
// space of results.json `skills`. Verified against every
// .agents/skills/_evals/expected/*.json `skill` field; a divergence here would be a
// SILENT COVERAGE HOLE (a staged edit to a skill not in this set requires no proof).
export const REASONING_SKILLS = Object.freeze([
  'lfe-security-check',
  'lfe-perf-check',
  'lfe-complexity-check',
  'lfe-mutation-verify',
  'lfe-plan-critique',
]);

// The machine results record the runner (skill-eval-report.mjs) writes and this
// gate reads. Repo-relative; resolved against CLAUDE_PROJECT_DIR || cwd at the CLI.
export const RESULTS_REL = '.claude/lib/__eval__/results.json';

export const ACTION = Object.freeze({ ALLOW: 'allow', WARN: 'warn', REFUSE: 'refuse' });

const SKILL_SET = new Set(REASONING_SKILLS);

// --- Pure helpers (exported for unit coverage) --------------------------------

/**
 * Map a staged path to the reasoning skill it edits, or null. Matches BOTH the
 * canonical `.agents/skills/<skill>/SKILL.md` and its `.claude/skills/<skill>/SKILL.md`
 * mirror (either staging signals an edit); the canonical content is authoritative
 * for hashing — the mirror-drift check guarantees the two agree.
 */
export function skillForStagedPath(path) {
  if (typeof path !== 'string') return null;
  const norm = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const m = /^(?:\.agents|\.claude)\/skills\/([^/]+)\/SKILL\.md$/.exec(norm);
  return m && SKILL_SET.has(m[1]) ? m[1] : null;
}

/** Unique, order-stable list of reasoning skills among the staged paths. */
export function stagedReasoningSkills(stagedPaths) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(stagedPaths)) return out;
  for (const p of stagedPaths) {
    const skill = skillForStagedPath(p);
    if (skill && !seen.has(skill)) {
      seen.add(skill);
      out.push(skill);
    }
  }
  return out;
}

/**
 * Parse the results record. Fail-soft and explicit about the two failure modes:
 *   - unreadable/unparseable/non-object → { record: null, unreadable: true }  (→ fail-safe ALLOW)
 *   - a valid object (INCLUDING `{}`)    → { record, unreadable: false }       (→ real decision)
 * The `{}` template state is *readable* — it means "no proof on record", not "broken substrate".
 */
export function parseRecord(text) {
  try {
    const record = JSON.parse(String(text ?? ''));
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      return { record: null, unreadable: true };
    }
    return { record, unreadable: false };
  } catch {
    return { record: null, unreadable: true };
  }
}

/**
 * Is there a fresh passing eval for this skill? Proven iff the record entry exists,
 * its verdict is `passed === true`, and its recorded `promptHash` equals the current
 * (staged) prompt hash. A non-string current hash (read failure) can never match.
 */
export function isProven(entry, currentHash) {
  return (
    !!entry &&
    typeof entry === 'object' &&
    entry.passed === true &&
    typeof entry.promptHash === 'string' &&
    typeof currentHash === 'string' &&
    entry.promptHash === currentHash
  );
}

/**
 * Evaluate the gate over the staged reasoning skills. Pure; never throws.
 * @param {string[]} skills                 staged reasoning skills
 * @param {object|null} record              parsed results record
 * @param {(skill:string)=>string|null} hashForSkill   injected current-hash resolver
 * @returns {{offending: {skill:string,reason:string}[], parseError:boolean}}
 *          reason ∈ 'no-record' | 'not-passed' | 'hash-mismatch'
 */
export function evaluateGate({ skills, record, hashForSkill }) {
  try {
    const offending = [];
    const recSkills = record && typeof record === 'object' ? record.skills : null;
    for (const skill of Array.isArray(skills) ? skills : []) {
      const entry = recSkills && typeof recSkills === 'object' ? recSkills[skill] : undefined;
      const currentHash = typeof hashForSkill === 'function' ? hashForSkill(skill) : null;
      if (isProven(entry, currentHash)) continue;
      let reason;
      if (!entry || typeof entry !== 'object') reason = 'no-record';
      else if (entry.passed !== true) reason = 'not-passed';
      else reason = 'hash-mismatch';
      offending.push({ skill, reason });
    }
    return { offending, parseError: false };
  } catch (err) {
    // Internal error → no offending list → ALLOW (fail-safe; never block on a gate bug).
    return { offending: [], parseError: true, error: String(err?.message ?? err) };
  }
}

/**
 * Decide the action from the evaluation + posture. Pure.
 *   recordUnreadable → ALLOW (ADR-85 fail-safe). No offending → ALLOW.
 *   offending → WARN (default posture) | REFUSE (block posture).
 */
export function decide({ offending, recordUnreadable, posture }) {
  if (recordUnreadable) return { action: ACTION.ALLOW, failSafe: true };
  const list = Array.isArray(offending) ? offending : [];
  if (list.length === 0) return { action: ACTION.ALLOW };
  return { action: posture === 'block' ? ACTION.REFUSE : ACTION.WARN, offending: list };
}

/** Educational message — names each offending skill + always directs the re-run (AC1). */
export function buildGateMessage({ offending, action }) {
  const list = Array.isArray(offending) ? offending : [];
  const names = list.map((o) => `    - ${o.skill} (${o.reason})`).join('\n');
  const head =
    action === ACTION.REFUSE
      ? '[LFE skill-eval] Commit refused — a reasoning-skill prompt was edited without a fresh passing eval:'
      : '[LFE skill-eval warn-and-log] A reasoning-skill prompt was edited without a fresh passing eval:';
  const tail =
    action === ACTION.REFUSE
      ? '  Posture is `block`. Set key `skill-eval` to `warn` in .claude/enforcement-posture.json for advisory-only.'
      : '  Advisory only — the commit proceeds. Promote to a hard block via key `skill-eval` in .claude/enforcement-posture.json.';
  return [
    head,
    names,
    '',
    "  The skill-accuracy results record holds no passing eval whose recorded prompt-hash",
    "  matches this prompt's current content. Re-run the eval, then re-stage + commit:",
    '',
    '    /lfe-skill-eval   (full mode — repopulates .docs/quality/skill-eval-scorecard.md',
    '                       and .claude/lib/__eval__/results.json)',
    '',
    tail,
  ].join('\n');
}

// --- CLI boundary (invokedAsCli-guarded; advisory exit; fail-safe ALLOW) -------
// The git hook (.githooks/pre-commit) shells out to this. The pure core above is
// the tested seam; this wrapper does the git + fs I/O the core injects.

/** Staged file list (Added/Copied/Modified). git failure/absence → null → fail-safe ALLOW. */
function listStagedPaths(root) {
  try {
    const res = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
      encoding: 'utf8',
      cwd: root,
    });
    if (res.status !== 0 || typeof res.stdout !== 'string') return null;
    return res.stdout.split(/\r?\n/).filter((l) => l.trim() !== '');
  } catch {
    return null;
  }
}

async function readResults(root) {
  try {
    const text = await readFile(join(root, RESULTS_REL), 'utf8');
    return parseRecord(text);
  } catch {
    // Missing file → unreadable → fail-safe ALLOW (the shipped template carries `{}`,
    // which IS readable; a truly absent record is an abnormal, recover-first state).
    return { record: null, unreadable: true };
  }
}

async function runCli() {
  const root = String(process.env.CLAUDE_PROJECT_DIR || process.cwd()).replace(/\\/g, '/');

  const stagedPaths = listStagedPaths(root);
  if (stagedPaths === null) {
    process.exit(0); // no git / not a repo → nothing to verify → ALLOW
    return;
  }
  const skills = stagedReasoningSkills(stagedPaths);
  if (skills.length === 0) {
    process.exit(0); // no reasoning prompt staged → the overwhelmingly common commit
    return;
  }

  const { record, unreadable } = await readResults(root);
  const posture = await readPosture(GATE_NAME, {
    readFileText: (p) => readFile(p, 'utf8'),
    projectRoot: root,
  });

  // Hash each staged skill's CURRENT canonical prompt from the WORKING TREE — the exact
  // same basis the runner records (skill-eval-report.mjs reads the working-tree SKILL.md
  // via readFile before hashing). Reading the file (not the `git show :blob` staged copy)
  // keeps the gate's hash byte-identical to the recorded one on every platform: a blob
  // would diverge from a CRLF-translated working tree and false-mismatch a proven skill.
  const hashCache = new Map();
  const hashForSkill = (skill) => {
    if (hashCache.has(skill)) return hashCache.get(skill);
    let content = null;
    try {
      content = readFileSync(join(root, '.agents', 'skills', skill, 'SKILL.md'), 'utf8');
    } catch {
      content = null;
    }
    const h = content === null ? null : hashPrompt(content);
    hashCache.set(skill, h);
    return h;
  };

  const { offending } = evaluateGate({ skills, record, hashForSkill });
  const { action } = decide({ offending, recordUnreadable: unreadable, posture });

  if (action === ACTION.ALLOW) {
    process.exit(0);
    return;
  }

  const message = buildGateMessage({ offending, action });
  await recordWarn({
    appendFileText: (p, c) => appendFile(p, c, 'utf8'),
    path: join(root, TELEMETRY_PATH),
    record: buildRecord({
      now: () => new Date().toISOString(),
      gate: GATE_NAME,
      decision: action === ACTION.REFUSE ? 'deny' : 'warn',
      reason: 'skill-eval-unproven',
      target: offending.map((o) => o.skill).join(','),
    }),
  });

  process.stderr.write(message + '\n');
  process.exit(action === ACTION.REFUSE ? 1 : 0);
}

const invokedAsCli =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /skill-eval-gate\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  runCli().catch((err) => {
    // Asymmetric fail-safe: an infra error never blocks a commit.
    process.stderr.write(`[LFE skill-eval] gate infrastructure error: ${err?.message ?? err} — fail-safe ALLOW.\n`);
    process.exit(0);
  });
}
