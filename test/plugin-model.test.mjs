import assert from 'node:assert/strict';
import { test } from 'node:test';
import { counts, formatAge, kindOf, paginate, profilesOf, shortProfile, visibleSessions, wrapName } from '../plugin/src/model.js';

const s = (over) => ({ id: over.id || Math.random().toString(36).slice(2), profile: 'main', project: 'proj', status: 'idle', updatedAt: 1000, startedAt: 500, ackedAt: null, ...over });

test('kindOf maps server status, ack and closed tabs', () => {
  assert.equal(kindOf(s({ status: 'waiting' })), 'waiting');
  assert.equal(kindOf(s({ status: 'done' })), 'done');
  assert.equal(kindOf(s({ status: 'done', ackedAt: 1 })), 'idle');
  assert.equal(kindOf(s({ status: 'working' })), 'working');
  assert.equal(kindOf(s({ status: 'working', location: { gone: true } })), 'gone');
  assert.equal(kindOf(s({ status: 'ended' })), null);
});

test('visibleSessions orders by urgency, then recency, and numbers duplicates', () => {
  const list = visibleSessions([
    s({ id: 'a', status: 'working', turnStartedAt: 10 }),
    s({ id: 'b', status: 'done', attentionAt: 5 }),
    s({ id: 'c', status: 'waiting', attentionAt: 1 }),
    s({ id: 'd', status: 'done', attentionAt: 9, startedAt: 100 }),
    s({ id: 'e', status: 'ended' }),
    s({ id: 'f', status: 'idle', profile: 'planni', project: 'other' }),
  ]);
  assert.deepEqual(list.map((e) => e.session.id), ['c', 'd', 'b', 'a', 'f']);
  // numbering follows start time: d started first (100), the rest tie at 500 in list order
  assert.deepEqual(list.map((e) => e.label), ['proj #2', 'proj #1', 'proj #3', 'proj #4', 'other']);
  assert.deepEqual(visibleSessions([s({ profile: 'planni' }), s({ profile: 'main' })], 'planni').length, 1);
});

test('counts and profiles', () => {
  const list = visibleSessions([s({ status: 'waiting' }), s({ status: 'working', profile: 'planni' }), s({ status: 'ended', profile: 'gone' })]);
  assert.deepEqual(counts(list), { waiting: 1, done: 0, working: 1, gone: 0, idle: 0, total: 2 });
  assert.deepEqual(profilesOf([s({ profile: 'planni' }), s({ profile: 'main' }), s({ status: 'ended', profile: 'x' })]), ['main', 'planni']);
});

test('paginate fills slots and adds an overflow key when needed', () => {
  const list = Array.from({ length: 4 }, (_, i) => ({ kind: 'working', session: { id: String(i) } }));
  const fits = paginate(list, 5, 0);
  assert.equal(fits.pages, 1);
  assert.deepEqual(fits.cells.map((c) => c.kind), ['session', 'session', 'session', 'session', 'empty']);
  const over = paginate(list, 3, 0);
  assert.equal(over.pages, 2);
  assert.deepEqual(over.cells.map((c) => c.kind), ['session', 'session', 'overflow']);
  assert.equal(over.cells[2].more, 2);
  const second = paginate(list, 3, 1);
  assert.deepEqual(second.cells.map((c) => c.kind), ['session', 'session', 'overflow']);
  assert.equal(second.cells[2].more, 2); // the two from page one are "elsewhere"
  assert.equal(paginate(list, 3, 7).page, 1); // wraps
  assert.deepEqual(paginate(list, 0, 0).cells, []);
});

test('wrapName keeps two lines and breaks at separators', () => {
  assert.deepEqual(wrapName('rechnungs-import'), ['rechnungs-', 'import']);
  assert.deepEqual(wrapName('monitoring'), ['monitoring']);
  assert.deepEqual(wrapName('schritt-fuer-schritt'), ['schritt-fuer-', 'schritt']);
  assert.deepEqual(wrapName('ein-sehr-langer-projektname-mit-vielen-teilen'), ['ein-sehr-', 'langer…']);
  assert.deepEqual(wrapName('abcdefghijklmnopqrstuvwxyz0123456789'), ['abcdefghijklm', 'nopqrstuvwxy…']);
  assert.deepEqual(wrapName(''), ['']);
});

test('shortProfile and formatAge', () => {
  assert.equal(shortProfile('code15-belege'), 'belege');
  assert.equal(shortProfile('main'), 'main');
  assert.equal(shortProfile('planni'), 'planni');
  assert.equal(shortProfile('a-very-long-profile-name'), 'name');
  assert.equal(formatAge(42_000), '42 s');
  assert.equal(formatAge(3 * 60_000 + 5000), '3 min');
  assert.equal(formatAge(65 * 60_000), '1 h 05');
  assert.equal(formatAge(-5), '0 s');
});
