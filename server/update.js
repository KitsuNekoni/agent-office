// Version + self-update from git. The office shows its version; when the upstream branch has a higher
// package.json version, the page offers an update: git pull --ff-only, refresh the hooks (only if they
// were installed), then the caller restarts the server.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { clip } from './classify.js';

const CHECK_EVERY = 6 * 3600_000;

/** Compare two x.y.z versions numerically: 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a, b) {
  const p = (v) => String(v || '').replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
}

// Never let git wait for a password or passphrase: a check just fails instead.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes' };
const exec = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 20_000, env: GIT_ENV, ...opts }, (e, stdout, stderr) => (e ? reject(Object.assign(e, { stderr: String(stderr || '') })) : resolve(String(stdout))));
});
const why = (e) => clip(String(e.stderr || e.message || e).trim().split('\n').filter(Boolean).pop() || 'unknown error', 90);

/**
 * root: the repo folder (with package.json). port: the server's port, for the hooks.
 * run(cmd, args) → Promise<stdout>, injectable for tests. onChange: called on every status change.
 */
export function createUpdater({ root, port = 4517, run = exec, enabled = true, onChange = () => {}, log = () => {} } = {}) {
  const readVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '?'; } catch { return '?'; } };
  const st = { version: readVersion(), remote: null, available: false, git: false, state: 'idle', error: '' };
  const git = (...args) => run('git', ['-C', root, ...args]);
  let timer = null, running = null, lastCheck = 0;

  function set(patch) {
    Object.assign(st, patch);
    st.available = st.git && !!st.remote && compareVersions(st.remote, st.version) > 0;
    onChange();
  }
  const status = () => ({ ...st });

  /** Check upstream; a check already under way is shared. With { recent }, a check younger than that many ms is reused. */
  function check({ recent = 0 } = {}) {
    if (running) return running;
    if (recent && Date.now() - lastCheck < recent) return Promise.resolve(status());
    running = doCheck().finally(() => { running = null; lastCheck = Date.now(); });
    return running;
  }

  async function doCheck() {
    if (!enabled || st.state === 'updating' || st.state === 'updated') return status();
    try { await git('rev-parse', '--abbrev-ref', '@{u}'); } catch { set({ git: false, state: 'idle' }); return status(); } // no git checkout or no upstream
    set({ git: true, state: 'checking' });
    try {
      await git('fetch', '--quiet');
      const remote = JSON.parse(await git('show', '@{u}:package.json')).version;
      set({ remote, state: 'idle', error: '' });
    } catch (e) { set({ state: 'error', error: `update check failed: ${why(e)}` }); }
    return status();
  }

  async function apply() {
    if (!st.available) return { ok: false, error: 'no update available' };
    if (st.state === 'updating' || st.state === 'updated') return { ok: false, error: 'already updating' };
    set({ state: 'updating', error: '' });
    try {
      if ((await git('status', '--porcelain', '--untracked-files=no')).trim()) { set({ state: 'error', error: 'local changes, update by hand' }); return { ok: false, error: st.error }; }
      await git('pull', '--ff-only', '--quiet');
    } catch (e) { set({ state: 'error', error: `update failed: ${why(e)}` }); return { ok: false, error: st.error }; }
    // Refresh the hooks with the new installer from disk, only where they were installed before.
    let error = '';
    try { log((await run(process.execPath, [path.join(root, 'bin', 'install-hooks.js'), '--if-installed', '--port', String(port)])).trim()); }
    catch (e) { error = `updated, but hooks: ${why(e)}`; log(error); }
    set({ version: readVersion(), state: 'updated', error });
    return { ok: true };
  }

  function start() {
    if (!enabled) return;
    check();
    timer = setInterval(() => check(), CHECK_EVERY); timer.unref?.();
  }
  const stop = () => clearInterval(timer);

  return { status, check, apply, start, stop };
}
