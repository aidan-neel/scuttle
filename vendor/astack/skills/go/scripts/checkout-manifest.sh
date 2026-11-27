#!/usr/bin/env bash
# Catch stray writes while read-only reviewers work in a checkout.
#
# Usage:
#   checkout-manifest.sh save <manifest> [dir]     record each file's checksum and each symlink's target
#   checkout-manifest.sh compare <manifest> [dir]  print what changed since; exit 1 when anything did
#
# dir defaults to the current folder. The manifest must live outside it. It skips .git, which
# harnesses write to on their own, and reports changes under __pycache__ or to .pyc files as caches.
# `git status` can't replace it: it misses another edit to a file that was already modified or
# untracked.
set -euo pipefail

usage() {
	printf 'usage: checkout-manifest.sh save|compare <manifest> [dir]\n' >&2
	exit 2
}

[ $# -ge 2 ] && [ $# -le 3 ] || usage
case "$1" in save | compare) ;; *) usage ;; esac
command=$1
manifest=$2
dir=${3:-.}
dir=$(cd "$dir" && pwd -P)

manifest_dir=$(cd "$(dirname "$manifest")" 2>/dev/null && pwd -P) || {
	printf 'checkout-manifest.sh: the folder for %s does not exist\n' "$manifest" >&2
	exit 2
}
case "$manifest_dir/" in
"$dir"/*)
	printf 'checkout-manifest.sh: put the manifest outside %s, for example in a folder from mktemp -d\n' "$dir" >&2
	exit 2
	;;
esac

snapshot() {
	(
		cd "$dir"
		find . -path ./.git -prune -o -type f -exec cksum {} + -o -type l -exec sh -c '
			for link do printf "link %s -> %s\n" "$link" "$(readlink "$link")"; done' sh {} +
	) | LC_ALL=C sort
}

case "$command" in
save)
	snapshot >"$manifest"
	printf 'saved %s lines to %s\n' "$(wc -l <"$manifest" | tr -d ' ')" "$manifest"
	;;
compare)
	[ -f "$manifest" ] || {
		printf 'checkout-manifest.sh: no manifest at %s; run save first\n' "$manifest" >&2
		exit 2
	}
	current=$(mktemp)
	trap 'rm -f "$current"' EXIT
	snapshot >"$current"
	changes=$(diff "$manifest" "$current" | grep '^[<>]' || true)
	cache='(/__pycache__/|\.py[co]( |$))'
	stray=$(printf '%s\n' "$changes" | grep -Ev "$cache" | grep . || true)
	caches=$(printf '%s\n' "$changes" | grep -E "$cache" | grep -c . || true)
	[ "$caches" -eq 0 ] || printf 'ignored %s changed cache lines\n' "$caches"
	if [ -n "$stray" ]; then
		printf 'stray writes (< before, > now):\n%s\n' "$stray"
		exit 1
	fi
	printf 'no changes outside caches\n'
	;;
esac
