import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOfTool, describeTool, projectName } from '../server/classify.js';
import { parseClaudeLine, parseCursorLine } from '../server/parse.js';
import { createStore } from '../server/store.js';
import { claudeHookEvents, cursorHookEvents, createHookSink } from '../server/sources/hooks.js';
import { createCursorSource } from '../server/sources/cursor.js';
import { isCursorEditor } from '../server/sources/cursor-app.js';
import { compareVersions, createUpdater } from '../server/update.js';
import { startServer } from '../server/index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const J = (o) => JSON.stringify(o);

test('classify: tools from Claude Code and Cursor', () => {
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

test('classify: descriptions and project names', () => {
  assert.equal(describeTool('Read', { file_path: '/a/b/office.js' }), 'office.js');
  assert.equal(describeTool('Bash', { command: 'npm test', description: 'Run tests' }), 'Run tests');
  assert.equal(describeTool('Shell', { command: 'php tests/run.php' }), 'php tests/run.php');
  assert.equal(describeTool('AskUserQuestion', { questions: [{ question: 'Which list?' }] }), 'Which list?');
  assert.equal(projectName('/home/alice/projects/webshop'), 'webshop');
  assert.equal(projectName('/home/alice/git/api-worktrees/12'), 'api #12');
  assert.equal(projectName('/home/alice'), '~');
  assert.equal(projectName('home-alice-git-shop42'), 'shop42');
  assert.equal(projectName('home-alice-git-api-worktrees-12'), 'api #12');
  // macOS and Windows, paths and slugs
  assert.equal(describeTool('Read', { file_path: 'C:\\code\\shop\\cart.ts' }), 'cart.ts');
  assert.equal(projectName('/Users/bob/code/shop'), 'shop');
  assert.equal(projectName('/Users/bob'), '~');
  assert.equal(projectName('C:\\Users\\bob\\repos\\api'), 'api');
  assert.equal(projectName('C:\\Users\\bob'), '~');
  assert.equal(projectName('Users-bob-code-shop'), 'shop');
  assert.equal(projectName('c-Users-bob-repos-api'), 'api');
  // Claude slug (leading dash), and a home folder whose name contains a dash
  assert.equal(projectName('-home-alice-projects-agent-office'), 'agent-office');
  assert.equal(projectName('home-mary-jane-git-shop', '/home/mary-jane'), 'shop');
  assert.equal(projectName('/home/mary-jane', '/home/mary-jane'), '~');
});

test('parseClaudeLine: tool_use, result, turn end, title, prompt', () => {
  const ts = '2026-11-26T08:32:04.717Z';
  const tool = parseClaudeLine(J({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } }));
  assert.deepEqual(tool.map((e) => e.type), ['think', 'tool']);
  assert.equal(tool[1].kind, 'bash');
  assert.equal(tool[1].t, Date.parse(ts));
  const res = parseClaudeLine(J({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true }] } }));
  assert.deepEqual(res, [{ t: Date.parse(ts), type: 'result', id: 'tu1', error: true }]);
  assert.equal(parseClaudeLine(J({ type: 'system', subtype: 'turn_duration', timestamp: ts }))[0].type, 'turnEnd');
  assert.equal(parseClaudeLine(J({ type: 'ai-title', aiTitle: 'Virtual office' }))[0].txt, 'Virtual office');
  assert.equal(parseClaudeLine(J({ type: 'user', timestamp: ts, message: { content: 'Build the office' } }))[0].type, 'prompt');
  assert.deepEqual(parseClaudeLine(J({ type: 'user', isMeta: true, message: { content: 'x' } })), []);
  assert.deepEqual(parseClaudeLine(J({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', id: 'x', name: 'Read' }] } })), []);
  assert.deepEqual(parseClaudeLine('not-json'), []);
});

test('parseCursorLine: prompt, tools, turn_ended', () => {
  const p = parseCursorLine(J({ role: 'user', message: { content: [{ type: 'text', text: '<timestamp>x</timestamp>\n<user_query>\nAnalyse the PDF\n</user_query>' }] } }), 5);
  assert.deepEqual(p, [{ t: 5, type: 'prompt', txt: 'Analyse the PDF' }]);
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

test('store: tool → result → done', () => {
  const { store, s } = setup();
  store.apply('s', { t: 1100, type: 'prompt', txt: 'do something' });
  assert.equal(s().kind, 'think');
  assert.equal(s().name, 'do something');
  store.apply('s', { t: 1200, type: 'tool', id: 'a', kind: 'read', txt: 'x.js' });
  assert.deepEqual([s().kind, s().txt], ['read', 'x.js']);
  store.apply('s', { t: 1300, type: 'result', id: 'a' });
  assert.equal(s().kind, 'think');
  store.apply('s', { t: 1400, type: 'turnEnd', ok: true });
  assert.equal(s().kind, 'idle');
  assert.deepEqual(s().recent.map((r) => r.kind), ['think', 'read', 'think']);
});

test('store: permission via hook stays until something happens after the question', () => {
  const { store, s } = setup();
  store.apply('s', { t: 2000, type: 'tool', id: 'b', kind: 'bash', txt: 'git push' }); // PreToolUse
  store.apply('s', { t: 2010, type: 'permission', txt: 'wants permission' });
  assert.equal(s().kind, 'ask');
  // transcript line for the same tool with an older time arrives later: stays ask
  store.apply('s', { t: 1990, type: 'think' });
  store.apply('s', { t: 1990, type: 'tool', id: 'b', kind: 'bash', txt: 'git push' });
  assert.equal(s().kind, 'ask');
  store.apply('s', { t: 5000, type: 'result', id: 'b' }); // approved and run
  assert.equal(s().kind, 'think');
});

test('store: AskUserQuestion waits until the answer is in', () => {
  const { store, s } = setup();
  store.apply('s', { t: 2000, type: 'tool', id: 'q', kind: 'ask', txt: 'Which list?' });
  assert.deepEqual([s().kind, s().txt], ['ask', 'Which list?']);
  store.apply('s', { t: 9000, type: 'result', id: 'q' });
  assert.equal(s().kind, 'think');
});

test('store: an error shows briefly, then carries on', () => {
  const { store, s, at } = setup();
  store.apply('s', { t: 2000, type: 'tool', id: 'a', kind: 'bash', txt: 'npm test' });
  store.apply('s', { t: 2100, type: 'result', id: 'a', error: true });
  assert.equal(s().kind, 'error');
  at(20_000); store.tick(20_000);
  assert.equal(s().kind, 'think');
});

test('store: without hooks a long-quiet tool "seems to be waiting"', () => {
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

test('store: with hooks there is no guessing', () => {
  const { store, s, at } = setup();
  store.apply('s', { type: 'hook' });
  store.apply('s', { t: 2000, type: 'tool', id: 'a', kind: 'bash', txt: 'npm test' });
  at(60_000); store.tick(60_000);
  assert.equal(s().kind, 'bash');
});

test('store: a closed session disappears after 30 s', () => {
  const { store, at } = setup();
  store.setAlive('s', false, 2000);
  assert.equal(store.snapshot(2000)[0].kind, 'gone');
  at(40_000); store.tick(40_000);
  assert.equal(store.snapshot(40_000).length, 0);
});

test('hooks: Claude payloads', () => {
  assert.equal(claudeHookEvents({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/a/b.js' }, tool_use_id: 't' }, 1)[0].kind, 'edit');
  assert.equal(claudeHookEvents({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }, 1)[0].type, 'permission');
  assert.equal(claudeHookEvents({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }, 1)[0].type, 'idle');
  assert.equal(claudeHookEvents({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push' } }, 1)[0].txt, 'permission: git push');
  assert.equal(claudeHookEvents({ hook_event_name: 'Stop' }, 1)[0].type, 'turnEnd');
  assert.equal(claudeHookEvents({ hook_event_name: 'SessionEnd' }, 1)[0].type, 'gone');
  assert.deepEqual(claudeHookEvents({ hook_event_name: 'Unknown' }), []);
  assert.equal(cursorHookEvents({ hook_event_name: 'stop', status: 'completed' }, 1)[0].type, 'turnEnd');
});

test('store: subagents from tool and hook are not counted twice', () => {
  const { store, s } = setup();
  store.apply('s', { t: 2000, type: 'tool', id: 'c', kind: 'agent', txt: 'review' });
  store.apply('s', { t: 2001, type: 'subStart', id: 'x1' });
  store.apply('s', { t: 2002, type: 'subStart', id: 'x2' });
  assert.equal(s().subs, 2);
  store.apply('s', { t: 3000, type: 'subStop', id: 'x1' });
  store.apply('s', { t: 3001, type: 'subStop', id: 'x2' });
  assert.equal(s().subs, 1); // the Agent tool is still running
  store.apply('s', { t: 3002, type: 'result', id: 'c' });
  assert.equal(s().subs, 0);
});

test('hooks: Cursor via the Claude hook route becomes a Cursor session, even with an old transcript', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  const dir = path.join(home, '.cursor', 'projects', 'home-x-git-shop', 'agent-transcripts', 'abc123');
  fs.mkdirSync(dir, { recursive: true });
  const transcript = path.join(dir, 'abc123.jsonl');
  fs.writeFileSync(transcript, J({ type: 'turn_ended', status: 'success' }) + '\n');
  fs.utimesSync(transcript, new Date(Date.now() - 3 * 3600_000), new Date(Date.now() - 3 * 3600_000));
  const store = createStore();
  const cursor = createCursorSource(store, { home });
  const claude = { track() { throw new Error('no Claude session expected'); } };
  const hook = createHookSink(store, claude, cursor);
  const base = { conversation_id: 'abc123', session_id: 'abc123', cursor_version: '3.32.4', workspace_roots: ['/home/x/git/shop'], transcript_path: transcript };
  hook('claude', { ...base, hook_event_name: 'preToolUse', tool_name: 'Shell', tool_input: { command: 'php tests/run.php' }, tool_use_id: 'u1' });
  const s = store.get('cursor:abc123');
  assert.ok(s, 'session exists');
  assert.equal(store.get('abc123'), undefined);
  assert.equal(s.client, 'cursor');
  assert.equal(s.project, 'shop');
  assert.equal(s.kind, 'bash');
  cursor.pumpAll();
  assert.ok(store.get('cursor:abc123')?.alive, 'stays visible despite an old transcript');
  hook('claude', { ...base, hook_event_name: 'postToolUse', tool_use_id: 'u1' });
  assert.equal(s.kind, 'think');
  hook('cursor', { ...base, hook_event_name: 'stop', status: 'completed' });
  assert.equal(s.kind, 'idle');
  fs.rmSync(home, { recursive: true, force: true });
});

test('hooks: a non-activity hook does not bring a finished or unknown Cursor chat back', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  const dir = path.join(home, '.cursor', 'projects', 'home-x-git-shop', 'agent-transcripts', 'old1');
  fs.mkdirSync(dir, { recursive: true });
  const transcript = path.join(dir, 'old1.jsonl');
  fs.writeFileSync(transcript, J({ type: 'turn_ended', status: 'success' }) + '\n');
  const store = createStore();
  const cursor = createCursorSource(store, { home });
  const logs = [];
  const hook = createHookSink(store, { track() {} }, cursor, { log: (m) => logs.push(m) });
  const base = { cursor_version: '3.32.4', workspace_roots: ['/home/x/git/shop'] };
  // Finished chat with a transcript, and an internal chat without one: results and session starts are ignored.
  hook('claude', { ...base, conversation_id: 'old1', transcript_path: transcript, hook_event_name: 'postToolUse', tool_use_id: 'u1' });
  hook('claude', { ...base, conversation_id: 'ghost', hook_event_name: 'sessionStart' });
  hook('cursor', { ...base, conversation_id: 'ghost', hook_event_name: 'stop', status: 'completed' });
  assert.equal(store.get('cursor:old1'), undefined);
  assert.equal(store.get('cursor:ghost'), undefined);
  assert.ok(logs.every((l) => l.endsWith('ignored')), logs.join('\n'));
  // Real activity does show it, and a finished chat ignores a stray result.
  hook('cursor', { ...base, conversation_id: 'old1', transcript_path: transcript, hook_event_name: 'afterShellExecution' });
  assert.equal(store.get('cursor:old1').kind, 'think');
  hook('cursor', { ...base, conversation_id: 'old1', hook_event_name: 'stop', status: 'completed' });
  hook('claude', { ...base, conversation_id: 'old1', hook_event_name: 'postToolUse', tool_use_id: 'u2' });
  assert.equal(store.get('cursor:old1').kind, 'idle');
  fs.rmSync(home, { recursive: true, force: true });
});

test('cursor: a chat seen only through hooks leaves after 2 quiet minutes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  const store = createStore();
  const cursor = createCursorSource(store, { home });
  const hook = createHookSink(store, { track() {} }, cursor);
  hook('cursor', { cursor_version: '3.32.4', conversation_id: 'h1', workspace_roots: ['/home/x/git/shop'], hook_event_name: 'afterMCPExecution' });
  const t0 = Date.now();
  cursor.pumpAll(t0 + 60_000);
  assert.ok(store.get('cursor:h1').alive, 'still there after 1 minute');
  cursor.pumpAll(t0 + 3 * 60_000);
  assert.equal(store.get('cursor:h1').alive, false, 'gone after 3 quiet minutes');
  fs.rmSync(home, { recursive: true, force: true });
});

test('cursor: closing the editor sends its chats home, not the CLI ones', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  fs.mkdirSync(path.join(home, '.cursor', 'chats', 'h', 'cli1'), { recursive: true });
  const store = createStore();
  const cursor = createCursorSource(store, { home });
  const hook = createHookSink(store, { track() {} }, cursor);
  const base = { cursor_version: '3.32.4', workspace_roots: ['/home/x/git/shop'] };
  for (const id of ['ide1', 'cli1']) {
    hook('cursor', { ...base, conversation_id: id, hook_event_name: 'afterMCPExecution' });
    hook('cursor', { ...base, conversation_id: id, hook_event_name: 'stop', status: 'completed' });
  }
  const t = Date.now();
  cursor.editorState(false); cursor.pumpAll(t);
  assert.ok(store.get('cursor:ide1').alive, 'one closed check is not enough');
  cursor.editorState(null); cursor.editorState(false); cursor.pumpAll(t);
  assert.equal(store.get('cursor:ide1').alive, false, 'editor chat leaves');
  assert.ok(store.get('cursor:cli1').alive, 'CLI chat stays');
  fs.rmSync(home, { recursive: true, force: true });
});

test('cursor: recognises an editor window by its process', () => {
  assert.ok(isCursorEditor('/opt/Cursor/cursor\0--no-sandbox'));
  assert.ok(isCursorEditor('/home/a/.cursor-server/bin/x/node\0/home/a/.cursor-server/bin/x/out/bootstrap-fork\0--type=extensionHost'));
  assert.ok(!isCursorEditor('/home/a/.cursor-server/bin/x/node /home/a/.cursor-server/bin/x/out/server-main.js --start-server'));
  assert.ok(!isCursorEditor('/home/a/.cursor-server/bin/x/node bootstrap-fork --type=ptyHost'));
  assert.ok(!isCursorEditor('/home/a/.local/bin/cursor-agent'));
});

test('install-hooks: a path with a space is quoted, old entries from a moved repo disappear', async () => {
  const { execFileSync } = await import('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-inst-'));
  const home = path.join(tmp, 'home');
  const bin = path.join(tmp, 'My Projects', 'agent-office', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  for (const f of ['install-hooks.js', 'hook.js']) fs.copyFileSync(new URL(`../bin/${f}`, import.meta.url), path.join(bin, f));
  const old = '/old/path/agent-office/bin/hook.sh'; // the old shell relay from a moved repo
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), J({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `${old} claude` }, { type: 'command', command: 'echo mine' }] }] } }));
  fs.writeFileSync(path.join(home, '.cursor', 'hooks.json'), J({ version: 1, hooks: { stop: [{ command: `${old} cursor` }] } }));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CONFIG_DIR; delete env.AGENT_OFFICE_PORT;
  const run = (...a) => execFileSync(process.execPath, [path.join(bin, 'install-hooks.js'), ...a], { env });
  const read = () => [JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'))];

  run();
  let [cl, cu] = read();
  const cmds = cl.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(!cmds.some((c) => c.startsWith(old)), 'old Claude entry gone');
  assert.ok(cmds.includes('echo mine'), 'foreign hook stays');
  const mine = cmds.find((c) => c.includes('My Projects'));
  assert.equal(mine, `${process.execPath} '${path.join(bin, 'hook.js')}' claude`);
  assert.deepEqual(cu.hooks.stop.map((h) => h.command), [`${process.execPath} '${path.join(bin, 'hook.js')}' cursor`]);
  // the quoted command really runs through the shell (server is off: fails silently, Cursor gets {})
  assert.equal(execFileSync('sh', ['-c', cu.hooks.stop[0].command], { input: '{}', env: { ...process.env, AGENT_OFFICE_PORT: '1' } }).toString(), '{}\n');

  run(); // install again: no duplicate entries
  [cl] = read();
  assert.equal(cl.hooks.Stop.flatMap((g) => g.hooks).filter((h) => h.command.includes('hook.js')).length, 1);

  run('--port', '5000'); // another port: baked into the command, replaces the old entry
  [cl, cu] = read();
  assert.deepEqual(cl.hooks.Stop.flatMap((g) => g.hooks).filter((h) => h.command.includes('hook.js')).map((h) => h.command), [`${process.execPath} '${path.join(bin, 'hook.js')}' claude 5000`]);

  run('--remove');
  [cl] = read();
  assert.deepEqual(cl.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command)), ['echo mine']);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('hook.js relays the payload to the server and answers Cursor with {}', async () => {
  const http = await import('node:http');
  const { execFile } = await import('node:child_process');
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push([req.url, b]); res.writeHead(204).end(); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = String(srv.address().port);
  const relay = (src) => new Promise((resolve, reject) => {
    const c = execFile(process.execPath, [new URL('../bin/hook.js', import.meta.url).pathname, src, port], (e, out) => (e ? reject(e) : resolve(out)));
    c.stdin.end(J({ hook_event_name: 'Stop', session_id: 's1' }));
  });
  assert.equal(await relay('claude'), '');
  assert.equal(await relay('cursor'), '{}\n');
  srv.close();
  assert.deepEqual(got.map((g) => g[0]), ['/hook/claude', '/hook/cursor']);
  assert.equal(JSON.parse(got[0][1]).session_id, 's1');
});

test('update: version comparison', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('v1.2', '1.2.0'), 0);
  assert.equal(compareVersions('0.2.9', '0.3.0'), -1);
  assert.equal(compareVersions(null, '0.0.1'), -1);
});

