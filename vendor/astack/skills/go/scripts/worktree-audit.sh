#!/usr/bin/env bash
# Read-only worktree prune audit. Classifies every git worktree by size, merge
# state, uncommitted work, ignored files outside known build output, remote and
# PR state, and the newest agent session that touched it. Emits a table sorted by size with a suggested bucket. Never
# deletes anything; deletion stays a human-gated step in the playbook.
#
# PR reads #N/merged only when the PR's head commit is the worktree's HEAD.
# #N/merged-moved means the branch gained commits after the PR merged, so the
# worktree holds work the PR lacks.
#
# Usage: worktree-audit.sh [-b|--base <ref>] [repo-path]
#   repo-path defaults to the current repo.
#   -b sets the ref the MERGED column checks against (e.g. origin/integration).
#   Without it the base is origin/HEAD, then origin/main, then origin/master.
#   origin/HEAD is the remote's default branch, not necessarily the branch PRs
#   merge into; pass -b when they differ.
#
# PR state comes from gh when it is installed and authenticated: every author's
# PRs whose head branch lives in this repo, not in a fork. Session state
# comes from Claude Code's ${CLAUDE_CONFIG_DIR:-~/.claude}/projects (only the folders derived from
# this repo's own paths) and Codex's ${CODEX_HOME:-~/.codex}/sessions. Set
# ASTACK_SESSION_DIRS to a colon-separated list to scan other folders instead.
set -u

base=""
while [ $# -gt 0 ]; do
	case "$1" in
	-b|--base) [ $# -ge 2 ] || { echo "error: $1 needs a ref" >&2; exit 2; }; base="$2"; shift 2 ;;
	-h|--help) sed -n '2,/^set -u/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
	-*) echo "error: unknown option: $1" >&2; exit 2 ;;
	*) break ;;
	esac
done

repo="${1:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$repo" ] && { echo "not in a git repo; pass a repo path" >&2; exit 1; }
cd "$repo" || exit 1
git rev-parse --git-dir >/dev/null 2>&1 || { echo "error: not a git repo: $repo" >&2; exit 1; }

# Worktree paths, one per line. Paths may hold spaces, so strip the prefix
# rather than splitting on whitespace.
list_worktrees() { git worktree list --porcelain | sed -n 's/^worktree //p'; }

# The main worktree is the first entry; everything else is a candidate.
main_wt=$(list_worktrees | head -1)

if [ -z "$base" ]; then
	for cand in "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)" origin/main origin/master; do
		[ -n "$cand" ] && git rev-parse --verify --quiet "$cand^{commit}" >/dev/null && { base="$cand"; break; }
	done
	[ -z "$base" ] && { echo "error: no base ref (origin/HEAD, origin/main, origin/master all missing); pass -b <ref>" >&2; exit 1; }
	echo "warn: no -b given; MERGED checks against $base" >&2
fi

