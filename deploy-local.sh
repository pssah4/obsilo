#!/bin/bash

# Deploy to local Obsidian vault
# Usage: ./deploy-local.sh
#
# Requires a .env file with:
#   PLUGIN_DIR=/path/to/your/obsidian/vault/.obsidian/plugins/obsidian-agent

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/.env" ]; then
  source "$SCRIPT_DIR/.env"
fi

if [ -z "$PLUGIN_DIR" ]; then
  echo "Error: PLUGIN_DIR not set. Create a .env file with:"
  echo "  PLUGIN_DIR=/path/to/.obsidian/plugins/obsidian-agent"
  exit 1
fi

echo "Deploying Obsidian Agent to: $PLUGIN_DIR"

# Create plugin directory if it doesn't exist
mkdir -p "$PLUGIN_DIR"

# Copy only essential files
cp manifest.json "$PLUGIN_DIR/"
cp main.js "$PLUGIN_DIR/"
cp styles.css "$PLUGIN_DIR/"
[ -f src/assets/logo.png ] && cp src/assets/logo.png "$PLUGIN_DIR/"

echo "Deployment complete."
echo ""
echo "Next steps:"
echo "1. Reload Obsidian (Cmd/Ctrl + R)"
echo "2. Or disable/enable the plugin in Settings"
