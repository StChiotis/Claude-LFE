// Tests for .claude/lib/persona-name.mjs — the shared persona-name reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadingPersonaName, PERSONA_NAMES } from '../persona-name.mjs';

test('resolves an emoji-decorated cell to the canonical lowercase name', () => {
  assert.equal(leadingPersonaName('🏛️ Architect'), 'architect');
  assert.equal(leadingPersonaName('🔨 Builder'), 'builder');
  assert.equal(leadingPersonaName('🕵️ Inspector'), 'inspector');
  assert.equal(leadingPersonaName('📚 Archivist'), 'archivist');
  assert.equal(leadingPersonaName('🚀 Scout'), 'scout');
  assert.equal(leadingPersonaName('🫵 Brain'), 'brain');
});

test('resolves a bare (un-decorated) cell, trimming and case-folding', () => {
  assert.equal(leadingPersonaName('Architect'), 'architect');
  assert.equal(leadingPersonaName('  Builder  '), 'builder');
  assert.equal(leadingPersonaName('SCOUT'), 'scout');
});

test('resolves <emoji> <Name> *(note)* — the trailing note is ignored', () => {
  assert.equal(leadingPersonaName('🔨 Builder *(in flight)*'), 'builder');
  assert.equal(leadingPersonaName('Inspector *(verifying the slice)*'), 'inspector');
});

// Recommended Action #1 (plan_critique Lens 1): the live-card trap — a trailing
// note that itself names a DIFFERENT persona must not be mis-matched. Start-
// anchoring guarantees the leading name wins; the mid-note name is inert.
test('never mis-matches a persona named inside the trailing note', () => {
  assert.equal(
    leadingPersonaName('🏛️ Architect *(transitioned from Archivist)*'),
    'architect',
  );
  assert.equal(leadingPersonaName('🔨 Builder *(was Inspector last slice)*'), 'builder');
});

test('word boundary: "Architecture" is not "Architect" (decorated or bare)', () => {
  assert.equal(leadingPersonaName('Architecture rework'), null);
  assert.equal(leadingPersonaName('🏛️ Architecture rework'), null);
});

// Pins the `^` start-anchor (Inspector mutation-verify): a persona name
// that is NOT the leading token must not resolve — the parser reads the LEADING
// persona only, never one buried later in the cell.
test('start-anchored: a persona name not in leading position does not resolve', () => {
  assert.equal(leadingPersonaName('rework by Architect'), null);
  assert.equal(leadingPersonaName('🏛️ rework by Architect'), null);
  assert.equal(leadingPersonaName('please make me Scout'), null);
});

test('returns null for emoji-only, garbage, the unknown sentinel, empty, and nullish input', () => {
  assert.equal(leadingPersonaName('🏛️'), null);
  assert.equal(leadingPersonaName('🔨   '), null);
  assert.equal(leadingPersonaName('Wizard'), null);
  assert.equal(leadingPersonaName('unknown'), null);
  assert.equal(leadingPersonaName(''), null);
  assert.equal(leadingPersonaName(null), null);
  assert.equal(leadingPersonaName(undefined), null);
});

test('PERSONA_NAMES is the canonical six (incl. Brain), frozen', () => {
  assert.deepEqual(
    [...PERSONA_NAMES],
    ['Architect', 'Builder', 'Inspector', 'Archivist', 'Scout', 'Brain'],
  );
  assert.ok(Object.isFrozen(PERSONA_NAMES));
});
