#!/usr/bin/env bash
# CI guard: regenerate types and fail if the committed file drifts.
# Requires `supabase start` to be running.
set -euo pipefail

OUTPUT="lib/db/database.types.ts"
TMP="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$TMP" "$ERR"' EXIT

# The generator runs postgres-meta from public.ecr.aws, which rate-limits
# shared runners. When that pull is refused, fetch the same image from
# Docker Hub, tag it under the ECR name and try again.
generate() {
  supabase gen types typescript --local --schema public >"$TMP" 2>"$ERR"
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

if ! diff -q "$OUTPUT" "$TMP" >/dev/null; then
  echo "::error::lib/db/database.types.ts is out of date. Run 'pnpm db:types:generate' and commit." >&2
  diff "$OUTPUT" "$TMP" || true
  exit 1
fi

echo "Types are in sync."
