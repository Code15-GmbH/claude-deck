// The board (shared state: filter, page, alarm, which key is which slot) and the six
// Stream Deck actions. Session slots need no settings: every "Session" key on a device
// gets its slot number from its position (reading order), so you just drag as many
// of them onto the deck as you like.
import streamDeck, { SingletonAction } from '@elgato/streamdeck';
import { execFile } from 'node:child_process';
import * as M from './model.js';
import * as R from './render.js';

const UUID = 'de.code15.claude-sessions';
const LONG_PRESS_MS = 600; // holding a green key this long checks it off without jumping
const SOUND = '/System/Library/Sounds/Glass.aiff';
const playSound = () => execFile('afplay', [SOUND], () => {});

export class Board {
  constructor(client) {
    this.client = client;
    this.profile = '';
    this.page = 0;
    this.pages = 1;
    this.alarm = true;
    this.slots = new Map();   // action id -> { action, device, column, row }
    this.others = new Map();  // action id -> { action, kind }
    this.cellBySlot = new Map();
    this.holds = new Map();   // action id -> long-press timer while a key is held
    this.list = [];
    this.prevWaiting = null;  // null until the first state arrived (no alarm for sessions that already wait)
    client.on('state', () => this.update(true));
    client.on('connection', () => this.update(false));
    this.ticker = setInterval(() => this.renderAll(), 15000); // age counters
  }

  async loadSettings() {
    try {
      const g = await streamDeck.settings.getGlobalSettings();
      if (typeof g.alarm === 'boolean') this.alarm = g.alarm;
      if (typeof g.profile === 'string') this.profile = g.profile;
    } catch (e) { streamDeck.logger.warn(`global settings: ${e.message}`); }
  }

  saveSettings() {
    streamDeck.settings.setGlobalSettings({ alarm: this.alarm, profile: this.profile }).catch(() => {});
  }

  addSlot(action) {
    const c = action.coordinates;
    if (!action.isKey() || !c) return; // multi-action instances have no position
    this.slots.set(action.id, { action, device: action.device?.id || '', column: c.column, row: c.row });
    this.renderAll();
  }
  removeSlot(id) { this.slots.delete(id); this.cellBySlot.delete(id); }
  addOther(action, kind) { this.others.set(action.id, { action, kind }); this.renderOther(action.id); }
  removeOther(id) { this.others.delete(id); }

  orderedSlots() {
    return [...this.slots.values()].sort((a, b) => a.device.localeCompare(b.device) || a.row - b.row || a.column - b.column);
  }

  update(fromState) {
    const sessions = this.client.sessions;
    if (this.profile && !M.profilesOf(sessions).includes(this.profile)) this.profile = ''; // filtered profile has no sessions any more
    this.list = M.visibleSessions(sessions, this.profile);
    if (fromState) this.checkAlarm(sessions);
    this.renderAll();
  }

  checkAlarm(sessions) {
    const now = new Set(sessions.filter((s) => M.kindOf(s) === 'waiting').map((s) => s.id));
    const fresh = this.prevWaiting && [...now].some((id) => !this.prevWaiting.has(id));
    this.prevWaiting = now;
    if (fresh && this.alarm) playSound();
  }

  renderAll() {
    const slots = this.orderedSlots();
    const pg = M.paginate(this.list, slots.length, this.page);
    this.page = pg.page;
    this.pages = pg.pages;
    const now = Date.now();
    const connected = this.client.connected;
    slots.forEach((slot, i) => {
      const cell = pg.cells[i] || { kind: 'empty' };
      this.cellBySlot.set(slot.action.id, cell);
      const img = !connected ? R.renderOffline(this.client.lastError)
        : cell.kind === 'session' ? R.renderSession(cell.entry, now)
        : cell.kind === 'overflow' ? R.renderOverflow(cell)
        : R.renderEmpty();
      slot.action.setImage(img).catch((e) => streamDeck.logger.warn(`setImage: ${e.message}`));
    });
    for (const id of this.others.keys()) this.renderOther(id);
  }

  renderOther(id) {
    const o = this.others.get(id);
    if (!o) return;
    const c = M.counts(this.list);
    const connected = this.client.connected;
    let img;
    switch (o.kind) {
      case 'next': img = R.renderNext(c, connected); break;
      case 'overview': img = R.renderOverview(c, connected); break;
      case 'profile': img = R.renderProfile(this.profile, M.profilesOf(this.client.sessions)); break;
      case 'page': {
        const shown = [...this.cellBySlot.values()].filter((cell) => cell.kind === 'session').length;
        img = R.renderPage(this.page, this.pages, shown, c.total);
        break;
      }
      case 'alarm': img = R.renderAlarm(this.alarm); break;
      default: return;
    }
    o.action.setImage(img).catch((e) => streamDeck.logger.warn(`setImage: ${e.message}`));
  }

