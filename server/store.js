// Sessiemodel + statusmachine. Bronnen roepen upsert()/apply()/setAlive() aan;
// de server leest snapshot() en luistert op onChange.
import { clip } from './classify.js';

const HISTORY_MS = 5 * 60_000;
const ERROR_MS = 8_000;
const GONE_MS = 30_000;
const GUESS_MS = 25_000; // stil na een tool zonder resultaat: lijkt te wachten
const LABEL = { think: 'denkt na', read: 'leest', edit: 'schrijft', bash: 'terminal', web: 'web', agent: 'subagent', ask: 'wacht op jou', error: 'fout', idle: 'idle', start: 'start op' };

export function createStore({ now = () => Date.now() } = {}) {
  const sessions = new Map();
  const listeners = new Set();
  let dirty = false;
  const changed = () => { dirty = true; for (const f of listeners) f(); };

  function get(id) { return sessions.get(id); }

  /** Maak of werk metadata bij. meta: {source, client, project, cwd, name, pid, nameRank} */
  function upsert(id, meta = {}) {
    let s = sessions.get(id);
    if (!s) {
      const t = meta.t ?? now();
      s = { id, source: meta.source, client: meta.client || 'cli', project: meta.project || '?', cwd: meta.cwd || '', name: meta.name || id.slice(0, 8), nameRank: meta.nameRank ?? 0,
        kind: meta.kind || 'start', txt: meta.txt || 'sessie start', since: t, last: t, recent: [], history: [{ t, kind: meta.kind || 'start' }],
        open: new Map(), subs: new Set(), subHooks: new Set(), ask: null, errorUntil: 0, guess: false, alive: true, goneAt: 0, hooks: false, ended: false };
      sessions.set(id, s); changed();
      return s;
    }
    let ch = false;
    for (const k of ['client', 'project', 'cwd', 'pid', 'source']) if (meta[k] != null && meta[k] !== s[k]) { s[k] = meta[k]; ch = true; }
    if (meta.name && (meta.nameRank ?? 0) >= s.nameRank && meta.name !== s.name) { s.name = meta.name; s.nameRank = meta.nameRank ?? 0; ch = true; }
    if (ch) changed();
    return s;
  }

  function setKind(s, kind, txt, t) {
    if (s.kind === kind && s.txt === txt) return;
    if (s.kind !== kind) {
      if (!['start', 'gone'].includes(s.kind) && s.txt) {
        const prev = s.recent[0];
        if (!prev || prev.kind !== s.kind || prev.txt !== s.txt) { s.recent.unshift({ kind: s.kind, txt: s.txt }); s.recent.length = Math.min(s.recent.length, 4); }
      }
      s.since = t;
      s.history.push({ t, kind });
      const cut = t - HISTORY_MS;
      while (s.history.length > 2 && s.history[1].t < cut) s.history.shift();
    }
    s.kind = kind; s.txt = txt;
  }

  /** Bepaal de zichtbare status uit de interne toestand (prioriteit: ask > error > actief > idle). */
  function settle(s, t, fallback) {
    if (!s.alive) return setKind(s, 'gone', '', t);
    if (s.ask) return setKind(s, 'ask', s.ask.txt, s.ask.t);
    if (s.errorUntil > t) return setKind(s, 'error', s.errorTxt || 'fout', t);
    const open = [...s.open.values()].at(-1);
    if (open) return setKind(s, open.kind, open.txt, t);
    if (fallback) return setKind(s, fallback.kind, fallback.txt, t);
  }

  /** Verwerk een genormaliseerd event (uit transcript of hook). */
  function apply(id, ev) {
    const s = sessions.get(id);
    if (!s) return;
    const t = ev.t ?? now();
    if (ev.type === 'title') { if (s.nameRank <= 2) { s.name = clip(ev.txt, 40); s.nameRank = 2; changed(); } return; }
    if (ev.type === 'hook') { s.hooks = true; return; }
    // Een openstaande vraag wordt alleen gewist door iets dat ná de vraag gebeurde.
    const after = !s.ask || t > s.ask.t;
    if (t > s.last) s.last = t;
    if (s.ask?.guess && t > s.ask.t) s.ask = null;
    s.guess = false;
    if (!s.alive && ev.type !== 'gone') { s.alive = true; s.goneAt = 0; }
    switch (ev.type) {
      case 'start':
        s.ended = false; s.open.clear(); s.subs.clear(); s.subHooks.clear();
        settle(s, t, { kind: 'start', txt: 'sessie start' }); break;
      case 'prompt':
        s.ended = false; if (after) s.ask = null; s.open.clear();
        if (!s.nameRank && ev.txt) { s.name = clip(ev.txt, 32); s.nameRank = 1; }
        settle(s, t, { kind: 'think', txt: 'denkt na' }); break;
      case 'think':
        s.ended = false; if (after) s.ask = null;
        if (ev.source === 'cursor') s.open.clear();
        settle(s, t, { kind: 'think', txt: ev.txt || 'denkt na' }); break;
      case 'tool':
        s.ended = false;
        if (ev.kind === 'ask') { if (!s.ask || after) s.ask = { t, txt: ev.txt || 'vraag aan jou', id: ev.id }; }
        else if (after && s.ask && s.ask.id !== ev.id) s.ask = null;
        if (ev.kind === 'agent') s.subs.add(ev.id);
        if (ev.source === 'cursor') s.open.clear(); // Cursor kent geen resultaten: de laatste tool is de huidige
        if (ev.kind !== 'ask') s.open.set(ev.id || `t${t}`, { kind: ev.kind, txt: ev.txt });
        settle(s, t); break;
      case 'result': {
        if (ev.id && s.ask?.id === ev.id) s.ask = null;
        else if (after && s.ask?.hookOnly) s.ask = null;
        if (ev.id) { s.open.delete(ev.id); s.subs.delete(ev.id); } else s.open.delete([...s.open.keys()].at(-1));
        if (ev.error) { s.errorUntil = t + ERROR_MS; s.errorTxt = ev.txt || 'tool gaf een fout'; }
        settle(s, t, { kind: 'think', txt: 'denkt na' }); break;
      }
      case 'permission': // hook: Claude vraagt toestemming
        s.ask = { t, txt: ev.txt || 'wil toestemming', id: [...s.open.keys()].at(-1), hookOnly: true };
        settle(s, t); break;
      // Subagents via hooks naast de Agent-tool: tel het maximum van beide, niet de som.
      case 'subStart': s.subHooks.add(ev.id || `s${t}`); break;
      case 'subStop': s.subHooks.delete(ev.id && s.subHooks.has(ev.id) ? ev.id : [...s.subHooks][0]); break;
      case 'turnEnd':
        s.ended = true; s.ask = null; s.open.clear(); s.subs.clear(); s.subHooks.clear();
        settle(s, t, { kind: 'idle', txt: ev.ok === false ? (ev.txt || 'gestopt') : 'klaar, jouw beurt' }); break;
      case 'idle':
        if (s.open.size && !s.ask) break;
        if (!s.ask) { s.ended = true; settle(s, t, { kind: 'idle', txt: ev.txt || 'klaar, jouw beurt' }); } break;
      case 'gone': setAlive(id, false, t); return;
    }
    changed();
  }

  function setAlive(id, alive, t = now()) {
    const s = sessions.get(id);
    if (!s || s.alive === alive) return;
    s.alive = alive;
    if (!alive) { s.goneAt = t; s.ask = null; s.open.clear(); s.subs.clear(); s.subHooks.clear(); setKind(s, 'gone', '', t); }
    else { s.goneAt = 0; setKind(s, s.ended ? 'idle' : 'think', s.ended ? 'klaar, jouw beurt' : 'denkt na', t); }
    changed();
  }

  /** Periodiek: fouten laten verlopen, 'lijkt te wachten' afleiden, verdwenen sessies opruimen. */
  function tick(t = now()) {
    for (const [id, s] of sessions) {
      if (!s.alive && t - s.goneAt > GONE_MS) { sessions.delete(id); changed(); continue; }
      if (s.kind === 'error' && s.errorUntil <= t) { settle(s, t, { kind: s.ended ? 'idle' : 'think', txt: s.ended ? 'klaar, jouw beurt' : 'denkt na' }); changed(); }
      const open = [...s.open.values()].at(-1);
      // Zonder hooks (Cursor, of Claude zonder hook-events) raden we 'wacht op jou' bij een lang stille tool.
      if (s.alive && !s.ask && !s.hooks && open && ['bash', 'edit', 'web'].includes(open.kind) && t - s.last > GUESS_MS && !s.guess) {
        s.guess = true; s.ask = { t, txt: `lijkt te wachten: ${open.txt}`, guess: true, hookOnly: true }; setKind(s, 'ask', s.ask.txt, t); changed();
      }
    }
  }

  function view(s, t) {
    const cut = t - 70_000;
    let i = s.history.length - 1; while (i > 0 && s.history[i].t > cut) i--;
    return { id: s.id, client: s.client, project: s.project, name: s.name, kind: s.kind, label: LABEL[s.kind] || s.kind, txt: s.txt, since: s.since,
      recent: s.recent, history: s.history.slice(i), subs: Math.max(s.subs.size, s.subHooks.size), guess: !!s.ask?.guess, hooks: s.hooks };
  }

  function snapshot(t = now()) {
    return [...sessions.values()].sort((a, b) => a.id.localeCompare(b.id)).map((s) => view(s, t));
  }

  return { get, upsert, apply, setAlive, tick, snapshot, sessions, onChange: (f) => { listeners.add(f); return () => listeners.delete(f); }, takeDirty: () => { const d = dirty; dirty = false; return d; } };
}
