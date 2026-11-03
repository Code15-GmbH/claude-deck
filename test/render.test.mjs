import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as R from '../plugin/src/render.js';

const decode = (uri) => {
  assert.match(uri, /^data:image\/svg\+xml;base64,/);
  return Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
};
const entry = (kind, over = {}) => ({ kind, label: 'mein-projekt', since: 1000, session: { project: 'mein-projekt', profile: 'code15-belege' }, ...over });

test('toDataUri encodes SVG as base64', () => {
  assert.equal(decode(R.toDataUri('<svg/>')), '<svg/>');
});

test('renderSession uses the colour, label and icon of each kind', () => {
  const cases = { waiting: [R.C.red, 'FREIGABE'], working: [R.C.blue, 'ARBEITET'], done: [R.C.green, 'FERTIG'], idle: [R.C.dark, 'BEREIT'], gone: [R.C.dark, 'VERWAIST'] };
  for (const [kind, [color, text]] of Object.entries(cases)) {
    const svg = decode(R.renderSession(entry(kind), 1000 + 65 * 60_000));
    assert.ok(svg.startsWith('<svg'), kind);
    assert.ok(svg.includes(`fill="${color}"`), kind);
    assert.ok(svg.includes(text), kind);
    assert.ok(svg.includes('belege'), kind); // profile badge
    assert.ok(svg.includes('1 h 05'), kind); // age
    assert.ok(svg.includes('mein-'), kind);
  }
  const grey = decode(R.renderSession(entry('idle')));
  assert.ok(grey.includes(`fill="${R.C.greyBand}"`)); // grey band on dark keys
});

test('renderSession falls back to idle style, project name and zero age', () => {
  const svg = decode(R.renderSession({ kind: 'weird', session: { project: 'p' } }, 5000));
  assert.ok(svg.includes('BEREIT'));
  assert.ok(svg.includes('>p<'));
  assert.ok(svg.includes('0 s'));
});

test('text is XML-escaped', () => {
  const svg = decode(R.renderSession(entry('done', { label: `<a&"'>` })));
  assert.ok(svg.includes('&lt;a&amp;&quot;&#39;&gt;'));
  assert.ok(!svg.includes('<a&'));
});

test('renderEmpty, renderOverflow and renderOffline', () => {
  assert.ok(decode(R.renderEmpty()).includes('FREI'));
  const over = decode(R.renderOverflow({ more: 7, kinds: ['waiting', 'done', 'unknown'] }));
  assert.ok(over.includes('+7'));
  assert.equal((over.match(/<circle /g) || []).length, 3);
  assert.ok(over.includes(`fill="${R.C.red}"`) && over.includes(`fill="${R.C.green}"`));
  assert.ok(decode(R.renderOverflow({ more: 0 })).includes('+0'));
  assert.ok(decode(R.renderOffline('ECONNREFUSED')).includes('erreichbar'));
  assert.ok(decode(R.renderOffline()).includes('startet'));
});

test('renderNext takes the colour of its target', () => {
  const c = (waiting, done) => ({ waiting, done, working: 0, idle: 0, gone: 0, total: waiting + done });
  const red = decode(R.renderNext(c(1, 2)));
  assert.ok(red.includes(`fill="${R.C.red}"`) && red.includes('1 Freigabe · 2 fertig') && red.includes('>3<'));
  const green = decode(R.renderNext(c(0, 2)));
  assert.ok(green.includes(`fill="${R.C.green}"`) && green.includes('2 fertig'));
  const none = decode(R.renderNext(c(0, 0)));
  assert.ok(none.includes('nichts offen') && none.includes(`fill="${R.C.panel}"`));
  const off = decode(R.renderNext(c(1, 0), false));
  assert.ok(off.includes('offline') && !off.includes('<circle'));
});

test('renderOverview lists the counters', () => {
  const svg = decode(R.renderOverview({ waiting: 12, working: 3, done: 0 }));
  assert.ok(svg.includes('ÜBERSICHT') && svg.includes('>12<') && svg.includes('x="62"') && svg.includes('x="52"'));
  assert.ok(decode(R.renderOverview({ waiting: 0, working: 0, done: 0 }, false)).includes(`fill="${R.C.grey}">0<`));
});

test('renderProfile shows the filter and the other profiles', () => {
  const all = decode(R.renderProfile('', ['main', 'planni']));
  assert.ok(all.includes('alle') && all.includes('main · planni'));
  const one = decode(R.renderProfile('code15-belege', ['code15-belege', 'main']));
  assert.ok(one.includes('>belege<') && one.includes('>main<'));
  const lonely = decode(R.renderProfile('main', ['main']));
  assert.ok(lonely.includes('–'));
  const many = decode(R.renderProfile('', ['aaaaaaa', 'bbbbbbb', 'ccccccc', 'ddddddd']));
  assert.ok(many.includes('…'));
});

test('renderPage and renderAlarm', () => {
  const page = decode(R.renderPage(1, 3, 9, 20));
  assert.ok(page.includes('>2<tspan') && page.includes('/3') && page.includes('9 von 20 sichtbar'));
  assert.ok(decode(R.renderAlarm(true)).includes('>an<'));
  assert.ok(decode(R.renderAlarm(false)).includes('>aus<'));
});
