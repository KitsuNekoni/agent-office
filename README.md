# Agent Office

Live mission control for every agent on your machine. Each session is an operator at a console. You can see what they're doing (thinking, reading, writing, terminal, web, subagent), who is waiting for you (orange beacon) and who is done (drinking coffee at their console). It's view-only: you can't steer agents from here.

Works with Claude Code (terminal, IDE extensions, the Claude app over SSH, headless `claude -p`) and Cursor (IDE and the `agent` CLI).

## Install

You need [Node.js](https://nodejs.org) 22 or newer. There are no other dependencies.

```sh
git clone <this repo> agent-office
cd agent-office
npm start                 # open http://localhost:4517
```

Or install the `agent-office` command globally from the clone:

```sh
npm install -g .
agent-office              # same as npm start
agent-office --help
```

### Optional: hooks for an exact "waiting for you"

Without hooks the office guesses that a session is waiting when a terminal, write or web tool stays quiet for more than 25 s. With hooks, Claude Code reports permission prompts and questions directly:

```sh
agent-office hooks install     # or: npm run hooks:install
agent-office hooks remove      # or: npm run hooks:remove
```

This adds entries to `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) and `~/.cursor/hooks.json`. Your own hooks are left alone, and a backup of each file is written next to it (`*.agent-office.bak`). Sessions that are already running pick up the hooks after a restart. Use `--dry-run` to see the result without writing anything.

The hook command contains the absolute paths of this folder and of the Node that ran the installer. Run `hooks install` again after you move the folder, switch Node version (nvm, fnm, …) or change the port.

### Options

| Setting | How |
|---|---|
| Port | `--port 5000` or `AGENT_OFFICE_PORT=5000`. If you change it, install the hooks with the same `--port`. |
| Claude Code config folder | `CLAUDE_CONFIG_DIR`, the same variable Claude Code itself uses. Default `~/.claude`. |

### Start it automatically

Agent Office is a plain foreground process. Start it the way you start other small local tools, for example from your shell profile:

```sh
# ~/.bashrc or ~/.zshrc: start once in the background, quietly
(agent-office >/dev/null 2>&1 &)
```

A second copy notices the port is taken and exits.

## Platforms

| Platform | Status |
|---|---|
| Linux, WSL | Used daily |
| macOS | Should work: same file layout as Linux, home folders under `/Users` are recognised |
| Windows (native) | Untested. Paths and home folders are handled, the hook relay is plain Node, but hook commands depend on the shell Claude Code and Cursor use there |

If Claude Code runs inside WSL and Cursor on Windows, run Agent Office where the agents' files are (`~/.claude`, `~/.cursor`) and open the URL from your Windows browser; WSL forwards localhost.

## Privacy

The server listens on `127.0.0.1` only and never sends anything anywhere. It reads transcripts and session files from `~/.claude` and `~/.cursor`, and shows prompts, tool names and file names to whoever can open the page on your machine. It never writes to those folders, except `hooks install`/`hooks remove`, which only edit the two settings files above.

## Development

```sh
npm test
```

### Where the data comes from

| Client | Source |
|---|---|
| Claude Code (terminal, Claude app over SSH, headless `-p`) | `~/.claude/sessions/<pid>.json` (which sessions are alive, terminal or app), `~/.claude/projects/<slug>/<id>.jsonl` (what they're doing) |
| Cursor IDE and Cursor CLI (`agent`, also when another program starts it) | `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`; CLI chats are recognised by `~/.cursor/chats/*/<id>` |
| Hooks (optional) | `bin/hook.js` sends hook payloads to `POST /hook/claude` and `/hook/cursor` |

Without hooks the office guesses "waiting for you" when a terminal, write or web tool stays quiet for more than 25 s ("seems to be waiting"). With the Claude Code hooks (`PermissionRequest`, `Notification`) it's exact. Cursor has no hook for permission prompts, so there it stays a guess.

Cursor also runs the Claude Code hooks (`preToolUse`, `postToolUse`, … with `cursor_version` in the payload). The server recognises those and attaches them to the Cursor session. This matters because Cursor sometimes writes its transcript only after a turn.

The Claude Code hooks run with `async: true`, and the relay (`bin/hook.js`) gives up after 0.2 s if the server isn't running, so agents don't notice anything. The Cursor hooks only use `after*` events and `stop`, which never make a decision.

### Layout

- `server/classify.js`: tool name → kind of activity, short description, project name
- `server/parse.js`: transcript lines (Claude, Cursor) → events
- `server/store.js`: session model and state machine (ask > error > active > idle; gone sessions stay visible for 30 s)
- `server/sources/`: registry, transcript tailing, hook payloads
- `server/index.js`: static `web/`, `GET /events` (SSE), `GET /api/sessions`, `POST /hook/:src`
- `web/office.js`: the control room (canvas); grows with the number of sessions
