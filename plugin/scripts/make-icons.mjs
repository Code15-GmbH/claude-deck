#!/usr/bin/env node
// Generates the PNG icons the manifest references (plugin icon, one icon per action,
// the default key image) without any image library: shapes are rasterised with
// 4×4 supersampling and written as RGBA PNG via zlib.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'de.code15.claude-sessions.sdPlugin', 'imgs');

// --- png ---------------------------------------------------------------------
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// --- shapes (unit coordinates 0..1) ---------------------------------------------
const hex = (h, a = 1) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const rrect = (x, y, w, h, r, color) => ({ color, hit: (px, py) => {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.max(x + r, Math.min(px, x + w - r)), cy = Math.max(y + r, Math.min(py, y + h - r));
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
} });
const circle = (cx, cy, r, color) => ({ color, hit: (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r });
const poly = (pts, color) => ({ color, hit: (px, py) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
} });
// a thick line segment with round caps
const line = (x1, y1, x2, y2, w, color) => ({ color, hit: (px, py) => {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2 <= (w / 2) ** 2;
} });
const ERASE = [0, 0, 0, 0];

function raster(size, shapes, ss = 4) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const px = (x + (sx + 0.5) / ss) / size, py = (y + (sy + 0.5) / ss) / size;
      let cr = 0, cg = 0, cb = 0, ca = 0;
      for (const s of shapes) {
        if (!s.hit(px, py)) continue;
        if (s.color === ERASE) { ca = 0; continue; }
        const [sr, sg, sb, sa] = s.color;
        const na = sa + ca * (1 - sa);
        cr = (sr * sa + cr * ca * (1 - sa)) / (na || 1); cg = (sg * sa + cg * ca * (1 - sa)) / (na || 1); cb = (sb * sa + cb * ca * (1 - sa)) / (na || 1); ca = na;
      }
      r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
    }
    const n = ss * ss, i = (y * size + x) * 4;
    out[i] = a ? Math.round(r / a) : 0; out[i + 1] = a ? Math.round(g / a) : 0; out[i + 2] = a ? Math.round(b / a) : 0; out[i + 3] = Math.round((a / n) * 255);
  }
  return out;
}

// --- the icons ------------------------------------------------------------------
const W = hex('#FFFFFF');
const pluginIcon = [
  rrect(0, 0, 1, 1, 0.22, hex('#141413')),
  circle(0.26, 0.5, 0.11, hex('#D93B3F')), circle(0.5, 0.5, 0.11, hex('#F2B134')), circle(0.74, 0.5, 0.11, hex('#3DBB7A')),
];
const keyImage = [rrect(0, 0, 1, 1, 0.11, hex('#1E1E20')), rrect(0, 0, 1, 0.045, 0, hex('#6E6E72')), circle(0.5, 0.55, 0.06, hex('#3A3A3C'))];
const actionIcons = {
  slot: [rrect(0.1, 0.1, 0.8, 0.8, 0.18, W), rrect(0.22, 0.22, 0.56, 0.56, 0.1, ERASE), rrect(0.22, 0.22, 0.56, 0.12, 0, W)],
  next: [line(0.15, 0.5, 0.65, 0.5, 0.16, W), poly([[0.5, 0.18], [0.88, 0.5], [0.5, 0.82], [0.5, 0.64], [0.6, 0.5], [0.5, 0.36]], W)],
  overview: [circle(0.5, 0.2, 0.13, W), circle(0.5, 0.5, 0.13, W), circle(0.5, 0.8, 0.13, W)],
  profile: [circle(0.5, 0.32, 0.2, W), circle(0.5, 1.02, 0.42, W), rrect(0, 0.9, 1, 0.2, 0, ERASE)],
  page: [line(0.32, 0.15, 0.7, 0.5, 0.16, W), line(0.7, 0.5, 0.32, 0.85, 0.16, W)],
  alarm: [circle(0.5, 0.42, 0.28, W), rrect(0.22, 0.42, 0.56, 0.3, 0, W), rrect(0.12, 0.68, 0.76, 0.1, 0.05, W), circle(0.5, 0.86, 0.09, W)],
};

fs.mkdirSync(OUT, { recursive: true });
const write = (name, size, shapes) => fs.writeFileSync(path.join(OUT, name), png(size, size, raster(size, shapes)));
write('plugin-icon.png', 256, pluginIcon); write('plugin-icon@2x.png', 512, pluginIcon);
write('key.png', 72, keyImage); write('key@2x.png', 144, keyImage);
for (const [name, shapes] of Object.entries(actionIcons)) { write(`${name}.png`, 20, shapes); write(`${name}@2x.png`, 40, shapes); }
console.log(`Icons geschrieben nach ${OUT}`);
