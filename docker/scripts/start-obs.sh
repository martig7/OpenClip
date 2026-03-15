#!/bin/bash
set -e

echo "[obs-docker] Starting virtual display..."
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &
XVFB_PID=$!
trap 'kill -TERM "$XVFB_PID" 2>/dev/null || true; wait "$XVFB_PID" 2>/dev/null || true' EXIT INT TERM

export DISPLAY=:99
sleep 2

echo "[obs-docker] Starting OBS Studio..."
# --disable-crash-handler avoids crash dialog prompts that block headless startup
obs --disable-crash-handler --minimize-to-tray 2>&1 &
OBS_PID=$!

echo "[obs-docker] Waiting for OBS WebSocket on port 4455..."
for i in $(seq 1 60); do
  if nc -z localhost 4455 2>/dev/null; then
    echo "[obs-docker] OBS WebSocket is ready (${i}s)"
    break
  fi
  if ! kill -0 $OBS_PID 2>/dev/null; then
    echo "[obs-docker] ERROR: OBS process exited unexpectedly"
    exit 1
  fi
  echo "[obs-docker] Waiting... ($i/60)"
  sleep 1
done

if ! nc -z localhost 4455 2>/dev/null; then
  echo "[obs-docker] ERROR: OBS WebSocket never became available"
  kill $OBS_PID 2>/dev/null || true
  exit 1
fi

echo "[obs-docker] Ready. OBS WebSocket listening on ws://0.0.0.0:4455"
wait $OBS_PID
