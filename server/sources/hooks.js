// Hook-payloads (via bin/hook.sh) → store-events.
import { kindOfTool, describeTool, projectName, clip } from '../classify.js';
import { promptText } from '../parse.js';

/** Claude Code hook-payload → lijst events. Exporteerd voor tests. */
export function claudeHookEvents(p, t = Date.now()) {
  const name = p.hook_event_name;
  const id = p.tool_use_id;
  switch (name) {
    case 'SessionStart': return [{ t, type: 'start' }];
    case 'UserPromptSubmit': return [{ t, type: 'prompt', txt: promptText(p.prompt) }];
    case 'PreToolUse': return [{ t, type: 'tool', id, name: p.tool_name, kind: kindOfTool(p.tool_name), txt: describeTool(p.tool_name, p.tool_input) }];
    case 'PostToolUse': return [{ t, type: 'result', id, error: false }];
    case 'PostToolUseFailure': return [{ t, type: 'result', id, error: !p.is_interrupt, txt: clip(p.error || 'tool gaf een fout', 40) }];
    case 'PermissionRequest': return [{ t, type: 'permission', txt: `toestemming: ${describeTool(p.tool_name, p.tool_input)}` }];
    case 'Notification': {
      const nt = p.notification_type || '';
      const msg = String(p.message || '');
      if (nt === 'permission_prompt' || (!nt && /permission/i.test(msg))) return [{ t, type: 'permission', txt: clip(msg || 'wil toestemming', 60) }];
      if (nt === 'elicitation_dialog') return [{ t, type: 'permission', txt: clip(msg || 'vraag aan jou', 60) }];
      if (nt === 'idle_prompt' || /waiting for your input/i.test(msg)) return [{ t, type: 'idle' }];
      return [];
    }
    case 'Stop': return [{ t, type: 'turnEnd', ok: true }];
    case 'StopFailure': return [{ t, type: 'turnEnd', ok: false, txt: 'gestopt met een fout' }];
    case 'SubagentStart': return [{ t, type: 'subStart', id: p.agent_id }];
    case 'SubagentStop': return [{ t, type: 'subStop', id: p.agent_id }];
    case 'SessionEnd': return [{ t, type: 'gone' }];
    default: return [];
  }
}

/** Cursor hooks: alleen 'after'-events en stop, die nooit een beslissing nemen. */
export function cursorHookEvents(p, t = Date.now()) {
  switch (p.hook_event_name) {
    case 'afterShellExecution': return [{ t, type: 'think', txt: 'denkt na', source: 'cursor' }];
    case 'afterFileEdit': return [{ t, type: 'tool', id: `e${t}`, name: 'Edit', kind: 'edit', txt: describeTool('Edit', { path: p.file_path }), source: 'cursor' }];
    case 'afterMCPExecution': return [{ t, type: 'think', txt: 'denkt na', source: 'cursor' }];
    case 'stop': return [{ t, type: 'turnEnd', ok: p.status !== 'error', txt: p.status === 'aborted' ? 'onderbroken' : 'gestopt met een fout' }];
    default: return [];
  }
}

// Cursor voert ook de Claude Code-hooks uit, met eigen namen of in camelCase (preToolUse).
const CURSOR_AS_CLAUDE = { beforeSubmitPrompt: 'UserPromptSubmit', postToolUseFailure: 'PostToolUseFailure' };
const claudeName = (n = '') => CURSOR_AS_CLAUDE[n] || n.charAt(0).toUpperCase() + n.slice(1);

/** Komt deze payload van Cursor? (Cursor stuurt ook via de Claude-hooks.) */
export const isCursorPayload = (src, p) => src === 'cursor' || !!(p.cursor_version || p.conversation_id);

export function createHookSink(store, claude, cursor) {
  return function handle(src, payload) {
    if (!payload || typeof payload !== 'object') return;
    const t = Date.now();
    if (isCursorPayload(src, payload)) {
      const cid = payload.conversation_id || payload.session_id;
      if (!cid) return;
      const id = cursor ? cursor.track(cid, { cwd: payload.workspace_roots?.[0] || payload.cwd || '', transcript: payload.transcript_path, t }) : 'cursor:' + cid;
      const evs = src === 'cursor' ? cursorHookEvents(payload, t) : claudeHookEvents({ ...payload, hook_event_name: claudeName(payload.hook_event_name) }, t);
      for (const ev of evs) store.apply(id, ev);
    } else if (src === 'claude') {
      const id = payload.session_id;
      if (!id) return;
      if (!store.get(id)) claude.track(id, { cwd: payload.cwd, project: projectName(payload.cwd), transcript: payload.transcript_path, t });
      store.apply(id, { type: 'hook' });
      for (const ev of claudeHookEvents(payload, t)) store.apply(id, ev);
    }
  };
}
