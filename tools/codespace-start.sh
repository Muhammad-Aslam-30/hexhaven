#!/usr/bin/env bash
# Starts Hexhaven inside a GitHub Codespace and makes its port public so phones can join without a GitHub login.
# Runs by itself when the codespace opens (see .devcontainer/devcontainer.json). Safe to run again by hand.
cd "$(dirname "$0")/.." || exit 1

if curl -fs http://localhost:3700/healthz >/dev/null 2>&1; then
  echo "Hexhaven is already running."
  echo "Open: https://${CODESPACE_NAME}-3700.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/"
  exit 0
fi

[ -d node_modules ] || npm install

(
  sleep 6
  if gh codespace ports visibility 3700:public -c "$CODESPACE_NAME" >/dev/null 2>&1; then
    echo ""
    echo "  ✅ Port 3700 is public — phones can join."
  else
    echo ""
    echo "  ⚠️  Could not make the port public automatically."
    echo "     Open the PORTS tab, right-click port 3700 → Port Visibility → Public."
  fi
  echo "  👉 Open this on the laptop/TV: https://${CODESPACE_NAME}-3700.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/"
  echo ""
) &

npm start
