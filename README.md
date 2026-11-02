# claude-deck

Every Claude Code session at a glance, and one press to get to the one that needs you.

Claude Code hooks report each session to a small local server. Two views read it: a **Stream Deck plugin** that puts every session on a key (red waits for a permission, amber is finished, green is working) and jumps to its iTerm2 tab on press, and a **browser dashboard** for a tablet or wall screen. Works across all Claude profiles, projects, monitors and macOS Spaces.

Design canvas of the deck layout: https://claude.ai/artifact/D5U39p6TPacMKAtRztTwTT

```
Claude Code session (any profile)         claude-deck server (localhost:4777)        Views
  hooks: SessionStart, UserPromptSubmit,   state of every session               -->  Stream Deck plugin (keys as SVG, press = jump)
         Stop, Notification, SessionEnd    iTerm2 window/tab/desktop lookup     -->  browser dashboard (tablet, Raspberry Pi)
  hook/claude-deck-hook.sh (~0.1 s)        AppleScript focus on request
```

Nothing leaves the machine: hooks post to `127.0.0.1`, the dashboard is served in your LAN with a key.

## What is in the repo

| Path | Purpose |
|---|---|
| `server/` | zero-dependency Node server: receives hook events, keeps `~/.claude-deck/state.json`, locates iTerm2 sessions (AppleScript plus a small Swift helper for Mission Control desktops), focuses a session on request |
| `hook/` | the Claude Code hook: reads the event from stdin, adds profile, pid and terminal ids, posts it to the server, never blocks Claude |
| `scripts/install-hooks.mjs` | adds or removes the hook in every Claude profile's `settings.json` |
| `plugin/` | the Stream Deck plugin (`de.code15.claude-sessions`): sources, manifest, icons, profile generator |
| `web/` | the React dashboard |
| `test/` | unit tests for the server's state logic and the plugin's key logic |

## Requirements

- macOS with iTerm2 (jumping to a session works for iTerm2; other terminals only get their app activated)
- Node.js 20 or newer
- For the Stream Deck part: Stream Deck app 7.1 or newer and `npm install -g @elgato/cli`
- Optional: `swiftc` (Xcode command line tools) for desktop names such as "Desktop 5 · Display 2"

## Setup

```sh
npm install
npm run hooks:check        # dry run: shows which settings.json files would change
npm run hooks:install      # writes the hook into every profile (backup next to each file)
npm run web:build          # builds the dashboard
npm start                  # starts the server and prints the dashboard links with key
```

The first start creates `~/.claude-deck/config.json` (mode 600) with the port, an `ingestToken` for the hooks and a `viewToken` for the dashboard link. Profiles are `~/.claude` plus every `~/.claude-profiles/<name>`; existing hooks from other tools stay untouched. New hooks apply to newly started Claude sessions.

When the server runs as a LaunchAgent, macOS asks once whether `node` may control iTerm2. `scripts/de.code15.claude-deck.plist` is a template for that; the install command is in the file.

## Stream Deck

```sh
npm run plugin:build       # generates icons and bundles the plugin
streamdeck dev             # once: developer mode of the Stream Deck app, needed for linked plugins
npm run plugin:link        # symlinks plugin/de.code15.claude-sessions.sdPlugin into the Stream Deck app
npm run plugin:restart     # starts the plugin (also after every build)
```

The Stream Deck app now lists a category **Claude Sessions** with six actions. Drag them onto keys by hand or import the ready-made layout for a Stream Deck MK.2 (5 × 3):

```sh
npm run plugin:profile     # writes plugin/dist/Claude Sessions.streamDeckProfile
open "plugin/dist/Claude Sessions.streamDeckProfile"
```

Then select the profile "Claude Sessions" in the Stream Deck app. For another device pass its model, for example `node plugin/scripts/make-profile.mjs 20GAT9901` for the XL.

