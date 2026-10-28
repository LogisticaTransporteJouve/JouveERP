#!/usr/bin/env bash
# Checks the migrations added since <base>: the file name, a version of its own
# after the latest one in <base> and not in the future, statements the CLI
# applies all-or-nothing, no session-level SET, a revoke for every SECURITY
# DEFINER function, and squawk (.squawk.toml).
#
#   bash scripts/check-migrations.sh <base>
#
# Checks the checkout that holds the current directory, and finds squawk and
# its config in the repo this script belongs to, so it can check any checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQUAWK="$ROOT/node_modules/.bin/squawk"
CONFIG="$ROOT/.squawk.toml"

# The CLI applies migrations in filename byte order, which matches numeric
# order only while every version has 14 digits. The name is limited to
# characters squawk will not read as a glob: it takes each path as a pattern
# and silently skips one that matches nothing. Lowercase snake_case only, as
# every merged migration is named.
NAME_RE='^supabase/migrations/[0-9]{14}_[a-z0-9_]+\.sql$'

base="${1:-}"
# cat-file also rejects an empty base and the all-zero SHA of a new branch.
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "::warning::No usable base ('$base'), skipping the migration checks."
  exit 0
fi
cd "$(git rev-parse --show-toplevel)"

errors=0

# The CLI follows a symlink, so a merged one would let a later change edit an
# applied migration outside supabase/migrations/, where no check looks.
irregular="$(git -c core.quotePath=false ls-files -s -- supabase/migrations/ | awk '$1 != "100644" && $1 != "100755"' | cut -f 2)"
if [ -n "$irregular" ]; then
  echo "::error::Migrations are regular files, not symlinks or submodules:"
  echo "$irregular"
  errors=$((errors + 1))
fi

# Every added file, not only *.sql: the CLI skips a file whose name it does not
# recognise (`.SQL`, no extension) with a warning and exit 0, so it would never
# apply. Unquoted paths, so the errors below show names with accents as typed.
added="$(git -c core.quotePath=false diff --name-only --no-renames --diff-filter=A "$base...HEAD" -- supabase/migrations/)"
if [ -z "$added" ]; then
  echo "No new migrations since $base."
  [ "$errors" -eq 0 ]
  exit
fi

misnamed="$(printf '%s\n' "$added" | grep -Ev "$NAME_RE" || true)"
if [ -n "$misnamed" ]; then
  echo "::error::Migrations are named <14-digit timestamp>_<name>.sql, with only lowercase letters, digits and _ in the name (supabase migration new <name>):"
  echo "$misnamed"
  errors=$((errors + 1))
fi

named="$(printf '%s\n' "$added" | grep -E "$NAME_RE" || true)"
# Two new files with one version fail the deploy on schema_migrations' primary
# key.
duplicated="$(printf '%s\n' "$named" | awk -F/ 'NF { print substr($3, 1, 14) }' | sort | uniq -d)"
if [ -n "$duplicated" ]; then
  echo "::error::New migrations share a version. Give each its own timestamp:"
  echo "$duplicated"
  errors=$((errors + 1))
fi

versions_where() {
  printf '%s\n' "$named" | awk -F/ -v limit="$2" -v op="$1" \
    'NF { v = substr($3, 1, 14) + 0; if ((op == "<=" && v <= limit + 0) || (op == ">" && v > limit + 0)) print }'
}

# A merged name the check above would reject still counts here; only its
# 14-digit prefix matters.
latest="$(git -c core.quotePath=false ls-tree --name-only "$base" -- supabase/migrations/ \
  | sed -nE 's|^supabase/migrations/([0-9]{14})_.*\.sql$|\1|p' | sort | tail -n 1)"
early="$(versions_where '<=' "${latest:-0}")"
if [ -n "$early" ]; then
  echo "::error::New migrations must have a version after the latest one in $base ($latest). Rename with a newer timestamp:"
  echo "$early"
  errors=$((errors + 1))
fi

# A future version ratchets every later migration past it. Versions are UTC
# (`supabase migration new` writes them that way); the day of slack covers one
# typed by hand in a zone ahead of UTC. GNU date first, then BSD (macOS).
max="$(date -u -d '+1 day' +%Y%m%d%H%M%S 2>/dev/null || date -u -v+1d +%Y%m%d%H%M%S 2>/dev/null || true)"
if [ -z "$max" ]; then
  echo "::error::Could not compute the latest allowed version with date."
  exit 1
fi
future="$(versions_where '>' "$max")"
if [ -n "$future" ]; then
  echo "::error::New migrations must not be dated in the future. Rename with the current UTC time (git mv <file> supabase/migrations/\$(date -u +%Y%m%d%H%M%S)_<name>.sql):"
  echo "$future"
  errors=$((errors + 1))
fi

bom="$(printf '\357\273\277')"

