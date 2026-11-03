import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ago, board, needsYou, profileOf, span, where } from '../web/src/lib.js';
import { board as serverBoard } from '../server/store.mjs';

test('profileOf knows the named profiles and falls back for others', () => {
  assert.deepEqual(profileOf('code15-belege'), { label: 'Belege', color: 'var(--p-belege)' });
  assert.deepEqual(profileOf('kunde'), { label: 'kunde', color: 'var(--p-other)' });
});

test('ago in German', () => {
  assert.equal(ago(10e3), 'gerade eben');
  assert.equal(ago(5 * 60e3), 'vor 5 min');
  assert.equal(ago(120 * 60e3), 'vor 2 h');
  assert.equal(ago(135 * 60e3), 'vor 2 h 15 min');
  assert.equal(ago(50 * 3600e3), 'vor 2 T');
});

test('span', () => {
  assert.equal(span(200), '1 s');
  assert.equal(span(42e3), '42 s');
  assert.equal(span(7 * 60e3), '7 min');
  assert.equal(span(125 * 60e3), '2 h 5 min');
});

test('board matches the server order and caps the quiet row at 12', () => {
  const sessions = [
    { id: 'd1', status: 'done', attentionAt: 1, updatedAt: 1 },
    { id: 'd2', status: 'waiting', attentionAt: 5, updatedAt: 5 },
    { id: 'acked', status: 'done', attentionAt: 9, ackedAt: 20, updatedAt: 9 },
    { id: 'w', status: 'working', turnStartedAt: 3, updatedAt: 3 },
    { id: 'w0', status: 'working', updatedAt: 3 },
    ...Array.from({ length: 14 }, (_, i) => ({ id: `i${i}`, status: 'idle', updatedAt: i })),
  ];
  const b = board(sessions);
  assert.deepEqual(b.attention.map((s) => s.id), ['d2', 'd1']);
  assert.deepEqual(b.working.map((s) => s.id), ['w', 'w0']);
  assert.equal(b.quiet.length, 12);
  assert.equal(b.quiet[0].id, 'acked');
  const server = serverBoard(Object.fromEntries(sessions.map((s) => [s.id, s])));
  assert.deepEqual(b.attention.map((s) => s.id), server.attention.map((s) => s.id));
  assert.deepEqual(b.quiet.map((s) => s.id), server.quiet.slice(0, 12).map((s) => s.id));
  assert.equal(needsYou({ status: 'waiting' }), true);
});

test('where describes the terminal location', () => {
  assert.equal(where({}), '?');
  assert.equal(where({ location: { app: 'iTerm', gone: true, desktop: 'D1' } }), 'iTerm · Tab geschlossen');
  assert.equal(where({ location: { app: 'iTerm', desktop: 'Desktop 5', tab: 2, tty: 'ttys1' } }), 'iTerm · Desktop 5 · Tab 2');
  assert.equal(where({ location: { app: 'Cursor', tty: 'ttys1' } }), 'Cursor · ttys1');
});
