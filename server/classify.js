// Toolnaam + input → soort activiteit en een korte omschrijving.
// Soorten: think, read, edit, bash, web, agent, ask, error, idle, start, gone.

const READ = new Set(['read', 'grep', 'glob', 'ls', 'list', 'listdir', 'list_dir', 'codebase_search', 'semanticsearch', 'semsearch', 'file_search', 'readfile', 'read_file', 'notebookread', 'readlints', 'read_lints']);
const EDIT = new Set(['edit', 'write', 'multiedit', 'strreplace', 'str_replace', 'notebookedit', 'search_replace', 'edit_file', 'write_file', 'delete', 'deletefile', 'delete_file', 'applypatch', 'apply_patch', 'editnotebook', 'todowrite', 'todo_write']);
const BASH = new Set(['bash', 'shell', 'run_terminal_cmd', 'terminal', 'monitor', 'bashoutput', 'killshell', 'await', 'awaitshell']);
const WEB = new Set(['webfetch', 'websearch', 'web_search', 'fetch', 'web_fetch']);
const AGENT = new Set(['agent', 'task', 'subagent', 'sendmessage']);
const ASK = new Set(['askuserquestion', 'exitplanmode', 'ask_question', 'askquestion', 'createplan', 'create_plan', 'switchmode', 'switch_mode']);

const base = (p) => String(p).replace(/\/+$/, '').split('/').pop();
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
    // MCP: op het werkwoord in de naam
    if (/(search|read|get|list|query|fetch|find|describe|export)/.test(n)) return n.includes('web') ? 'web' : 'read';
    if (/(write|update|create|publish|edit|delete|send|replace|upload|batch)/.test(n)) return 'edit';
    return 'read';
  }
  if (/search|read|grep|glob|find|view/.test(n)) return 'read';
  if (/write|edit|replace|patch|create/.test(n)) return 'edit';
  return 'think';
}

/** Korte tekst voor wat een tool doet, uit zijn input. */
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
      return q ? clip(q, 60) : n.toLowerCase() === 'exitplanmode' ? 'plan ter goedkeuring' : 'vraag aan jou';
    }
    default: return clip(short);
  }
}

/** Nette projectnaam uit een cwd of een Cursor-projectslug. */
export function projectName(cwdOrSlug) {
  const s = String(cwdOrSlug || '');
  if (!s) return '?';
  if (s.includes('/')) {
    const parts = s.replace(/\/+$/, '').split('/');
    const last = parts.at(-1), parent = parts.at(-2) || '';
    const wt = parent.match(/^(.+)-worktrees$/);
    if (wt) return `${wt[1]} #${last}`;
    if (parts.length <= 3 && parts[1] === 'home') return '~';
    return last;
  }
  // Cursor-slug: home-alice-git-api-worktrees-12
  let t = s.replace(/^home-[^-]+-?/, '');
  if (!t) return '~';
  t = t.replace(/^(git|projects)-/, '');
  const wt = t.match(/^(.+)-worktrees-(\w+)$/);
  if (wt) return `${wt[1]} #${wt[2]}`;
  return t === 'git' || t === 'projects' ? `~/${t}` : t;
}

export { clip };
