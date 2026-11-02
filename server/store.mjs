// Pure session state logic (no I/O) so it can be tested without a server.
//
// Status per session:
//   idle     session is open, nothing asked yet (or after /clear)
//   working  a prompt was submitted, Claude is on it
//   waiting  Claude needs a decision (permission prompt)
//   done     turn finished -> needs your attention
//   ended    session closed (SessionEnd, or the claude process is gone)
//
// ackedAt: you cleared a done/waiting strip from the attention bay by hand. The status stays
// truthful; the next prompt, stop or permission prompt brings the session back.
import path from 'node:path';

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

const ENDED_TTL_MS = 12 * 3600e3; // ended strips disappear after 12 h
const STALE_TTL_MS = 3 * 86400e3; // anything silent for 3 days disappears

function isDecision(ev) {
  const type = ev.notificationType || '';
  return type === 'permission_prompt' || type.startsWith('elicitation') || (!type && /permission/i.test(ev.message || ''));
}

export function newSession(ev) {
  return {
    id: ev.sessionId,
    profile: ev.profile || 'main',
    cwd: ev.cwd || '',
    project: ev.cwd ? path.basename(ev.cwd) : '?',
    pid: ev.pid || null,
    transcript: ev.transcript || '',
    term: ev.term || {},
    status: 'idle',
    title: '',
    prompt: '',
    lastMessage: '',
    waitingReason: '',
    turns: 0,
    startedAt: ev.ts,
    updatedAt: ev.ts,
    turnStartedAt: null,
    finishedAt: null,
    attentionAt: null,
    ackedAt: null,
    endedAt: null,
    location: null,
    branch: '',
  };
}

/** Applies one hook event. Returns true when something visible changed. */
export function applyEvent(sessions, ev) {
  if (!ev || !ev.sessionId || !ev.event) return false;
  const ts = Number(ev.ts) || Date.now();
  if (ev.event === 'Notification' && !isDecision(ev)) return false; // idle reminders duplicate "done"
  let s = sessions[ev.sessionId];
  if (!s) {
    if (ev.event === 'SessionEnd') return false; // nothing to end
    s = sessions[ev.sessionId] = newSession({ ...ev, ts });
  }
  // keep the freshest facts about the session
  if (ev.cwd) { s.cwd = ev.cwd; s.project = path.basename(ev.cwd); }
  if (ev.profile) s.profile = ev.profile;
  if (ev.pid) s.pid = ev.pid;
  if (ev.transcript) s.transcript = ev.transcript;
  if (ev.term && Object.keys(ev.term).length) s.term = ev.term;
  if (ev.title) s.title = clip(ev.title, 120);
  s.updatedAt = ts;

  switch (ev.event) {
    case 'SessionStart':
      if (ev.source === 'clear') { s.prompt = ''; s.lastMessage = ''; s.title = ev.title ? s.title : ''; }
      if (ev.source !== 'compact' && s.status !== 'working') s.status = 'idle';
      s.endedAt = null;
      break;
    case 'UserPromptSubmit':
      s.status = 'working';
      if (ev.prompt) s.prompt = clip(ev.prompt, 400);
      s.turnStartedAt = ts;
      s.turns += 1;
      s.waitingReason = '';
      s.ackedAt = null;
      s.endedAt = null;
      break;
    case 'Stop':
      s.status = 'done';
      s.finishedAt = ts;
      s.attentionAt = ts;
      s.ackedAt = null;
      s.waitingReason = '';
      if (ev.lastMessage) s.lastMessage = clip(ev.lastMessage, 400);
      if (ev.prompt && !s.prompt) s.prompt = clip(ev.prompt, 400);
      break;
    case 'Notification':
      s.status = 'waiting';
      s.attentionAt = ts;
      s.ackedAt = null;
      s.waitingReason = clip(ev.message, 160);
      break;
    case 'SessionEnd':
      s.status = 'ended';
      s.endedAt = ts;
      break;
    default:
      return false;
  }
  return true;
}

export const needsYou = (s) => (s.status === 'done' || s.status === 'waiting') && !s.ackedAt;

/** Clears a strip from the attention bay (acked = false puts it back). Returns true when something changed. */
export function acknowledge(sessions, id, acked = true, now = Date.now()) {
  const s = sessions[id];
  if (!s || (s.status !== 'done' && s.status !== 'waiting') || Boolean(s.ackedAt) === acked) return false;
  s.ackedAt = acked ? now : null;
  return true;
}

/** Housekeeping; returns true when something was removed. */
export function prune(sessions, now = Date.now()) {
  let changed = false;
  for (const [id, s] of Object.entries(sessions)) {
    const gone = (s.status === 'ended' && now - (s.endedAt || s.updatedAt) > ENDED_TTL_MS) || now - s.updatedAt > STALE_TTL_MS;
    if (gone) { delete sessions[id]; changed = true; }
  }
  return changed;
}

/** Order used by the board: attention bay newest-first, working bay newest-first, cleared strips lead the quiet row. */
export function board(sessions) {
  const list = Object.values(sessions);
  const attention = list.filter(needsYou)
    .sort((a, b) => (b.attentionAt || 0) - (a.attentionAt || 0));
  const working = list.filter((s) => s.status === 'working')
    .sort((a, b) => (b.turnStartedAt || 0) - (a.turnStartedAt || 0));
  const quiet = list.filter((s) => s.status !== 'working' && !needsYou(s))
    .sort((a, b) => Math.max(b.updatedAt, b.ackedAt || 0) - Math.max(a.updatedAt, a.ackedAt || 0));
  return { attention, working, quiet };
}
