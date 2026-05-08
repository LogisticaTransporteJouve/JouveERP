#!/usr/bin/env bash
# Regenerate TypeScript types from the local Supabase Postgres schema.
# Requires `supabase start` to be running.
set -euo pipefail

OUTPUT="lib/db/database.types.ts"

supabase gen types typescript --local --schema public >"$OUTPUT"

echo "Generated $OUTPUT"
