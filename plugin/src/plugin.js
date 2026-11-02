// Entry point of the Stream Deck plugin (bundled to de.code15.claude-sessions.sdPlugin/bin/plugin.js).
import streamDeck from '@elgato/streamdeck';
import { Alarm, Board, NextUrgent, Overview, Page, ProfileFilter, SessionSlot } from './actions.js';
import { TowerClient } from './tower.js';

const tower = new TowerClient();
const board = new Board(tower);

for (const Action of [SessionSlot, NextUrgent, Overview, ProfileFilter, Page, Alarm]) {
  streamDeck.actions.registerAction(new Action(board));
}

tower.on('connection', (ok, err) => streamDeck.logger.info(ok ? 'Tower verbunden' : `Tower getrennt: ${err}`));
tower.on('error', (e) => streamDeck.logger.warn(`Tower: ${e.message}`));

streamDeck.connect().then(async () => {
  await board.loadSettings();
  tower.start();
});
