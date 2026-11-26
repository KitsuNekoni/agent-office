#!/usr/bin/env node
// Installs (or with --remove: removes) the Agent Office hooks in
//   ~/.claude/settings.json  (Claude Code, global; async so they never block)
//   ~/.cursor/hooks.json     (Cursor; only 'after' events and stop, which decide nothing)
// Existing hooks are kept. Our own entries are recognised by the path of hook.sh.
// Before each change a backup is written next to the file (<file>.agent-office.bak).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hook.sh');
const home = process.env.HOME;
const remove = process.argv.includes('--remove');
const dry = process.argv.includes('--dry-run');

const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'SessionEnd'];
const CURSOR_EVENTS = ['afterShellExecution', 'afterFileEdit', 'afterMCPExecution', 'stop'];

// Path with spaces or other shell characters: wrap in single quotes. Plain paths stay as they were.
const CMD = /^[\w@%+=:,./-]+$/.test(HOOK) ? HOOK : `'${HOOK.replace(/'/g, `'\\''`)}'`;
// Recognise our entries by '.../bin/hook.sh claude|cursor', not by the full path,
// so entries from a moved or renamed repo are cleaned up too.
const ours = (cmd) => typeof cmd === 'string' && (cmd.includes(HOOK) || /[\\/]bin[\\/]hook\.sh'?\s+(claude|cursor)\s*$/.test(cmd));

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`${file} is not valid JSON; nothing changed (${e.message})`); }
}
function writeJson(file, data) {
  if (dry) { console.log(`--- ${file} (dry run)\n${JSON.stringify(data, null, 2)}`); return; }
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.agent-office.bak');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-agent-office';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function claude() {
  const file = path.join(home, '.claude', 'settings.json');
  const s = readJson(file, {});
  const hooks = s.hooks && typeof s.hooks === 'object' ? s.hooks : {};
  for (const ev of Object.keys(hooks)) {
    hooks[ev] = (hooks[ev] || []).map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !ours(h.command)) })).filter((g) => g.hooks.length);
    if (!hooks[ev].length) delete hooks[ev];
  }
  if (!remove) for (const ev of CLAUDE_EVENTS) (hooks[ev] ||= []).push({ hooks: [{ type: 'command', command: `${CMD} claude`, timeout: 3, async: true }] });
  if (Object.keys(hooks).length) s.hooks = hooks; else delete s.hooks;
  writeJson(file, s);
  console.log(`${remove ? 'Removed from' : 'Installed in'} ${file}`);
}

function cursor() {
  const file = path.join(home, '.cursor', 'hooks.json');
  const s = readJson(file, { version: 1, hooks: {} });
  s.version ||= 1;
  const hooks = s.hooks && typeof s.hooks === 'object' ? s.hooks : {};
  for (const ev of Object.keys(hooks)) {
    hooks[ev] = (hooks[ev] || []).filter((h) => !ours(h.command));
    if (!hooks[ev].length) delete hooks[ev];
  }
  if (!remove) for (const ev of CURSOR_EVENTS) (hooks[ev] ||= []).push({ command: `${CMD} cursor` });
  s.hooks = hooks;
  if (remove && !Object.keys(hooks).length && !fs.existsSync(file + '.agent-office.bak')) { if (!dry && fs.existsSync(file)) fs.unlinkSync(file); console.log(`Removed: ${file}`); return; }
  writeJson(file, s);
  console.log(`${remove ? 'Removed from' : 'Installed in'} ${file}`);
}

try { claude(); cursor(); } catch (e) { console.error(e.message); process.exit(1); }
if (!remove) console.log('New Claude Code and Cursor sessions now send events to Agent Office. Sessions that are already running pick up the hooks after a restart.');
