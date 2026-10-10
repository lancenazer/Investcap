#!/bin/bash
# Double-click to run InvestCap so your phone can open it on the same Wi-Fi. Press Ctrl+C to stop.
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-5173}"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required but was not found."
  read -r -n 1 -p "Press any key to close..."
  exit 1
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is already running on port $PORT. Close the other InvestCap window first, then run this again."
  read -r -n 1 -p "Press any key to close..."
  exit 1
fi

echo "InvestCap is starting. On your phone (same Wi-Fi), open:"
echo
echo "    http://${IP:-<your-mac-ip>}:$PORT"
echo
echo "Then Share -> Add to Home Screen (iPhone) or menu -> Install app (Android)."
echo "Only devices on your home network can connect. Ctrl+C to stop."
echo
HOST=0.0.0.0 PORT="$PORT" python3 server.py
