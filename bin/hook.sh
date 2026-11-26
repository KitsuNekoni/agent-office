#!/bin/sh
# Agent Office hook-relay. Stuurt de hook-payload (stdin) door naar de lokale office-server.
# Neemt nooit een beslissing en faalt altijd stil: draait de office niet, dan gebeurt er niets.
# Gebruik: hook.sh claude|cursor
src="${1:-claude}"
port="${AGENT_OFFICE_PORT:-4517}"
curl -s --connect-timeout 0.2 -m 1 -X POST -H 'content-type: application/json' --data-binary @- "http://127.0.0.1:$port/hook/$src" >/dev/null 2>&1
# Cursor verwacht JSON op stdout; een leeg object betekent: geen mening.
[ "$src" = cursor ] && printf '{}\n'
exit 0
