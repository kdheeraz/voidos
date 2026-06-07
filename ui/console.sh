#!/usr/bin/env sh
# Launch voidOS with the Console UI. Boots the kernel, then the web console.
# Ctrl-C stops both. Needs: node >=23.6, a Python venv at .venv with mind deps,
# and (for chat) OLLAMA_API_KEY set.
cd "$(dirname "$0")/.." || exit 1

PY=.venv/bin/python
[ -x "$PY" ] || PY=python3

node kernel/src/index.ts &
KPID=$!
trap 'kill $KPID 2>/dev/null' INT TERM
sleep 1.5
"$PY" ui/server.py
kill $KPID 2>/dev/null
