# Agent Office

Een live mission control voor alle agents op deze PC. Elke sessie is een operator aan een console: wat hij doet (denkt, leest, schrijft, terminal, web, subagent), wie op je wacht (oranje zwaailicht) en wie klaar is (idle-hoek). Je kunt er alleen naar kijken; agents aansturen kan hier niet.

```sh
npm start            # http://localhost:4517
npm test
npm run hooks:install   # precieze 'wacht op jou' via hooks (Claude Code + Cursor)
npm run hooks:remove
```

Geen dependencies, Node 22+. Alles wordt in code getekend.

## Waar de data vandaan komt

| Client | Bron |
|---|---|
| Claude Code (terminal, Claude-app via SSH, headless `-p`) | `~/.claude/sessions/<pid>.json` (welke sessies leven, terminal of app), `~/.claude/projects/<slug>/<id>.jsonl` (wat ze doen) |
| Cursor IDE en Cursor CLI (`agent`, ook als hij vanuit een ander programma draait) | `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`; CLI-chats herkend aan `~/.cursor/chats/*/<id>` |
| Hooks (optioneel) | `bin/hook.sh` stuurt hook-payloads naar `POST /hook/claude` en `/hook/cursor` |

Zonder hooks raadt de office "wacht op jou" als een terminal-, schrijf- of webtool langer dan 25 s stil blijft ("lijkt te wachten"). Met de Claude Code-hooks (`PermissionRequest`, `Notification`) is het exact. Cursor heeft geen hook voor toestemmingsvragen, dus daar blijft het een gok. Cursor voert daarnaast ook de Claude Code-hooks uit (`preToolUse`, `postToolUse`, … met `cursor_version` in de payload). De server herkent die en hangt ze aan de Cursor-sessie. Dat is nodig omdat Cursor het transcript soms pas na een beurt wegschrijft.

De Claude Code-hooks draaien met `async: true` en de relay geeft het na 0,2 s op als de server niet draait. Agents merken er dus niets van. De Cursor-hooks gebruiken alleen `after*`-events en `stop`, en die nemen nergens een beslissing over.

## Opbouw

- `server/classify.js`: toolnaam → soort activiteit, korte omschrijving, projectnaam
- `server/parse.js`: transcriptregels (Claude, Cursor) → events
- `server/store.js`: sessiemodel en statusmachine (ask > error > actief > idle; verdwenen sessies blijven 30 s zichtbaar)
- `server/sources/`: register, transcripts tailen, hook-payloads
- `server/index.js`: statische `web/`, `GET /events` (SSE), `GET /api/sessions`, `POST /hook/:src`
- `web/office.js`: de controlekamer (canvas); groeit mee met het aantal sessies
