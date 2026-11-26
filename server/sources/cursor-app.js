// Is the Cursor editor (the IDE, not the CLI) open on this machine? Cursor writes no "closed" event,
// so without this check a finished chat stays at its desk after the editor is gone.
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const WSL = process.platform === 'linux' && (() => { try { return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch { return false; } })();
const TASKLIST = '/mnt/c/Windows/System32/tasklist.exe';

/** Does a command line belong to a Cursor editor window? Exported for tests. */
export function isCursorEditor(cmd) {
  const c = String(cmd);
  // Native Linux app (AppImage or package): the main binary is called cursor / Cursor.
  if (/(^|\/)cursor(\.AppImage)?(\0|\s|$)/i.test(c) && !/cursor-server|cursor-agent/i.test(c)) return true;
  // Remote window (WSL, SSH): cursor-server only has an extension host while a window is connected.
  return /cursor-server/.test(c) && /--type=extensionHost/.test(c);
}

function linuxRunning() {
  let pids = []; try { pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)); } catch { return null; }
  for (const pid of pids) {
    let cmd = ''; try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; }
    if (isCursorEditor(cmd)) return true;
  }
  return false;
}

const run = (file, args) => new Promise((resolve) => {
  execFile(file, args, { timeout: 8000, windowsHide: true }, (err, out) => resolve(err ? null : String(out)));
});

/** true = open, false = closed, null = could not tell (then nothing is changed). */
export async function cursorEditorRunning() {
  if (process.platform === 'darwin') {
    const out = await run('pgrep', ['-x', 'Cursor']);
    return out === null ? false : out.trim().length > 0; // pgrep exits 1 when nothing matches
  }
  if (process.platform === 'win32') {
    const out = await run('tasklist', ['/FI', 'IMAGENAME eq Cursor.exe', '/NH']);
    return out === null ? null : /Cursor\.exe/i.test(out);
  }
  const local = linuxRunning();
  if (local) return true;
  if (WSL) {
    const out = await run(TASKLIST, ['/FI', 'IMAGENAME eq Cursor.exe', '/NH']);
    if (out === null) return null; // Windows side unreachable: don't guess
    return /Cursor\.exe/i.test(out);
  }
  return local;
}