/** A fake git: answers by subcommand; a function answer can throw. */
function fakeRun(answers, calls = []) {
  return async (cmd, args) => {
    const key = cmd === 'git' ? args[2] : 'node';
    calls.push(key);
    const a = answers[key];
    if (a instanceof Error) throw a;
    return typeof a === 'function' ? a(args) : a ?? '';
  };
}

test('update: no git checkout means version only, never a button', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-up-'));
  fs.writeFileSync(path.join(root, 'package.json'), J({ version: '0.3.0' }));
  const u = createUpdater({ root, run: fakeRun({ 'rev-parse': new Error('not a git repository') }) });
  const st = await u.check();
  assert.equal(st.version, '0.3.0');
  assert.equal(st.available, false);
  assert.equal((await u.apply()).ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('update: higher upstream version → available; local changes or a failing pull block it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-up-'));
  fs.writeFileSync(path.join(root, 'package.json'), J({ version: '0.3.0' }));
  const answers = { 'rev-parse': 'origin/main', show: J({ version: '0.4.0' }), status: ' M server/index.js\n' };
  const calls = [];
  const u = createUpdater({ root, run: fakeRun(answers, calls) });
  let st = await u.check();
  assert.equal(st.remote, '0.4.0');
  assert.equal(st.available, true);
  assert.equal((await u.apply()).ok, false);
  assert.equal(u.status().error, 'local changes, update by hand');
  assert.ok(!calls.includes('pull'), 'no pull with local changes');
  answers.status = ''; answers.pull = Object.assign(new Error('x'), { stderr: 'fatal: Not possible to fast-forward, aborting.' });
  assert.equal((await u.apply()).ok, false);
  assert.match(u.status().error, /fast-forward/);
  // A good pull: hooks refreshed, then 'updated' with the new version from disk.
  answers.pull = () => { fs.writeFileSync(path.join(root, 'package.json'), J({ version: '0.4.0' })); return ''; };
  assert.equal((await u.apply()).ok, true);
  st = u.status();
  assert.equal(st.state, 'updated');
  assert.equal(st.version, '0.4.0');
  assert.equal(st.available, false);
  assert.equal(calls.at(-1), 'node', 'the hook installer ran after the pull');
  fs.rmSync(root, { recursive: true, force: true });
});

