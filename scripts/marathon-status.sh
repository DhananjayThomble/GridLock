#!/bin/bash
# Marathon status checker — reports to Kartik main session
REPORT_DIR=$(ls -td /tmp/gridlock-marathon-* 2>/dev/null | head -1)
if [ -z "$REPORT_DIR" ]; then echo "NO_MARATHON"; exit 0; fi

PID=$(cat /tmp/marathon.pid 2>/dev/null)
ALIVE="DEAD"
if [ -n "$PID" ] && ps -p $PID > /dev/null 2>&1; then ALIVE="RUNNING"; fi

# Count completed cycles
CYCLES=$(ls "$REPORT_DIR"/socket-cycle*.json 2>/dev/null | wc -l)
TOTAL_GAMES=$(cat "$REPORT_DIR"/socket-cycle*.json 2>/dev/null | jq -s '[.[].gamesCompleted] | add // 0')
TOTAL_BUGS=$(cat "$REPORT_DIR"/*.json 2>/dev/null | jq -s '[.[].bugs | length] | add // 0')

# Latest cycle progress
LATEST_LOG=$(ls -t "$REPORT_DIR"/*.log 2>/dev/null | head -1)
LATEST_LINE=$(tail -3 "$LATEST_LOG" 2>/dev/null | head -1)

echo "Marathon: $ALIVE | Cycles: $CYCLES | Games: $TOTAL_GAMES | Bugs: $TOTAL_BUGS"
echo "Latest: $LATEST_LINE"

# If marathon died, say so
if [ "$ALIVE" = "DEAD" ] && [ "$CYCLES" -lt 3 ]; then
  echo "⚠️ Marathon appears to have died early (only $CYCLES cycles). Check /tmp/marathon-output.log"
fi
