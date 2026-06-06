// git-command-classifier — pure classifier for the C1 Bash posture gate (ADR 95).
//
// Given a shell command string, return the HIGHEST git-mutation tier it contains:
//   tier 0 — non-git, or read-only git → no gating.
//   tier 1 — mutating git that needs an active mission (commit/reset/rebase/
//            cherry-pick/revert/tag(non-legal)/push(non-main,non-force)).
//   tier 2 — highest-blast git that needs an active mission + typed human
//            confirmation (merge / push-to-main / force-push / legal-anchor tag).
//
// Posture: zero-dep (ADR 83), ESM (ADR 81), pure (no I/O) → exhaustively unit-
// testable. This is a SPEED BUMP, not a sandbox (ADR 95): string parsing is
// defeatable by aliasing/indirection (`g=git; $g commit`), and general-shell
// file-laundering (rm/mv/sed/redirection) is out of scope by design — C1 gates
// git verbs, the highest-value target, not all shell.

export const TIER_NONE = 0;
export const TIER_MISSION = 1;
export const TIER_CONFIRM = 2;

// Default legal-anchor tag pattern (tunable surface — a project may widen this).
export const DEFAULT_LEGAL_TAG_PATTERN = /legal/i;

// Read-only git subcommands (never gated).
const READONLY_GIT = new Set([
  'status', 'log', 'diff', 'show', 'fetch', 'rev-parse', 'describe', 'blame',
  'shortlog', 'reflog', 'ls-files', 'ls-remote', 'cat-file', 'whatchanged',
  'grep', 'remote', 'config', 'branch', 'stash', 'switch', 'checkout', 'restore',
]);

// Tier-1 mutating verbs (history/index-affecting; need an active mission).
const TIER1_VERBS = new Set(['commit', 'reset', 'rebase', 'cherry-pick', 'revert']);

// Split a command line into sub-commands on shell separators.
export function splitSubcommands(command) {
  return String(command ?? '')
    .split(/(?:&&|\|\||[;|\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Tokenize a sub-command: strip leading `FOO=bar` env assignments, split on ws.
export function tokenize(sub) {
  const tokens = String(sub ?? '').split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  return tokens.slice(i);
}

export function classifySubcommand(sub, legalTagPattern = DEFAULT_LEGAL_TAG_PATTERN) {
  const tokens = tokenize(sub);
  if (tokens.length === 0 || tokens[0] !== 'git') return { tier: TIER_NONE };

  // Skip git global flags (e.g. `git -c key=val commit`) to find the subcommand.
  let j = 1;
  while (j < tokens.length && tokens[j].startsWith('-')) {
    // `-c key=val` consumes the next token too.
    if (tokens[j] === '-c' || tokens[j] === '-C') j += 2;
    else j += 1;
  }
  const verb = tokens[j];
  if (!verb) return { tier: TIER_NONE };
  const rest = tokens.slice(j + 1);

  if (verb === 'merge') return { tier: TIER_CONFIRM, verb: 'merge', detail: 'merge integrates history' };

  if (verb === 'push') {
    const hasForce = rest.some(
      (t) => t === '--force' || t === '-f' || t === '--force-with-lease' || /^\+/.test(t),
    );
    const hasMain = rest.some(
      (t) => t === 'main' || t === 'master' || /(?:^|\/|:)(?:refs\/heads\/)?(?:main|master)$/.test(t),
    );
    const pushesTags =
      rest.some((t) => t === '--tags') || rest.some((t) => !t.startsWith('-') && legalTagPattern.test(t));
    if (hasForce || hasMain || pushesTags) {
      return { tier: TIER_CONFIRM, verb: 'push', detail: 'push to main / force / tags' };
    }
    return { tier: TIER_MISSION, verb: 'push' };
  }

  if (verb === 'tag') {
    const nonFlags = rest.filter((t) => !t.startsWith('-'));
    const tagName = nonFlags[0];
    // `git tag` / `git tag -l` (list) has no created name → read-only.
    const isList = rest.some((t) => t === '-l' || t === '--list' || /^-n/.test(t));
    if (!tagName || isList) return { tier: TIER_NONE };
    return legalTagPattern.test(tagName)
      ? { tier: TIER_CONFIRM, verb: 'tag', detail: 'legal-anchor tag' }
      : { tier: TIER_MISSION, verb: 'tag' };
  }

  if (TIER1_VERBS.has(verb)) return { tier: TIER_MISSION, verb };

  // Read-only or unknown/low-blast subcommand → not gated (avoid over-blocking).
  if (READONLY_GIT.has(verb)) return { tier: TIER_NONE };
  return { tier: TIER_NONE };
}

// Returns the highest-tier classification across all sub-commands.
export function classifyGitCommand(command, { legalTagPattern = DEFAULT_LEGAL_TAG_PATTERN } = {}) {
  let highest = { tier: TIER_NONE };
  for (const sub of splitSubcommands(command)) {
    const r = classifySubcommand(sub, legalTagPattern);
    if (r.tier > highest.tier) highest = r;
  }
  return highest;
}
