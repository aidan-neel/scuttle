#!/usr/bin/env bash
# Save a checkout's uncommitted work as one patch, without touching the index, so a fresh
# worktree can take it with `git apply`. Covers staged, unstaged, deleted, untracked, binary,
# and executable files. Ignored files stay out.
#
# Usage: save-patch.sh <slug>
# Writes ${XDG_STATE_HOME:-~/.local/state}/astack/interrogate/<slug>.patch and prints its path.
# The slug takes letters, digits, dots, dashes, and underscores.
set -euo pipefail

fail() {
	printf 'save-patch.sh: %s\n' "$1" >&2
	exit 1
}

[ $# -eq 1 ] || fail 'usage: save-patch.sh <slug>'
case "$1" in
'' | .* | *[!A-Za-z0-9._-]*) fail "slug must be letters, digits, dots, dashes, or underscores, not starting with a dot: $1" ;;
esac
root=$(git rev-parse --show-toplevel) || fail 'run it inside a git checkout'
cd "$root"
git rev-parse --verify --quiet HEAD >/dev/null || fail 'the checkout has no commit yet, so a worktree would have nothing to apply to'

dir=${XDG_STATE_HOME:-$HOME/.local/state}/astack/interrogate
mkdir -p "$dir"
patch=$dir/$1.patch
partial=$(mktemp "$dir/.$1.XXXXXX")
trap 'rm -f "$partial"' EXIT

diff_options=(-c diff.noprefix=false -c diff.mnemonicPrefix=false -c diff.relative=false
	diff --no-color --no-ext-diff --no-textconv --binary)
git "${diff_options[@]}" HEAD >"$partial"
git ls-files --others --exclude-standard -z | while IFS= read -r -d '' file; do
	case "$file" in */) fail "$file is a separate git repository inside the checkout; commit it, or move it out, then rerun" ;; esac
	status=0
	git "${diff_options[@]}" --no-index -- /dev/null "$file" >>"$partial" || status=$?
	[ "$status" -le 1 ] || exit 1
done

mv "$partial" "$patch"
[ -s "$patch" ] || printf 'save-patch.sh: no uncommitted changes; the patch is empty\n' >&2
printf '%s\n' "$patch"
