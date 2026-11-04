#!/usr/bin/env bash
# Restamp migrations with fresh UTC timestamps, preserving their relative order.
#   pnpm db:restamp                 # every migration this branch adds on top of origin/main
#   pnpm db:restamp <substring>...  # migrations whose name contains it; lists them and asks first
# Refuses any migration already on origin/main (merged migrations are never renamed).
set -euo pipefail
cd "$(dirname "$0")/../.."
dir=supabase/migrations
base_ref=main
name_re='^[0-9]{14}_[a-z0-9_]+\.sql$'

case "${1:-}" in -h|--help) sed -n '2,5p' "$0"; exit 0;; -*) echo "unknown flag: $1" >&2; exit 1;; esac

git fetch -q origin "$base_ref"
base=$(git merge-base "origin/$base_ref" HEAD)

if [ $# -eq 0 ]; then
  # All of the branch's migrations, stale or not: restamping only the stale
  # ones would move them past their siblings and change the branch's order.
  echo "migrations this branch adds on top of origin/$base_ref ($(git rev-parse --short "$base")):" >&2
  selected=$({ git diff --no-renames --diff-filter=A --name-only "$base" HEAD -- "$dir"; git ls-files --others --exclude-standard -- "$dir"; } \
    | grep '\.sql$' | sed 's#.*/##' | sort -u || true)
  [ -n "$selected" ] || { echo "this branch adds no migrations" >&2; exit 1; }
  echo "$selected" >&2
else
  selected=$(for q in "$@"; do
    ls "$dir" | grep -F -- "${q##*/}" || { echo "no migration matches '$q'" >&2; exit 1; }
  done | sort -u)
  # A substring can also catch an older migration that must not move.
  echo "$selected" >&2
  read -rp "restamp these $(echo "$selected" | wc -l | tr -d ' ') migration(s)? [y/N] " ok || ok=
  [ "$ok" = y ] || { echo "nothing restamped" >&2; exit 1; }
fi

# Validate everything before renaming anything.
for f in $selected; do
  if ! [[ "$f" =~ $name_re ]]; then
    echo "refusing: '$f' does not match $name_re (YYYYMMDDHHMMSS_<scope>.sql)" >&2; exit 1
  fi
  if git cat-file -e "origin/$base_ref:$dir/$f" 2>/dev/null; then
    echo "refusing: '$f' is already on origin/$base_ref; never rename a merged migration" >&2; exit 1
  fi
done

# The new stamps must sort after every migration on main (CI rejects an older
# one). While main is stamped ahead of the clock they start one second after
# its max, read as a real time: a merged ...096100 (minute 61) counts as
# 10:01:00, so the next stamp is ...100101, never the impossible ...096101
# that CI rejects.
main_max=$(git ls-tree --name-only "origin/$base_ref" "$dir/" | sed 's#.*/##' | grep -E "$name_re" | sort | tail -1 | cut -c1-14)

# Seconds since the epoch of a UTC YYYYMMDDHHMMSS; hours, minutes and seconds
# past their range carry over. GNU date first, then BSD (macOS).
to_epoch() {
  local day
  day=$(date -u -d "${1:0:8}" +%s 2>/dev/null || date -u -j -f '%Y%m%d%H%M%S' "${1:0:8}000000" +%s)
  echo $((day + 10#${1:8:2} * 3600 + 10#${1:10:2} * 60 + 10#${1:12:2}))
}
from_epoch() {
  date -u -d "@$1" +%Y%m%d%H%M%S 2>/dev/null || date -u -r "$1" +%Y%m%d%H%M%S
}

next=$(date -u +%s)
if [ -n "$main_max" ]; then
  after_main=$(($(to_epoch "$main_max") + 1))
  [ "$next" -ge "$after_main" ] || next=$after_main
fi

# Sorted so relative order survives; one second apart keeps stamps unique. UTC,
# as `supabase migration new` writes: a local stamp from a timezone ahead of UTC
# pushes the shared head into the future, and every teammate's next migration
# is then rejected as out of order until the clock catches up.
for f in $selected; do
  name=${f#*_}
  new="$(from_epoch "$next")_$name"
  next=$((next + 1))
  [ "$f" != "$new" ] || continue
  git mv "$dir/$f" "$dir/$new" 2>/dev/null || mv "$dir/$f" "$dir/$new"
  echo "$f -> $new"
done
