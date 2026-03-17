#!/bin/bash
# Discord notification helper for CI/CD
# Usage: scripts/ci-notify.sh <channel_id> <message>
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: ci-notify.sh <channel_id> <message>"
  exit 1
fi

CHANNEL_ID="$1"
MESSAGE="$2"

# Prevent token leak: disable trace before reading secret, pipe directly to curl
set +x
python3 -c "import json; print(json.load(open('/home/ubuntu/.openclaw/openclaw.json'))['channels']['discord']['token'])" | {
  read -r TOKEN
  curl -s -X POST "https://discord.com/api/v10/channels/$CHANNEL_ID/messages" \
    -H "Authorization: Bot $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"content\": $(echo "$MESSAGE" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))')}"
}
