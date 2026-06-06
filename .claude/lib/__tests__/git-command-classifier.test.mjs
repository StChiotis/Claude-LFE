// Tests for git-command-classifier.mjs — the C1 tier classifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGitCommand,
  splitSubcommands,
  tokenize,
  TIER_NONE,
  TIER_MISSION,
  TIER_CONFIRM,
  DEFAULT_LEGAL_TAG_PATTERN,
} from '../git-command-classifier.mjs';

const tier = (cmd, opts) => classifyGitCommand(cmd, opts).tier;

// --- helpers -----------------------------------------------------------------

test('splitSubcommands splits on &&, ||, ;, |, newlines', () => {
  assert.deepEqual(splitSubcommands('a && b || c ; d | e\nf'), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(splitSubcommands(''), []);
  assert.deepEqual(splitSubcommands(null), []);
});

test('tokenize strips leading env assignments', () => {
  assert.deepEqual(tokenize('FOO=bar git commit'), ['git', 'commit']);
  assert.deepEqual(tokenize('git status'), ['git', 'status']);
});

// --- tier 0: non-git + read-only git -----------------------------------------

test('tier 0: non-git commands', () => {
  assert.equal(tier('ls -la'), TIER_NONE);
  assert.equal(tier('npm test'), TIER_NONE);
  assert.equal(tier('node script.mjs'), TIER_NONE);
  assert.equal(tier('rm -rf foo'), TIER_NONE); // out of scope by design
});

test('tier 0: read-only git', () => {
  assert.equal(tier('git status'), TIER_NONE);
  assert.equal(tier('git log --oneline -5'), TIER_NONE);
  assert.equal(tier('git diff HEAD'), TIER_NONE);
  assert.equal(tier('git show abc123'), TIER_NONE);
  assert.equal(tier('git fetch origin'), TIER_NONE);
  assert.equal(tier('git tag'), TIER_NONE); // list
  assert.equal(tier('git tag -l "v*"'), TIER_NONE); // list
});

test('tier 0: bare/garbage/bypass', () => {
  assert.equal(tier(''), TIER_NONE);
  assert.equal(tier(null), TIER_NONE);
  assert.equal(tier('git'), TIER_NONE);
  assert.equal(tier('gitfoo commit'), TIER_NONE); // not the git binary
  assert.equal(tier('g=git; $g commit'), TIER_NONE); // documented bypass (speed bump)
});

// --- tier 1: mutating git needing a mission ----------------------------------

test('tier 1: commit/reset/rebase/cherry-pick/revert', () => {
  assert.equal(tier('git commit -m "x"'), TIER_MISSION);
  assert.equal(tier('git reset --hard HEAD~1'), TIER_MISSION);
  assert.equal(tier('git rebase main'), TIER_MISSION);
  assert.equal(tier('git cherry-pick abc'), TIER_MISSION);
  assert.equal(tier('git revert abc'), TIER_MISSION);
});

test('tier 1: ordinary tag + push', () => {
  assert.equal(tier('git tag v1.0.0'), TIER_MISSION);
  assert.equal(tier('git tag -a v1 -m "release"'), TIER_MISSION);
  assert.equal(tier('git push'), TIER_MISSION);
  assert.equal(tier('git push origin feature-branch'), TIER_MISSION);
});

test('tier 1: env prefix + global flags still classify', () => {
  assert.equal(tier('FOO=bar git commit -m x'), TIER_MISSION);
  assert.equal(tier('git -c user.name=x commit -m y'), TIER_MISSION);
});

// --- tier 2: high-blast ------------------------------------------------------

test('tier 2: merge (any)', () => {
  assert.equal(tier('git merge feature'), TIER_CONFIRM);
  assert.equal(tier('git merge'), TIER_CONFIRM);
});

test('tier 2: push to main/master/refspec', () => {
  assert.equal(tier('git push origin main'), TIER_CONFIRM);
  assert.equal(tier('git push origin master'), TIER_CONFIRM);
  assert.equal(tier('git push origin HEAD:main'), TIER_CONFIRM);
  assert.equal(tier('git push origin HEAD:refs/heads/master'), TIER_CONFIRM);
});

test('tier 2: force push', () => {
  assert.equal(tier('git push --force'), TIER_CONFIRM);
  assert.equal(tier('git push -f origin feature'), TIER_CONFIRM);
  assert.equal(tier('git push --force-with-lease origin feature'), TIER_CONFIRM);
  assert.equal(tier('git push origin +feature'), TIER_CONFIRM);
});

test('tier 2: legal-anchor tags + --tags', () => {
  assert.equal(tier('git tag legal-2026-q1'), TIER_CONFIRM);
  assert.equal(tier('git tag v1-legal'), TIER_CONFIRM);
  assert.equal(tier('git push origin --tags'), TIER_CONFIRM);
  assert.equal(tier('git push origin legal-2026'), TIER_CONFIRM);
});

test('legalTagPattern is injectable', () => {
  assert.equal(tier('git tag rc1', { legalTagPattern: /rc/ }), TIER_CONFIRM);
  assert.equal(tier('git tag rc1'), TIER_MISSION); // default pattern is /legal/i
});

// --- compound: highest tier wins ---------------------------------------------

test('compound commands return the highest tier', () => {
  assert.equal(tier('echo hi && git commit -m x'), TIER_MISSION);
  assert.equal(tier('git status && git push origin main'), TIER_CONFIRM);
  assert.equal(tier('git add . ; git commit -m x'), TIER_MISSION);
  assert.equal(tier('git commit -m x && git merge dev'), TIER_CONFIRM);
  assert.equal(tier('ls | grep foo'), TIER_NONE);
});

test('classifyGitCommand returns verb detail on a match', () => {
  const r = classifyGitCommand('git push origin main');
  assert.equal(r.tier, TIER_CONFIRM);
  assert.equal(r.verb, 'push');
});

test('DEFAULT_LEGAL_TAG_PATTERN matches "legal" case-insensitively', () => {
  assert.ok(DEFAULT_LEGAL_TAG_PATTERN.test('LEGAL-1'));
  assert.ok(!DEFAULT_LEGAL_TAG_PATTERN.test('v1.0.0'));
});

test('robust to weird input (never throws)', () => {
  assert.doesNotThrow(() => classifyGitCommand('git   '));
  assert.doesNotThrow(() => classifyGitCommand('   '));
  assert.doesNotThrow(() => classifyGitCommand('&&&&'));
  assert.doesNotThrow(() => classifyGitCommand('git push ;;;'));
});