# The base drives the merge check. The fetch is best-effort (stale is fine for
# a first pass) and runs before the check, since -b may name a branch not
# fetched yet. The explicit refspec creates it even in a single-branch clone.
case "$base" in
origin/*) git fetch origin "+refs/heads/${base#origin/}:refs/remotes/$base" --quiet 2>/dev/null \
	|| echo "warn: could not fetch $base; merged column may be stale" >&2 ;;
esac
git rev-parse --verify --quiet "$base^{commit}" >/dev/null 2>&1 || { echo "error: base ref not found: $base" >&2; exit 1; }

# GNU coreutils (Linux, Homebrew gnubin) reads `stat -f` as file system status
# and `date -r` as a file, so pick the stat and date flags once.
if stat -c %Y / >/dev/null 2>&1; then
	mtime() { stat -c %Y "$1"; }; fmt_day() { date -d "@$1" '+%Y-%m-%d'; }
else
	mtime() { stat -f %m "$1"; }; fmt_day() { date -r "$1" '+%Y-%m-%d'; }
fi

# PR state by branch, fetched once as [{number, state, head, oid}] with state one of
# open, draft, merged, closed. Fork PRs are dropped, since their head names
# (main, patch-1) can collide with local branches. Empty when gh or jq is
# missing, or gh cannot read this repo's PRs.
prs=$(mktemp)
trap 'rm -f "$prs"' EXIT
forge="none (gh or jq missing, or gh cannot read this repo's PRs)"
if command -v gh >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 \
	&& raw=$(gh pr list --state all --limit 1000 \
		--json number,state,isDraft,isCrossRepository,headRefName,headRefOid 2>/dev/null) \
	&& printf '%s' "$raw" | jq '[.[] | select(.isCrossRepository | not)
		| {number, head: .headRefName, oid: .headRefOid,
		   state: (if .isDraft and .state == "OPEN" then "draft" else (.state | ascii_downcase) end)}]' \
		> "$prs" 2>/dev/null; then
	forge="github via gh, $(jq length "$prs") same-repo PRs from every author"
fi
[ -s "$prs" ] || echo "[]" > "$prs"
have_jq=no; command -v jq >/dev/null 2>&1 && have_jq=yes

# Counts ignored files, one path per line, that removal would lose. git
# reports an ignored folder as one entry, so the caller lists every file inside
# it. Installed packages are wholly disposable, since their fixtures often
# carry key.pem and dotfiles. Build output and caches are disposable unless the
# file is secret-like or user data: a dotfile or dot folder other than the
# tools' own markers, *.pem, *.key, *.p12, id_*, *.sqlite*, or *.db, which a
# build may copy in from the project (dist/.env).
# Any ignored file outside those folders exists only in this worktree.
count_kept_ignored='
BEGIN {
	n = split("node_modules .venv venv", a, " "); for (i = 1; i <= n; i++) pkgs[a[i]] = 1
	n = split("dist build out target coverage .next .turbo .cache .gradle __pycache__ .pytest_cache .mypy_cache .ruff_cache", a, " ")
	for (i = 1; i <= n; i++) output[a[i]] = 1
	n = split(".gitignore .gitkeep .cargo-lock .rustc_info.json .fingerprint .ninja_deps .ninja_log", a, " ")
	for (i = 1; i <= n; i++) markers[a[i]] = 1
}
{
	n = split($0, p, "/"); in_pkgs = 0; in_output = 0; dotted = 0
	for (i = 1; i <= n; i++) {
		if (i < n && p[i] in pkgs) in_pkgs = 1
		else if (i < n && p[i] in output) in_output = 1
		else if (p[i] ~ /^\./ && !(p[i] in markers)) dotted = 1
	}
	base = p[n]
	if (in_pkgs || base == ".DS_Store") next
	if (!in_output || dotted || base ~ /^id_/ || base ~ /\.(pem|key|p12|db)$/ || base ~ /\.sqlite/) kept++
}
END { print kept + 0 }'

# Claude Code keeps a session folder per working directory under
# ~/.claude/projects, named by the path with every non-alphanumeric character
# turned into "-". Scan only the folders for this repo's main worktree, its
# <repo>/.claude/worktrees/* children, and the worktree itself, so the scan
# never reads sessions from unrelated projects.
slug() { printf '%s' "$1" | sed 's/[^A-Za-z0-9]/-/g'; }
session_dirs() {
	wt="$1"
	if [ -n "${ASTACK_SESSION_DIRS:-}" ]; then
		printf '%s\n' "$ASTACK_SESSION_DIRS" | tr ':' '\n'
		return
	fi
	cc="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
	if [ -d "$cc" ]; then
		main_slug=$(slug "$main_wt")
		for d in "$cc/$main_slug" "$cc/$main_slug"--claude-worktrees-* "$cc/$(slug "$wt")"; do
			[ -d "$d" ] && printf '%s\n' "$d"
		done
	fi
	codex="${CODEX_HOME:-$HOME/.codex}/sessions"
	[ -d "$codex" ] && printf '%s\n' "$codex"
}

# Files under a folder that mention the worktree path followed by "/" or a
# quote, so glint-482 does not match glint-482-r37.
files_mentioning() {
	wt="$1"; dir="$2"
	if command -v rg >/dev/null 2>&1; then
		rg -l --fixed-strings -e "${wt}/" -e "${wt}\"" "$dir" 2>/dev/null
	else
		grep -rlF -e "${wt}/" -e "${wt}\"" "$dir" 2>/dev/null
	fi
}

now=$(date +%s)

echo "# base: $base"
scanned=$(session_dirs "$main_wt" | sort -u | tr '\n' ' ' | sed 's/ $//')
[ -z "${ASTACK_SESSION_DIRS:-}" ] && scanned="$scanned (plus each worktree's own Claude Code folder)"
echo "# scanned: sessions ${scanned:-none}; forge $forge"
printf "SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE\n"

list_worktrees | while IFS= read -r wt; do
	[ "$wt" = "$main_wt" ] && continue

	size=$(du -sh "$wt" 2>/dev/null | awk '{print $1}')
	[ -z "$size" ] && size="?"
	head=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
	head_ts=$(git -C "$wt" log -1 --format='%ct' HEAD 2>/dev/null || echo 0)
	age=$([ "${head_ts:-0}" -gt 0 ] 2>/dev/null && echo "$(( (now - head_ts) / 86400 ))d" || echo "?")

	# Squash-merged branches are not ancestors of the base, so PR state is the
	# real signal; merge-base only catches fast-forward and rebase merges.
	[ -n "$head" ] && git merge-base --is-ancestor "$head" "$base" 2>/dev/null && merged=YES || merged=no

	# Tracked edits are WIP. Untracked files that git doesn't ignore are often
	# new source never staged, and removing the worktree deletes them for good,
	# as it does ignored files outside known build output.
	# A worktree git can't read is never safe: its files are unknown.
	readable=yes
	porcelain=$(git -C "$wt" status --porcelain --untracked-files=all 2>/dev/null) || readable=no
	n_wip=$(printf '%s\n' "$porcelain" | grep -c '^[^?!]')
	n_untracked=$(printf '%s\n' "$porcelain" | grep -c '^??')
	n_ignored=$(git -C "$wt" ls-files -z --others --ignored --exclude-standard 2>/dev/null \
		| tr '\0' '\n' | awk "$count_kept_ignored")
	if [ "$n_wip" -gt 0 ]; then dirty="wip:$n_wip"
	elif [ "$n_untracked" -gt 0 ]; then dirty="untracked:$n_untracked"
	else dirty=clean; fi
	[ "$readable" = no ] && dirty=git-error
	if [ "$n_ignored" -gt 0 ]; then
		[ "$dirty" = clean ] && dirty="ignored:$n_ignored" || dirty="$dirty,ignored:$n_ignored"
	fi

	branch=$(git -C "$wt" symbolic-ref --quiet --short HEAD 2>/dev/null || echo "")
	if [ -z "$branch" ]; then remote=detached
	elif git -C "$wt" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
		[ "$(git -C "$wt" rev-parse "origin/$branch" 2>/dev/null)" = "$head" ] \
			&& remote=pushed \
			|| remote="ahead$(git -C "$wt" rev-list --count "origin/$branch..HEAD" 2>/dev/null)"
	else remote=no-remote; fi

	pr="-"
	if [ -n "$branch" ] && [ "$have_jq" = yes ]; then
		pr=$(jq -r --arg b "$branch" --arg h "$head" \
			'[.[] | select(.head==$b) | if .state == "merged" and .oid != $h then .state = "merged-moved" else . end]
			| sort_by(.state | if . == "open" or . == "draft" then 0 elif . == "merged" then 1 elif . == "merged-moved" then 2 else 3 end)
			| .[0] // empty | "#\(.number)/\(.state)"' "$prs" 2>/dev/null)
		[ -z "$pr" ] && pr="-"
	fi

	# Newest session file that operated in this worktree.
	last="-"; last_ts=0
	while IFS= read -r dir; do
		[ -n "$dir" ] && [ -d "$dir" ] || continue
		while IFS= read -r f; do
			ts=$(mtime "$f" 2>/dev/null || echo 0)
			[ "${ts:-0}" -gt "$last_ts" ] 2>/dev/null && last_ts=$ts
		done <<EOF
$(files_mentioning "$wt" "$dir")
EOF
	done <<EOF
$(session_dirs "$wt")
EOF
	[ "$last_ts" -gt 0 ] && last=$(fmt_day "$last_ts" 2>/dev/null)
	recent=no
	[ "$last_ts" -gt 0 ] && [ $(( (now - last_ts) / 86400 )) -le 4 ] && recent=yes

	landed=no
	case "$pr" in */merged) landed=yes ;; esac
	[ "$merged" = YES ] && landed=yes
	if [ "$n_wip" -gt 0 ]; then bucket=hold-wip
	else
		case "$pr" in */open|*/draft) bucket=hold-open-pr ;; *)
			if [ "$recent" = yes ]; then bucket=verify-recent-chat
			elif [ "$landed" = yes ] && [ "$readable" = yes ] && [ "$n_untracked" -eq 0 ] && [ "$n_ignored" -eq 0 ]; then bucket=safe
			else bucket=review; fi ;;
		esac
	fi

	printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
		"$size" "$age" "$merged" "$dirty" "$remote" "$pr" "$last" "$bucket" "$wt"
done | sort -t "$(printf '\t')" -k1,1 -rh
