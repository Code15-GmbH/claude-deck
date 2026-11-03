import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, test, vi } from 'vitest';

// Stream Deck SDK and afplay are process boundaries: replace them.
const sd = vi.hoisted(() => ({
  settings: { getGlobalSettings: vi.fn(), setGlobalSettings: vi.fn() },
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  system: { openUrl: vi.fn() },
}));
vi.mock('@elgato/streamdeck', () => ({ default: sd, SingletonAction: class {} }));
const cp = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => cp);

const { Alarm, Board, NextUrgent, Overview, Page, ProfileFilter, SessionSlot } = await import('../plugin/src/actions.js');

const decode = (uri) => Buffer.from(uri.split(',')[1], 'base64').toString('utf8');

class FakeClient extends EventEmitter {
  constructor(sessions = []) {
    super();
    this.sessions = sessions;
    this.connected = true;
    this.lastError = '';
    this.focus = vi.fn(async () => ({ ok: true }));
    this.ack = vi.fn(async () => ({}));
    this.dashboardUrl = vi.fn(() => 'http://localhost:4777/?key=k');
  }
}
let n = 0;
const fakeAction = (over = {}) => ({
  id: over.id || `act${n++}`,
  isKey: () => true,
  coordinates: { column: 0, row: 0 },
  device: { id: 'dev' },
  setImage: vi.fn(async () => {}),
  showOk: vi.fn(async () => {}),
  showAlert: vi.fn(async () => {}),
  ...over,
});
const sess = (id, status, over = {}) => ({ id, status, profile: 'main', project: id, updatedAt: 1, startedAt: 1, attentionAt: 1, ...over });
const lastImage = (a) => decode(a.setImage.mock.calls.at(-1)[0]);

let boards = [];
const makeBoard = (sessions) => { const b = new Board(new FakeClient(sessions)); boards.push(b); return b; };

beforeEach(() => {
  sd.settings.getGlobalSettings.mockResolvedValue({});
  sd.settings.setGlobalSettings.mockResolvedValue();
});
afterEach(() => { for (const b of boards) clearInterval(b.ticker); boards = []; vi.useRealTimers(); });

test('slots are ordered by device, row and column and fill in deck order', () => {
  const b = makeBoard([sess('w', 'working', { turnStartedAt: 1 }), sess('d', 'done')]);
  const second = fakeAction({ coordinates: { column: 1, row: 0 } });
  const first = fakeAction({ coordinates: { column: 0, row: 0 } });
  const other = fakeAction({ coordinates: { column: 0, row: 0 }, device: { id: 'zzz' } });
  const noDevice = fakeAction({ coordinates: { column: 4, row: 4 }, device: undefined });
  for (const a of [second, other, first, noDevice]) b.addSlot(a);
  b.update(true);
  assert.deepEqual(b.orderedSlots().map((s) => s.action), [noDevice, first, second, other]);
  assert.ok(lastImage(noDevice).includes('ARBEITET'));
  assert.ok(lastImage(first).includes('FERTIG'));
  assert.ok(lastImage(second).includes('FREI'));
});

test('multi-action instances without coordinates are ignored', () => {
  const b = makeBoard();
  b.addSlot(fakeAction({ isKey: () => false }));
  b.addSlot(fakeAction({ coordinates: undefined }));
  assert.equal(b.slots.size, 0);
});

test('offline keys and setImage failures are handled', async () => {
  const b = makeBoard([sess('w', 'working')]);
  b.client.connected = false;
  b.client.lastError = 'ECONNREFUSED';
  const a = fakeAction({ setImage: vi.fn(async () => { throw new Error('gone'); }) });
  b.addSlot(a);
  await new Promise((r) => setImmediate(r));
  assert.ok(decode(a.setImage.mock.calls[0][0]).includes('OFFLINE'));
  assert.match(sd.logger.warn.mock.calls.at(-1)[0], /setImage: gone/);
});

test('overflow key appears when there are more sessions than slots, and pages', () => {
  const b = makeBoard([sess('a', 'working'), sess('b', 'working'), sess('c', 'working')]);
  const k1 = fakeAction({ coordinates: { column: 0, row: 0 } });
  const k2 = fakeAction({ coordinates: { column: 1, row: 0 } });
  b.addSlot(k1); b.addSlot(k2);
  b.update(false);
  assert.ok(lastImage(k2).includes('+2'));
  b.pressSlot(k2);
  assert.equal(b.page, 1);
  assert.ok(lastImage(k1).includes('>b<'));
});

