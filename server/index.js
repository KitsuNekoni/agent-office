// HTTP server: static web/, GET /events (SSE snapshots), POST /hook/:src, POST /api/update[/check], GET /health.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createClaudeSource } from './sources/claude.js';
import { createCursorSource } from './sources/cursor.js';
import { cursorEditorRunning } from './sources/cursor-app.js';
import { createHookSink } from './sources/hooks.js';
import { createUpdater } from './update.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY = 1024 * 1024;

export function startServer({ port = 4517, host = '127.0.0.1', home = os.homedir(), log = console.log, debug = !!process.env.AGENT_OFFICE_DEBUG,
  updates = !process.env.AGENT_OFFICE_NO_UPDATE_CHECK, restart = null, updater: injected = null } = {}) {
  const store = createStore();
  const claude = createClaudeSource(store, { home });
  const cursor = createCursorSource(store, { home });
  const hook = createHookSink(store, claude, cursor, { log: debug ? (m) => log(`${new Date().toTimeString().slice(0, 8)} ${m}`) : null });
  const clients = new Set();
  let lastHook = 0, updateDirty = false;
  const updater = injected || createUpdater({ root: path.join(WEB, '..'), port, enabled: updates, onChange: () => { updateDirty = true; }, log });

  const payload = () => JSON.stringify({ now: Date.now(), lastHook, update: updater.status(), sessions: store.snapshot() });
  const send = (res, data) => res.write(`data: ${data}\n\n`);

  let checking = false;
  const checkEditor = () => { if (checking) return; checking = true; cursorEditorRunning().then(cursor.editorState, () => {}).finally(() => { checking = false; }); };
  const timers = [
    setInterval(checkEditor, 5000),
    setInterval(() => { claude.scanRegistry(); }, 2000),
    setInterval(() => { claude.scanHeadless(); cursor.scan(); }, 5000),
    setInterval(() => { claude.pumpAll(); cursor.pumpAll(); store.tick(); }, 700),
    setInterval(() => { const dirty = store.takeDirty() | updateDirty; updateDirty = false; if (dirty && clients.size) { const d = payload(); for (const c of clients) send(c, d); } }, 400),
    setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000),
  ];
  claude.scanRegistry(); claude.scanHeadless(); cursor.scan(); claude.pumpAll(); cursor.pumpAll();
  checkEditor();
  updater.start();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname.startsWith('/hook/')) {
      const src = url.pathname.slice(6);
      let body = '', size = 0;
      req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) body += c; });
      req.on('end', () => {
        res.writeHead(204).end();
        if (size > MAX_BODY) return;
        try { hook(src, JSON.parse(body)); lastHook = Date.now(); } catch {}
      });
      return;
    }
    if (url.pathname === '/api/update' || url.pathname === '/api/update/check') {
      if (req.method !== 'POST') return res.writeHead(405).end();
      // A custom header can't be sent cross-site without a CORS preflight, which we never allow: no other website can trigger this.
      if (req.headers['x-agent-office'] !== '1') return res.writeHead(403).end('forbidden');
      req.resume();
      const job = url.pathname === '/api/update' ? updater.apply() : updater.check({ recent: 30_000 }); // page loads and clicks: at most one git fetch per 30 s
      job.then((r) => {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(updater.status()));
        if (r?.ok && restart) setTimeout(restart, 300); // let the answer (and the 'updated' status) reach the page first
      }).catch((e) => res.writeHead(500).end(String(e.message || e)));
      return;
    }
    if (req.method !== 'GET') return res.writeHead(405).end();
    if (url.pathname === '/health') return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      send(res, payload());
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/sessions') return res.writeHead(200, { 'content-type': 'application/json' }).end(payload());
    const rel = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^[/\\]+/, '');
    const file = path.join(WEB, rel);
    if (!file.startsWith(WEB + path.sep)) return res.writeHead(404).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(data);
    });
  });
  server.listen(port, host, () => log(`Agent Office: http://localhost:${port}`));
  const close = () => { timers.forEach(clearInterval); updater.stop(); for (const c of clients) c.end(); server.close(); };
  return { server, store, updater, close };
}
