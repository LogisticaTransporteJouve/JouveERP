#!/usr/bin/env bash
# Fails if a tracked file, a file name, a staged addition, a commit message or
# the branch name contains a forbidden word. The list lives in FORBIDDEN_WORDS
# (one case-insensitive extended regex) so the word itself never has to be
# spelled out in the repo: set it in your shell profile and in the CI secret
# FORBIDDEN_WORDS. Output never prints matched text, only where it is (commit
# ids, paths that do not match themselves, counts), because CI logs are read
# by everyone with access to the repo.
#
# Optional (CI sets the first three, pre-push sets RANGE and BRANCH, and
# commit-msg sets MESSAGE_FILE):
#   REQUIRE_FORBIDDEN_WORDS=1     fail instead of skipping when the list is unset
#   FORBIDDEN_WORDS_RANGE=A..B    also check the commit messages in that range
#   FORBIDDEN_WORDS_BRANCH=name   also check that branch name
#   FORBIDDEN_WORDS_MESSAGE_FILE=path  check only that message, as is
#                                 (commit-msg hook, annotated tags in pre-push)
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

pattern="${FORBIDDEN_WORDS:-}"
if [ -z "$pattern" ]; then
  if [ -n "${REQUIRE_FORBIDDEN_WORDS:-}" ]; then
    echo "[forbidden-words] FORBIDDEN_WORDS is not set and this run requires it." >&2
    exit 1
  fi
  echo "[forbidden-words] WARNING: FORBIDDEN_WORDS is not set, nothing was checked. Export it in your shell profile." >&2
  exit 0
fi

# grep exits 2 on a malformed regex; that must fail, not read as "clean".
status=0
printf '' | grep -iE -- "$pattern" >/dev/null || status=$?
if [ "$status" -gt 1 ]; then
  echo "[forbidden-words] FORBIDDEN_WORDS is not a valid extended regex." >&2
  exit 1
fi

die() {
  echo "[forbidden-words] $1 failed; nothing can be called clean." >&2
  exit 1
}

found=0
# $1 = label, $2 = hits, one per line (empty = none). Prints the count and
# only the hits safe to show: commit ids and paths without the word.
flag() {
  [ -z "$2" ] && return 0
  found=1
  local count safe
  count=$(printf '%s\n' "$2" | wc -l | tr -d ' ')
  safe=$(printf '%s\n' "$2" | grep -viE -- "$pattern" || true)
  echo "[forbidden-words] $1: $count" >&2
  if [ -n "$safe" ]; then printf '%s\n' "$safe" | sed 's/^/  /' >&2; fi
}
# $1 = label, $2 = text to search, one item per line.
report() {
  flag "$1" "$(printf '%s\n' "$2" | grep -iE -- "$pattern" || true)"
}

if [ -n "${FORBIDDEN_WORDS_MESSAGE_FILE:-}" ]; then
  message=$(cat "$FORBIDDEN_WORDS_MESSAGE_FILE")
  report "lines of the message" "$message"
  if [ "$found" -eq 1 ]; then exit 1; fi
  exit 0
fi

# Each git command runs on its own so a failure stops the check instead of
# reading as "no match". --text everywhere: otherwise a binary file, or one a
# .gitattributes entry marks -diff, is skipped silently. Matching is on raw
# bytes, so UTF-16 text and compressed files (PDF, xlsx, docx, zip) are not
# really read; fixtures in those formats need a manual check.
names=$(git ls-files) || die "git ls-files"
report "file names" "$names"

contents=$(git grep --text -i -l -E -e "$pattern" -- .) || {
  [ $? -eq 1 ] || die "git grep"
}
flag "files whose contents match" "$contents"

staged=$(git diff --cached --text -U0 --no-color) || die "git diff --cached"
report "staged additions" "$(printf '%s\n' "$staged" | grep -E '^\+' | grep -vE '^\+\+\+ ' || true)"

# Every commit in the range is visible once pushed, even if a later commit
# removes what it added. Merge commits are diffed against their first parent.
if [ -n "${FORBIDDEN_WORDS_RANGE:-}" ]; then
  range="$FORBIDDEN_WORDS_RANGE"
  messages=$(git log --format='%an %ae %cn %ce %B' "$range") || die "git log $range"
  report "lines of commit messages or authors in $range" "$messages"

  touching=$(git log --diff-merges=first-parent --no-patch --text --regexp-ignore-case -G "$pattern" --format='%h' "$range") \
    || die "git log -G $range"
  flag "commits whose diff adds or removes it in $range" "$touching"

  touched_names=$(git log --diff-merges=first-parent --name-only --format= "$range") || die "git log --name-only $range"
  report "file names in the commits of $range" "$(printf '%s\n' "$touched_names" | sort -u)"
fi
if [ -n "${FORBIDDEN_WORDS_BRANCH:-}" ]; then
  report "branch name" "$FORBIDDEN_WORDS_BRANCH"
fi

if [ "$found" -eq 1 ]; then
  echo "[forbidden-words] Remove the forbidden word from the places above." >&2
  exit 1
fi
echo "[forbidden-words] Clean."
