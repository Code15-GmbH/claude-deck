// Finds out *where* a Claude session lives on this Mac: terminal app, window, tab
// and Mission Control desktop. Runs on the Mac (server side), so the hook stays fast.
//
// Chain for iTerm2 (what Nico uses):
//   ITERM_SESSION_ID (from the hook env)  ->  iTerm AppleScript: which window/tab holds
//   that session  ->  window id (= CGWindowID)  ->  spaces helper (private SkyLight API)
//   ->  "Desktop 5".
// Other terminals (Cursor, VS Code, Terminal.app) only get the app name + TTY.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SWIFT_SRC = path.join(HERE, 'spaces.swift');
const HELPER = path.join(HERE, '..', '.bin', 'spaces');

const run = (cmd, args, timeout = 3000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
});

let helperReady = null;
function ensureHelper() {
  if (helperReady) return helperReady;
  helperReady = (async () => {
    try {
      const fresh = fs.existsSync(HELPER) && fs.statSync(HELPER).mtimeMs >= fs.statSync(SWIFT_SRC).mtimeMs;
      if (fresh) return true;
      fs.mkdirSync(path.dirname(HELPER), { recursive: true });
      await run('swiftc', ['-O', SWIFT_SRC, '-o', HELPER], 120000);
      return fs.existsSync(HELPER);
    } catch { return false; }
  })();
  return helperReady;
}

const ITERM_SCRIPT = `
if application "iTerm2" is not running then return ""
set TB to character id 9
tell application "iTerm2"
  set out to ""
  repeat with w in windows
    set tabNo to 0
    repeat with t in tabs of w
      set tabNo to tabNo + 1
      repeat with s in sessions of t
        set out to out & (id of w) & TB & tabNo & TB & (unique id of s) & TB & (tty of s) & TB & (name of w) & linefeed
      end repeat
    end repeat
  end repeat
  return out
end tell`;

async function itermSessions() {
  const out = await run('osascript', ['-e', ITERM_SCRIPT]);
  if (!out.trim()) return null; // iTerm not running or AppleScript failed -> unknown, not "closed"
  const map = new Map();
  for (const line of out.split('\n')) {
    const [windowId, tab, uuid, tty, windowTitle] = line.split('\t');
    if (uuid) map.set(uuid, { windowId: Number(windowId), tab: Number(tab), tty: tty?.replace('/dev/', ''), windowTitle: (windowTitle || '').trim() });
  }
  return map;
}

async function spacesFor(windowIds) {
  if (!windowIds.length || !(await ensureHelper())) return { windows: {}, current: [] };
  try { return JSON.parse(await run(HELPER, windowIds.map(String))); } catch { return { windows: {}, current: [] }; }
}

const APP_NAMES = { 'iTerm.app': 'iTerm', Apple_Terminal: 'Terminal', vscode: 'VS Code', WarpTerminal: 'Warp', ghostty: 'Ghostty' };
export const appName = (term) => (term?.cursor ? 'Cursor' : APP_NAMES[term?.program] || term?.program || '');

/** Resolves locations for many sessions at once (one AppleScript + one helper call). */
export async function locateAll(sessions) {
  const result = new Map();
  const iterm = sessions.filter((s) => s.term?.itermSession);
  let map = new Map();
  let known = true;
  if (iterm.length) { map = await itermSessions(); known = Boolean(map); map ||= new Map(); }
  const windowIds = [...new Set(iterm.map((s) => map.get(s.term.itermSession)?.windowId).filter(Boolean))];
  const spaces = await spacesFor(windowIds);
  for (const s of sessions) {
    const loc = { app: appName(s.term), tty: s.term?.tty || '' };
    const hit = s.term?.itermSession && map.get(s.term.itermSession);
    if (hit) {
      loc.tty = hit.tty || loc.tty;
      loc.tab = hit.tab;
      loc.windowId = hit.windowId;
      loc.windowTitle = hit.windowTitle;
      loc.desktop = spaces.windows?.[String(hit.windowId)] || '';
    } else if (s.term?.itermSession && known) {
      loc.gone = true; // iTerm session no longer exists (tab closed)
    }
    result.set(s.id, loc);
  }
  return { locations: result, currentDesktop: spaces.current || [] };
}

export { ensureHelper };
