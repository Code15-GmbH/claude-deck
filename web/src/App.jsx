import { useEffect, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// URL options:  ?key=<viewToken>   required once (then remembered on this device)
//               &minimal=1         hide prompt/result text (wall screen with visitors)
//               &sound=1           chime when something finishes (kiosk; else use the button)
//               &still=1           no animations (very weak hardware)
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
if (params.get('key')) store.set('deck.key', params.get('key'));
const KEY = params.get('key') || store.get('deck.key') || '';
const MINIMAL = params.get('minimal') === '1';
const STILL = params.get('still') === '1'; // no motion (weak hardware, screenshots)

const PROFILES = {
  main: { label: 'Normal', color: 'var(--p-main)' },
  'code15-belege': { label: 'Belege', color: 'var(--p-belege)' },
  planni: { label: 'Planung', color: 'var(--p-planni)' },
};
const profileOf = (name) => PROFILES[name] || { label: name, color: 'var(--p-other)' };

const FRESH_MS = 90e3; // strip glows this long after it finished
const COLD_MS = 30 * 60e3; // then dims after 30 min without reaction

function ago(ms) {
  if (ms < 45e3) return 'gerade eben';
  const m = Math.round(ms / 60e3);
  if (m < 60) return `vor ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `vor ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `vor ${Math.floor(h / 24)} T`;
}
function span(ms) {
  const m = Math.floor(ms / 60e3);
  if (m < 1) return `${Math.max(1, Math.round(ms / 1e3))} s`;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
const clock = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

// done/waiting and not cleared by hand (same rule as server/store.mjs)
const needsYou = (s) => (s.status === 'done' || s.status === 'waiting') && !s.ackedAt;

function board(sessions) {
  const attention = sessions.filter(needsYou)
    .sort((a, b) => (b.attentionAt || 0) - (a.attentionAt || 0));
  const working = sessions.filter((s) => s.status === 'working')
    .sort((a, b) => (b.turnStartedAt || 0) - (a.turnStartedAt || 0));
  const quiet = sessions.filter((s) => s.status !== 'working' && !needsYou(s))
    .sort((a, b) => Math.max(b.updatedAt, b.ackedAt || 0) - Math.max(a.updatedAt, a.ackedAt || 0)).slice(0, 12);
  return { attention, working, quiet };
}

function where(s) {
  const l = s.location || {};
  const parts = [l.app || '?'];
  if (l.gone) parts.push('Tab geschlossen');
  else {
    if (l.desktop) parts.push(l.desktop);
    if (l.tab) parts.push(`Tab ${l.tab}`);
    if (!l.desktop && l.tty) parts.push(l.tty);
  }
  return parts.join(' · ');
}

// --- sound -------------------------------------------------------------------
let audio = null;
function chime(kind) {
  try {
    audio ||= new AudioContext();
    const notes = kind === 'waiting' ? [660, 520, 660] : [523, 784];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = audio.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.55);
    });
  } catch {}
}

// --- data --------------------------------------------------------------------
function useDeck() {
  const [snap, setSnap] = useState(null);
  const [status, setStatus] = useState('connecting'); // connecting | live | offline | denied
  const [lastSeen, setLastSeen] = useState(Date.now());
  useEffect(() => {
    if (!KEY) { setStatus('denied'); return; }
    let es, stopped = false, retry;
    const open = () => {
      es = new EventSource(`/api/stream?key=${encodeURIComponent(KEY)}`);
      es.addEventListener('state', (e) => { setSnap({ ...JSON.parse(e.data), receivedAt: Date.now() }); setStatus('live'); setLastSeen(Date.now()); });
      es.addEventListener('ping', () => { setLastSeen(Date.now()); setStatus('live'); });
      es.onerror = async () => {
        es.close();
        if (stopped) return;
        const r = await fetch(`/api/state?key=${encodeURIComponent(KEY)}`).catch(() => null);
        setStatus(r?.status === 401 ? 'denied' : 'offline');
        if (r?.status !== 401) retry = setTimeout(open, 3000);
      };
    };
    open();
    return () => { stopped = true; clearTimeout(retry); es?.close(); };
  }, []);
  return { snap, status, lastSeen };
}

