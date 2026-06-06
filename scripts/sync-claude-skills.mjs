#!/usr/bin/env node
/**
 * sync-claude-skills.mjs — keep .claude/skills/ in lock-step with .agents/skills/.
 *
 * Why this exists: Claude Code only discovers skills at .claude/skills/<name>/SKILL.md,
 * but LFE ships skills at .agents/skills/<name>/SKILL.md (IDE-agnostic, byte-identical
 * to upstream). This script copies the canonical tree to the dispatch location so
 * `/lfe-boot` and the other Brain-typeable skills dispatch natively in any clone.
 *
 * Modes:
 *   default (no args)  — sync canonical → mirror; write only on byte-diff; warn on stale
 *   --check            — read-only; exit non-zero on any drift (pre-commit hook + CI)
 *   --clean            — delete mirror entries whose canonical source no longer exists
 *
 * Hard policy: .agents/skills/** is LFE-SOURCE — DO NOT EDIT.
 *   - Edits to skill protocol go to LFE upstream (your local LFE upstream checkout).
 *   - After every `git pull` of LFE upstream, run `npm run sync:lfe-skills` to refresh.
 *   - Pre-commit hook (.githooks/pre-commit) runs --check and blocks commits on drift.
 */

import { promises as fs } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const SOURCE_ROOT = join(REPO_ROOT, '.agents', 'skills');
const MIRROR_ROOT = join(REPO_ROOT, '.claude', 'skills');

const argv = new Set(process.argv.slice(2));
const MODE_CHECK = argv.has('--check');
const MODE_CLEAN = argv.has('--clean');

async function pathExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

// Underscore-prefixed directories (e.g. _evals) are non-dispatchable substrate that
// lives under .agents/skills/ but is NOT a skill — the skill-eval fixture corpus +
// expected sidecars. They must not be mirrored into .claude/skills/ (and must not
// trip the pre-commit --check on a missing mirror). Exported for unit coverage.
export function isSkippedSourceDir(name) {
  return typeof name === 'string' && name.startsWith('_');
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.isDirectory() && isSkippedSourceDir(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walk(full)));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

async function buffersEqual(srcPath, dstPath) {
  if (!(await pathExists(dstPath))) return false;
  const [srcBuf, dstBuf] = await Promise.all([
    fs.readFile(srcPath),
    fs.readFile(dstPath),
  ]);
  return srcBuf.equals(dstBuf);
}

async function main() {
  if (!(await pathExists(SOURCE_ROOT))) {
    console.error(`sync-claude-skills: source missing: ${relative(REPO_ROOT, SOURCE_ROOT)}`);
    process.exit(1);
  }

  const sourceFiles = await walk(SOURCE_ROOT);
  const expectedMirrorSet = new Set(
    sourceFiles.map((src) => join(MIRROR_ROOT, relative(SOURCE_ROOT, src)))
  );

  const drift = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const src of sourceFiles) {
    const rel = relative(SOURCE_ROOT, src);
    const dst = join(MIRROR_ROOT, rel);
    const exists = await pathExists(dst);
    const equal = exists && (await buffersEqual(src, dst));

    if (equal) {
      unchanged++;
      continue;
    }

    drift.push({ rel, kind: exists ? 'updated' : 'created' });

    if (!MODE_CHECK) {
      await fs.mkdir(dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
      if (exists) updated++;
      else created++;
    }
  }

  const stale = [];
  if (await pathExists(MIRROR_ROOT)) {
    const mirrorFiles = await walk(MIRROR_ROOT);
    for (const mirror of mirrorFiles) {
      if (!expectedMirrorSet.has(mirror)) {
        stale.push(relative(REPO_ROOT, mirror));
        if (MODE_CLEAN) {
          await fs.unlink(mirror);
        }
      }
    }
  }

  if (MODE_CHECK) {
    if (drift.length === 0 && stale.length === 0) {
      console.log(`sync-claude-skills: mirror in sync (${unchanged} files).`);
      process.exit(0);
    }
    console.error(`sync-claude-skills: mirror drift detected.`);
    for (const d of drift) {
      console.error(`  ${d.kind === 'created' ? 'missing  ' : 'diverged '}.claude/skills/${d.rel}`);
    }
    for (const s of stale) {
      console.error(`  stale     ${s}`);
    }
    console.error(``);
    console.error(`Fix: run \`npm run sync:lfe-skills\`, re-stage changes, then re-commit.`);
    console.error(`(If a skill was removed upstream, run \`node scripts/sync-claude-skills.mjs --clean\` after confirming.)`);
    process.exit(2);
  }

  for (const d of drift) {
    console.log(`  ${d.kind === 'created' ? '+' : '~'} .claude/skills/${d.rel}`);
  }
  for (const s of stale) {
    console.log(`  ! ${MODE_CLEAN ? 'removed (stale)' : 'stale (not auto-deleted; use --clean)'}: ${s}`);
  }
  console.log(``);
  console.log(
    `Summary: ${created} created, ${updated} updated, ${unchanged} unchanged, ${stale.length} stale${MODE_CLEAN ? ' (deleted)' : ''}.`
  );
  if (stale.length > 0 && !MODE_CLEAN) {
    console.log(`Stale mirrors reference canonical skills that no longer exist.`);
    console.log(`Run \`node scripts/sync-claude-skills.mjs --clean\` to remove after confirming.`);
  }
}

// CLI guard: run main() only when invoked directly, so a test can `import` this
// module (e.g. for isSkippedSourceDir) without triggering a real sync. Mirrors the
// invokedAsCli pattern used across the lib/hook layer.
const invokedAsCli =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /sync-claude-skills\.mjs$/.test(process.argv[1]);

if (invokedAsCli) {
  main().catch((err) => {
    console.error(err.stack ?? err);
    process.exit(1);
  });
}
