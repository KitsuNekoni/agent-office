# Agent Office

Live mission control for every agent on your machine. Each session is an operator at a console. You can see what they're doing (thinking, reading, writing, terminal, web, subagent), who is waiting for you (orange beacon) and who is done (drinking coffee at their console). It's view-only: you can't steer agents from here.

Works with Claude Code (terminal, IDE extensions, the Claude app over SSH, headless `claude -p`) and Cursor (IDE and the `agent` CLI).

## Install with an AI assistant

Give your coding assistant (Claude Code, Cursor, …) the link to this repository and ask it to install Agent Office. The steps below are written for that assistant.

### Steps for the AI assistant

Follow these in order. Run commands yourself where you can. **Ask the user first** before installing Node, editing their agent settings (hooks) or editing their shell profile (autostart).

1. **Pick the environment.** Install Agent Office in the same environment the user's agents run in, because it reads `~/.claude` and `~/.cursor` from the home folder of that environment.
   - Claude Code in WSL (also when the Claude desktop app connects to WSL over SSH): install **inside WSL**.
   - Claude Code or Cursor on macOS, Linux or Windows itself: install there.
   - Check with `ls -d ~/.claude ~/.cursor` (PowerShell: `Test-Path $HOME\.claude, $HOME\.cursor`). If agents run both in WSL and on Windows, ask which side matters most: one office only sees one home folder.
   - Native Windows is untested. Prefer WSL if the user has it.

2. **Check Node.js 22 or newer:** `node --version`. If it's missing or older, ask the user, then install it:
   - WSL/Linux/macOS: [nvm](https://github.com/nvm-sh/nvm), then `nvm install 22`. On macOS, `brew install node` also works.
   - Windows: `winget install OpenJS.NodeJS.LTS`, then open a new terminal.

3. **Get the code.** `git` is the only other requirement. There's nothing to `npm install`: Agent Office has no dependencies.

   ```sh
   git clone https://github.com/KitsuNekoni/agent-office.git ~/agent-office
   # already there? update instead:
   git -C ~/agent-office pull
   ```

   Once it runs, the page shows its version top right. When GitHub has a newer version, an **Update** button appears there: it pulls, refreshes the hooks if they're installed, and restarts the office.

4. **Start it in the background and check it runs.**

   ```sh
   (node ~/agent-office/bin/agent-office.js >/dev/null 2>&1 &)
   sleep 1; curl -s http://127.0.0.1:4517/health          # prints: ok
   ```

   PowerShell:

   ```powershell
   Start-Process node -ArgumentList "$HOME\agent-office\bin\agent-office.js" -WindowStyle Hidden
   (Invoke-WebRequest http://127.0.0.1:4517/health -UseBasicParsing).Content   # ok
   ```

   If the port is taken, an office is probably already running: `curl` then also prints `ok`. To use another port, add `--port 5000` and use that port everywhere below.

5. **Check that it sees agents.** Your own session is an agent, so `curl -s http://127.0.0.1:4517/api/sessions` should list at least one session. If the list is empty, you're probably in the wrong environment (see step 1).

6. **Hooks (optional, ask first).** Hooks make "waiting for you" exact instead of a guess. They add entries to `~/.claude/settings.json` and `~/.cursor/hooks.json`, back up both files and leave existing hooks alone. Explain that to the user and ask:

   ```sh
   node ~/agent-office/bin/agent-office.js hooks install       # add --port N if you changed it
   ```

   Sessions that are already running pick up the hooks after they restart.

7. **Autostart (optional, ask first).** Add this line to the end of `~/.bashrc` or `~/.zshrc`. If Node comes from nvm, put it after the nvm lines:

   ```sh
   (node "$HOME/agent-office/bin/agent-office.js" >/dev/null 2>&1 &)
   ```

   A second copy notices the port is taken and exits, so a new terminal doesn't start a duplicate. On Windows, put a shortcut to `node "%USERPROFILE%\agent-office\bin\agent-office.js"` in the Startup folder (`shell:startup`).

8. **Tell the user** to open <http://localhost:4517> in their browser. From WSL this works in the Windows browser too.

**Update:** `git -C ~/agent-office pull`, stop the office with `pkill -f 'agent-office/bin/[a]gent-office.js'` (the brackets keep `pkill` from matching the shell that runs it), then start it again as in step 4. Run `hooks install` again only if the folder, the Node version or the port changed.

**Uninstall:** `node ~/agent-office/bin/agent-office.js hooks remove`, remove the autostart line, stop the process and delete `~/agent-office`.

## Install by hand

You need [Node.js](https://nodejs.org) 22 or newer. There are no other dependencies.

```sh
git clone https://github.com/KitsuNekoni/agent-office.git
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
| Update check | On by default: every 6 hours a `git fetch` of the repo's own upstream. `AGENT_OFFICE_NO_UPDATE_CHECK=1` turns it off (the version still shows). |
| Hook log | `AGENT_OFFICE_DEBUG=1` prints every incoming hook (event, session, and what it did or `ignored`). |

### Start it automatically

Agent Office is a plain foreground process. Start it the way you start other small local tools, for example from your shell profile:

```sh
# ~/.bashrc or ~/.zshrc: start once in the background, quietly
(agent-office >/dev/null 2>&1 &)
```

A second copy notices the port is taken and exits.

### Updating

The page shows the running version. The office compares the `version` in its `package.json` with the one on the upstream branch (`git fetch`, then `git show @{u}:package.json`). When the upstream one is higher, an **Update** button appears. It:

1. refuses if the checkout has local changes to tracked files ("local changes, update by hand"),
2. runs `git pull --ff-only`,
3. runs `bin/install-hooks.js --if-installed --port <port>`: the hooks are refreshed with the new installer, but only if they were installed before,
4. restarts the office with the same arguments and environment, and the page reloads.

Without a git checkout (or without an upstream branch) only the version shows. **Releasing:** raise `version` in `package.json` with every change you want other machines to get; otherwise the button doesn't appear.

## Platforms

| Platform | Status |
|---|---|
| Linux, WSL | Used daily |
| macOS | Should work: same file layout as Linux, home folders under `/Users` are recognised |
| Windows (native) | Untested. Paths and home folders are handled, the hook relay is plain Node, but hook commands depend on the shell Claude Code and Cursor use there |

If Claude Code runs inside WSL and Cursor on Windows, run Agent Office where the agents' files are (`~/.claude`, `~/.cursor`) and open the URL from your Windows browser; WSL forwards localhost.

## Privacy

The server listens on `127.0.0.1` only and never sends anything anywhere. Its only outgoing traffic is the update check: a `git fetch` from the repo's own upstream every 6 hours (turn it off with `AGENT_OFFICE_NO_UPDATE_CHECK=1`). The update endpoints only accept requests from the page itself (custom header, no CORS), so other websites can't trigger an update. It reads transcripts and session files from `~/.claude` and `~/.cursor`, and shows prompts, tool names and file names to whoever can open the page on your machine. It never writes to those folders, except `hooks install`/`hooks remove`, which only edit the two settings files above.

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
- `server/index.js`: static `web/`, `GET /events` (SSE), `GET /api/sessions`, `POST /hook/:src`, `POST /api/update` and `/api/update/check`
- `server/update.js`: version, update check against the upstream branch, update (pull, hooks, then the CLI restarts)
- `web/office.js`: the control room (canvas); grows with the number of sessions
