import { test } from 'vitest';
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

import { needsYou, newSession } from '../server/store.mjs';

test('newSession fills defaults', () => {
  const n = newSession({ sessionId: 'z', ts: 7 });
  assert.equal(n.project, '?');
  assert.equal(n.profile, 'main');
  assert.equal(n.pid, null);
  assert.deepEqual(n.term, {});
  assert.equal(n.startedAt, 7);
  assert.equal(n.status, 'idle');
});

test('applyEvent ignores incomplete and unknown events', () => {
  const s = {};
  assert.equal(applyEvent(s, null), false);
  assert.equal(applyEvent(s, { event: 'Stop' }), false);
  assert.equal(applyEvent(s, { sessionId: 'a' }), false);
  assert.equal(applyEvent(s, ev('PreToolUse')), false); // creates the session, but nothing visible changed
  assert.equal(s.a.status, 'idle');
});

test('applyEvent keeps the freshest facts and falls back to Date.now() without ts', () => {
  const s = {};
  applyEvent(s, ev('SessionStart', { ts: undefined, pid: 42, transcript: '/t.jsonl', term: { program: 'iTerm.app' } }));
  assert.ok(s.a.updatedAt > 1e12);
  assert.equal(s.a.pid, 42);
  assert.equal(s.a.transcript, '/t.jsonl');
  applyEvent(s, ev('UserPromptSubmit', { cwd: '/y/other', profile: 'main', term: {}, title: 't'.repeat(300) }));
  assert.equal(s.a.project, 'other');
  assert.equal(s.a.profile, 'main');
  assert.deepEqual(s.a.term, { program: 'iTerm.app' }); // an empty term does not wipe the known one
  assert.ok(s.a.title.length <= 120);
  assert.ok(s.a.title.endsWith('…'));
});

test('SessionStart: clear resets texts, compact keeps working, resume revives ended', () => {
  const s = {};
  applyEvent(s, ev('UserPromptSubmit', { prompt: 'p', title: 'T' }));
  applyEvent(s, ev('SessionStart', { source: 'compact' }));
  assert.equal(s.a.status, 'working');
  applyEvent(s, ev('Stop', { lastMessage: 'done' }));
  applyEvent(s, ev('SessionStart', { source: 'clear' }));
  assert.equal(s.a.status, 'idle');
  assert.equal(s.a.prompt, '');
  assert.equal(s.a.lastMessage, '');
  assert.equal(s.a.title, '');
  applyEvent(s, ev('SessionStart', { source: 'clear', title: 'Neu' }));
  assert.equal(s.a.title, 'Neu');
  applyEvent(s, ev('SessionEnd', { ts: 2000 }));
  applyEvent(s, ev('SessionStart', { source: 'resume', ts: 3000 }));
  assert.equal(s.a.endedAt, null);
  assert.equal(s.a.status, 'idle');
});

test('Stop keeps an existing prompt and adopts one when none is known', () => {
  const s = {};
  applyEvent(s, ev('Stop', { prompt: 'aus dem Stop' }));
  assert.equal(s.a.prompt, 'aus dem Stop');
  applyEvent(s, ev('Stop', { prompt: 'anderer' }));
  assert.equal(s.a.prompt, 'aus dem Stop');
});

test('decisions: elicitation and untyped permission messages count, untyped others do not', () => {
  const s = {};
  applyEvent(s, ev('UserPromptSubmit'));
  assert.equal(applyEvent(s, ev('Notification', { notificationType: 'elicitation_dialog', message: 'Pick one' })), true);
  assert.equal(s.a.status, 'waiting');
  const t = {};
  assert.equal(applyEvent(t, ev('Notification', { message: 'Claude needs your Permission' })), true);
  assert.equal(applyEvent(t, ev('Notification', { message: 'just idle' })), false);
  assert.equal(applyEvent(t, ev('Notification', {})), false);
});

test('needsYou and prune of silent sessions', () => {
  assert.equal(needsYou({ status: 'done' }), true);
  assert.equal(needsYou({ status: 'waiting', ackedAt: 1 }), false);
  assert.equal(needsYou({ status: 'working' }), false);
  const s = {};
  applyEvent(s, ev('UserPromptSubmit', { ts: 1000 }));
  assert.equal(prune(s, 1000 + 2 * 86400e3), false);
  assert.equal(prune(s, 1000 + 4 * 86400e3), true);
  assert.deepEqual(s, {});
  // ended without endedAt falls back to updatedAt
  const e = { x: { status: 'ended', updatedAt: 0, endedAt: null } };
  assert.equal(prune(e, 13 * 3600e3), true);
  assert.equal(prune({}, Date.now()), false);
});

test('board quiet row: newest activity first, ack time counts as activity', () => {
  const s = {
    a: { id: 'a', status: 'idle', updatedAt: 100 },
    b: { id: 'b', status: 'done', updatedAt: 50, ackedAt: 500 },
    c: { id: 'c', status: 'ended', updatedAt: 300 },
    w1: { id: 'w1', status: 'working', updatedAt: 1 },
    w2: { id: 'w2', status: 'working', updatedAt: 1, turnStartedAt: 5 },
    d1: { id: 'd1', status: 'done', updatedAt: 1 },
  };
  const b = board(s);
  assert.deepEqual(b.quiet.map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(b.working.map((x) => x.id), ['w2', 'w1']);
  assert.deepEqual(b.attention.map((x) => x.id), ['d1']);
});
