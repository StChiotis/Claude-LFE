// Block-with-Escape (BE) substrate library — pure helpers + constants shared
// across all BE-posture PreToolUse hooks. Lifted out of
// `.claude/hooks/persona-path-lock.mjs` so the canonical BE helpers can be
// shared without coupling to that hook.
//
// Posture: zero-dep per ADR 83 (Node built-ins only — `node:path.posix` here).
// Runtime: Node ESM per ADR 81. No I/O — all helpers are pure functions over
// caller-supplied inputs, mockable via the dependency-injection seam used by
// hooks that consume this library.
//
// Sec-G1.H1 closure: `normalizePath` now applies
// `posix.normalize()` after backslash conversion + project-root strip + leading-
// `./` strip. This canonicalises `..` segments before glob match, closing the
// path-traversal bypass of the framework-infrastructure carve-out documented in
// `.docs/quality/known-issues.md` § "Sec-G1.H1 — Path traversal in glob match".
// Pre-fix, `.claude/../etc/passwd` matched `.claude/**` because the glob regex
// did not see the `..`; post-fix, the path normalizes to `etc/passwd` and the
// glob correctly fails to match.
//
// Consumers:
//   - `.claude/hooks/persona-path-lock.mjs` — re-exports the moved
//     symbols for backward compat with existing test imports.
//   - `.claude/hooks/plan-critique-gate.mjs` — imports the LFE-FORCE
//     escape substrate (transcript detection + debt-row formatting + atomic
//     insertion) verbatim.
//
// Future BE hooks consume the same surface;
// no further refactor expected.

import { posix } from 'node:path';

// --- Constants (canonical names; re-exported by consumers) -------------------

export const LFE_FORCE_KEYWORD = 'LFE-FORCE';
export const LFE_FORCE_SCAN_WINDOW = 3;
export const PROTOCOL_DEBT_PATH = '.docs/quality/PROTOCOL_DEBT.md';
export const DEBT_ROW_MAX_MISSION_CHARS = 80;

// Tail-window size (bytes) for the
// bounded transcript read on the deny-candidate path. 256 KiB comfortably spans the
// last few user turns scanned for LFE-FORCE / MERGE-OK (LFE_FORCE_SCAN_WINDOW /
// CONFIRM_SCAN_WINDOW) — the realistic keyword the user just typed sits at EOF.
// Consumed by read-file-tail.mjs (the injected I/O adapter). A keyword present only
// BEFORE this window is out of scope, and a too-small window fails safe to DENY /
// not-confirmed, never a spurious ALLOW.
export const TRANSCRIPT_TAIL_BYTES = 262144;

// --- Module-load-compiled regexes ------------------------------
// Hoisted out of their functions so they compile once at module load rather than
// per call. SAFETY: every `/g` regex here is used ONLY with String.replace (never
// .test), and the row extractors are non-global used with .match, so none carries a
// stateful `lastIndex` hazard across calls.
const ANSI_RE = /\x1b/g;
const ACTIVE_MISSION_RE = /\|\s*\*\*Active Mission\*\*\s*\|\s*([^|]+?)\s*\|/i;
const AUTHORIZED_SCOPE_RE = /\|\s*\*\*Authorized Scope\*\*\s*\|\s*([^|]+?)\s*\|/i;
const KEYWORD_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
// Glob meta-escape (note: NO `*` — the star is handled specially by compileGlob).
const GLOB_META_RE = /[.+?^${}()|[\]\\]/g;
// Authorized-Scope token normalization (KI-3): strip a trailing *(...)* italic
// note, then surrounding inline-code backticks, per comma-split token. All three
// are non-global, used with String.replace — no `lastIndex` hazard.
const SCOPE_ITALIC_NOTE_RE = /\s*\*\([^)]*\)\*\s*$/;
const SCOPE_LEADING_BACKTICKS_RE = /^`+/;
const SCOPE_TRAILING_BACKTICKS_RE = /`+$/;