# Prints why the migration on stdin would not apply all-or-nothing, or nothing.
# The CLI commits what came before a CREATE/DROP INDEX or REINDEX with
# CONCURRENTLY, VACUUM, CLUSTER or ALTER SYSTEM and runs it alone, so one of
# these is allowed only as the file's single statement (and only the index
# statements: the rest do not belong in a migration). A file with a transaction
# control statement (BEGIN, COMMIT, ROLLBACK, PREPARE TRANSACTION...) runs
# statement by statement; squawk's transaction-nesting rule catches all but
# PREPARE TRANSACTION, and its exemption is rejected below. Squawk alone only
# catches CREATE INDEX CONCURRENTLY. Statements are split on `;` after dropping
# `--` comments and a leading BOM, so a `;` or `--` inside a string literal or
# block comment can mis-split; the index statements are matched anywhere in a
# statement so a split in front of one still counts it.
not_atomic() {
  sed "1s/^$bom//; s/--.*\$//" | awk 'BEGIN { RS = ";" }
    {
      s = toupper($0)
      gsub(/^[ \t\r\n]+|[ \t\r\n]+$/, "", s)
      # Leading block comments, which the CLI also skips.
      while (s ~ /^\/\*/) {
        if (!sub(/^\/\*([^*]|\*+[^*\/])*\*+\//, "", s)) break
        gsub(/^[ \t\r\n]+/, "", s)
      }
      if (s == "") next
      n++
      if (s ~ /^(VACUUM|CLUSTER|ALTER[ \t\r\n]+SYSTEM|PREPARE[ \t\r\n]+TRANSACTION)([ \t\r\n(]|$)/) banned = 1
      # Literals and block comments may mention an index statement. An odd
      # number of quotes means a `;` or `--` cut one off, so the literals stay.
      t = s
      if (gsub(/\047/, "&", t) % 2) gsub(/\/\*([^*]|\*+[^*\/])*\*+\//, " ", t)
      else gsub(/\047[^\047]*\047|\/\*([^*]|\*+[^*\/])*\*+\//, " ", t)
      if (t ~ /(^|[^A-Z0-9_])((CREATE([ \t\r\n]+UNIQUE)?|DROP)[ \t\r\n]+INDEX|REINDEX)[ \t\r\n(].*CONCURRENTLY/) concurrent = 1
    }
    END {
      if (banned) print "VACUUM, CLUSTER, ALTER SYSTEM and PREPARE TRANSACTION do not belong in a migration"
      else if (concurrent && n > 1) print "a CONCURRENTLY index statement is not alone in the file"
    }'
}

# bash 3.2 (macOS) has no mapfile, and with `set -u` it fails on an empty array.
files=()
cr=$'\r'
while IFS= read -r file; do
  [ -n "$file" ] || continue
  if [ ! -f "$file" ]; then
    echo "::error::$file is committed but missing from the working tree."
    errors=$((errors + 1))
    continue
  fi
  files+=("$file")
  # This first line makes the CLI run the file statement by statement with no
  # transaction, which squawk cannot see. Only a short line can match.
  first=""
  IFS= read -r first <"$file" || true
  if [ "${#first}" -le 40 ]; then
    first="${first#"$bom"}"
    if [ "${first%"$cr"}" = "-- pg-delta: transaction=false" ]; then
      echo "::error::$file: migrations run in one transaction; remove the '-- pg-delta: transaction=false' first line."
      errors=$((errors + 1))
    fi
  fi
  reason="$(not_atomic <"$file")"
  if [ -n "$reason" ]; then
    echo "::error::$file would not apply all-or-nothing: $reason."
    errors=$((errors + 1))
  fi
  # An exemption names its rule and sits on the statement it covers.
  if grep -Eq -- 'squawk-ignore-file' "$file"; then
    echo "::error::$file: exempt single statements with '-- squawk-ignore <rule>', not the whole file."
    errors=$((errors + 1))
  fi
  if grep -Eq -- 'squawk-ignore[[:space:]].*transaction-nesting' "$file"; then
    echo "::error::$file: a transaction control statement makes the CLI apply the file without a transaction; split it into separate migrations."
    errors=$((errors + 1))
  fi
done <<EOF
$named
EOF

if [ ! -x "$SQUAWK" ]; then
  echo "::error::squawk not found at $SQUAWK (run pnpm install)."
  exit 1
fi
if [ "${#files[@]}" -gt 0 ]; then
  node "$ROOT/.github/scripts/check-migration-set-local.mjs" "${files[@]}" || errors=$((errors + 1))
  node "$ROOT/.github/scripts/check-migration-definer-revoke.mjs" "${files[@]}" || errors=$((errors + 1))
fi
if [ "${#files[@]}" -gt 0 ] && ! "$SQUAWK" -c "$CONFIG" "${files[@]}"; then
  echo "::error::squawk rejected a new migration: fix the rules it lists above. Most migrations start with the header in scripts/fixtures/squawk/pass-migration-header.sql."
  errors=$((errors + 1))
fi

[ "$errors" -eq 0 ]
