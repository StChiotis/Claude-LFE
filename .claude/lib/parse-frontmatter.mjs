// Hand-rolled YAML-frontmatter parser scoped to the LFE coordination-file
// schema defined in .docs/protocol/COORDINATION_FILES.md. Result-style API:
// no throws; all error states represented as return values.
//
// Ratified by ADR 83 (zero-dep custom frontmatter parser — extends ADR 81's
// runtime convention to parsers/utilities). Closed-schema scope: every
// coordination-file field is a single-line `key: value` pair over a closed
// value space (enum strings, ISO-8601 timestamps, paths, integers, booleans,
// null literal). No multiline, nesting, anchors, comments. Adding js-yaml
// requires a superseding ADR.
//
// Cat D — the shared frontmatter parser.

const FRONTMATTER_DELIMITER = '---';

export function parseFrontmatter(text) {
  const source = String(text ?? '');
  const lines = source.split(/\r?\n/);

  // Find opening delimiter — must be at the very top (allow up to 2 leading
  // blank lines as tolerance for BOM / editor artefacts).
  let openIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    if (lines[i].trim() === FRONTMATTER_DELIMITER) {
      openIdx = i;
      break;
    }
    if (lines[i].trim() !== '') break;
  }
  if (openIdx === -1) {
    return {
      fields: {},
      error: {
        kind: 'no_frontmatter',
        line: 1,
        message:
          'No frontmatter block found. Coordination files require a `---` delimiter block at the top of the file.',
      },
    };
  }

  // Find closing delimiter
  let closeIdx = -1;
  for (let i = openIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === FRONTMATTER_DELIMITER) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    return {
      fields: {},
      error: {
        kind: 'malformed_inside',
        line: openIdx + 1,
        message:
          'Frontmatter opened with `---` but no closing `---` delimiter was found.',
      },
    };
  }

  // Parse lines between delimiters
  const fields = {};
  for (let i = openIdx + 1; i < closeIdx; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (trimmed === '') continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      return {
        fields: {},
        error: {
          kind: 'malformed_inside',
          line: i + 1,
          message: `Expected \`key: value\` format, got: \`${rawLine}\``,
        },
      };
    }
    const key = trimmed.slice(0, colonIdx).trim();
    if (key === '') {
      return {
        fields: {},
        error: {
          kind: 'malformed_inside',
          line: i + 1,
          message: `Expected \`key: value\` format (key is empty), got: \`${rawLine}\``,
        },
      };
    }
    const rawValue = trimmed.slice(colonIdx + 1).trim();
    fields[key] = normalizeValue(rawValue);
  }

  return { fields, error: null };
}

function normalizeValue(raw) {
  // Empty value → empty string (caller's mandatory-field check rejects)
  if (raw === '') return '';

  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Integer (positive or negative; no decimals in our schema)
  if (/^-?\d+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }

  // Double-quoted string — strip outer quotes, normalize to unquoted
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  // Single-quoted string — same normalization
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }

  // Default: unquoted string (ISO-8601 dates, paths, enum strings, etc.)
  return raw;
}
