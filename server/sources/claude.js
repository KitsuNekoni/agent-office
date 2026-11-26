// Claude Code: session registry (~/.claude/sessions/<pid>.json) + transcripts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTail } from './tail.js';
import { parseClaudeLine } from '../parse.js';
import { projectName } from '../classify.js';

const slugOf = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

/** Is this process still alive, and is it the same process (pid reuse)? */
export function pidAlive(pid, procStart) {
  try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') return false; }
  if (!procStart) return true;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[19] === String(procStart);
  } catch { return true; }
}

const CLIENT = { cli: 'cli', 'claude-desktop': 'app', 'claude-vscode': 'cli', 'sdk-cli': 'cli', 'sdk-ts': 'cli', 'sdk-py': 'cli' };

/** Claude Code's config folder: $CLAUDE_CONFIG_DIR, otherwise ~/.claude. */
export const claudeDir = (home = os.homedir()) => process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');

export function createClaudeSource(store, { home = os.homedir(), dir = claudeDir(home) } = {}) {
  const root = dir;
  const tails = new Map(); // sessionId → tail
  const known = new Map(); // sessionId → transcript path
  const registered = new Set(); // seen in the registry once: don't pick it up as headless

  function transcriptFor(id, cwd) {
    if (known.has(id)) return known.get(id);
    const guess = path.join(root, 'projects', slugOf(cwd || ''), `${id}.jsonl`);
    if (fs.existsSync(guess)) { known.set(id, guess); return guess; }
    try {
      for (const d of fs.readdirSync(path.join(root, 'projects'))) {
        const p = path.join(root, 'projects', d, `${id}.jsonl`);
        if (fs.existsSync(p)) { known.set(id, p); return p; }
      }
    } catch {}
    return null;
  }

  function pump(id) {
    const tail = tails.get(id);
    const r = tail?.read();
    if (!r) return;
    for (const line of r.lines) for (const ev of parseClaudeLine(line, r.mtime)) store.apply(id, ev);
  }

  /** Register a session and start following its transcript. */
  function track(id, meta) {
    const existed = !!store.get(id);
    store.upsert(id, { source: 'claude', ...meta });
    if (!tails.has(id)) {
      const p = meta.transcript || transcriptFor(id, meta.cwd);
      if (p) { known.set(id, p); tails.set(id, createTail(p)); pump(id); }
    }
    if (!existed) store.setAlive(id, true);
  }

  function scanRegistry() {
    const dir = path.join(root, 'sessions');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return; }
    const live = new Map();
    for (const f of files) {
      let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      if (!j.sessionId || !pidAlive(j.pid, j.procStart)) continue;
      live.set(j.sessionId, j);
    }
    for (const [id, j] of live) {
      registered.add(id);
      track(id, { client: CLIENT[j.entrypoint] || 'cli', cwd: j.cwd, project: projectName(j.cwd), pid: j.pid,
        name: j.name, nameRank: j.nameSource === 'user' ? 3 : 0, t: j.startedAt });
      const s = store.get(id);
      if (!s.alive) store.setAlive(id, true);
      // Registry says idle and nothing happened since: the turn is over.
      if (j.status === 'idle' && j.statusUpdatedAt > s.last + 1000 && !['idle', 'ask'].includes(s.kind) && !s.open.size) store.apply(id, { t: j.statusUpdatedAt, type: 'idle' });
    }
    for (const s of store.sessions.values()) {
      if (s.source !== 'claude' || !s.alive || live.has(s.id)) continue;
      if (s.pid && !pidAlive(s.pid)) { store.setAlive(s.id, false); continue; }
      if (!s.pid && Date.now() - s.last > 10 * 60_000) store.setAlive(s.id, false); // headless without a registry entry
    }
  }

  /** Headless runs (claude -p) are not in the registry: pick up recently changed transcripts. */
  function scanHeadless(t = Date.now()) {
    const pdir = path.join(root, 'projects');
    let dirs = []; try { dirs = fs.readdirSync(pdir); } catch { return; }
    for (const d of dirs) {
      let files = []; try { files = fs.readdirSync(path.join(pdir, d)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of files) {
        const id = f.slice(0, -6);
        if (registered.has(id) || store.get(id)) continue;
        const p = path.join(pdir, d, f);
        let st; try { st = fs.statSync(p); } catch { continue; }
        if (t - st.mtimeMs > 60_000) continue;
        let cwd = '';
        try { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(16384); const n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); cwd = b.toString('utf8', 0, n).match(/"cwd":"([^"]+)"/)?.[1] || ''; } catch {}
        track(id, { client: 'cli', cwd, project: projectName(cwd || d), transcript: p, name: 'headless ' + id.slice(0, 6), t: st.mtimeMs });
      }
    }
  }

  function pumpAll() { for (const id of tails.keys()) { if (store.get(id)) pump(id); else tails.delete(id); } }

  return { scanRegistry, scanHeadless, pumpAll, track, transcriptFor };
}
