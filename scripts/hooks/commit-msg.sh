#!/usr/bin/env bash
# The commit message is public once pushed, and pre-commit runs before it
# exists, so it gets its own check. It checks what an editor commit stores:
# the text above the `commit -v` scissors line, without comment lines. The
# scissors line is matched by its fixed suffix, because its leading comment
# string can come from core.commentChar=auto or core.commentString. Under
# `auto`, git picks the comment char per message and stripspace would assume
# `#`, so the char is read from the template line that quotes it ("; with ';'
# will be ignored"), a shape that does not depend on git's language. A
# comment-looking line kept by `git commit -m` is caught by pre-push and CI,
# which read the stored message.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
scissors=" ------------------------ >8 ------------------------"

strip=(git stripspace --strip-comments)
if [ "$(git config core.commentChar || true)" = "auto" ]; then
  # The last such line before the scissors: the template follows the user's
  # text, which can have the same shape.
  char=$(awk -v q="'" -v cut="$scissors" '
    length($0) > length(cut) && substr($0, length($0) - length(cut) + 1) == cut { exit }
    substr($0, 2, 1) == " " && index($0, q substr($0, 1, 1) q) { c = substr($0, 1, 1) }
    END { print c }' "$1")
  strip=(git -c core.commentChar="${char:-#}" stripspace --strip-comments)
fi

message=$(mktemp)
trap 'rm -f "$message"' EXIT
awk -v cut="$scissors" '
  length($0) > length(cut) && substr($0, length($0) - length(cut) + 1) == cut { exit }
  { print }' "$1" \
  | "${strip[@]}" > "$message"

FORBIDDEN_WORDS_MESSAGE_FILE="$message" bash "$ROOT/scripts/check-forbidden-words.sh"
