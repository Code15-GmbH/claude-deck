// Pure helpers of the dashboard (no DOM, no React), unit-tested in test/web-lib.test.mjs.

export const PROFILES = {
  main: { label: 'Normal', color: 'var(--p-main)' },
  'code15-belege': { label: 'Belege', color: 'var(--p-belege)' },
  planni: { label: 'Planung', color: 'var(--p-planni)' },
};
export const profileOf = (name) => PROFILES[name] || { label: name, color: 'var(--p-other)' };

export function ago(ms) {
  if (ms < 45e3) return 'gerade eben';
  const m = Math.round(ms / 60e3);
  if (m < 60) return `vor ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `vor ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `vor ${Math.floor(h / 24)} T`;
}

export function span(ms) {
  const m = Math.floor(ms / 60e3);
  if (m < 1) return `${Math.max(1, Math.round(ms / 1e3))} s`;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// done/waiting and not cleared by hand (same rule as server/store.mjs)
export const needsYou = (s) => (s.status === 'done' || s.status === 'waiting') && !s.ackedAt;

export function board(sessions) {
  const attention = sessions.filter(needsYou)
    .sort((a, b) => (b.attentionAt || 0) - (a.attentionAt || 0));
  const working = sessions.filter((s) => s.status === 'working')
    .sort((a, b) => (b.turnStartedAt || 0) - (a.turnStartedAt || 0));
  const quiet = sessions.filter((s) => s.status !== 'working' && !needsYou(s))
    .sort((a, b) => Math.max(b.updatedAt, b.ackedAt || 0) - Math.max(a.updatedAt, a.ackedAt || 0)).slice(0, 12);
  return { attention, working, quiet };
}

export function where(s) {
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
