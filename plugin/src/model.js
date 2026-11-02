// Pure logic: which sessions show up, in which order, on which key. No I/O, unit-tested.
//
// A "kind" is what the key shows (server status + acknowledgement + terminal state):
//   waiting  Claude asks for a permission             -> red, most urgent
//   done     turn finished, nobody looked yet          -> amber
//   working  Claude is on it                           -> dark with green edge
//   gone     the iTerm tab is closed but claude lives  -> dark with grey edge, warning
//   idle     open, nothing pending (or already acked)  -> dark with grey edge
// Ended sessions are not shown at all.

const RANK = { waiting: 0, done: 1, working: 2, gone: 3, idle: 4 };

export function kindOf(s) {
  if (!s || s.status === 'ended') return null;
  if (s.location?.gone) return 'gone';
  if (s.status === 'waiting' && !s.ackedAt) return 'waiting';
  if (s.status === 'done' && !s.ackedAt) return 'done';
  if (s.status === 'working') return 'working';
  return 'idle';
}

/** Timestamp the key's age counter refers to. */
export function sinceOf(s, kind) {
  if (kind === 'waiting' || kind === 'done') return s.attentionAt || s.updatedAt || 0;
  if (kind === 'working') return s.turnStartedAt || s.updatedAt || 0;
  return Math.max(s.updatedAt || 0, s.ackedAt || 0);
}

/** Badge text: "code15-belege" -> "belege", "main" -> "main". At most 8 characters. */
export function shortProfile(name) {
  name = String(name || 'main');
  if (name.length <= 8) return name;
  const parts = name.split(/[-_]/).filter(Boolean);
  return (parts[parts.length - 1] || name).slice(0, 8);
}

/** Profile names that currently have a live session, sorted. */
export function profilesOf(sessions) {
  const set = new Set();
  for (const s of sessions || []) if (kindOf(s)) set.add(s.profile || 'main');
  return [...set].sort();
}

/**
 * Sessions to show, most urgent first. Each entry: {session, kind, since, label}.
 * Two sessions in the same project and profile get "#1", "#2" by start time.
 */
export function visibleSessions(sessions, profile = '') {
  const list = [];
  for (const s of sessions || []) {
    const kind = kindOf(s);
    if (!kind) continue;
    if (profile && (s.profile || 'main') !== profile) continue;
    list.push({ session: s, kind, since: sinceOf(s, kind), label: s.project || '?' });
  }
  list.sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.since - a.since);
  const groups = new Map();
  for (const e of list) {
    const key = `${e.session.profile || 'main'}/${e.session.project || '?'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    [...group].sort((a, b) => (a.session.startedAt || 0) - (b.session.startedAt || 0))
      .forEach((e, i) => { e.label = `${e.session.project || '?'} #${i + 1}`; });
  }
  return list;
}

export function counts(list) {
  const c = { waiting: 0, done: 0, working: 0, gone: 0, idle: 0, total: 0 };
  for (const e of list || []) { c[e.kind] += 1; c.total += 1; }
  return c;
}

/** "42 s", "3 min", "1 h 05" */
export function formatAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

/** Breaks a project name into at most two lines of `max` characters, preferring -_. and space boundaries. */
export function wrapName(name, max = 13) {
  const text = String(name ?? '').trim();
  if (!text) return [''];
  const tokens = [];
  for (const t of text.match(/[^-_.\s]+[-_.]?|[-_.]/g) || [text]) {
    for (let i = 0; i < t.length; i += max) tokens.push(t.slice(i, i + max));
  }
  const lines = [];
  let cur = '';
  let i = 0;
  for (; i < tokens.length; i++) {
    const tok = tokens[i];
    if ((cur + tok).length <= max) { cur += tok; continue; }
    if (cur) lines.push(cur);
    cur = tok;
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && cur) { lines.push(cur); cur = ''; i = tokens.length; }
  const leftover = i < tokens.length || cur;
  if (leftover) lines[1] = lines[1].slice(0, max - 1).replace(/[-_.\s]+$/, '') + '…';
  return lines.map((l) => l.replace(/\s+$/, ''));
}

/**
 * Distributes the list over `slots` keys. When the list does not fit, the last key of
 * every page becomes an overflow key ("+N weitere") that pages forward.
 * Returns {page, pages, cells: [{kind:'session', entry} | {kind:'overflow', more, kinds} | {kind:'empty'}]}.
 */
export function paginate(list, slots, page = 0) {
  if (slots <= 0) return { page: 0, pages: 1, cells: [] };
  const overflow = list.length > slots;
  const cap = overflow ? Math.max(1, slots - 1) : slots;
  const pages = Math.max(1, Math.ceil(list.length / cap));
  page = ((page % pages) + pages) % pages;
  const start = page * cap;
  const chunk = list.slice(start, start + cap);
  const cells = chunk.map((entry) => ({ kind: 'session', entry }));
  while (cells.length < cap) cells.push({ kind: 'empty' });
  if (overflow) {
    const rest = [...list.slice(start + cap), ...list.slice(0, start)]; // what the next pages hold, in order
    cells.push({ kind: 'overflow', more: rest.length, kinds: rest.slice(0, 3).map((e) => e.kind) });
  }
  return { page, pages, cells };
}
