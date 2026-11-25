#!/bin/sh
# Fails when any *.test.* file is placed inside a src/ directory instead of tests/.
set -eu

bad=$(find apps packages -path '*/src/*' -type f -name '*.test.*' \
  ! -path '*/node_modules/*' ! -path '*/dist/*' ! -path '*/.hutch/*')

if [ -n "$bad" ]; then
  echo "error: test files must live under tests/, not alongside source files in src/:" >&2
  printf '%s\n' "$bad" >&2
  exit 1
fi

echo "test layout ok"