test('other keys render their own views', () => {
  const b = makeBoard([sess('p', 'waiting'), sess('d', 'done', { profile: 'planni' })]);
  b.addSlot(fakeAction());
  b.update(false);
  const keys = Object.fromEntries(['next', 'overview', 'profile', 'page', 'alarm', 'unknown'].map((k) => [k, fakeAction()]));
  for (const [k, a] of Object.entries(keys)) b.addOther(a, k);
  assert.ok(lastImage(keys.next).includes('1 Freigabe · 1 fertig'));
  assert.ok(lastImage(keys.overview).includes('ÜBERSICHT'));
  assert.ok(lastImage(keys.profile).includes('alle'));
  assert.ok(lastImage(keys.page).includes('1 von 2 sichtbar'));
  assert.ok(lastImage(keys.alarm).includes('>an<'));
  assert.equal(keys.unknown.setImage.mock.calls.length, 0);
  b.removeOther(keys.next.id);
  b.renderOther(keys.next.id); // no longer registered: no-op
  b.removeSlot([...b.slots.keys()][0]);
  assert.equal(b.slots.size, 0);
});

test('loadSettings restores alarm and profile, ignores wrong types and errors', async () => {
  const b = makeBoard();
  sd.settings.getGlobalSettings.mockResolvedValueOnce({ alarm: false, profile: 'planni' });
  await b.loadSettings();
  assert.equal(b.alarm, false);
  assert.equal(b.profile, 'planni');
  sd.settings.getGlobalSettings.mockResolvedValueOnce({ alarm: 'yes', profile: 3 });
  await b.loadSettings();
  assert.equal(b.alarm, false);
  sd.settings.getGlobalSettings.mockRejectedValueOnce(new Error('no ws'));
  await b.loadSettings();
  assert.match(sd.logger.warn.mock.calls.at(-1)[0], /global settings: no ws/);
});

test('a filtered profile without sessions falls back to all', () => {
  const b = makeBoard([sess('a', 'working')]);
  b.profile = 'planni';
  b.update(false);
  assert.equal(b.profile, '');
});

test('alarm sounds only for newly waiting sessions after the first state', () => {
  const b = makeBoard([sess('p', 'waiting')]);
  b.client.emit('state');
  assert.equal(cp.execFile.mock.calls.length, 0); // already waiting at startup
  b.client.sessions = [sess('p', 'waiting'), sess('q', 'waiting')];
  b.client.emit('state');
  assert.equal(cp.execFile.mock.calls.length, 1);
  assert.equal(cp.execFile.mock.calls[0][0], 'afplay');
  cp.execFile.mock.calls[0][2](); // callback is a no-op
  b.alarm = false;
  b.client.sessions = [sess('r', 'waiting')];
  b.client.emit('state');
  assert.equal(cp.execFile.mock.calls.length, 1);
  b.client.emit('connection');
});

test('toggleAlarm saves the setting and plays a test sound when switched on', () => {
  cp.execFile.mockClear();
  const b = makeBoard();
  b.toggleAlarm();
  assert.equal(b.alarm, false);
  assert.equal(cp.execFile.mock.calls.length, 0);
  b.toggleAlarm();
  assert.equal(b.alarm, true);
  assert.equal(cp.execFile.mock.calls.length, 1);
  assert.deepEqual(sd.settings.setGlobalSettings.mock.calls.at(-1)[0], { alarm: true, profile: '' });
});

test('saveSettings swallows errors', async () => {
  sd.settings.setGlobalSettings.mockRejectedValueOnce(new Error('x'));
  makeBoard().saveSettings();
  await new Promise((r) => setImmediate(r));
});

test('cycleProfile walks through all, then each profile', () => {
  const b = makeBoard([sess('a', 'working'), sess('b', 'working', { profile: 'planni' })]);
  b.page = 3;
  b.cycleProfile();
  assert.equal(b.profile, 'main');
  assert.equal(b.page, 0);
  b.cycleProfile();
  assert.equal(b.profile, 'planni');
  assert.deepEqual(b.list.map((e) => e.session.id), ['b']);
  b.cycleProfile();
  assert.equal(b.profile, '');
});

test('pressing a non-green session jumps right away', async () => {
  const b = makeBoard([sess('w', 'working')]);
  const a = fakeAction();
  b.addSlot(a);
  b.update(false);
  await b.pressSlot(a);
  assert.deepEqual(b.client.focus.mock.calls, [['w']]);
  assert.equal(b.client.ack.mock.calls.length, 0);
  assert.equal(a.showOk.mock.calls.length, 1);
  b.releaseSlot(a); // no timer: nothing happens
  assert.equal(b.client.focus.mock.calls.length, 1);
});

test('pressing unknown or empty keys does nothing', () => {
  const b = makeBoard();
  const a = fakeAction();
  b.pressSlot(a); // never rendered
  b.addSlot(a);
  b.pressSlot(a); // empty cell
  assert.equal(b.client.focus.mock.calls.length, 0);
});

