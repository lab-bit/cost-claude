#!/bin/bash

echo "Testing watch command with custom sounds..."
echo "Task sound: Tink"
echo "Session sound: Hero"
echo ""
echo "Running watch command with custom sounds..."

# Run watch command with custom sounds
node dist/cli/index.js watch \
  --path ~/.claude/projects \
  --sound \
  --task-sound Tink \
  --session-sound Hero \
  --verbose \
  --max-age 1