#!/usr/bin/env bash
# Regenerate TypeScript types from the local Supabase Postgres schema.
# Requires a local stack (`supabase start`, or at least `supabase db start`).
# Usage: scripts/db-types.sh [output]   (default lib/db/database.types.ts)
set -euo pipefail

OUTPUT="${1:-lib/db/database.types.ts}"
SUPABASE="${SUPABASE_BIN:-supabase}"
# A telemetry call that fails writes its error into the generated output.
export SUPABASE_TELEMETRY_DISABLED="${SUPABASE_TELEMETRY_DISABLED:-1}"
TMP="$(mktemp "$OUTPUT.XXXXXX")"
ERR="$(mktemp)"
trap 'rm -f "$TMP" "$ERR"' EXIT

# The generator runs postgres-meta from public.ecr.aws, which rate-limits
# shared runners. When that pull is refused, fetch the same image from
# Docker Hub, tag it under the ECR name and try again.
generate() {
  "$SUPABASE" gen types typescript --local --schema public >"$TMP" 2>"$ERR"
}

if ! generate; then
  cat "$ERR" >&2
  image="$(grep -oE "public\.ecr\.aws/supabase/[A-Za-z0-9._-]+:[A-Za-z0-9._-]+" "$ERR" | head -n1 || true)"
  if [ -z "$image" ]; then
    exit 1
  fi
  mirror="${image#public.ecr.aws/}"
  echo "Pulling ${mirror} from Docker Hub instead of ECR." >&2
  docker pull "$mirror"
  docker tag "$mirror" "$image"
  if ! generate; then
    cat "$ERR" >&2
    exit 1
  fi
fi

# Written to a temp file and moved, so a failed run never truncates the
# committed types.
mv "$TMP" "$OUTPUT"
echo "Generated $OUTPUT"
