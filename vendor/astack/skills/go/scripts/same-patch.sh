#!/usr/bin/env bash
# Decide whether a review verdict still covers a pull request after its commits moved.
#
# Usage: same-patch.sh <verdict-base> <verdict-head> <current-base> <current-head>
#
# Compares the whole PR's patch at both points: the diff from the merge base of base and head to
# head (base...head), so trunk moving on doesn't change it and an earlier commit changing does.
# Prints both patch ids, then `same` (exit 0) or `differs` (exit 1). Exit 2 on any error, such as
# an unknown commit or no merge base, so a failure never reads as `same`.
# Patch ids keep whitespace (--verbatim) and binary content (--binary).
set -euo pipefail

fail() {
	printf 'same-patch.sh: %s\n' "$1" >&2
	exit 2
}

[ $# -eq 4 ] || fail 'usage: same-patch.sh <verdict-base> <verdict-head> <current-base> <current-head>'
for rev in "$@"; do
	git rev-parse --verify --quiet "$rev^{commit}" >/dev/null || fail "no commit named $rev"
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

patch_id() {
	git merge-base "$1" "$2" >/dev/null || fail "no merge base between $1 and $2"
	git -c diff.noprefix=false -c diff.mnemonicPrefix=false -c diff.relative=false \
		diff --no-color --no-ext-diff --no-textconv --binary "$1...$2" >"$work/diff" ||
		fail "git diff $1...$2 failed"
	if [ ! -s "$work/diff" ]; then
		printf 'empty\n'
		return
	fi
	git patch-id --verbatim <"$work/diff" >"$work/id" || fail 'git patch-id failed; it needs git 2.39 or later'
	if [ -s "$work/id" ]; then
		cut -d' ' -f1 <"$work/id"
	else
		printf 'raw-%s\n' "$(git hash-object --stdin <"$work/diff")"
	fi
}

verdict=$(patch_id "$1" "$2")
current=$(patch_id "$3" "$4")
printf 'verdict %s\ncurrent %s\n' "$verdict" "$current"
if [ "$verdict" = "$current" ]; then
	printf 'same\n'
else
	printf 'differs\n'
	exit 1
fi