| Key | Shows | On press |
|---|---|---|
| **Session** (place as many as you like) | Status, project name, profile badge, time since the last event. Session keys fill in reading order: permission first, then finished, working, idle. | Jumps to the session. A finished session counts as seen afterwards and moves to the back. |
| **Next urgent** | How many sessions need you | Jumps to the most urgent one |
| **Overview** | Counters per status | Opens the dashboard in the browser |
| **Profile filter** | Current profile or "alle" | Cycles through the profiles |
| **Page** | Page x/y, how many sessions are visible | Pages forward when more sessions run than session keys exist. The last session slot then shows "+N weitere" and pages as well. |
| **Alarm** | on/off | Plays a sound as soon as a session newly waits for a permission |

Session keys need no settings; their position on the deck defines the order. Profile filter and alarm are remembered.

| Key state | Look | Meaning |
|---|---|---|
| Freigabe | solid red | Claude asks for a permission |
| Fertig | solid amber | turn finished, nobody looked yet |
| Arbeitet | dark, green edge | Claude is working |
| Bereit | dark, grey edge | idle, or finished and already seen |
| Verwaist | dark, warning icon | the iTerm2 tab is gone but the claude process still runs |
| Frei | dashed border | no session for this slot |
| +N weitere | count and status dots | more sessions than slots |
| Offline | red edge | the server is not reachable |

Key labels and the dashboard are in German for now.

### macOS settings for the jump

- On the first press macOS asks whether `node` (the server) may control iTerm2. Allow it.
- To make the jump switch desktops as well, enable System Settings → Desktop & Dock → "When switching to an application, switch to a Space with open windows for the application".

## Dashboard

Open `http://<mac>.local:4777/?key=<viewToken>` on a tablet (`npm run urls` prints the links). The device remembers the key. URL options: `minimal=1` hides prompts and results, `sound=1` chimes on finished and permission, `still=1` disables animations. For a Raspberry Pi wall screen:

```sh
chromium-browser --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required \
  "http://<mac>.local:4777/?key=<viewToken>&sound=1"
```

The first access from another device may trigger the macOS firewall prompt for `node`.

## Server API

All calls except `/api/event` take the view token as `?key=` or as a bearer token.

| Call | Purpose |
|---|---|
| `POST /api/event` (bearer `ingestToken`) | hook events |
| `GET /api/state` | current board as JSON |
| `GET /api/stream` | Server-Sent Events, full state on every change |
| `POST /api/ack` `{id, acked}` | mark a finished or waiting session as seen, or put it back |
| `POST /api/focus` `{id}` | bring the session's terminal to the front, answers `{ok, reason}` |
| `GET /api/health` | `{ok: true}` |

Session status: `idle`, `working`, `waiting` (permission prompt), `done`, `ended`. Ended sessions disappear after 12 hours, silent ones after 3 days. A session whose claude process is gone counts as ended; a waiting session whose transcript moves on goes back to working.

Environment: `CLAUDE_DECK_HOME` (data folder, default `~/.claude-deck`), `CLAUDE_DECK_PORT`, `CLAUDE_DECK_HOST`; for the hook `CLAUDE_DECK_URL` and `CLAUDE_DECK_TOKEN` to post to another server, `CLAUDE_DECK_DRY_RUN=1` to print the event instead.

## Development

```sh
npm test                 # server state logic and plugin key logic (node --test)
npm run simulate         # plays five fake sessions against the running server (--fast, --end)
npm run web:dev          # dashboard with hot reload, proxies /api to the running server
npm run plugin:watch     # rebuilds the plugin on change and restarts it
npm run plugin:validate  # checks the plugin manifest
```

Plugin logs: `plugin/de.code15.claude-sessions.sdPlugin/logs/`. Server log when run as LaunchAgent: `~/.claude-deck/server.log`.

## Limitations

- Desktop detection uses the private SkyLight API (the same one yabai reads from). It may stop working after a macOS update; everything else keeps working, only the desktop name is missing.
- When the iTerm2 window sits on another desktop, the jump depends on the macOS setting above. Occasionally macOS lands in the right Space only on the second press.
- "Working" stays on when a response is cancelled with Esc, because no Stop hook fires then. The age counter on the key makes that visible.

## License

MIT, see `LICENSE`.
