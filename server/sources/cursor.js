// Cursor: agent-transcripts van IDE en CLI (~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl).
// CLI-chats (agent / agent -p, ook vanuit andere tools) hebben daarnaast een map in ~/.cursor/chats/<hash>/<id>.
import fs from 'node:fs';
import path from 'node:path';
import { createTail } from './tail.js';
import { parseCursorLine } from '../parse.js';
import { projectName } from '../classify.js';

const ACTIVE_MS = 30 * 60_000; // midden in een beurt: zo lang zichtbaar zonder nieuwe regels
const IDLE_MS = 10 * 60_000;   // na het einde van een beurt: nog zo lang in de idle-hoek
const SUB_MS = 20_000;

export function createCursorSource(store, { home = process.env.HOME } = {}) {
  const root = path.join(home, '.cursor');
  const tracked = new Map(); // id → { tail, dir, mtime, fresh }
  const dismissed = new Map(); // id → mtime waarop hij verdween; pas terug als het bestand weer verandert

  function cliChats() {
    const out = new Map();
    const dir = path.join(root, 'chats');
    let hs = []; try { hs = fs.readdirSync(dir); } catch { return out; }
    for (const h of hs) {
      let ids = []; try { ids = fs.readdirSync(path.join(dir, h)); } catch { continue; }
      for (const id of ids) out.set(id, path.join(dir, h, id));
    }
    return out;
  }

  /** Begin een sessie te volgen die een hook meldt (Cursor schrijft het transcript soms pas na de beurt). */
  function track(id, { cwd = '', transcript = '', t = Date.now() } = {}) {
    const key = 'cursor:' + id;
    if (tracked.has(key) && store.get(key)) return key;
    dismissed.delete(key);
    const chat = cliChats().get(id);
    const slug = transcript ? path.basename(path.dirname(path.dirname(path.dirname(transcript)))) : '';
    store.upsert(key, { source: 'cursor', client: chat ? 'cursor-cli' : 'cursor', cwd, project: projectName(cwd || slug), name: 'chat ' + id.slice(0, 6), t });
    let mtime = t; try { mtime = fs.statSync(transcript).mtimeMs; } catch {}
    tracked.set(key, { tail: createTail(transcript || path.join(root, 'none')), dir: transcript ? path.dirname(transcript) : '', mtime, fresh: false });
    while (tracked.get(key).tail.read()); // oude regels overslaan: de hooks vertellen wat er nu gebeurt
    store.setAlive(key, true, t);
    return key;
  }

  /** Zoek transcripts die recent veranderd zijn. */
  function scan(t = Date.now()) {
    const pdir = path.join(root, 'projects');
    let slugs = []; try { slugs = fs.readdirSync(pdir); } catch { return; }
    const chats = cliChats();
    for (const slug of slugs) {
      const adir = path.join(pdir, slug, 'agent-transcripts');
      let ids = []; try { ids = fs.readdirSync(adir); } catch { continue; }
      for (const id of ids) {
        const key = 'cursor:' + id;
        const file = path.join(adir, id, `${id}.jsonl`);
        let st; try { st = fs.statSync(file); } catch { continue; }
        const age = t - st.mtimeMs;
        if (!tracked.has(key)) {
          if (age > ACTIVE_MS || dismissed.get(key) >= st.mtimeMs) continue;
          dismissed.delete(key);
          let cwd = '';
          const chat = chats.get(id);
          if (chat) { try { cwd = JSON.parse(fs.readFileSync(path.join(chat, 'meta.json'), 'utf8')).cwd || ''; } catch {} }
          store.upsert(key, { source: 'cursor', client: chat ? 'cursor-cli' : 'cursor', cwd, project: projectName(cwd || slug), name: 'chat ' + id.slice(0, 6), t: st.mtimeMs });
          tracked.set(key, { tail: createTail(file), dir: path.join(adir, id), mtime: st.mtimeMs, fresh: true });
        }
        const tr = tracked.get(key);
        tr.mtime = st.mtimeMs;
      }
    }
  }

  function pumpAll(t = Date.now()) {
    for (const [key, tr] of tracked) {
      const s = store.get(key);
      if (!s) { tracked.delete(key); continue; }
      const r = tr.tail.read();
      if (r) for (const line of r.lines) for (const ev of parseCursorLine(line, r.mtime)) store.apply(key, { ...ev, source: 'cursor' });
      const mtime = r?.mtime ?? tr.mtime;
      if (mtime > tr.mtime) tr.mtime = mtime;
      // Subagents: bestanden in subagents/ die net veranderd zijn
      let subs = 0;
      if (tr.dir) try { for (const f of fs.readdirSync(path.join(tr.dir, 'subagents'))) { const st = fs.statSync(path.join(tr.dir, 'subagents', f)); if (t - st.mtimeMs < SUB_MS) subs++; } } catch {}
      if (subs !== s.cursorSubs) {
        s.cursorSubs = subs; s.subs = new Set(Array.from({ length: subs }, (_, i) => 'c' + i));
        if (subs) { s.last = t; if (s.ask?.guess) s.ask = null; } // subagent aan het werk: niet aan het wachten
      }
      const age = t - Math.max(tr.mtime, s.last); // hook-activiteit telt ook als leven
      const stale = s.ended ? age > IDLE_MS : age > ACTIVE_MS;
      if (stale && tr.fresh) { store.sessions.delete(key); tracked.delete(key); dismissed.set(key, tr.mtime); continue; } // al klaar bij opstarten: niet tonen
      tr.fresh = false;
      if (s.alive && stale) { store.setAlive(key, false, t); dismissed.set(key, tr.mtime); }
      else if (!s.alive && age < 5_000) { store.setAlive(key, true, t); dismissed.delete(key); }
    }
  }

  return { scan, pumpAll, track };
}
