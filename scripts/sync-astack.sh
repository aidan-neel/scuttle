#!/bin/sh
# Syncs vendored astack skills, agents, and standards into vendor/astack/.
# Usage: ASTACK_DIR=~/astack sh scripts/sync-astack.sh
set -eu

src="${ASTACK_DIR:-$HOME/astack}"
dest="vendor/astack"

if [ ! -d "$src/skills" ]; then
  echo "error: astack skills directory not found at $src/skills" >&2
  exit 1
fi

rm -rf "$dest"
mkdir -p "$dest"

cp -R "$src/skills" "$dest/skills"
if [ -d "$src/agents" ]; then
  cp -R "$src/agents" "$dest/agents"
fi
if [ -f "$src/AGENTS.md" ]; then
  cp "$src/AGENTS.md" "$dest/AGENTS.md"
fi

count=$(find "$dest/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')
echo "synced $count skills from $src into $dest"
