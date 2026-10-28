#!/usr/bin/env bash
# CI guard: regenerate types and fail if the committed file drifts.
# Requires a local stack (see scripts/db-types.sh).
set -euo pipefail

OUTPUT="lib/db/database.types.ts"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
GENERATED="$TMP_DIR/database.types.ts"

bash "$(dirname "$0")/db-types.sh" "$GENERATED" >/dev/null

if ! diff -q "$OUTPUT" "$GENERATED" >/dev/null; then
  echo "::error::lib/db/database.types.ts is out of date. Run 'pnpm db:types:generate' and commit." >&2
  diff "$OUTPUT" "$GENERATED" || true
  exit 1
fi

echo "Types are in sync."
