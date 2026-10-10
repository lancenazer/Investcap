#!/bin/bash
# Double-click to start InvestCap and open it in your browser. Press Ctrl+C (or close this window) to stop.
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-5173}"
URL="http://localhost:$PORT"
open_page() { [ -n "$INVESTCAP_NO_OPEN" ] || open "$URL"; }

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required but was not found."
  read -r -n 1 -p "Press any key to close..."
  exit 1
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "InvestCap is already running at $URL"
  open_page
  exit 0
fi

(sleep 1; open_page) &
echo "Starting InvestCap at $URL  (Ctrl+C to stop)"
PORT="$PORT" python3 server.py
