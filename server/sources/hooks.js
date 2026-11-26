// Hook payloads (via bin/hook.sh) → store events.
import { kindOfTool, describeTool, projectName, clip } from '../classify.js';
import { promptText } from '../parse.js';

/** Claude Code hook payload → list of events. Exported for tests. */
export function claudeHookEvents(p, t = Date.now()) {
  const name = p.hook_event_name;
  const id = p.tool_use_id;
  // Tool calls inside a subagent carry its agent_id: they belong to that helper, not to the main agent.
  if (p.agent_id && name === 'PreToolUse') return [{ t, type: 'subTool', id: p.agent_id, kind: kindOfTool(p.tool_name), txt: describeTool(p.tool_name, p.tool_input) }];
  if (p.agent_id && (name === 'PostToolUse' || name === 'PostToolUseFailure')) return [{ t, type: 'subResult', id: p.agent_id }];
  switch (name) {
    case 'SessionStart': return [{ t, type: 'start' }];
    case 'UserPromptSubmit': return [{ t, type: 'prompt', txt: promptText(p.prompt) }];
    case 'PreToolUse': return [{ t, type: 'tool', id, name: p.tool_name, kind: kindOfTool(p.tool_name), txt: describeTool(p.tool_name, p.tool_input) }];
    case 'PostToolUse': return [{ t, type: 'result', id, error: false }];
    case 'PostToolUseFailure': return [{ t, type: 'result', id, error: !p.is_interrupt, txt: clip(p.error || 'tool failed', 40) }];
    case 'PermissionRequest': return [{ t, type: 'permission', txt: `permission: ${describeTool(p.tool_name, p.tool_input)}` }];
    case 'Notification': {
      const nt = p.notification_type || '';
      const msg = String(p.message || '');
      if (nt === 'permission_prompt' || (!nt && /permission/i.test(msg))) return [{ t, type: 'permission', txt: clip(msg || 'wants permission', 60) }];
      if (nt === 'elicitation_dialog') return [{ t, type: 'permission', txt: clip(msg || 'question for you', 60) }];
      if (nt === 'idle_prompt' || /waiting for your input/i.test(msg)) return [{ t, type: 'idle' }];
      return [];
    }
    case 'Stop': return [{ t, type: 'turnEnd', ok: true }];
    case 'StopFailure': return [{ t, type: 'turnEnd', ok: false, txt: 'stopped with an error' }];
    case 'SubagentStart': return [{ t, type: 'subStart', id: p.agent_id }];
    case 'SubagentStop': return [{ t, type: 'subStop', id: p.agent_id }];
    case 'SessionEnd': return [{ t, type: 'gone' }];
    default: return [];
  }
}

/** Cursor hooks: only 'after' events and stop, which never make a decision. */
export function cursorHookEvents(p, t = Date.now()) {
  switch (p.hook_event_name) {
    case 'afterShellExecution': return [{ t, type: 'think', txt: 'thinking', source: 'cursor' }];
    case 'afterFileEdit': return [{ t, type: 'tool', id: `e${t}`, name: 'Edit', kind: 'edit', txt: describeTool('Edit', { path: p.file_path }), source: 'cursor' }];
    case 'afterMCPExecution': return [{ t, type: 'think', txt: 'thinking', source: 'cursor' }];
    case 'stop': return [{ t, type: 'turnEnd', ok: p.status !== 'error', txt: p.status === 'aborted' ? 'interrupted' : 'stopped with an error' }];
    default: return [];
  }
}

// Cursor also runs the Claude Code hooks, with its own names or in camelCase (preToolUse).
const CURSOR_AS_CLAUDE = { beforeSubmitPrompt: 'UserPromptSubmit', postToolUseFailure: 'PostToolUseFailure' };
const claudeName = (n = '') => CURSOR_AS_CLAUDE[n] || n.charAt(0).toUpperCase() + n.slice(1);

/** Does this payload come from Cursor? (Cursor also sends through the Claude hooks.) */
export const isCursorPayload = (src, p) => src === 'cursor' || !!(p.cursor_version || p.conversation_id);

// Events that mean a Cursor chat is really working right now. Anything else (a tool result, session start,
// notification) may come from an old or internal Cursor conversation and must not bring a chat back to life.
const ACTIVITY = new Set(['prompt', 'tool', 'think']);

export function createHookSink(store, claude, cursor, { log = null } = {}) {
  return function handle(src, payload) {
    if (!payload || typeof payload !== 'object') return;
    const t = Date.now();
    if (isCursorPayload(src, payload)) {
      const cid = payload.conversation_id || payload.session_id;
      if (!cid) return;
      const evs = src === 'cursor' ? cursorHookEvents(payload, t) : claudeHookEvents({ ...payload, hook_event_name: claudeName(payload.hook_event_name) }, t);
      const s = store.get('cursor:' + cid);
      const asleep = !s || !s.alive || s.ended; // unknown, gone or finished
      const keep = asleep ? evs.filter((ev) => ACTIVITY.has(ev.type) || (s && ['turnEnd', 'gone', 'idle'].includes(ev.type))) : evs;
      log?.(`hook ${src} ${payload.hook_event_name} cursor:${String(cid).slice(0, 8)} ${keep.length ? keep.map((e) => e.type).join(',') : 'ignored'}`);
      if (!keep.length) return;
      const id = cursor ? cursor.track(cid, { cwd: payload.workspace_roots?.[0] || payload.cwd || '', transcript: payload.transcript_path, t }) : 'cursor:' + cid;
      for (const ev of keep) store.apply(id, ev);
    } else if (src === 'claude') {
      const id = payload.session_id;
      if (!id) return;
      log?.(`hook ${src} ${payload.hook_event_name} ${String(id).slice(0, 8)}${payload.agent_id ? ` agent:${String(payload.agent_id).slice(0, 8)}` : ''}${payload.agent_type ? ` ${payload.agent_type}` : ''}`);
      if (!store.get(id)) claude.track(id, { cwd: payload.cwd, project: projectName(payload.cwd), transcript: payload.transcript_path, t });
      store.apply(id, { type: 'hook' });
      for (const ev of claudeHookEvents(payload, t)) store.apply(id, ev);
    }
  };
}
