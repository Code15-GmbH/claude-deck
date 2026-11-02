# claude-deck

A Stream Deck plugin that puts every running Claude Code session on a key. Red means Claude is waiting for a permission, amber means the turn is finished and nobody has looked yet, dark with a green edge means Claude is working. Press a key and the plugin brings that session's iTerm2 tab to the front, even when it lives on another monitor or another macOS Space.

Design canvas: https://claude.ai/artifact/D5U39p6TPacMKAtRztTwTT

```
Claude Code session (any profile)      claude-tower (localhost:4777)        Stream Deck
  hooks: SessionStart, UserPrompt-  -->  state of all sessions          -->  plugin: SSE /api/stream, keys rendered as SVG
         Submit, Stop, Notification,     iTerm2 lookup via AppleScript  <--  key press: POST /api/focus {id}
         SessionEnd
```

The plugin installs no hooks of its own. It reads [claude-tower](../claude-tower), the local server that already receives the Claude Code hooks from every profile and knows each session's status, profile, working directory, iTerm2 session id and desktop. When the tower is not running, every session key shows "Offline".

## Keys

| Key | Shows | On press |
|---|---|---|
| **Session** (place as many as you like) | Status, project name, profile badge, time since the last event. Session keys fill in reading order: red first, then amber, green, idle. | Jumps to the session. A finished session counts as seen afterwards and moves to the back. |
| **Next urgent** | How many sessions need you | Jumps to the most urgent one (permission before finished) |
| **Overview** | Counters per status | Opens the tower dashboard in the browser |
| **Profile filter** | Current profile (`alle`, `belege`, `main`, `planni`, …) | Cycles through all profiles |
| **Page** | Page x/y and how many sessions are visible | Pages forward when more sessions run than session keys exist. The last session slot then shows "+N weitere" and pages forward as well. |
| **Alarm** | on/off | Plays a sound (Glass) as soon as a session newly waits for a permission |

Session keys need no settings. Their position on the deck defines their order. The profile filter and the alarm switch are remembered across restarts.

### Key states

| State | Look | Source |
|---|---|---|
| Freigabe (permission) | solid red, white text | tower status `waiting`, not acknowledged |
| Fertig (finished) | solid amber, dark text | tower status `done`, not acknowledged |
| Arbeitet (working) | dark, green top edge | tower status `working` |
| Bereit (ready) | dark, grey top edge | idle, or finished and already seen |
| Verwaist (orphaned) | dark, grey edge, warning icon | the iTerm2 tab is gone but the claude process still runs |
| Frei (free) | near-black, dashed border | no session for this slot |
| +N weitere (overflow) | panel with count and status dots | more sessions than slots |
| Offline | dark, red edge | the tower server is not reachable |

## Requirements

- macOS, iTerm2 (the jump works for iTerm2 sessions; other terminals only get their app activated)
- Stream Deck app 7.1 or newer, Node.js 20 or newer
- claude-tower set up and running, with its hooks installed in every Claude profile (`npm run hooks:install` there)

## Installation

```sh
npm install
npm install -g @elgato/cli      # provides the `streamdeck` command
npm run build                   # generates the icons and bundles the plugin into de.code15.claude-sessions.sdPlugin/bin
streamdeck dev                  # enables developer mode in the Stream Deck app (once, needed for linked plugins)
npm run link                    # symlinks the plugin folder into the Stream Deck app
npm run restart                 # starts the plugin (also after every build)
```

The Stream Deck app now lists a category **Claude Sessions** with the six actions. Either drag them onto the deck by hand or import the ready-made layout:

```sh
npm run profile                 # writes dist/Claude Sessions.streamDeckProfile (Stream Deck MK.2, 5×3)
open "dist/Claude Sessions.streamDeckProfile"
```

The profile fills the top two rows with ten session keys and the bottom row with Next urgent, Overview, Profile filter, Page and Alarm. After the import, select the profile "Claude Sessions" in the Stream Deck app; the app does not switch to it automatically. For another device pass its model, for example `node scripts/make-profile.mjs 20GAT9901` for the XL (the layout stays 5×3, the remaining keys are free).

### macOS permissions

- On the first jump macOS asks whether `node` (the tower server) may control iTerm2. Allow it.
- To make the jump switch desktops as well, enable System Settings → Desktop & Dock → "When switching to an application, switch to a Space with open windows for the application".

## Development

```sh
npm test            # logic: ordering, paging, line breaking (node --test)
npm run watch       # rebuilds on change and restarts the plugin
npm run validate    # checks the manifest
```

| Path | Purpose |
|---|---|
| `src/plugin.js` | entry point: registers the actions, connects to Stream Deck and the tower |
| `src/actions.js` | the board (filter, page, alarm, slot registry) and the six actions |
| `src/model.js` | pure logic without I/O: session kinds, ordering, duplicate labels, paging, line breaking |
| `src/render.js` | key images as 144 × 144 SVG |
| `src/tower.js` | client for the tower: SSE stream, `/api/focus`, `/api/ack` |
| `scripts/make-icons.mjs` | writes the PNG icons the manifest references, without any image library |
| `scripts/make-profile.mjs` | writes the importable `.streamDeckProfile` |
| `de.code15.claude-sessions.sdPlugin/` | the plugin as the Stream Deck app sees it: manifest, icons, bundled code, logs |

Plugin logs are written to `de.code15.claude-sessions.sdPlugin/logs/`. The tower config (`~/.claude-tower/config.json`) provides the port and the view token; the plugin re-reads it on every reconnect.

### Tower API used

| Call | Purpose |
|---|---|
| `GET /api/stream?key=<viewToken>` | Server-Sent Events with the full session list on every change |
| `POST /api/focus?key=<viewToken>` `{id}` | brings the session's terminal to the front; answers `{ok, reason}` |
| `POST /api/ack?key=<viewToken>` `{id, acked}` | marks a finished session as seen |

## Limitations

- Jumping works for sessions in iTerm2. For Cursor, VS Code or Terminal.app only the app is activated.
- When the iTerm2 window sits on another desktop, the switch depends on the macOS setting above. Occasionally macOS lands in the right Space only on the second press.
- "Working" stays on when a response is cancelled with Esc, because no Stop hook fires then. The age counter makes that visible.
- The key count of the Stream Deck SDK is fixed, hence the slot principle and the overflow key.
- The Elgato MCP server (`@elgato/mcp-server`) is registered in Claude Code but not needed by the plugin. It lets a Claude session place keys and profiles once the Stream Deck app accepts MCP connections.
