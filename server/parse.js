// Transcriptregels → genormaliseerde events.
// Event: { t, type, ... } met type:
//   prompt {txt}  think {txt}  tool {id, name, kind, txt}  result {id, error}
//   turnEnd {ok}  title {txt}
import { kindOfTool, describeTool, clip } from './classify.js';

const ts = (v, fb) => { const n = Date.parse(v); return Number.isFinite(n) ? n : fb; };

const promptText = (s) => {
  s = String(s || '');
  const q = s.match(/<user_query>\s*([\s\S]*?)\s*(<\/user_query>|$)/);
  if (q) s = q[1];
  const cmd = s.match(/<command-name>\s*([^<]+)<\/command-name>/);
  if (cmd) return cmd[1].trim();
  return clip(s.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' '), 60);
};

/** Eén regel uit een Claude Code transcript (~/.claude/projects/<slug>/<id>.jsonl). */
export function parseClaudeLine(line, now = Date.now()) {
  let j; try { j = JSON.parse(line); } catch { return []; }
  const t = ts(j.timestamp, now);
  if (j.type === 'ai-title' && j.aiTitle) return [{ t, type: 'title', txt: j.aiTitle }];
  if (j.isSidechain) return []; // subagent-regels: alleen via hooks/subagent-tool
  if (j.type === 'system' && j.subtype === 'turn_duration') return [{ t, type: 'turnEnd', ok: true }];
  const c = j.message?.content;
  if (j.type === 'assistant' && Array.isArray(c)) {
    const out = [];
    for (const b of c) {
      if (b.type === 'thinking' || b.type === 'redacted_thinking') out.push({ t, type: 'think', txt: 'denkt na' });
      else if (b.type === 'text' && b.text?.trim()) out.push({ t, type: 'think', txt: 'schrijft antwoord' });
      else if (b.type === 'tool_use') out.push({ t, type: 'tool', id: b.id, name: b.name, kind: kindOfTool(b.name), txt: describeTool(b.name, b.input) });
    }
    return out;
  }
  if (j.type === 'user') {
    if (j.isMeta) return [];
    if (typeof c === 'string') {
      if (/^\[Request interrupted/.test(c)) return [{ t, type: 'turnEnd', ok: false, txt: 'onderbroken' }];
      if (c.startsWith('<local-command-stdout>') || c.startsWith('<local-command-caveat>')) return [];
      return [{ t, type: 'prompt', txt: promptText(c) }];
    }
    if (Array.isArray(c)) {
      const out = [];
      for (const b of c) {
        if (b.type === 'tool_result') out.push({ t, type: 'result', id: b.tool_use_id, error: !!b.is_error });
        else if (b.type === 'text' && /^\[Request interrupted/.test(b.text || '')) out.push({ t, type: 'turnEnd', ok: false, txt: 'onderbroken' });
      }
      if (!out.length && c.some((b) => b.type === 'text' && b.text?.trim())) out.push({ t, type: 'prompt', txt: promptText(c.find((b) => b.type === 'text').text) });
      return out;
    }
  }
  return [];
}

/** Eén regel uit een Cursor agent-transcript (~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl).
 *  Er staan geen tijdstempels in, dus t komt van de aanroeper (mtime). Tool-resultaten staan er niet in. */
export function parseCursorLine(line, t = Date.now()) {
  let j; try { j = JSON.parse(line); } catch { return []; }
  if (j.type === 'turn_ended') return [{ t, type: 'turnEnd', ok: j.status === 'success' || !j.status }];
  const c = j.message?.content;
  if (!Array.isArray(c)) return [];
  if (j.role === 'user') {
    const txt = c.find((b) => b.type === 'text' && /<user_query>/.test(b.text || ''))?.text;
    return txt ? [{ t, type: 'prompt', txt: promptText(txt) }] : [];
  }
  if (j.role === 'assistant') {
    const out = [];
    for (const b of c) {
      if (b.type === 'text' && b.text?.trim()) out.push({ t, type: 'think', txt: 'schrijft antwoord' });
      else if (b.type === 'thinking') out.push({ t, type: 'think', txt: 'denkt na' });
      else if (b.type === 'tool_use') out.push({ t, type: 'tool', id: b.id, name: b.name, kind: kindOfTool(b.name), txt: describeTool(b.name, b.input) });
    }
    return out;
  }
  return [];
}

export { promptText };
