// Bounded file-tail reader — the framework's single injected I/O adapter.
//
// BE-substrate perf (AC1). The three Block-with-Escape / C1
// enforcement gates (persona-path-lock, plan-critique-gate, bash-posture-gate)
// scan only the last few USER messages of the session transcript for an
// LFE-FORCE / MERGE-OK keyword. Reading the whole (potentially multi-MB) JSONL
// transcript just to inspect its tail is wasteful, so on the deny-candidate path
// the CLI wrappers inject this reader, which returns only a bounded tail window.
//
// Unlike the pure libs (be-escape, enforcement-context), this module PERFORMS I/O
// — it is the real-I/O side that the hooks' CLI wrappers wire into the pure
// `main({ readFileTail })` seam (documented in framework-decisions.md: "pure main()
// + DI-injected reader; CLI wrapper wires real I/O"). It stays unit-testable via
// the injected-fs third parameter, whose defaults bind node:fs/promises. Pure
// `main()` functions never import it — they receive it injected.
//
// Posture: zero-dep (ADR 83 — node:fs/promises built-ins only); ESM (ADR 81).
//
// In-window contract: a byte-offset tail read can begin mid-line; the transcript
// scanner (extractKeywordFromTranscript) JSON.parses each line in a try/catch and
// skips parse failures, so the truncated leading fragment is dropped harmlessly.
// Detection is identical for any keyword within the window.

import { stat as fsStat, open as fsOpen, readFile as fsReadFile } from 'node:fs/promises';
import { TRANSCRIPT_TAIL_BYTES } from './be-escape.mjs';

// Read at most the last `maxBytes` of `path` as a utf8 string. A file at or below
// the window is read whole (byte-identical to the pre-slice behavior); a larger
// file is read from a single offset window at its end. The injected `io` seam
// (stat/open/readFile) defaults to node:fs/promises and is overridable for tests.
export async function readFileTail(
  path,
  maxBytes = TRANSCRIPT_TAIL_BYTES,
  { stat = fsStat, open = fsOpen, readFile = fsReadFile } = {},
) {
  const { size } = await stat(path);
  if (size <= maxBytes) return readFile(path, 'utf8');

  const handle = await open(path, 'r');
  try {
    const start = size - maxBytes;
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buf, 0, maxBytes, start);
    // Slice to bytesRead so a short read never emits trailing NUL padding.
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}
