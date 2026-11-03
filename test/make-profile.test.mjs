import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { buildProfile, DEFAULT_MODEL, LAYOUT, NAME, ROOT, writeTree } from '../plugin/scripts/make-profile.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'de.code15.claude-sessions.sdPlugin', 'manifest.json'), 'utf8'));
const counter = () => { let i = 0; return () => `id-${String(++i).padStart(2, '0')}`; };

test('the layout uses only actions from the manifest', () => {
  const uuids = new Set(manifest.Actions.map((a) => a.UUID.split('.').pop()));
  for (const key of Object.values(LAYOUT)) assert.ok(uuids.has(key), key);
  assert.equal(Object.keys(LAYOUT).length, 15); // MK.2: 5 × 3
});

test('buildProfile creates the Stream Deck profile structure', () => {
  const { files, dirs } = buildProfile(manifest, { uuid: counter(), osRelease: '25.0.0' });
  const pkg = files['package.json'];
  assert.equal(pkg.DeviceModel, DEFAULT_MODEL);
  assert.equal(pkg.OSVersion, '25.0.0');
  assert.deepEqual(pkg.RequiredPlugins, [manifest.UUID]);
  // 15 action ids first, then root, default page, page, device
  const root = path.join('Profiles', 'ID-16.sdProfile');
  const top = files[path.join(root, 'manifest.json')];
  assert.equal(top.Name, NAME);
  assert.deepEqual(top.Pages, { Current: '00000000-0000-0000-0000-000000000000', Default: 'id-17', Pages: ['id-18'] });
  assert.equal(top.Device.UUID, 'id-19');
  assert.equal(files[path.join(root, 'Profiles', 'ID-17', 'manifest.json')].Controllers[0].Actions, null);
  const actions = files[path.join(root, 'Profiles', 'ID-18', 'manifest.json')].Controllers[0].Actions;
  assert.equal(Object.keys(actions).length, 15);
  assert.equal(actions['0,0'].UUID, `${manifest.UUID}.slot`);
  assert.equal(actions['4,2'].UUID, `${manifest.UUID}.alarm`);
  assert.deepEqual(actions['0,2'].Plugin, { Name: manifest.Name, UUID: manifest.UUID, Version: manifest.Version });
  assert.equal(dirs.length, 3);
});

test('buildProfile takes another device model and rejects unknown actions', () => {
  assert.equal(buildProfile(manifest, { model: '20GAT9901' }).files['package.json'].DeviceModel, '20GAT9901');
  assert.throws(() => buildProfile(manifest, { layout: { '0,0': 'missing' } }), /no action "missing"/);
});

test('writeTree writes the files and empty image folders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-profile-'));
  try {
    const profile = buildProfile(manifest, { uuid: counter() });
    writeTree(dir, profile);
    for (const rel of Object.keys(profile.files)) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')), profile.files[rel]);
    for (const d of profile.dirs) assert.ok(fs.statSync(path.join(dir, d)).isDirectory());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
