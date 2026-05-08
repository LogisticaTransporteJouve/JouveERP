#!/usr/bin/env bash
# CI guard: regenerate types and fail if the committed file drifts.
# Requires `supabase start` to be running.
set -euo pipefail

OUTPUT="lib/db/database.types.ts"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

supabase gen types typescript --local --schema public >"$TMP"

if ! diff -q "$OUTPUT" "$TMP" >/dev/null; then
  echo "::error::lib/db/database.types.ts is out of date. Run 'pnpm db:types:generate' and commit." >&2
  diff "$OUTPUT" "$TMP" || true
  exit 1
fi

echo "Types are in sync."