test('update: page checks share a running check and reuse a recent one', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.3.1' }));
  let fetches = 0;
  const run = async (cmd, args) => {
    if (args.includes('fetch')) { fetches++; await new Promise((r) => setTimeout(r, 20)); }
    if (args.includes('show')) return JSON.stringify({ version: '0.3.2' });
    return 'origin/main';
  };
  const u = createUpdater({ root, run });
  const [a, b] = await Promise.all([u.check({ recent: 30_000 }), u.check({ recent: 30_000 })]);
  assert.equal(fetches, 1, 'two page loads at once: one git fetch');
  assert.ok(a.available && b.available);
  await u.check({ recent: 30_000 });
  assert.equal(fetches, 1, 'a check from seconds ago is reused');
  await u.check();
  assert.equal(fetches, 2, 'the timer always checks');
  fs.rmSync(root, { recursive: true, force: true });
});

test('server: the update endpoints need the page header', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  let applied = 0;
  const updater = { status: () => ({ version: '0.3.0', available: false }), check: async () => ({}), apply: async () => { applied++; return { ok: false }; }, start() {}, stop() {} };
  const { server, close } = startServer({ port: 0, home, log: () => {}, updater });
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/api/update`, { method: 'POST' })).status, 403);
  assert.equal(applied, 0);
  const r = await fetch(`${url}/api/update`, { method: 'POST', headers: { 'x-agent-office': '1' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).version, '0.3.0');
  assert.equal(applied, 1);
  assert.equal(JSON.parse(await (await fetch(`${url}/api/sessions`)).text()).update.version, '0.3.0');
  close(); server.closeAllConnections();
  fs.rmSync(home, { recursive: true, force: true });
});

test('install-hooks --if-installed: skips without our hooks, refreshes old ones', async () => {
  const { execFileSync } = await import('node:child_process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-inst-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CONFIG_DIR; delete env.AGENT_OFFICE_PORT;
  const installer = new URL('../bin/install-hooks.js', import.meta.url).pathname;
  const run = (...a) => execFileSync(process.execPath, [installer, ...a], { env }).toString();
  const claudeFile = path.join(home, '.claude', 'settings.json'), cursorFile = path.join(home, '.cursor', 'hooks.json');
  fs.writeFileSync(claudeFile, J({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
  assert.match(run('--if-installed', '--port', '5000'), /not installed, skipped/);
  assert.equal(fs.readFileSync(claudeFile, 'utf8'), J({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
  assert.ok(!fs.existsSync(cursorFile), 'Cursor file not created');
  // Only the old shell relay in Cursor: both files get the current relay, on the given port.
  fs.writeFileSync(cursorFile, J({ version: 1, hooks: { stop: [{ command: '/old/agent-office/bin/hook.sh cursor' }] } }));
  run('--if-installed', '--port', '5000');
  const cu = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
  assert.deepEqual(cu.hooks.stop.map((h) => h.command), [`${process.execPath} ${path.join(path.dirname(installer), 'hook.js')} cursor 5000`]);
  const cl = JSON.parse(fs.readFileSync(claudeFile, 'utf8'));
  assert.ok(cl.hooks.Stop.flatMap((g) => g.hooks).some((h) => h.command.endsWith('hook.js claude 5000')));
  fs.rmSync(home, { recursive: true, force: true });
});

test('update: end to end with real git, a newer upstream is pulled and the hooks refreshed', async () => {
  const { execFileSync, execFile } = await import('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-git-'));
  const origin = path.join(tmp, 'origin.git'), work = path.join(tmp, 'work'), clone = path.join(tmp, 'clone'), home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  // One clean environment for every git and node call: no global git config (autocrlf etc.) from the real home.
  const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  delete env.CLAUDE_CONFIG_DIR; delete env.AGENT_OFFICE_PORT;
  const sh = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { env, stdio: 'pipe' }).toString();
  const git = (cwd, ...a) => sh('-C', cwd, ...a);
  sh('init', '-q', '--bare', '-b', 'main', origin);
  sh('clone', '-q', origin, work);
  fs.mkdirSync(path.join(work, 'bin'));
  for (const f of ['install-hooks.js', 'hook.js']) fs.copyFileSync(new URL(`../bin/${f}`, import.meta.url), path.join(work, 'bin', f));
  fs.writeFileSync(path.join(work, 'package.json'), J({ version: '0.3.0' }));
  git(work, 'add', '.'); git(work, 'commit', '-qm', 'v0.3.0'); git(work, 'push', '-q', 'origin', 'HEAD:main');
  sh('clone', '-q', origin, clone);
  fs.writeFileSync(path.join(work, 'package.json'), J({ version: '0.4.0' }));
  git(work, 'commit', '-qam', 'v0.4.0'); git(work, 'push', '-q', 'origin', 'HEAD:main');
  fs.writeFileSync(path.join(home, '.cursor', 'hooks.json'), J({ version: 1, hooks: { stop: [{ command: '/old/agent-office/bin/hook.sh cursor' }] } }));
  const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { env }, (e, out) => (e ? rej(e) : res(String(out)))));
  const u = createUpdater({ root: clone, port: 4600, run });
  assert.equal((await u.check()).available, true);
  assert.equal((await u.apply()).ok, true, u.status().error);
  assert.equal(JSON.parse(fs.readFileSync(path.join(clone, 'package.json'), 'utf8')).version, '0.4.0');
  assert.equal(u.status().version, '0.4.0');
  const cu = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'));
  assert.deepEqual(cu.hooks.stop.map((h) => h.command), [`${process.execPath} ${path.join(clone, 'bin', 'hook.js')} cursor 4600`]);
  fs.rmSync(tmp, { recursive: true, force: true });
});
