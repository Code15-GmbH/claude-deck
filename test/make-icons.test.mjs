import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { test } from 'vitest';
import * as I from '../plugin/scripts/make-icons.mjs';

/** Decoded IDAT of a single-IDAT PNG. */
const pixels = (file) => zlib.inflateSync(file.subarray(41, 41 + file.readUInt32BE(33)));

test('crc32 matches the standard check value', () => {
  assert.equal(I.crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(I.crc32(Buffer.alloc(0)), 0);
});

test('chunk writes length, type, data and CRC', () => {
  const c = I.chunk('IEND', Buffer.alloc(0));
  assert.equal(c.length, 12);
  assert.equal(c.readUInt32BE(0), 0);
  assert.equal(c.toString('ascii', 4, 8), 'IEND');
  assert.equal(c.readUInt32BE(8), 0xae426082); // well-known IEND CRC
});

test('png produces a valid RGBA PNG', () => {
  const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128]);
  const file = I.png(2, 1, rgba);
  assert.deepEqual([...file.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(file.toString('ascii', 12, 16), 'IHDR');
  assert.equal(file.readUInt32BE(16), 2);
  assert.equal(file.readUInt32BE(20), 1);
  assert.equal(file[24], 8); // bit depth
  assert.equal(file[25], 6); // RGBA
  assert.equal(file.toString('ascii', 37, 41), 'IDAT');
  assert.deepEqual([...pixels(file)], [0, ...rgba]); // filter byte 0 + row
});

test('hex parses colours with alpha', () => {
  assert.deepEqual(I.hex('#D93B3F'), [0xd9, 0x3b, 0x3f, 1]);
  assert.deepEqual(I.hex('#000000', 0.5), [0, 0, 0, 0.5]);
});

test('shape hit tests', () => {
  const r = I.rrect(0, 0, 1, 1, 0.2, I.hex('#FFFFFF'));
  assert.equal(r.hit(0.5, 0.5), true);
  assert.equal(r.hit(0.01, 0.01), false); // rounded corner
  assert.equal(r.hit(1.5, 0.5), false);
  const c = I.circle(0.5, 0.5, 0.1, I.hex('#FFFFFF'));
  assert.equal(c.hit(0.5, 0.55), true);
  assert.equal(c.hit(0.5, 0.7), false);
  const tri = I.poly([[0, 0], [1, 0], [0, 1]], I.hex('#FFFFFF'));
  assert.equal(tri.hit(0.2, 0.2), true);
  assert.equal(tri.hit(0.8, 0.8), false);
  const l = I.line(0, 0.5, 1, 0.5, 0.1, I.hex('#FFFFFF'));
  assert.equal(l.hit(0.5, 0.52), true);
  assert.equal(l.hit(0.5, 0.7), false);
  assert.equal(I.line(0.5, 0.5, 0.5, 0.5, 0.2, I.hex('#FFFFFF')).hit(0.5, 0.55), true); // zero-length segment
});

test('raster blends shapes, ERASE cuts holes, alpha is supersampled', () => {
  const full = I.raster(2, [I.rrect(0, 0, 1, 1, 0, I.hex('#FF0000'))], 2);
  assert.deepEqual([...full.subarray(0, 4)], [255, 0, 0, 255]);
  const empty = I.raster(1, [], 1);
  assert.deepEqual([...empty], [0, 0, 0, 0]);
  const holed = I.raster(1, [I.rrect(0, 0, 1, 1, 0, I.hex('#FFFFFF')), I.rrect(0, 0, 1, 1, 0, I.ERASE)], 1);
  assert.equal(holed[3], 0);
  const half = I.raster(1, [I.rrect(0, 0, 1, 1, 0, I.hex('#0000FF', 0.5))], 1);
  assert.equal(half[2], 255);
  assert.equal(half[3], 128);
  const over = I.raster(1, [I.rrect(0, 0, 1, 1, 0, I.hex('#FF0000')), I.rrect(0, 0, 1, 1, 0, I.hex('#0000FF', 0.5))], 1);
  assert.deepEqual([...over], [128, 0, 128, 255]);
});

test('writeIcons writes every icon the manifest references', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-icons-'));
  try {
    const names = I.writeIcons(out);
    assert.equal(names.length, 4 + Object.keys(I.actionIcons).length * 2);
    const manifest = JSON.parse(fs.readFileSync(path.join(I.OUT, '..', 'manifest.json'), 'utf8'));
    for (const a of manifest.Actions) assert.ok(names.includes(`${path.basename(a.Icon)}.png`), a.Icon);
    const icon = fs.readFileSync(path.join(out, 'plugin-icon.png'));
    assert.equal(icon.readUInt32BE(16), 256);
    // committed icons are up to date (pixels compared, zlib output may differ between Node versions)
    for (const name of names) assert.deepEqual(pixels(fs.readFileSync(path.join(out, name))), pixels(fs.readFileSync(path.join(I.OUT, name))), name);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
