#!/usr/bin/env node
// Writes dist/Claude Sessions.streamDeckProfile: a ready-made Stream Deck MK.2 profile
// (5×3) with the layout from the design canvas. Double-click the file to import it.
//
//   row 0  Session  Session  Session  Session  Session
//   row 1  Session  Session  Session  Session  Session
//   row 2  Nächste  Übersicht  Profil  Seite  Alarm
//
// Format: zip of Profiles/<id>.sdProfile/... (same structure Stream Deck exports).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'de.code15.claude-sessions.sdPlugin', 'manifest.json'), 'utf8'));
const PLUGIN = { Name: manifest.Name, UUID: manifest.UUID, Version: manifest.Version };
const MODEL = process.argv[2] || '20GBA9901'; // Stream Deck MK.2 (15 keys); XL = 20GAT9901, Mini = 20GAI9901, Plus = 20GBD9901
const NAME = 'Claude Sessions';

const actionByName = Object.fromEntries(manifest.Actions.map((a) => [a.UUID.split('.').pop(), a]));
const layout = {
  '0,0': 'slot', '1,0': 'slot', '2,0': 'slot', '3,0': 'slot', '4,0': 'slot',
  '0,1': 'slot', '1,1': 'slot', '2,1': 'slot', '3,1': 'slot', '4,1': 'slot',
  '0,2': 'next', '1,2': 'overview', '2,2': 'profile', '3,2': 'page', '4,2': 'alarm',
};

const uuid = () => crypto.randomUUID();
const actions = {};
for (const [pos, key] of Object.entries(layout)) {
  const a = actionByName[key];
  actions[pos] = {
    ActionID: uuid(), LinkedTitle: true, Name: a.Name, Plugin: PLUGIN, Resources: null, Settings: {}, State: 0,
    States: [{ FontFamily: '', FontSize: 12, FontStyle: '', FontUnderline: false, OutlineThickness: 2, ShowTitle: false, TitleAlignment: 'middle', TitleColor: '#ffffff' }],
    UUID: a.UUID,
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-profile-'));
const rootId = uuid(), defaultId = uuid(), pageId = uuid();
const sdProfile = path.join(tmp, 'Profiles', `${rootId.toUpperCase()}.sdProfile`);
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };
writeJson(path.join(tmp, 'package.json'), { AppVersion: '7.5.1.00000', DeviceModel: MODEL, DeviceSettings: null, FormatVersion: 1, OSType: 'Mac', OSVersion: os.release(), RequiredPlugins: [manifest.UUID] });
writeJson(path.join(sdProfile, 'manifest.json'), { Device: { Model: MODEL, UUID: uuid() }, Name: NAME, Pages: { Current: '00000000-0000-0000-0000-000000000000', Default: defaultId, Pages: [pageId] }, Version: '3.0' });
writeJson(path.join(sdProfile, 'Profiles', defaultId.toUpperCase(), 'manifest.json'), { Controllers: [{ Actions: null, Type: 'Keypad' }], Icon: '', Name: '' });
writeJson(path.join(sdProfile, 'Profiles', pageId.toUpperCase(), 'manifest.json'), { Controllers: [{ Actions: actions, Type: 'Keypad' }], Icon: '', Name: '' });
for (const d of ['Images', path.join('Profiles', defaultId.toUpperCase(), 'Images'), path.join('Profiles', pageId.toUpperCase(), 'Images')]) fs.mkdirSync(path.join(sdProfile, d), { recursive: true });

const out = path.join(ROOT, 'dist', `${NAME}.streamDeckProfile`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-0', '-q', out, 'package.json', 'Profiles'], { cwd: tmp });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Profil geschrieben: ${out} (Gerät ${MODEL})`);