test('short tap on a green key jumps and checks it off', async () => {
  vi.useFakeTimers();
  const b = makeBoard([sess('d', 'done')]);
  const a = fakeAction();
  b.addSlot(a);
  b.update(false);
  b.pressSlot(a);
  assert.equal(b.holds.size, 1);
  await b.releaseSlot(a);
  assert.equal(b.holds.size, 0);
  assert.deepEqual(b.client.focus.mock.calls, [['d']]);
  assert.deepEqual(b.client.ack.mock.calls, [['d', true]]);
});

test('a release after the key changed to non-session does not jump', () => {
  vi.useFakeTimers();
  const b = makeBoard([sess('d', 'done')]);
  const a = fakeAction();
  b.addSlot(a);
  b.update(false);
  b.pressSlot(a);
  b.cellBySlot.set(a.id, { kind: 'empty' });
  b.releaseSlot(a);
  assert.equal(b.client.focus.mock.calls.length, 0);
});

test('long press on a green key checks it off without jumping', async () => {
  vi.useFakeTimers();
  const b = makeBoard([sess('d', 'done')]);
  const a = fakeAction();
  b.addSlot(a);
  b.update(false);
  b.pressSlot(a);
  await vi.advanceTimersByTimeAsync(600);
  assert.equal(b.client.focus.mock.calls.length, 0);
  assert.deepEqual(b.client.ack.mock.calls, [['d', true]]);
  assert.equal(a.showOk.mock.calls.length, 1);
  b.releaseSlot(a); // timer already fired
  assert.equal(b.client.focus.mock.calls.length, 0);
});

test('checkOff and jump report failures with an alert', async () => {
  const b = makeBoard();
  const a = fakeAction();
  const entry = { kind: 'done', label: 'x', session: { id: 'x' } };
  b.client.ack.mockRejectedValueOnce(new Error('down'));
  await b.checkOff(entry, a);
  assert.equal(a.showAlert.mock.calls.length, 1);
  b.client.focus.mockResolvedValueOnce({ ok: false, reason: 'tab-closed' });
  await b.jump(entry, a);
  assert.equal(a.showAlert.mock.calls.length, 2);
  assert.match(sd.logger.warn.mock.calls.at(-1)[0], /tab-closed/);
  b.client.focus.mockRejectedValueOnce(new Error('boom'));
  await b.jump(entry, a);
  assert.equal(a.showAlert.mock.calls.length, 3);
  assert.equal(b.client.ack.mock.calls.length, 1); // no ack after a failed jump
});

test('the ticker re-renders age counters', () => {
  vi.useFakeTimers();
  const b = makeBoard([sess('w', 'working')]);
  const a = fakeAction();
  b.addSlot(a);
  const before = a.setImage.mock.calls.length;
  vi.advanceTimersByTime(15000);
  assert.equal(a.setImage.mock.calls.length, before + 1);
});

test('action classes delegate to the board', async () => {
  const b = makeBoard([sess('p', 'waiting'), sess('q', 'working', { profile: 'planni' })]);
  const action = fakeAction();
  const ev = { action };
  const slot = new SessionSlot(b);
  assert.equal(slot.manifestId, 'de.code15.claude-sessions.slot');
  slot.onWillAppear(ev);
  assert.equal(b.slots.size, 1);
  b.update(false);
  await slot.onKeyDown(ev);
  slot.onKeyUp(ev);
  assert.deepEqual(b.client.focus.mock.calls, [['p']]);
  slot.onWillDisappear(ev);
  assert.equal(b.slots.size, 0);

  const next = new NextUrgent(b);
  next.onWillAppear(ev);
  await next.onKeyDown(ev);
  assert.equal(b.client.focus.mock.calls.length, 2);
  b.client.sessions = [];
  b.update(false);
  await next.onKeyDown(ev);
  assert.equal(action.showAlert.mock.calls.length, 1); // nothing to jump to
  next.onWillDisappear(ev);

  const overview = new Overview(b);
  overview.onWillAppear(ev);
  overview.onKeyDown(ev);
  assert.deepEqual(sd.system.openUrl.mock.calls.at(-1), ['http://localhost:4777/?key=k']);
  b.client.dashboardUrl.mockReturnValueOnce('');
  overview.onKeyDown(ev);
  assert.equal(action.showAlert.mock.calls.length, 2);
  overview.onWillDisappear(ev);

  b.client.sessions = [sess('q', 'working', { profile: 'planni' })];
  const profile = new ProfileFilter(b);
  profile.onWillAppear(ev);
  profile.onKeyDown();
  assert.equal(b.profile, 'planni');
  profile.onWillDisappear(ev);

  const page = new Page(b);
  page.onWillAppear(ev);
  page.onKeyDown();
  assert.equal(b.page, 0); // one page only: wraps
  page.onWillDisappear(ev);

  const alarm = new Alarm(b);
  alarm.onWillAppear(ev);
  alarm.onKeyDown();
  assert.equal(b.alarm, false);
  alarm.onWillDisappear(ev);
  assert.equal(b.others.size, 0);
});
