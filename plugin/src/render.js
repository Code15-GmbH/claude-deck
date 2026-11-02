// Key images as 144×144 SVG (the @2x size Stream Deck renders keys at). Layout and
// colours follow the design canvas: label row with icon, project name (two lines),
// profile badge bottom-left, age bottom-right.
import { formatAge, shortProfile, wrapName } from './model.js';

const FONT = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "Menlo, 'SF Mono', Consolas, monospace";

export const C = {
  red: '#D93B3F', green: '#3DBB7A', blue: '#2F6FE0', purple: '#9B6CFF', purpleText: '#B894FF',
  dark: '#1E1E20', darker: '#1A1A1B', panel: '#26262A', text: '#E8E8E6', grey: '#9A9A96', greyBand: '#6E6E72',
  dash: '#3A3A3C', faint: '#4A4A4C', pillDark: '#2C2C30', pillText: '#B9B9B5', ink: '#1A1A1A', white: '#FFFFFF',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 24-unit stroke icons, drawn at 14 px in the label row (scale 14/24)
const ICON = {
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  spin: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  warn: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21h4"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  arrow: '<path d="M5 12h13"/><path d="M12 5l7 7-7 7"/>',
  plug: '<path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>',
};

const icon = (name, x, y, size, color, width = 2.4) =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</g>`;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${body}</svg>`;
export const toDataUri = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s, 'utf8').toString('base64');

/** Key background: rounded square, optional 6 px band at the top. */
const base = (fill, band = '', extra = '') =>
  `<defs><clipPath id="k"><rect width="144" height="144" rx="16"/></clipPath></defs>` +
  `<g clip-path="url(#k)"><rect width="144" height="144" fill="${fill}"/>` +
  (band ? `<rect width="144" height="6" fill="${band}"/>` : '') + extra + '</g>';

const label = (text, color, iconName, iconColor = color) =>
  icon(iconName, 12, 11, 14, iconColor) +
  `<text x="31" y="23" font-family="${FONT}" font-size="10" font-weight="700" letter-spacing="0.8" fill="${color}">${esc(text.toUpperCase())}</text>`;

const nameLines = (lines, color, y = 68, size = 15) =>
  lines.map((l, i) => `<text x="12" y="${y + i * (size + 2)}" font-family="${FONT}" font-size="${size}" font-weight="700" fill="${color}">${esc(l)}</text>`).join('');

const pill = (text, fill, color) => {
  const w = Math.min(90, 12 + text.length * 5.6);
  return `<rect x="12" y="113" width="${w}" height="17" rx="8.5" fill="${fill}"/>` +
    `<text x="${12 + w / 2}" y="125" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="600" letter-spacing="0.4" fill="${color}">${esc(text)}</text>`;
};

const age = (text, color) =>
  `<text x="132" y="125" text-anchor="end" font-family="${MONO}" font-size="11" font-weight="500" fill="${color}">${esc(text)}</text>`;

// Solid red, blue and green for the three states that matter; grey keys stay dark so colour stands out.
const STYLE = {
  waiting: { bg: C.red, band: '', fg: C.white, labelColor: C.white, label: 'Freigabe', icon: 'lock', pillFill: 'rgba(255,255,255,0.22)', pillText: C.white, ageColor: C.white },
  working: { bg: C.blue, band: '', fg: C.white, labelColor: C.white, label: 'Arbeitet', icon: 'spin', pillFill: 'rgba(255,255,255,0.22)', pillText: C.white, ageColor: C.white },
  done: { bg: C.green, band: '', fg: C.ink, labelColor: C.ink, label: 'Fertig', icon: 'check', pillFill: 'rgba(0,0,0,0.14)', pillText: C.ink, ageColor: C.ink },
  idle: { bg: C.dark, band: C.greyBand, fg: C.grey, labelColor: C.grey, label: 'Bereit', icon: 'checkCircle', pillFill: C.pillDark, pillText: C.pillText, ageColor: C.grey },
  gone: { bg: C.dark, band: C.greyBand, fg: C.grey, labelColor: C.grey, label: 'Verwaist', icon: 'warn', pillFill: C.pillDark, pillText: C.pillText, ageColor: C.grey },
};

export function renderSession(entry, now = Date.now()) {
  const st = STYLE[entry.kind] || STYLE.idle;
  const s = entry.session;
  return toDataUri(svg(
    base(st.bg, st.band) +
    label(st.label, st.labelColor, st.icon) +
    nameLines(wrapName(entry.label || s.project, 13), st.fg) +
    pill(shortProfile(s.profile), st.pillFill, st.pillText) +
    age(formatAge(now - (entry.since || now)), st.ageColor),
  ));
}

export function renderEmpty() {
  return toDataUri(svg(
    base(C.darker) +
    `<rect x="1" y="1" width="142" height="142" rx="15" fill="none" stroke="${C.dash}" stroke-width="1.5" stroke-dasharray="5 4"/>` +
    `<text x="72" y="77" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" letter-spacing="0.7" fill="${C.faint}">FREI</text>`,
  ));
}

const dotColor = { waiting: C.red, working: C.blue, done: C.green, idle: C.greyBand, gone: C.greyBand };

