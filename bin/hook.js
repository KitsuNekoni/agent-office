#!/usr/bin/env node
// Agent Office hook relay. Forwards the hook payload (stdin) to the local office server.
// Never makes a decision and always fails silently: if the office isn't running, nothing happens.
// Usage: hook.js claude|cursor [port]   (port: argument, else $AGENT_OFFICE_PORT, else 4517)
import http from 'node:http';

const src = process.argv[2] === 'cursor' ? 'cursor' : 'claude';
const port = Number(process.argv[3] || process.env.AGENT_OFFICE_PORT || 4517);

// Cursor expects JSON on stdout; an empty object means: no opinion.
const done = () => { if (src === 'cursor') process.stdout.write('{}\n'); process.exit(0); };
setTimeout(done, 1500).unref?.(); // hard cap, whatever happens

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('error', done);
process.stdin.on('end', () => {
  const body = Buffer.concat(chunks);
  const req = http.request({ host: '127.0.0.1', port, path: `/hook/${src}`, method: 'POST', timeout: 200,
    headers: { 'content-type': 'application/json', 'content-length': body.length } }, (res) => { res.resume(); res.on('end', done); });
  req.on('timeout', () => req.destroy());
  req.on('error', done);
  req.end(body);
});
