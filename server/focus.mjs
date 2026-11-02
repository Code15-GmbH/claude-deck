// Brings a Claude session's terminal to the front (used by the Stream Deck plugin).
//
// iTerm2: the hook recorded ITERM_SESSION_ID, whose second half is the session's
// `unique id`. AppleScript selects window, tab and session and activates iTerm2.
// macOS then switches to the Mission Control desktop that holds the window, as long as
// "When switching to an application, switch to a Space with open windows" is on
// (System Settings > Desktop & Dock). Other terminals only get "activate app".
import { execFile } from 'node:child_process';

const run = (cmd, args, timeout = 4000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() }));
});

const ITERM_FOCUS = `
on run argv
  set wanted to item 1 of argv
  if application "iTerm2" is not running then return "not-running"
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if unique id of s is wanted then
            select s
            select t
            select w
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "not-found"
end run`;

const APP_BY_TERM = { 'iTerm.app': 'iTerm2', Apple_Terminal: 'Terminal', vscode: 'Visual Studio Code', WarpTerminal: 'Warp', ghostty: 'Ghostty' };

/** Focuses the terminal of one session. Resolves {ok, reason}. Never throws. */
export async function focusSession(s) {
  if (!s) return { ok: false, reason: 'unknown-session' };
  const uuid = s.term?.itermSession;
  if (uuid) {
    const r = await run('osascript', ['-e', ITERM_FOCUS, uuid]);
    if (r.ok && r.out === 'ok') return { ok: true, reason: 'iterm' };
    if (r.ok && r.out === 'not-found') return { ok: false, reason: 'tab-closed' };
    if (r.ok && r.out === 'not-running') return { ok: false, reason: 'iterm-not-running' };
    return { ok: false, reason: r.err || 'osascript-failed' };
  }
  const app = s.term?.cursor ? 'Cursor' : APP_BY_TERM[s.term?.program];
  if (!app) return { ok: false, reason: 'no-terminal-info' };
  const r = await run('osascript', ['-e', `tell application "${app}" to activate`]);
  return r.ok ? { ok: true, reason: 'app-only' } : { ok: false, reason: r.err || 'osascript-failed' };
}
