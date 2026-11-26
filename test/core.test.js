import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOfTool, describeTool, projectName } from '../server/classify.js';
import { parseClaudeLine, parseCursorLine } from '../server/parse.js';
import { createStore } from '../server/store.js';
import { claudeHookEvents, cursorHookEvents, createHookSink } from '../server/sources/hooks.js';
import { createCursorSource } from '../server/sources/cursor.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const J = (o) => JSON.stringify(o);

test('classify: tools van Claude Code en Cursor', () => {
  assert.equal(kindOfTool('Read'), 'read');
  assert.equal(kindOfTool('Grep'), 'read');
  assert.equal(kindOfTool('StrReplace'), 'edit');
  assert.equal(kindOfTool('Write'), 'edit');
  assert.equal(kindOfTool('Bash'), 'bash');
  assert.equal(kindOfTool('Shell'), 'bash');
  assert.equal(kindOfTool('WebSearch'), 'web');
  assert.equal(kindOfTool('Agent'), 'agent');
  assert.equal(kindOfTool('AskUserQuestion'), 'ask');
  assert.equal(kindOfTool('ExitPlanMode'), 'ask');
  assert.equal(kindOfTool('mcp__claude_ai_Munin__search_memory'), 'read');
  assert.equal(kindOfTool('mcp__claude-artifacts__publish_files'), 'edit');
});

test('classify: omschrijvingen en projectnamen', () => {
  assert.equal(describeTool('Read', { file_path: '/a/b/office.js' }), 'office.js');
  assert.equal(describeTool('Bash', { command: 'npm test', description: 'Run tests' }), 'Run tests');
  assert.equal(describeTool('Shell', { command: 'php tests/run.php' }), 'php tests/run.php');
  assert.equal(describeTool('AskUserQuestion', { questions: [{ question: 'Welke lijst?' }] }), 'Welke lijst?');
  assert.equal(projectName('/home/alice/projects/webshop'), 'webshop');
  assert.equal(projectName('/home/alice/git/api-worktrees/12'), 'api #12');
  assert.equal(projectName('/home/alice'), '~');
  assert.equal(projectName('home-alice-git-shop42'), 'shop42');
  assert.equal(projectName('home-alice-git-api-worktrees-12'), 'api #12');
});

test('parseClaudeLine: tool_use, result, beurt klaar, titel, prompt', () => {
  const ts = '2026-11-26T08:32:04.717Z';
  const tool = parseClaudeLine(J({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } }));
  assert.deepEqual(tool.map((e) => e.type), ['think', 'tool']);
  assert.equal(tool[1].kind, 'bash');
  assert.equal(tool[1].t, Date.parse(ts));
  const res = parseClaudeLine(J({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true }] } }));
  assert.deepEqual(res, [{ t: Date.parse(ts), type: 'result', id: 'tu1', error: true }]);
  assert.equal(parseClaudeLine(J({ type: 'system', subtype: 'turn_duration', timestamp: ts }))[0].type, 'turnEnd');
  assert.equal(parseClaudeLine(J({ type: 'ai-title', aiTitle: 'Virtuele office' }))[0].txt, 'Virtuele office');
  assert.equal(parseClaudeLine(J({ type: 'user', timestamp: ts, message: { content: 'Bouw de office' } }))[0].type, 'prompt');
  assert.deepEqual(parseClaudeLine(J({ type: 'user', isMeta: true, message: { content: 'x' } })), []);
  assert.deepEqual(parseClaudeLine(J({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', id: 'x', name: 'Read' }] } })), []);
  assert.deepEqual(parseClaudeLine('niet-json'), []);
});

test('parseCursorLine: prompt, tools, turn_ended', () => {
  const p = parseCursorLine(J({ role: 'user', message: { content: [{ type: 'text', text: '<timestamp>x</timestamp>\n<user_query>\nAnalyseer de PDF\n</user_query>' }] } }), 5);
  assert.deepEqual(p, [{ t: 5, type: 'prompt', txt: 'Analyseer de PDF' }]);
  const tools = parseCursorLine(J({ role: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { path: '/x/SalesModel.php' } }, { type: 'tool_use', name: 'Shell', input: { command: 'php tests/run.php' } }] } }), 6);
  assert.deepEqual(tools.map((e) => [e.kind, e.txt]), [['read', 'SalesModel.php'], ['bash', 'php tests/run.php']]);
  assert.deepEqual(parseCursorLine(J({ type: 'turn_ended', status: 'success' }), 7), [{ t: 7, type: 'turnEnd', ok: true }]);
});

