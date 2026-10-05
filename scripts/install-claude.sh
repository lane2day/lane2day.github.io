#!/usr/bin/env bash
# Installs the publish-html skill into ~/.claude/skills and adds a standing instruction to ~/.claude/CLAUDE.md.
# Safe to re-run: replaces its own block, leaves the rest of CLAUDE.md alone.
set -euo pipefail
HUB="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
MD="$CLAUDE_DIR/CLAUDE.md"
START="<!-- publish-html:start -->"
END="<!-- publish-html:end -->"

mkdir -p "$CLAUDE_DIR/skills"
ln -sfn "$HUB/claude/skills/publish-html" "$CLAUDE_DIR/skills/publish-html"
touch "$MD"
cp "$MD" "$MD.bak"
awk -v s="$START" -v e="$END" '$0==s{skip=1} !skip{print} $0==e{skip=0}' "$MD.bak" > "$MD"

cat >> "$MD" <<BLOCK
$START
## Publishing HTML deliverables

Whenever you create or substantially update an HTML deliverable for me (a presentation, report, dashboard, visualization or prototype) in any project, end the task by asking whether I want it published to my Pages hub. If I say yes, follow the \`publish-html\` skill. Never publish without my yes.

- Hub repo: \`$HUB\`
- CLI: \`node $HUB/scripts/pub.mjs\`
$END
BLOCK

echo "Linked skill → $CLAUDE_DIR/skills/publish-html"
echo "Updated $MD (backup at $MD.bak)"
