// Shared stdin reader for the .claude CLI entrypoints.
// Unifies the near-duplicate readStdinAll
// definitions in statusline.mjs + session-start-reminder.mjs. Collects chunks
// into an array and joins once (avoids repeated string concat), and is
// error-tolerant — on a mid-stream iteration error it returns whatever was read
// so a load-bearing warn-and-log entrypoint never throws on stdin trouble.
//
// NOTE: the ~10 enforcement-gate hooks that carry their own
// readStdinAll are intentionally NOT migrated here — that boilerplate is owned
// by the deferred shared production gate-runner follow-up.
import process from 'node:process';

export async function readStdinAll(stdin = process.stdin) {
  const chunks = [];
  try {
    for await (const chunk of stdin) chunks.push(chunk);
  } catch {
    // ignore — return whatever was collected before the error
  }
  return chunks.join('');
}