function setup() {
  let clock = 1000;
  const store = createStore({ now: () => clock });
  store.upsert('s', { source: 'claude', client: 'cli', project: 'p', t: clock });
  return { store, s: () => store.snapshot(clock)[0], at: (t) => { clock = t; } };
}

test('store: tool → resultaat → klaar', () => {
  const { store, s } = setup();
  store.apply('s', { t: 1100, type: 'prompt', txt: 'doe iets' });
  assert.equal(s().kind, 'think');
  assert.equal(s().name, 'doe iets');
  store.apply('s', { t: 1200, type: 'tool', id: 'a', kind: 'read', txt: 'x.js' });
  assert.deepEqual([s().kind, s().txt], ['read', 'x.js']);
  store.apply('s', { t: 1300, type: 'result', id: 'a' });
  assert.equal(s().kind, 'think');
  store.apply('s', { t: 1400, type: 'turnEnd', ok: true });
  assert.equal(s().kind, 'idle');
  assert.deepEqual(s().recent.map((r) => r.kind), ['think', 'read', 'think']);
});

test('store: toestemming via hook blijft staan tot er na de vraag iets gebeurt', () => {
  const { store, s } = setup();
  store.apply('s', { t: 2000, type: 'tool', id: 'b', kind: 'bash', txt: 'git push' }); // PreToolUse
  store.apply('s', { t: 2010, type: 'permission', txt: 'wil toestemming' });
  assert.equal(s().kind, 'ask');
  // transcriptregel van dezelfde tool met een oudere tijd komt later binnen: blijft ask
  store.apply('s', { t: 1990, type: 'think' });
  store.apply('s', { t: 1990, type: 'tool', id: 'b', kind: 'bash', txt: 'git push' });
  assert.equal(s().kind, 'ask');
  store.apply('s', { t: 5000, type: 'result', id: 'b' }); // goedgekeurd en uitgevoerd
  assert.equal(s().kind, 'think');
});

test('store: AskUserQuestion is wachten tot het antwoord binnen is', () => {
  const { store, s } = setup();
  store.apply('s', { t: 2000, type: 'tool', id: 'q', kind: 'ask', txt: 'Welke lijst?' });
  assert.deepEqual([s().kind, s().txt], ['ask', 'Welke lijst?']);
  store.apply('s', { t: 9000, type: 'result', id: 'q' });
  assert.equal(s().kind, 'think');
});

test('store: fout is kort zichtbaar, daarna weer verder', () => {
  const { store, s, at } = setup();
  store.apply('s', { t: 2000, type: 'tool', id: 'a', kind: 'bash', txt: 'npm test' });
  store.apply('s', { t: 2100, type: 'result', id: 'a', error: true });
  assert.equal(s().kind, 'error');
  at(20_000); store.tick(20_000);
  assert.equal(s().kind, 'think');
});

test('store: zonder hooks wordt een lang stille tool "lijkt te wachten"', () => {
  const { store, s, at } = setup();
  store.apply('s', { t: 2000, type: 'tool', id: 'a', kind: 'bash', txt: 'rm -rf build', source: 'cursor' });
  at(10_000); store.tick(10_000);
  assert.equal(s().kind, 'bash');
  at(30_000); store.tick(30_000);
  assert.equal(s().kind, 'ask');
  assert.equal(s().guess, true);
  store.apply('s', { t: 31_000, type: 'think', source: 'cursor' });
  assert.equal(s().kind, 'think');
});

test('store: met hooks wordt er niet geraden', () => {
  const { store, s, at } = setup();
  store.apply('s', { type: 'hook' });
  store.apply('s', { t: 2000, type: 'tool', id: 'a', kind: 'bash', txt: 'npm test' });
  at(60_000); store.tick(60_000);
  assert.equal(s().kind, 'bash');
});

