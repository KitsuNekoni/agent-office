// HTTP-server: statische web/, GET /events (SSE-snapshots), POST /hook/:src, GET /health.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createClaudeSource } from './sources/claude.js';
import { createCursorSource } from './sources/cursor.js';
import { createHookSink } from './sources/hooks.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY = 1024 * 1024;

export function startServer({ port = 4517, host = '127.0.0.1', home = process.env.HOME, log = console.log } = {}) {
  const store = createStore();
  const claude = createClaudeSource(store, { home });
  const cursor = createCursorSource(store, { home });
  const hook = createHookSink(store, claude, cursor);
  const clients = new Set();
  let lastHook = 0;

  const payload = () => JSON.stringify({ now: Date.now(), lastHook, sessions: store.snapshot() });
  const send = (res, data) => res.write(`data: ${data}\n\n`);

  const timers = [
    setInterval(() => { claude.scanRegistry(); }, 2000),
    setInterval(() => { claude.scanHeadless(); cursor.scan(); }, 5000),
    setInterval(() => { claude.pumpAll(); cursor.pumpAll(); store.tick(); }, 700),
    setInterval(() => { if (store.takeDirty() && clients.size) { const d = payload(); for (const c of clients) send(c, d); } }, 400),
    setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000),
  ];
  claude.scanRegistry(); claude.scanHeadless(); cursor.scan(); claude.pumpAll(); cursor.pumpAll();

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
      if (err) return res.writeHead(404).end('niet gevonden');
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(data);
    });
  });
  server.listen(port, host, () => log(`Agent Office: http://localhost:${port}`));
  const close = () => { timers.forEach(clearInterval); for (const c of clients) c.end(); server.close(); };
  return { server, store, close };
}