// Glob→RegExp memo cache. Each distinct pattern compiles its final
// `^…$` RegExp once per process, then reuses it — matchAnyGlob calls matchGlob once
// per pattern in lists like FRAMEWORK_INFRA_PATHS (~17 entries), several times per
// hook invocation. Bounded by the number of DISTINCT patterns the process ever sees
// (small finite static lists + persona constraints + authorized scope); the hook
// process is short-lived (one PreToolUse event, then exit), so the cache cannot grow
// unbounded. A pattern that fails to compile caches `null` (= never matches),
// preserving the original try/catch → false semantics exactly.
const GLOB_RE_CACHE = new Map();

function compileGlob(pattern) {
  if (GLOB_RE_CACHE.has(pattern)) return GLOB_RE_CACHE.get(pattern);
  const SENTINEL = '\x00DOUBLESTAR\x00';
  const source = pattern
    .replace(/\*\*/g, SENTINEL)
    .replace(GLOB_META_RE, '\\$&')
    .replace(/\*/g, '[^/]*')
    .split(SENTINEL)
    .join('.*');
  let compiled;
  try {
    compiled = new RegExp(`^${source}$`);
  } catch {
    compiled = null;
  }
  GLOB_RE_CACHE.set(pattern, compiled);
  return compiled;
}

// Test-only observability for the compile-once cell: the number of
// distinct glob patterns compiled-and-cached so far this process.
export function getGlobCacheSize() {
  return GLOB_RE_CACHE.size;
}

// --- Pure helpers -------------------------------------------------------------

export function normalizePath(rawPath, projectRoot = '') {
  let p = String(rawPath ?? '').replace(/\\/g, '/');
  if (projectRoot) {
    const root = String(projectRoot).replace(/\\/g, '/').replace(/\/+$/, '');
    if (root && p.startsWith(root + '/')) p = p.slice(root.length + 1);
  }
  if (p.startsWith('./')) p = p.slice(2);
  if (p === '') return p;
  // Sec-G1.H1 fix: canonicalise `..` and `.` segments so adversarial paths like
  // `.claude/../etc/passwd` resolve to `etc/passwd` before glob match.
  p = posix.normalize(p);
  if (p === '.') return '';
  if (p.startsWith('./')) p = p.slice(2);
  return p;
}

export function matchGlob(path, pattern) {
  if (pattern === '**/*' || pattern === '**') return true;
  const re = compileGlob(String(pattern));
  return re ? re.test(String(path)) : false;
}

export function matchAnyGlob(path, patterns) {
  if (!Array.isArray(patterns)) return false;
  for (const p of patterns) {
    if (matchGlob(path, p)) return true;
  }
  return false;
}

export function extractActiveMission(entranceCardText) {
  const m = String(entranceCardText ?? '').match(ACTIVE_MISSION_RE);
  if (!m) return 'n/a';
  const raw = m[1].replace(ANSI_RE, '').trim();
  if (!raw) return 'n/a';
  return raw.length > DEBT_ROW_MAX_MISSION_CHARS
    ? raw.slice(0, DEBT_ROW_MAX_MISSION_CHARS - 3) + '...'
    : raw;
}

// Placeholder cell values that mean "no authorized scope" — treated as an empty
// list so an unused `Authorized Scope` row never extends the path-lock.
export const AUTHORIZED_SCOPE_PLACEHOLDERS = Object.freeze(['(none)', 'none', 'n/a', '—', '-']);

// Normalize one comma-split Authorized-Scope token to a bare glob: drop a trailing
// markdown italic note of the form `*(...)*`, THEN strip surrounding inline-code
// backticks, then re-trim (KI-3). Order matters — the note (which ends in `*`) must
// be removed before the surrounding-backtick strip, and the note matcher targets
// only the PARENTHESIZED italic form, so a bare glob such as `src/**` keeps its own
// trailing `**` (the no-regression guarantee).
function normalizeScopeToken(token) {
  return String(token)
    .trim()
    .replace(SCOPE_ITALIC_NOTE_RE, '')
    .replace(SCOPE_LEADING_BACKTICKS_RE, '')
    .replace(SCOPE_TRAILING_BACKTICKS_RE, '')
    .trim();
}

