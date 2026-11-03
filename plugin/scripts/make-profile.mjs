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

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_MODEL = '20GBA9901'; // Stream Deck MK.2 (15 keys); XL = 20GAT9901, Mini = 20GAI9901, Plus = 20GBD9901
export const NAME = 'Claude Sessions';

export const LAYOUT = {
  '0,0': 'slot', '1,0': 'slot', '2,0': 'slot', '3,0': 'slot', '4,0': 'slot',
  '0,1': 'slot', '1,1': 'slot', '2,1': 'slot', '3,1': 'slot', '4,1': 'slot',
  '0,2': 'next', '1,2': 'overview', '2,2': 'profile', '3,2': 'page', '4,2': 'alarm',
};

/**
 * The profile as a map of relative path -> JSON content (plus the empty image folders).
 * Pure: ids come from `uuid`, so tests can pass a deterministic one.
 */
export function buildProfile(manifest, { model = DEFAULT_MODEL, uuid = () => crypto.randomUUID(), osRelease = os.release(), layout = LAYOUT } = {}) {
  const PLUGIN = { Name: manifest.Name, UUID: manifest.UUID, Version: manifest.Version };
  const actionByName = Object.fromEntries(manifest.Actions.map((a) => [a.UUID.split('.').pop(), a]));
  const actions = {};
  for (const [pos, key] of Object.entries(layout)) {
    const a = actionByName[key];
    if (!a) throw new Error(`manifest has no action "${key}"`);
    actions[pos] = {
      ActionID: uuid(), LinkedTitle: true, Name: a.Name, Plugin: PLUGIN, Resources: null, Settings: {}, State: 0,
      States: [{ FontFamily: '', FontSize: 12, FontStyle: '', FontUnderline: false, OutlineThickness: 2, ShowTitle: false, TitleAlignment: 'middle', TitleColor: '#ffffff' }],
      UUID: a.UUID,
    };
  }
  const rootId = uuid(), defaultId = uuid(), pageId = uuid();
  const sdProfile = path.join('Profiles', `${rootId.toUpperCase()}.sdProfile`);
  const files = {
    'package.json': { AppVersion: '7.5.1.00000', DeviceModel: model, DeviceSettings: null, FormatVersion: 1, OSType: 'Mac', OSVersion: osRelease, RequiredPlugins: [manifest.UUID] },
    [path.join(sdProfile, 'manifest.json')]: { Device: { Model: model, UUID: uuid() }, Name: NAME, Pages: { Current: '00000000-0000-0000-0000-000000000000', Default: defaultId, Pages: [pageId] }, Version: '3.0' },
    [path.join(sdProfile, 'Profiles', defaultId.toUpperCase(), 'manifest.json')]: { Controllers: [{ Actions: null, Type: 'Keypad' }], Icon: '', Name: '' },
    [path.join(sdProfile, 'Profiles', pageId.toUpperCase(), 'manifest.json')]: { Controllers: [{ Actions: actions, Type: 'Keypad' }], Icon: '', Name: '' },
  };
  const dirs = ['Images', path.join('Profiles', defaultId.toUpperCase(), 'Images'), path.join('Profiles', pageId.toUpperCase(), 'Images')].map((d) => path.join(sdProfile, d));
  return { files, dirs };
}

/** Writes the profile tree into `dir` (no zip). */
export function writeTree(dir, { files, dirs }) {
  for (const [rel, data] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  }
  for (const d of dirs) fs.mkdirSync(path.join(dir, d), { recursive: true });
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'de.code15.claude-sessions.sdPlugin', 'manifest.json'), 'utf8'));
  const model = process.argv[2] || DEFAULT_MODEL;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-profile-'));
  writeTree(tmp, buildProfile(manifest, { model }));
  const out = path.join(ROOT, 'dist', `${NAME}.streamDeckProfile`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.rmSync(out, { force: true });
  execFileSync('zip', ['-r', '-X', '-0', '-q', out, 'package.json', 'Profiles'], { cwd: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Profil geschrieben: ${out} (Gerät ${model})`);
}

const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) main();