// clears a strip from "Braucht dich" (acked = false puts it back); the board follows via the stream
const ack = (id, acked) => fetch(`/api/ack?key=${encodeURIComponent(KEY)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, acked }),
}).catch(() => {});

// tappable strip; a tap that ends a text selection does not count
const tap = (fn, title) => ({
  role: 'button', tabIndex: 0, title,
  onClick: () => { if (!String(getSelection())) fn(); },
  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } },
});

function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// --- UI ----------------------------------------------------------------------
function Strip({ s, now, compact, onAck }) {
  const p = profileOf(s.profile);
  const since = s.attentionAt ? now - s.attentionAt : 0;
  const state = s.status === 'waiting' ? 'waiting' : s.status;
  const heat = s.status === 'done' || s.status === 'waiting' ? (since < FRESH_MS ? 'fresh' : since > COLD_MS ? 'cold' : 'warm') : '';
  let when = '';
  if (s.status === 'done') when = `fertig ${ago(since)}`;
  else if (s.status === 'waiting') when = `wartet ${ago(since).replace('vor ', 'seit ')}`;
  else if (s.status === 'working') when = `läuft seit ${span(now - (s.turnStartedAt || s.updatedAt))}`;
  else if (s.status === 'ended') when = `beendet ${ago(now - (s.endedAt || s.updatedAt))}`;
  else when = `offen seit ${span(now - s.startedAt)}`;
  const statusLabel = { done: 'FERTIG', waiting: 'FREIGABE', working: 'IN ARBEIT', idle: 'BEREIT', ended: 'ENDE' }[state];

  if (compact) {
    const back = s.ackedAt && (s.status === 'done' || s.status === 'waiting') ? tap(() => ack(s.id, false), 'Antippen: zurück nach „Braucht dich“') : null;
    return (
      <div className={`mini ${state} ${back ? 'tap' : ''}`} style={{ '--band': p.color }} {...back}>
        <span className="mini-band" />
        <span className="mini-proj">{s.project}</span>
        <span className="mini-title">{s.title || '—'}</span>
        <span className="mini-when">{statusLabel} · {when}</span>
      </div>
    );
  }
  return (
    <article className={`strip ${state} ${heat} ${onAck ? 'tap' : ''}`} style={{ '--band': p.color }} {...(onAck ? tap(() => onAck(s.id, true), 'Antippen: erledigt, vom Board nehmen') : null)}>
      <div className="band"><span>{p.label}</span></div>
      <div className="body">
        <div className="row1">
          <span className="callsign">{s.project}</span>
          {s.branch && <span className="branch">{s.branch}</span>}
          <span className="title">{s.title || (MINIMAL ? '' : s.prompt) || 'ohne Titel'}</span>
        </div>
        {!MINIMAL && s.status === 'waiting' && s.waitingReason && <div className="line reason">{s.waitingReason}</div>}
        {!MINIMAL && s.prompt && <div className="line"><b>Auftrag</b>{s.prompt}</div>}
        {!MINIMAL && s.status === 'done' && s.lastMessage && <div className="line result"><b>Ergebnis</b>{s.lastMessage}</div>}
      </div>
      <div className="meta">
        <span className="status">{statusLabel}</span>
        <span className="when">{when}</span>
        <span className="where">{where(s)}</span>
      </div>
    </article>
  );
}

// `onToggle` makes the header tappable (collapses the bay); `onAck` makes each strip tappable (clears it).
function Bay({ title, hint, list, now, empty, onToggle, onAck }) {
  return (
    <section className="bay">
      <header className={`bay-head ${onToggle ? 'tap' : ''}`} onClick={onToggle} title={onToggle ? 'Antippen zum Ausblenden' : undefined}><h2>{title}</h2><span className="count">{list.length}</span>{hint && <span className="hint">{hint}</span>}</header>
      <div className="bay-list">
        {list.length ? list.map((s) => <Strip key={`${s.id}-${s.status}`} s={s} now={now} onAck={onAck} />) : <div className="empty">{empty}</div>}
      </div>
    </section>
  );
}

export default function App() {
  const { snap, status, lastSeen } = useDeck();
  const now0 = useNow(5000);
  const offset = snap ? snap.now - snap.receivedAt : 0; // Mac clock vs. this device
  const now = now0 + offset;
  const [sound, setSound] = useState(params.get('sound') === '1' || store.get('deck.sound') === '1');
  const [flash, setFlash] = useState(null);
  const [leftHidden, setLeftHidden] = useState(store.get('deck.leftHidden') === '1'); // left bay collapsed for focus
  const prev = useRef(null);

  const sessions = snap?.sessions || [];
  const b = useMemo(() => board(sessions), [snap]);

  // detect new arrivals in the attention bay -> flash + chime + tab title
  useEffect(() => {
    if (!snap) return;
    const cur = new Map(sessions.map((s) => [s.id, `${s.status}:${s.attentionAt}`]));
    if (prev.current) {
      const arrived = sessions.filter((s) => needsYou(s) && prev.current.get(s.id) !== cur.get(s.id));
      if (arrived.length) {
        const kind = arrived.some((s) => s.status === 'waiting') ? 'waiting' : 'done';
        setFlash({ kind, at: Date.now(), label: arrived.map((s) => s.project).join(' · ') });
        if (sound) chime(kind);
      }
    }
    prev.current = cur;
  }, [snap]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 4200); return () => clearTimeout(t); }, [flash]);
  useEffect(() => {
    const fresh = b.attention.filter((s) => now - s.attentionAt < COLD_MS).length;
    document.title = fresh ? `(${fresh}) Claude Deck` : 'Claude Deck';
  }, [b, now]);

  const toggleSound = () => { const v = !sound; setSound(v); store.set('deck.sound', v ? '1' : '0'); if (v) chime('done'); };
  const toggleLeft = () => { const v = !leftHidden; setLeftHidden(v); store.set('deck.leftHidden', v ? '1' : '0'); };
  const offline = status === 'offline' || (status === 'live' && Date.now() - lastSeen > 45e3);

  if (status === 'denied') {
    return (
      <main className="gate">
        <h1>Claude Deck</h1>
        <p>Kein oder falscher Schlüssel. Öffne die Adresse mit <code>?key=…</code> — auf dem Mac zeigt <code>npm run urls</code> die fertigen Links.</p>
      </main>
    );
  }

  return (
    <main className={`deck ${offline ? 'is-offline' : ''} ${STILL ? 'still' : ''}`}>
      <header className="top">
        <div className="brand"><span className="logo" aria-hidden />CLAUDE DECK</div>
        <div className="stats">
          <span className="stat attn">{b.attention.length}<small>braucht dich</small></span>
          <span className="stat work">{b.working.length}<small>in Arbeit</small></span>
          {snap?.currentDesktop?.length > 0 && <span className="here">Mac ist auf {snap.currentDesktop.join(', ')}</span>}
        </div>
        <div className="right">
          <button className={`sound ${sound ? 'on' : ''}`} onClick={toggleSound} title="Ton bei fertig/Freigabe">{sound ? 'Ton an' : 'Ton aus'}</button>
          <span className={`conn ${offline ? 'off' : status}`}>{offline ? 'keine Verbindung' : status === 'live' ? 'live' : 'verbinde…'}</span>
          <span className="clock">{clock(now0)}</span>
        </div>
      </header>

      {offline && <div className="offline-banner">Keine Verbindung zum Mac seit {clock(lastSeen)} — Anzeige ist eingefroren.</div>}

      <div className={`bays ${leftHidden ? 'left-hidden' : ''}`}>
        {leftHidden
          ? <button className="bay-rail" onClick={toggleLeft} title="Antippen zum Einblenden"><span className="count">{b.attention.length}</span><span className="label">Braucht dich</span></button>
          : <Bay title="Braucht dich" hint="neueste oben · Streifen antippen = erledigt" list={b.attention} now={now} empty="Nichts wartet auf dich." onToggle={toggleLeft} onAck={ack} />}
        <Bay title="In Arbeit" list={b.working} now={now} empty="Gerade arbeitet keine Session." />
      </div>

      {b.quiet.length > 0 && (
        <section className="quiet">
          <h3>Ruhig</h3>
          <div className="quiet-list">{b.quiet.map((s) => <Strip key={s.id} s={s} now={now} compact />)}</div>
        </section>
      )}

      {flash && <div key={flash.at} className={`flash ${flash.kind}`}><span>{flash.kind === 'waiting' ? 'Freigabe nötig' : 'Fertig'} · {flash.label}</span></div>}
    </main>
  );
}