// Extract the optional mission-authorized write-scope glob list from the entrance
// card's `Authorized Scope` row (ADR 95,
// extends ADR 84). Returns `[]` when the row is absent, empty, or a placeholder
// (`(none)`/`n/a`/`—`/`-`). Globs are comma-separated, trimmed, and markdown-normalized — surrounding
// backticks and a trailing italic note are stripped per token (KI-3). ANSI bytes are
// stripped at the parser boundary — the same defense used by `parseEntranceCard`
// and `extractActiveMission`. Pure: the caller decides how the list is consumed.
export function extractAuthorizedScope(entranceCardText) {
  const m = String(entranceCardText ?? '').match(AUTHORIZED_SCOPE_RE);
  if (!m) return [];
  const raw = m[1].replace(ANSI_RE, '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => normalizeScopeToken(s))
    .filter((s) => s.length > 0 && !AUTHORIZED_SCOPE_PLACEHOLDERS.includes(s.toLowerCase()));
}

export function extractKeywordFromTranscript(transcriptText, keyword, scanWindow = LFE_FORCE_SCAN_WINDOW) {
  const lines = String(transcriptText ?? '')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  const userMessages = [];
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const role = obj?.role ?? obj?.message?.role ?? obj?.type;
    const content = obj?.content ?? obj?.message?.content;
    if (role !== 'user' || content == null) continue;

    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .map((c) => {
          if (typeof c === 'string') return c;
          if (c && typeof c === 'object') return String(c.text ?? '');
          return '';
        })
        .join(' ');
    }
    if (text) userMessages.push(text);
  }

  const recent = userMessages.slice(-Math.max(1, scanWindow));
  const joined = recent.join(' ');
  const escaped = String(keyword ?? '').replace(KEYWORD_ESCAPE_RE, '\\$&');
  if (!escaped) return false;
  return new RegExp(escaped, 'i').test(joined);
}

// Backward-compatible wrapper — the canonical LFE-FORCE detector delegates to the
// generic scanner above (generalized for the C1 MERGE-OK confirmation).
export function extractLfeForceFromTranscript(transcriptText, scanWindow = LFE_FORCE_SCAN_WINDOW) {
  return extractKeywordFromTranscript(transcriptText, LFE_FORCE_KEYWORD, scanWindow);
}

// Escape a value for safe embedding in one markdown table cell: neutralize the
// pipe (cell delimiter) and collapse CR/LF to a visible escaped form so a crafted
// field (e.g. a file path) cannot break the debt row across table rows.
// Mirrors the existing pipe-escape.
function escapeCell(value, fallback = 'unknown') {
  return String(value ?? fallback)
    .replace(/\|/g, '\\|')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

export function buildDebtRow({ now, missionName, persona, target }) {
  const date = escapeCell(String(now ?? '').slice(0, 10) || 'unknown-date');
  const mission = escapeCell(missionName && missionName !== 'n/a' ? missionName : 'n/a');
  const safeTarget = escapeCell(target);
  const safePersona = escapeCell(persona);
  return `| ${date} | ${mission} | LFE-FORCE write to \`${safeTarget}\` by ${safePersona} persona | open |`;
}

export function insertDebtRowIntoFile(fileText, row) {
  const text = String(fileText ?? '');
  // Dedup: simultaneous multi-gate detection of one LFE-FORCE write
  // event calls this with a byte-identical row (the row string deterministically
  // encodes the identifying tuple date/mission/target/persona + the builder's
  // invariant `open` status). Skip if that exact row already exists so one event
  // yields one row. A genuinely distinct event, or a status-differing historical row
  // (e.g. `resolved`), does not byte-match and is correctly left alone.
  if (text.split(/\r?\n/).some((line) => line === row)) return text;
  const separatorIdx = text.indexOf('\n---');
  if (separatorIdx === -1) {
    return text.replace(/\n*$/, '\n') + row + '\n';
  }
  const head = text.slice(0, separatorIdx);
  const tail = text.slice(separatorIdx);
  const headTrimmed = head.replace(/\n+$/, '');
  return `${headTrimmed}\n${row}\n${tail}`;
}
