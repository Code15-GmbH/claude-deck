#!/usr/bin/env node
// Claude Code hook -> Claude Deck. Wire it for SessionStart, UserPromptSubmit, Stop,
// Notification and SessionEnd (scripts/install-hooks.mjs does that).
//
// It reads the hook JSON from stdin, adds what only the session process knows
// (profile, claude pid, terminal ids, AI session title) and POSTs it to the deck server
// server. It NEVER blocks Claude: every failure exits 0 silently (errors are logged
// to ~/.claude-deck/hook-errors.log) and the request times out after 1.5 s.
//
// Target: CLAUDE_DECK_URL env, else http://127.0.0.1:<port from ~/.claude-deck/config.json>.
// CLAUDE_DECK_DRY_RUN=1 prints the event instead of sending it.
//
// The logic lives in hook-lib.mjs (unit-tested); this file only runs it.
import { run } from './hook-lib.mjs';

await run();
process.exit(0);