/** One dot per hidden session (up to six) in its key colour: green here means paging is worth it. */
export function renderOverflow(cell) {
  const dots = (cell.kinds || []).map((k, i) => `<circle cx="${72 + (i - (cell.kinds.length - 1) / 2) * 14}" cy="108" r="5" fill="${dotColor[k] || C.greyBand}"/>`).join('');
  return toDataUri(svg(
    base(C.panel) +
    `<text x="72" y="66" text-anchor="middle" font-family="${MONO}" font-size="32" font-weight="700" fill="${C.text}">+${cell.more}</text>` +
    `<text x="72" y="86" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${C.grey}">weitere</text>` + dots,
  ));
}

export function renderOffline(reason = '') {
  const lines = wrapName(reason ? 'Server nicht erreichbar' : 'Server startet', 14);
  return toDataUri(svg(
    base(C.darker, C.red) +
    label('Offline', C.grey, 'plug') +
    nameLines(lines, C.grey, 68, 14) +
    `<text x="12" y="125" font-family="${FONT}" font-size="9" fill="${C.faint}">npm start in claude-deck</text>`,
  ));
}

/** "Nächste" takes the colour of the key it would jump to: red while a permission is open, green while finished sessions wait, dark otherwise. */
export function renderNext(c, connected = true) {
  const open = connected ? c.waiting + c.done : 0;
  const target = !connected || !open ? null : c.waiting ? 'waiting' : 'done';
  const bg = target === 'waiting' ? C.red : target === 'done' ? C.green : C.panel;
  const fg = target === 'waiting' ? C.white : target === 'done' ? C.ink : C.greyBand;
  const parts = [];
  if (c.waiting) parts.push(`${c.waiting} Freigabe`);
  if (c.done) parts.push(`${c.done} fertig`);
  const sub = !connected ? 'offline' : parts.length ? parts.join(' · ') : 'nichts offen';
  return toDataUri(svg(
    base(bg) +
    icon('arrow', 12, 20, 40, fg, 2.2) +
    (open ? `<circle cx="118" cy="30" r="14" fill="${fg}"/><text x="118" y="35" text-anchor="middle" font-family="${MONO}" font-size="14" font-weight="700" fill="${bg}">${open}</text>` : '') +
    `<text x="12" y="110" font-family="${FONT}" font-size="14" font-weight="700" fill="${fg}">Nächste</text>` +
    `<text x="12" y="126" font-family="${FONT}" font-size="10" fill="${fg}" opacity="0.85">${esc(sub)}</text>`,
  ));
}

export function renderOverview(c, connected = true) {
  const row = (y, color, n, word) =>
    `<circle cx="18" cy="${y - 5}" r="6" fill="${color}"/>` +
    `<text x="32" y="${y}" font-family="${MONO}" font-size="18" font-weight="700" fill="${connected ? C.text : C.grey}">${n}</text>` +
    `<text x="${n >= 10 ? 62 : 52}" y="${y}" font-family="${FONT}" font-size="11" fill="${C.grey}">${word}</text>`;
  return toDataUri(svg(
    base(C.panel) +
    `<text x="12" y="23" font-family="${FONT}" font-size="10" font-weight="700" letter-spacing="0.8" fill="${C.grey}">ÜBERSICHT</text>` +
    row(58, C.red, c.waiting, 'Freigabe') + row(86, C.blue, c.working, 'läuft') + row(114, C.green, c.done, 'fertig'),
  ));
}

export function renderProfile(current, all) {
  const name = current ? shortProfile(current) : 'alle';
  const others = (current ? all.filter((p) => p !== current) : all).map(shortProfile).join(' · ');
  const sub = others.length > 24 ? others.slice(0, 23) + '…' : others;
  return toDataUri(svg(
    base(C.panel, C.purple) +
    label('Profil', C.purpleText, 'person') +
    nameLines(wrapName(name, 13), C.text) +
    `<text x="12" y="125" font-family="${FONT}" font-size="10" fill="${C.grey}">${esc(sub || '–')}</text>`,
  ));
}

export function renderPage(page, pages, shown, total) {
  return toDataUri(svg(
    base(C.panel) +
    `<text x="12" y="23" font-family="${FONT}" font-size="10" font-weight="700" letter-spacing="0.8" fill="${C.grey}">SEITE</text>` +
    `<text x="12" y="80" font-family="${MONO}" font-size="30" font-weight="700" fill="${C.text}">${page + 1}<tspan fill="${C.greyBand}">/${pages}</tspan></text>` +
    `<text x="12" y="125" font-family="${FONT}" font-size="10" fill="${C.grey}">${shown} von ${total} sichtbar</text>` +
    icon('chevron', 118, 111, 14, C.text),
  ));
}

export function renderAlarm(on) {
  return toDataUri(svg(
    base(C.panel) +
    label('Alarm', C.grey, 'bell') +
    nameLines(['Ton bei', 'Freigabe'], C.text) +
    pill(on ? 'an' : 'aus', on ? C.green : C.pillDark, on ? '#0E2A1C' : C.pillText),
  ));
}
