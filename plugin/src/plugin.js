// Entry point of the Stream Deck plugin (bundled to de.code15.claude-sessions.sdPlugin/bin/plugin.js).
import streamDeck from '@elgato/streamdeck';
import { Alarm, Board, NextUrgent, Overview, Page, ProfileFilter, SessionSlot } from './actions.js';
import { DeckClient } from './client.js';

const client = new DeckClient();
const board = new Board(client);

for (const Action of [SessionSlot, NextUrgent, Overview, ProfileFilter, Page, Alarm]) {
  streamDeck.actions.registerAction(new Action(board));
}

client.on('connection', (ok, err) => streamDeck.logger.info(ok ? 'Server connected' : `Server disconnected: ${err}`));
client.on('error', (e) => streamDeck.logger.warn(`Server: ${e.message}`));

streamDeck.connect().then(async () => {
  await board.loadSettings();
  client.start();
});
