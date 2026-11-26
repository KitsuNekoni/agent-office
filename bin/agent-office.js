#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(BIN, '..', 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const HELP = `Agent Office ${version}: live mission control for Claude Code and Cursor agents on this machine.

Usage:
  agent-office [--port <n>]                  start the office (default port 4517, or $AGENT_OFFICE_PORT)
  agent-office hooks install [--port <n>]    install the optional hooks (exact "waiting for you")
  agent-office hooks remove                  remove them again
  agent-office --version | --help

The office only listens on 127.0.0.1 and only reads files: it never controls your agents.`;

if (args.includes('--help') || args.includes('-h')) { console.log(HELP); process.exit(0); }
if (args.includes('--version') || args.includes('-v')) { console.log(version); process.exit(0); }

if (args[0] === 'hooks') {
  const sub = args[1];
  if (!['install', 'remove'].includes(sub)) { console.error(HELP); process.exit(1); }
  const rest = args.slice(2).concat(sub === 'remove' ? ['--remove'] : []);
  const r = spawnSync(process.execPath, [path.join(BIN, 'install-hooks.js'), ...rest], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
if (args.length && !args[0].startsWith('-')) { console.error(`Unknown command: ${args[0]}\n\n${HELP}`); process.exit(1); }

const port = Number(opt('--port') || process.env.AGENT_OFFICE_PORT || 4517);
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error(`Invalid port: ${opt('--port') || process.env.AGENT_OFFICE_PORT}`); process.exit(1); }

const { startServer } = await import('../server/index.js');
const { server, close } = startServer({ port });
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`Port ${port} is already in use: is Agent Office already running? Open http://localhost:${port} or pick another port with --port.`); process.exit(1); }
  throw e;
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { close(); process.exit(0); });
