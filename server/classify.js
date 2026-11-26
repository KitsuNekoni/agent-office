// Tool name + input → kind of activity and a short description.
// Kinds: think, read, edit, bash, web, agent, ask, error, idle, start, gone.
import os from 'node:os';

const READ = new Set(['read', 'grep', 'glob', 'ls', 'list', 'listdir', 'list_dir', 'codebase_search', 'semanticsearch', 'semsearch', 'file_search', 'readfile', 'read_file', 'notebookread', 'readlints', 'read_lints']);
const EDIT = new Set(['edit', 'write', 'multiedit', 'strreplace', 'str_replace', 'notebookedit', 'search_replace', 'edit_file', 'write_file', 'delete', 'deletefile', 'delete_file', 'applypatch', 'apply_patch', 'editnotebook', 'todowrite', 'todo_write']);
const BASH = new Set(['bash', 'shell', 'run_terminal_cmd', 'terminal', 'monitor', 'bashoutput', 'killshell', 'await', 'awaitshell']);
const WEB = new Set(['webfetch', 'websearch', 'web_search', 'fetch', 'web_fetch']);
const AGENT = new Set(['agent', 'task', 'subagent', 'sendmessage']);
const ASK = new Set(['askuserquestion', 'exitplanmode', 'ask_question', 'askquestion', 'createplan', 'create_plan', 'switchmode', 'switch_mode']);

const base = (p) => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
const clip = (s, n = 48) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function kindOfTool(name) {
  const raw = String(name || '');
  const n = raw.toLowerCase();
  if (ASK.has(n)) return 'ask';
  if (READ.has(n)) return 'read';
  if (EDIT.has(n)) return 'edit';
  if (BASH.has(n)) return 'bash';
  if (WEB.has(n)) return 'web';
  if (AGENT.has(n)) return 'agent';
  if (n.startsWith('mcp__') || n.startsWith('mcp_') || n.includes('-')) {
    // MCP: go by the verb in the name
    if (/(search|read|get|list|query|fetch|find|describe|export)/.test(n)) return n.includes('web') ? 'web' : 'read';
    if (/(write|update|create|publish|edit|delete|send|replace|upload|batch)/.test(n)) return 'edit';
    return 'read';
  }
  if (/search|read|grep|glob|find|view/.test(n)) return 'read';
  if (/write|edit|replace|patch|create/.test(n)) return 'edit';
  return 'think';
}

/** Short text for what a tool does, from its input. */
export function describeTool(name, input = {}) {
  const n = String(name || '');
  const i = input && typeof input === 'object' ? input : {};
  const short = n.startsWith('mcp__') ? n.split('__').pop() : n;
  const path = i.file_path || i.path || i.target_file || i.notebook_path || i.filePath;
  switch (kindOfTool(n)) {
    case 'bash': return clip(i.description || i.command || i.cmd || short, 44);
    case 'read':
      if (i.pattern || i.query) return clip(`${short}: ${i.pattern || i.query}`);
      return path ? base(path) : clip(short);
    case 'edit': return path ? base(path) : clip(short);
    case 'web': return clip(i.query || i.url || short);
    case 'agent': return clip(i.description || i.subagent_type || 'subagent');
    case 'ask': {
      const q = i.questions?.[0]?.question || i.question;
      return q ? clip(q, 60) : n.toLowerCase() === 'exitplanmode' ? 'plan for approval' : 'question for you';
    }
    default: return clip(short);
  }
}

// Home folders on Linux (/home/alice), macOS (/Users/alice) and Windows (C:\Users\alice), as a path or as a slug.
const HOME_PATH = /^(?:[A-Za-z]:)?\/(?:home|Users)\/[^/]+$/i;
const HOME_SLUG = /^(?:[A-Za-z]-+)?(?:home|Users)-[^-]+(?:-+|$)/i;
const slugify = (p) => String(p).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Tidy project name from a cwd or a Claude/Cursor project slug. `home` is the user's home folder. */
export function projectName(cwdOrSlug, home = os.homedir()) {
  const s = String(cwdOrSlug || '');
  if (!s) return '?';
  if (/[\\/]/.test(s)) {
    const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
    const p = norm(s);
    if ((home && p.toLowerCase() === norm(home).toLowerCase()) || HOME_PATH.test(p)) return '~';
    const parts = p.split('/');
    const last = parts.at(-1), parent = parts.at(-2) || '';
    const wt = parent.match(/^(.+)-worktrees$/);
    if (wt) return `${wt[1]} #${last}`;
    return last || p;
  }
  // Slug: home-alice-git-api-worktrees-12 (Cursor), -home-alice-git-shop (Claude), Users-alice-..., c-Users-alice-...
  let t = s.replace(/^-+/, '');
  const hs = home ? slugify(home) : '';
  if (hs && t.toLowerCase().startsWith(hs.toLowerCase()) && (t.length === hs.length || t[hs.length] === '-')) t = t.slice(hs.length);
  else t = t.replace(HOME_SLUG, '');
  t = t.replace(/^-+/, '');
  if (!t) return '~';
  t = t.replace(/^(git|projects|code|src|dev|repos|Documents)-/i, '');
  const wt = t.match(/^(.+)-worktrees-(\w+)$/);
  if (wt) return `${wt[1]} #${wt[2]}`;
  return /^(git|projects|code|src|dev|repos|Documents)$/i.test(t) ? `~/${t}` : t;
}

export { clip };
