#!/bin/sh
# Legacy relay: `hooks install` now uses bin/hook.js (no sh or curl needed). Kept so hooks installed
# by older versions keep working; running `agent-office hooks install` again switches them over.
# Agent Office hook relay. Forwards the hook payload (stdin) to the local office server.
# Never makes a decision and always fails silently: if the office isn't running, nothing happens.
# Usage: hook.sh claude|cursor
src="${1:-claude}"
port="${AGENT_OFFICE_PORT:-4517}"
curl -s --connect-timeout 0.2 -m 1 -X POST -H 'content-type: application/json' --data-binary @- "http://127.0.0.1:$port/hook/$src" >/dev/null 2>&1
# Cursor expects JSON on stdout; an empty object means: no opinion.
[ "$src" = cursor ] && printf '{}\n'
exit 0