test('store: gesloten sessie verdwijnt na 30 s', () => {
  const { store, at } = setup();
  store.setAlive('s', false, 2000);
  assert.equal(store.snapshot(2000)[0].kind, 'gone');
  at(40_000); store.tick(40_000);
  assert.equal(store.snapshot(40_000).length, 0);
});

test('hooks: Claude-payloads', () => {
  assert.equal(claudeHookEvents({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/a/b.js' }, tool_use_id: 't' }, 1)[0].kind, 'edit');
  assert.equal(claudeHookEvents({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }, 1)[0].type, 'permission');
  assert.equal(claudeHookEvents({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }, 1)[0].type, 'idle');
  assert.equal(claudeHookEvents({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push' } }, 1)[0].txt, 'toestemming: git push');
  assert.equal(claudeHookEvents({ hook_event_name: 'Stop' }, 1)[0].type, 'turnEnd');
  assert.equal(claudeHookEvents({ hook_event_name: 'SessionEnd' }, 1)[0].type, 'gone');
  assert.deepEqual(claudeHookEvents({ hook_event_name: 'Onbekend' }), []);
  assert.equal(cursorHookEvents({ hook_event_name: 'stop', status: 'completed' }, 1)[0].type, 'turnEnd');
});

test('store: subagents uit tool en hook worden niet dubbel geteld', () => {
  const { store, s } = setup();
  store.apply('s', { t: 2000, type: 'tool', id: 'c', kind: 'agent', txt: 'review' });
  store.apply('s', { t: 2001, type: 'subStart', id: 'x1' });
  store.apply('s', { t: 2002, type: 'subStart', id: 'x2' });
  assert.equal(s().subs, 2);
  store.apply('s', { t: 3000, type: 'subStop', id: 'x1' });
  store.apply('s', { t: 3001, type: 'subStop', id: 'x2' });
  assert.equal(s().subs, 1); // de Agent-tool loopt nog
  store.apply('s', { t: 3002, type: 'result', id: 'c' });
  assert.equal(s().subs, 0);
});

test('hooks: Cursor via de Claude-hookroute wordt een Cursor-sessie, ook met een oud transcript', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  const dir = path.join(home, '.cursor', 'projects', 'home-x-git-shop', 'agent-transcripts', 'abc123');
  fs.mkdirSync(dir, { recursive: true });
  const transcript = path.join(dir, 'abc123.jsonl');
  fs.writeFileSync(transcript, J({ type: 'turn_ended', status: 'success' }) + '\n');
  fs.utimesSync(transcript, new Date(Date.now() - 3 * 3600_000), new Date(Date.now() - 3 * 3600_000));
  const store = createStore();
  const cursor = createCursorSource(store, { home });
  const claude = { track() { throw new Error('geen Claude-sessie verwacht'); } };
  const hook = createHookSink(store, claude, cursor);
  const base = { conversation_id: 'abc123', session_id: 'abc123', cursor_version: '3.32.4', workspace_roots: ['/home/x/git/shop'], transcript_path: transcript };
  hook('claude', { ...base, hook_event_name: 'preToolUse', tool_name: 'Shell', tool_input: { command: 'php tests/run.php' }, tool_use_id: 'u1' });
  const s = store.get('cursor:abc123');
  assert.ok(s, 'sessie bestaat');
  assert.equal(store.get('abc123'), undefined);
  assert.equal(s.client, 'cursor');
  assert.equal(s.project, 'shop');
  assert.equal(s.kind, 'bash');
  cursor.pumpAll();
  assert.ok(store.get('cursor:abc123')?.alive, 'blijft zichtbaar ondanks oud transcript');
  hook('claude', { ...base, hook_event_name: 'postToolUse', tool_use_id: 'u1' });
  assert.equal(s.kind, 'think');
  hook('cursor', { ...base, hook_event_name: 'stop', status: 'completed' });
  assert.equal(s.kind, 'idle');
  fs.rmSync(home, { recursive: true, force: true });
});
