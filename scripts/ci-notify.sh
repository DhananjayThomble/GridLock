#!/bin/bash
# Discord notification helper for CI/CD
# Usage: scripts/ci-notify.sh <channel_id> <message>
set -euo pipefail

CHANNEL_ID="$1"
MESSAGE="$2"
TOKEN=$(python3 -c "import json; print(json.load(open('/home/ubuntu/.openclaw/openclaw.json'))['channels']['discord']['token'])")

curl -s -X POST "https://discord.com/api/v10/channels/$CHANNEL_ID/messages" \
  -H "Authorization: Bot $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"content\": $(echo "$MESSAGE" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))')}"
