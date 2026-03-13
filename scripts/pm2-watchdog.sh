#!/usr/bin/env bash
# PM2 Watchdog — logs who kills PM2 processes
# Monitors pm2.log for "Deleting process" and captures context
LOG="/home/ubuntu/.pm2/pm2.log"
ALERT_LOG="/home/ubuntu/pm2-kills.log"

tail -F "$LOG" 2>/dev/null | while read -r line; do
  if echo "$line" | grep -q "Deleting process"; then
    {
      echo "========== PM2 KILL DETECTED: $(date -u) =========="
      echo "PM2 log line: $line"
      echo "--- Who's running pm2? ---"
      ps aux | grep -E '[p]m2|[n]ode.*ecosystem' || echo "(none)"
      echo "--- Recent bash processes ---"
      ps aux | grep -E '[b]ash.*deploy|[b]ash.*pm2' || echo "(none)"
      echo "--- GitHub runner? ---"
      ps aux | grep -E '[r]unner|[a]ctions' || echo "(none)"
      echo "--- Last 5 lines of pm2.log ---"
      tail -5 "$LOG"
      echo "=================================================="
    } >> "$ALERT_LOG"
  fi
done
