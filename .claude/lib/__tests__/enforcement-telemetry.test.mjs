// Tests for enforcement-telemetry.mjs — the warn-event JSONL log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, recordWarn, TELEMETRY_PATH } from '../enforcement-telemetry.mjs';

test('TELEMETRY_PATH points at the gitignored local log', () => {
  assert.equal(TELEMETRY_PATH, '.claude/enforcement-telemetry.jsonl');
});

test('buildRecord accepts now as a string', () => {
  const r = buildRecord({ now: '2026-01-01T00:00:00Z', gate: 'no-mission', decision: 'warn', target: 'src/x' });
  assert.equal(r.ts, '2026-01-01T00:00:00Z');
  assert.equal(r.gate, 'no-mission');
  assert.equal(r.decision, 'warn');
  assert.equal(r.target, 'src/x');
});

test('buildRecord accepts now as a function', () => {
  const r = buildRecord({ now: () => '2026-02-02T00:00:00Z', gate: 'g' });
  assert.equal(r.ts, '2026-02-02T00:00:00Z');
});

test('buildRecord null-fills missing fields', () => {
  const r = buildRecord({});
  assert.deepEqual(r, {
    ts: null, gate: null, decision: null, reason: null,
    target: null, sessionId: null, persona: null, missionState: null,
  });
});

test('recordWarn appends one JSONL line and returns true', async () => {
  const calls = [];
  const append = async (p, c) => { calls.push({ p, c }); };
  const record = buildRecord({ now: '2026-01-01T00:00:00Z', gate: 'no-mission', decision: 'warn' });
  const ok = await recordWarn({ appendFileText: append, path: '/repo/.claude/enforcement-telemetry.jsonl', record });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p, '/repo/.claude/enforcement-telemetry.jsonl');
  assert.equal(calls[0].c, JSON.stringify(record) + '\n');
  // Line is valid JSON.
  assert.deepEqual(JSON.parse(calls[0].c.trim()), record);
});

test('recordWarn swallows errors and returns false (never throws)', async () => {
  const append = async () => { throw new Error('disk full'); };
  const ok = await recordWarn({ appendFileText: append, path: 'x', record: { a: 1 } });
  assert.equal(ok, false); // swallowed, no throw
});
