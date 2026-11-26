# Agent Office

Live mission control for every agent on your machine. Each session is an operator at a console. You can see what they're doing (thinking, reading, writing, terminal, web, subagent), who is waiting for you (orange beacon) and who is done (drinking coffee at their console). It's view-only: you can't steer agents from here.

```sh
npm start               # http://localhost:4517
npm test
npm run hooks:install   # exact 'waiting for you' via hooks (Claude Code + Cursor)
npm run hooks:remove
```

No dependencies, Node 22+. Everything is drawn in code.

## Where the data comes from

| Client | Source |
|---|---|
| Claude Code (terminal, Claude app over SSH, headless `-p`) | `~/.claude/sessions/<pid>.json` (which sessions are alive, terminal or app), `~/.claude/projects/<slug>/<id>.jsonl` (what they're doing) |
| Cursor IDE and Cursor CLI (`agent`, also when another program starts it) | `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`; CLI chats are recognised by `~/.cursor/chats/*/<id>` |
| Hooks (optional) | `bin/hook.sh` sends hook payloads to `POST /hook/claude` and `/hook/cursor` |

Without hooks the office guesses "waiting for you" when a terminal, write or web tool stays quiet for more than 25 s ("seems to be waiting"). With the Claude Code hooks (`PermissionRequest`, `Notification`) it's exact. Cursor has no hook for permission prompts, so there it stays a guess.

Cursor also runs the Claude Code hooks (`preToolUse`, `postToolUse`, … with `cursor_version` in the payload). The server recognises those and attaches them to the Cursor session. This matters because Cursor sometimes writes its transcript only after a turn.

The Claude Code hooks run with `async: true`, and the relay gives up after 0.2 s if the server isn't running, so agents don't notice anything. The Cursor hooks only use `after*` events and `stop`, which never make a decision.

## Layout

- `server/classify.js`: tool name → kind of activity, short description, project name
- `server/parse.js`: transcript lines (Claude, Cursor) → events
- `server/store.js`: session model and state machine (ask > error > active > idle; gone sessions stay visible for 30 s)
- `server/sources/`: registry, transcript tailing, hook payloads
- `server/index.js`: static `web/`, `GET /events` (SSE), `GET /api/sessions`, `POST /hook/:src`
- `web/office.js`: the control room (canvas); grows with the number of sessions
