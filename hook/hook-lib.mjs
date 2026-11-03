// Logic of the Claude Deck hook (hook/claude-deck-hook.mjs is the entry point).
// Split out so it can be unit-tested without spawning a process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const deckDir = (env = process.env) => env.CLAUDE_DECK_HOME || path.join(os.homedir(), '.claude-deck');
export const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function logError(msg, dir = deckDir()) {
  try {
    const f = path.join(dir, 'hook-errors.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 256 * 1024) fs.truncateSync(f, 0);
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

// Which profile? CLAUDE_CONFIG_DIR is set by the claude() shell function for
// ~/.claude-profiles/<name>; unset means the main profile (~/.claude).
export function profile(transcript, env = process.env) {
  const dir = env.CLAUDE_CONFIG_DIR || '';
  const m = (dir || transcript || '').match(/\.claude-profiles\/([^/]+)/);
  return m ? m[1] : 'main';
}

// The claude process (for liveness checks) and its TTY: walk up a few parents.
export function claudeProcess(startPid = process.ppid, exec = execFileSync) {
  let pid = startPid;
  for (let i = 0; i < 5 && pid > 1; i++) {
    let line = '';
    try { line = exec('ps', ['-o', 'ppid=,tty=,comm=', '-p', String(pid)], { timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { break; }
    const [ppid, tty, ...rest] = line.split(/\s+/);
    const comm = rest.join(' ');
    if (/(^|\/)claude$/.test(comm)) return { pid, tty: tty && tty !== '??' ? tty : '' };
    pid = Number(ppid) || 0;
  }
  return { pid: null, tty: '' };
}

// Last AI-generated session title ("ai-title" entries) from the transcript tail.
export function aiTitle(file) {
  if (!file) return '';
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 512 * 1024);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    let at = text.lastIndexOf('"type":"ai-title"');
    if (at < 0) return '';
    const lineStart = text.lastIndexOf('\n', at) + 1;
    const lineEnd = text.indexOf('\n', at);
    return JSON.parse(text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)).aiTitle || '';
  } catch { return ''; }
}

export function target(env = process.env) {
  if (env.CLAUDE_DECK_URL) return { url: env.CLAUDE_DECK_URL.replace(/\/$/, '') + '/api/event', token: env.CLAUDE_DECK_TOKEN || '' };
  const cfg = JSON.parse(fs.readFileSync(path.join(deckDir(env), 'config.json'), 'utf8'));
  return { url: `http://127.0.0.1:${cfg.port || 4777}/api/event`, token: cfg.ingestToken };
}

/** Turns the hook JSON from stdin into the event the server expects (null when it is not one). */
export function buildEvent(input, { proc = { pid: null, tty: '' }, env = process.env, now = Date.now(), cwd = process.cwd() } = {}) {
  const event = input?.hook_event_name;
  if (!event || !input.session_id) return null;
  const ev = {
    v: 1,
    event,
    ts: now,
    sessionId: input.session_id,
    cwd: input.cwd || cwd,
    transcript: input.transcript_path || '',
    profile: profile(input.transcript_path, env),
    pid: proc.pid,
    term: {
      program: env.TERM_PROGRAM || '',
      cursor: Boolean(env.CURSOR_TRACE_ID),
      itermSession: (env.ITERM_SESSION_ID || '').split(':')[1] || '',
      tty: proc.tty,
      tmux: env.TMUX_PANE || '',
    },
    title: event === 'UserPromptSubmit' || event === 'Stop' || event === 'SessionStart' ? aiTitle(input.transcript_path) : '',
  };
  if (event === 'UserPromptSubmit') ev.prompt = clip(input.prompt, 400);
  if (event === 'Stop') ev.lastMessage = clip(input.last_assistant_message, 400);
  if (event === 'Notification') { ev.notificationType = input.notification_type || ''; ev.message = clip(input.message, 200); }
  if (event === 'SessionStart') ev.source = input.source || '';
  if (event === 'SessionEnd') ev.reason = input.reason || '';
  return ev;
}

/** Reads stdin, builds the event and posts it (or prints it with CLAUDE_DECK_DRY_RUN). */
export async function main({ readStdin = () => fs.readFileSync(0, 'utf8'), env = process.env, out = process.stdout, fetchImpl = fetch, proc } = {}) {
  let input;
  try { input = JSON.parse(readStdin()); } catch { return; }
  if (!input?.hook_event_name || !input.session_id) return;
  const ev = buildEvent(input, { proc: proc || claudeProcess(), env });

  if (env.CLAUDE_DECK_DRY_RUN) { out.write(JSON.stringify(ev, null, 2) + '\n'); return; }
  const { url, token } = target(env);
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(ev),
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) logError(`${ev.event}: HTTP ${res.status}`, deckDir(env));
}

/** Errors that only mean "server not running" are not worth logging. */
export const isQuietError = (err) => /ECONNREFUSED|fetch failed|ENOENT/.test(String(err?.cause?.code || err?.message));

/** main() wrapped so the hook never fails: errors are logged, never thrown. */
export async function run(opts = {}) {
  try { await main(opts); } catch (err) {
    // server not running is normal (ECONNREFUSED) -> don't spam the log with it
    if (!isQuietError(err)) logError(String(err?.message || err), deckDir(opts.env));
  }
}
