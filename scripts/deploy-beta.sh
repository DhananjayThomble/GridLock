#!/usr/bin/env bash
# /home/ubuntu/projects/GridLock/scripts/deploy-beta.sh
# Auto-deploy develop branch to beta-gridlock.snapurl.in
# Called by GitHub webhook or manually

set -euo pipefail

REPO_DIR="/home/ubuntu/projects/GridLock"
BETA_DIR="/var/www/gridlock-beta"

cd "$REPO_DIR"

echo "[$(date -u)] Beta deploy starting..."

# Pull latest develop
git checkout develop 2>/dev/null
git pull origin develop

# Build frontend
cd frontend
VITE_SOCKET_URL=https://gridlock-api.snapurl.in \
VITE_API_BASE_URL=https://gridlock-api.snapurl.in \
VITE_SITE_URL=https://beta-gridlock.snapurl.in \
npm run build --silent

# Deploy
sudo cp -r dist/* "$BETA_DIR/"

echo "[$(date -u)] Beta deploy complete"