  /** Key down: a green key starts the long-press timer, everything else acts right away. */
  pressSlot(action) {
    const cell = this.cellBySlot.get(action.id);
    if (!cell) return;
    if (cell.kind === 'overflow') return this.nextPage();
    if (cell.kind !== 'session') return;
    if (cell.entry.kind !== 'done') return this.jump(cell.entry, action);
    const timer = setTimeout(() => { this.holds.delete(action.id); this.checkOff(cell.entry, action); }, LONG_PRESS_MS);
    this.holds.set(action.id, timer);
  }

  /** Key up before the timer fired: a short tap on a green key jumps and checks it off. */
  releaseSlot(action) {
    const timer = this.holds.get(action.id);
    if (!timer) return;
    clearTimeout(timer);
    this.holds.delete(action.id);
    const cell = this.cellBySlot.get(action.id);
    if (cell?.kind === 'session') return this.jump(cell.entry, action);
  }

  /** Long press: checks a finished session off without leaving the current window. */
  async checkOff(entry, action) {
    try {
      await this.client.ack(entry.session.id, true);
      await action.showOk();
    } catch (e) {
      streamDeck.logger.error(`ack: ${e.message}`);
      await action.showAlert();
    }
  }

  /** Brings the session's terminal to the front; a finished turn counts as checked off afterwards. */
  async jump(entry, action) {
    try {
      const r = await this.client.focus(entry.session.id);
      if (!r.ok) {
        streamDeck.logger.warn(`focus ${entry.label}: ${r.reason}`);
        await action.showAlert();
        return;
      }
      if (entry.kind === 'done') await this.client.ack(entry.session.id, true);
      await action.showOk();
    } catch (e) {
      streamDeck.logger.error(`focus: ${e.message}`);
      await action.showAlert();
    }
  }

  nextPage() { this.page = (this.page + 1) % Math.max(1, this.pages); this.renderAll(); }

  cycleProfile() {
    const all = ['', ...M.profilesOf(this.client.sessions)];
    this.profile = all[(all.indexOf(this.profile) + 1) % all.length];
    this.page = 0;
    this.saveSettings();
    this.update(false);
  }

  toggleAlarm() {
    this.alarm = !this.alarm;
    this.saveSettings();
    this.renderAll();
    if (this.alarm) playSound();
  }
}

class BoardAction extends SingletonAction {
  constructor(board) { super(); this.board = board; }
}

export class SessionSlot extends BoardAction {
  manifestId = `${UUID}.slot`;
  onWillAppear(ev) { this.board.addSlot(ev.action); }
  onWillDisappear(ev) { this.board.removeSlot(ev.action.id); }
  onKeyDown(ev) { return this.board.pressSlot(ev.action); }
  onKeyUp(ev) { return this.board.releaseSlot(ev.action); }
}

export class NextUrgent extends BoardAction {
  manifestId = `${UUID}.next`;
  onWillAppear(ev) { this.board.addOther(ev.action, 'next'); }
  onWillDisappear(ev) { this.board.removeOther(ev.action.id); }
  onKeyDown(ev) {
    const entry = M.nextTarget(this.board.list);
    return entry ? this.board.jump(entry, ev.action) : ev.action.showAlert();
  }
}

export class Overview extends BoardAction {
  manifestId = `${UUID}.overview`;
  onWillAppear(ev) { this.board.addOther(ev.action, 'overview'); }
  onWillDisappear(ev) { this.board.removeOther(ev.action.id); }
  onKeyDown(ev) {
    const url = this.board.client.dashboardUrl();
    return url ? streamDeck.system.openUrl(url) : ev.action.showAlert();
  }
}

export class ProfileFilter extends BoardAction {
  manifestId = `${UUID}.profile`;
  onWillAppear(ev) { this.board.addOther(ev.action, 'profile'); }
  onWillDisappear(ev) { this.board.removeOther(ev.action.id); }
  onKeyDown() { this.board.cycleProfile(); }
}

export class Page extends BoardAction {
  manifestId = `${UUID}.page`;
  onWillAppear(ev) { this.board.addOther(ev.action, 'page'); }
  onWillDisappear(ev) { this.board.removeOther(ev.action.id); }
  onKeyDown() { this.board.nextPage(); }
}

export class Alarm extends BoardAction {
  manifestId = `${UUID}.alarm`;
  onWillAppear(ev) { this.board.addOther(ev.action, 'alarm'); }
  onWillDisappear(ev) { this.board.removeOther(ev.action.id); }
  onKeyDown() { this.board.toggleAlarm(); }
}
