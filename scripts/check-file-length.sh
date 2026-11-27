#!/bin/sh
# Fails when a tracked or workspace source file exceeds the line limit.
# Usage: scripts/check-file-length.sh [max-lines]
set -eu

max=${1:-500}
ignore=.file-length-ignore
failed=0

files=$(git ls-files -- \
  '*.ts' '*.tsx' '*.js' '*.mjs' '*.css' '*.rs' '*.sh' \
  ':!:*.d.ts' ':!:*.gen.*' ':!:**/generated/**' ':!:**/.hutch/**' ':!:vendor/**')

if [ -z "$files" ]; then
  files=$(find apps packages crates scripts -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.rs' -o -name '*.sh' \) \
    ! -name '*.d.ts' ! -name '*.gen.*' ! -path '*/node_modules/*' ! -path '*/dist/*' ! -path '*/.hutch/*' ! -path '*/target/*')
fi

for file in $files; do
  [ -f "$file" ] || continue
  if [ -f "$ignore" ] && grep -qxF "$file" "$ignore"; then continue; fi
  lines=$(wc -l <"$file")
  if [ "$lines" -gt "$max" ]; then
    echo "error: $file has $lines lines (max $max). Split it by responsibility." >&2
    failed=1
  fi
done

[ "$failed" = 0 ] && echo "file length ok"
exit "$failed"
