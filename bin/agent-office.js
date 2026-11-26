#!/usr/bin/env node
import { startServer } from '../server/index.js';

const port = Number(process.env.AGENT_OFFICE_PORT || 4517);
const { server, close } = startServer({ port });
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`Poort ${port} is al in gebruik: draait Agent Office al? Open http://localhost:${port}`); process.exit(1); }
  throw e;
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { close(); process.exit(0); });
