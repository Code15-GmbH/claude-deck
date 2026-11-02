import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acknowledge, applyEvent, board, prune } from '../server/store.mjs';

const ev = (event, extra = {}) => ({ event, sessionId: 'a', cwd: '/x/figoca', profile: 'planni', ts: 1000, ...extra });

test('prompt -> working, stop -> done with result', () => {
  const s = {};
  applyEvent(s, ev('SessionStart', { source: 'startup' }));
  assert.equal(s.a.status, 'idle');
  assert.equal(s.a.project, 'figoca');
  applyEvent(s, ev('UserPromptSubmit', { prompt: 'Bau das Modal', ts: 2000 }));
  assert.equal(s.a.status, 'working');
  assert.equal(s.a.turnStartedAt, 2000);
  applyEvent(s, ev('Stop', { lastMessage: 'Fertig.', title: 'Modal', ts: 5000 }));
  assert.equal(s.a.status, 'done');
  assert.equal(s.a.attentionAt, 5000);
  assert.equal(s.a.lastMessage, 'Fertig.');
  assert.equal(s.a.title, 'Modal');
});

test('only permission notifications count as waiting', () => {
  const s = {};
  applyEvent(s, ev('UserPromptSubmit', { prompt: 'x' }));
  assert.equal(applyEvent(s, ev('Notification', { notificationType: 'idle_prompt', message: 'Claude is waiting for your input' })), false);
  assert.equal(s.a.status, 'working');
  applyEvent(s, ev('Notification', { notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash', ts: 3000 }));
  assert.equal(s.a.status, 'waiting');
  assert.match(s.a.waitingReason, /permission/);
});

test('idle notification for an unknown session creates no strip', () => {
  const s = {};
  assert.equal(applyEvent(s, ev('Notification', { notificationType: 'idle_prompt' })), false);
  assert.deepEqual(s, {});
});

test('board: newest finished first, then working', () => {
  const s = {};
  applyEvent(s, { event: 'Stop', sessionId: 'old', cwd: '/p/old', ts: 1000 });
  applyEvent(s, { event: 'Stop', sessionId: 'new', cwd: '/p/new', ts: 9000 });
  applyEvent(s, { event: 'UserPromptSubmit', sessionId: 'run', cwd: '/p/run', ts: 5000 });
  const b = board(s);
  assert.deepEqual(b.attention.map((x) => x.id), ['new', 'old']);
  assert.deepEqual(b.working.map((x) => x.id), ['run']);
});

test('SessionEnd for unknown session is ignored; ended sessions are pruned later', () => {
  const s = {};
  assert.equal(applyEvent(s, ev('SessionEnd')), false);
  applyEvent(s, ev('SessionStart'));
  applyEvent(s, ev('SessionEnd', { ts: 1000 }));
  assert.equal(s.a.status, 'ended');
  prune(s, 1000 + 13 * 3600e3);
  assert.equal(s.a, undefined);
});

test('long text is clipped', () => {
  const s = {};
  applyEvent(s, ev('UserPromptSubmit', { prompt: 'x'.repeat(2000) }));
  assert.ok(s.a.prompt.length <= 400);
});

test('acknowledge clears a strip from the attention bay until the session reports again', () => {
  const s = {};
  applyEvent(s, ev('Stop', { ts: 5000 }));
  assert.equal(acknowledge(s, 'a', true, 6000), true);
  assert.equal(acknowledge(s, 'a', true, 6500), false); // already cleared
  assert.equal(s.a.status, 'done');
  assert.deepEqual(board(s).attention, []);
  assert.deepEqual(board(s).quiet.map((x) => x.id), ['a']);
  assert.equal(acknowledge(s, 'a', false), true); // put back
  assert.deepEqual(board(s).attention.map((x) => x.id), ['a']);
  acknowledge(s, 'a', true, 7000);
  applyEvent(s, ev('UserPromptSubmit', { prompt: 'weiter', ts: 8000 }));
  applyEvent(s, ev('Stop', { ts: 9000 }));
  assert.deepEqual(board(s).attention.map((x) => x.id), ['a']); // next result shows up again
  assert.equal(acknowledge(s, 'nope'), false);
  applyEvent(s, ev('UserPromptSubmit', { prompt: 'x', ts: 9500 }));
  assert.equal(acknowledge(s, 'a'), false); // nothing to clear while working
});
