#!/bin/bash
cd "$(dirname "$0")"
ENGINE_LOG="/home/z/my-project/stream-engine.log"
while true; do
    echo "[$(date '+%H:%M:%S')] Starting stream engine..." >> "$ENGINE_LOG"
    bun index.ts < /dev/null >> "$ENGINE_LOG" 2>&1
    EXIT_CODE=$?
    echo "[$(date '+%H:%M:%S')] Engine exited with code $EXIT_CODE, restarting in 2s..." >> "$ENGINE_LOG"
    sleep 2
done
