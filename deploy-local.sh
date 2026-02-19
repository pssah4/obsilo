#!/bin/bash

# Deploy to local Obsidian vault
# Usage: ./deploy-local.sh

PLUGIN_DIR="/Users/sebastianhanke/Obsidian/NexusOS/.obsidian/plugins/obsidian-agent"

echo "🚀 Deploying Obsidian Agent to vault..."

# Create plugin directory if it doesn't exist
mkdir -p "$PLUGIN_DIR"

# Copy only essential files
echo "📦 Copying files..."
cp manifest.json "$PLUGIN_DIR/"
cp main.js "$PLUGIN_DIR/"
cp styles.css "$PLUGIN_DIR/"
[ -f src/assets/logo.png ] && cp src/assets/logo.png "$PLUGIN_DIR/"

echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Reload Obsidian (Cmd/Ctrl + R)"
echo "2. Or disable/enable the plugin in Settings"
