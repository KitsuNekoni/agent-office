// Session model + state machine. Sources call upsert()/apply()/setAlive();
// the server reads snapshot() and listens on onChange.
import { clip } from './classify.js';

const HISTORY_MS = 5 * 60_000;
const ERROR_MS = 8_000;
const GONE_MS = 30_000;
const GUESS_MS = 25_000; // quiet after a tool without a result: seems to be waiting
const SUB_STALE_MS = 20 * 60_000; // a subagent without any sign of life for this long has been lost (missed SubagentStop)
const LABEL = { think: 'thinking', read: 'reading', edit: 'writing', bash: 'terminal', web: 'web', agent: 'subagent', ask: 'waiting for you', error: 'error', idle: 'idle', start: 'starting' };

export function createStore({ now = () => Date.now() } = {}) {
  const sessions = new Map();
  const listeners = new Set();
  let dirty = false;
  const changed = () => { dirty = true; for (const f of listeners) f(); };

  function get(id) { return sessions.get(id); }

  /** Create or update metadata. meta: {source, client, project, cwd, name, pid, nameRank} */
  function upsert(id, meta = {}) {
    let s = sessions.get(id);
    if (!s) {
      const t = meta.t ?? now();
      s = { id, source: meta.source, client: meta.client || 'cli', project: meta.project || '?', cwd: meta.cwd || '', name: meta.name || id.slice(0, 8), nameRank: meta.nameRank ?? 0,
        kind: meta.kind || 'start', txt: meta.txt || 'session starting', since: t, last: t, recent: [], history: [{ t, kind: meta.kind || 'start' }],
        open: new Map(), subs: new Set(), subHooks: new Map(), ask: null, errorUntil: 0, guess: false, alive: true, goneAt: 0, hooks: false, ended: false };
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

  /** Derive the visible status from the internal state (priority: ask > error > active > idle). */
  function settle(s, t, fallback) {
    if (!s.alive) return setKind(s, 'gone', '', t);
    if (s.ask) return setKind(s, 'ask', s.ask.txt, s.ask.t);
    if (s.errorUntil > t) return setKind(s, 'error', s.errorTxt || 'error', t);
    const open = [...s.open.values()].at(-1);
    if (open) return setKind(s, open.kind, open.txt, t);
    if (fallback) return setKind(s, fallback.kind, fallback.txt, t);
  }

  /** Process a normalised event (from a transcript or hook). */
  function apply(id, ev) {
    const s = sessions.get(id);
    if (!s) return;
    const t = ev.t ?? now();
    if (ev.type === 'title') { if (s.nameRank <= 2) { s.name = clip(ev.txt, 40); s.nameRank = 2; changed(); } return; }
    if (ev.type === 'hook') { s.hooks = true; return; }
    // An open question is only cleared by something that happened after it.
    const after = !s.ask || t > s.ask.t;
    if (t > s.last) s.last = t;
    if (s.ask?.guess && t > s.ask.t) s.ask = null;
    s.guess = false;
    if (!s.alive && ev.type !== 'gone') { s.alive = true; s.goneAt = 0; }
    switch (ev.type) {
      case 'start':
        s.ended = false; s.open.clear(); s.subs.clear(); s.subHooks.clear();
        settle(s, t, { kind: 'start', txt: 'session starting' }); break;
      case 'prompt':
        s.ended = false; if (after) s.ask = null; s.open.clear();
        if (!s.nameRank && ev.txt) { s.name = clip(ev.txt, 32); s.nameRank = 1; }
        settle(s, t, { kind: 'think', txt: 'thinking' }); break;
      case 'think':
        s.ended = false; if (after) s.ask = null;
        if (ev.source === 'cursor') s.open.clear();
        settle(s, t, { kind: 'think', txt: ev.txt || 'thinking' }); break;
      case 'tool':
        s.ended = false;
        if (ev.kind === 'ask') { if (!s.ask || after) s.ask = { t, txt: ev.txt || 'question for you', id: ev.id }; }
        else if (after && s.ask && s.ask.id !== ev.id) s.ask = null;
        if (ev.kind === 'agent') s.subs.add(ev.id);
        if (ev.source === 'cursor') s.open.clear(); // Cursor has no results: the last tool is the current one
        if (ev.kind !== 'ask') s.open.set(ev.id || `t${t}`, { kind: ev.kind, txt: ev.txt });
        settle(s, t); break;
      case 'result': {
        if (ev.id && s.ask?.id === ev.id) s.ask = null;
        else if (after && s.ask?.hookOnly) s.ask = null;
        if (ev.id) { s.open.delete(ev.id); s.subs.delete(ev.id); } else s.open.delete([...s.open.keys()].at(-1));
        if (ev.error) { s.errorUntil = t + ERROR_MS; s.errorTxt = ev.txt || 'tool failed'; }
        settle(s, t, { kind: 'think', txt: 'thinking' }); break;
      }
      case 'permission': // hook: Claude asks for permission
        s.ask = { t, txt: ev.txt || 'wants permission', id: [...s.open.keys()].at(-1), hookOnly: true };
        settle(s, t); break;
      // Subagents via hooks next to the Agent tool: count the maximum of both, not the sum.
      // A hook subagent stays until its SubagentStop, also after the main turn ended (background agents).
      case 'subStart': s.subHooks.set(ev.id || `s${t}`, { kind: 'think', txt: 'starting', last: t }); break;
      case 'subStop': s.subHooks.delete(ev.id || [...s.subHooks.keys()][0]); break; // an unknown id (an internal helper) removes nobody
      case 'subTool': case 'subResult': { // a tool call inside a subagent: shows on its helper, not on the main agent
        const h = s.subHooks.get(ev.id) || { kind: 'think', txt: '' };
        if (ev.type === 'subTool') { h.kind = ev.kind === 'ask' ? 'think' : ev.kind; h.txt = ev.txt || ''; } else { h.kind = 'think'; h.txt = 'thinking'; }
        h.last = t; s.subHooks.set(ev.id, h); break;
      }
      case 'turnEnd':
        s.ended = true; s.ask = null; s.open.clear(); s.subs.clear();
        settle(s, t, { kind: 'idle', txt: ev.ok === false ? (ev.txt || 'stopped') : 'done, your turn' }); break;
      case 'idle':
        if (s.open.size && !s.ask) break;
        if (!s.ask) { s.ended = true; settle(s, t, { kind: 'idle', txt: ev.txt || 'done, your turn' }); } break;
      case 'gone': setAlive(id, false, t); return;
    }
    changed();
  }

  function setAlive(id, alive, t = now()) {
    const s = sessions.get(id);
    if (!s || s.alive === alive) return;
    s.alive = alive;
    if (!alive) { s.goneAt = t; s.ask = null; s.open.clear(); s.subs.clear(); s.subHooks.clear(); setKind(s, 'gone', '', t); }
    else { s.goneAt = 0; setKind(s, s.ended ? 'idle' : 'think', s.ended ? 'done, your turn' : 'thinking', t); }
    changed();
  }

  /** Periodically: expire errors, infer 'seems to be waiting', clean up gone sessions. */
  function tick(t = now()) {
    for (const [id, s] of sessions) {
      if (!s.alive && t - s.goneAt > GONE_MS) { sessions.delete(id); changed(); continue; }
      for (const [k, h] of s.subHooks) if (t - h.last > SUB_STALE_MS) { s.subHooks.delete(k); changed(); }
      if (s.kind === 'error' && s.errorUntil <= t) { settle(s, t, { kind: s.ended ? 'idle' : 'think', txt: s.ended ? 'done, your turn' : 'thinking' }); changed(); }
      const open = [...s.open.values()].at(-1);
      // Without hooks (Cursor, or Claude without hook events) we guess 'waiting for you' when a tool stays quiet for long.
      if (s.alive && !s.ask && !s.hooks && open && ['bash', 'edit', 'web'].includes(open.kind) && t - s.last > GUESS_MS && !s.guess) {
        s.guess = true; s.ask = { t, txt: `seems to be waiting: ${open.txt}`, guess: true, hookOnly: true }; setKind(s, 'ask', s.ask.txt, t); changed();
      }
    }
  }

  function view(s, t) {
    const cut = t - 70_000;
    let i = s.history.length - 1; while (i > 0 && s.history[i].t > cut) i--;
    // Helpers: the hook subagents (with what they do), or the running Agent tools when there are more of those.
    const helpers = s.subHooks.size >= s.subs.size ? [...s.subHooks].map(([id, h]) => ({ id, kind: h.kind, txt: h.txt })) : [...s.subs].map((id) => ({ id: String(id), kind: 'agent', txt: '' }));
    return { id: s.id, client: s.client, project: s.project, name: s.name, kind: s.kind, label: LABEL[s.kind] || s.kind, txt: s.txt, since: s.since,
      recent: s.recent, history: s.history.slice(i), subs: helpers.length, helpers, guess: !!s.ask?.guess, hooks: s.hooks };
  }

  function snapshot(t = now()) {
    return [...sessions.values()].sort((a, b) => a.id.localeCompare(b.id)).map((s) => view(s, t));
  }

  return { get, upsert, apply, setAlive, tick, snapshot, sessions, onChange: (f) => { listeners.add(f); return () => listeners.delete(f); }, takeDirty: () => { const d = dirty; dirty = false; return d; } };
}
