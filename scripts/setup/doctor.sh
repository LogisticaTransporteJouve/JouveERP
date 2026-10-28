#!/usr/bin/env bash
# Checks the local prerequisites for `pnpm dev:up` (pnpm preflight).
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
failed=0

ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; failed=1; }
warn() { printf '  warn  %s\n' "$1"; }

want_node=$(tr -d 'v[:space:]' < .nvmrc)
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" = "${want_node%%.*}" ]; then ok "Node $(node -v)"; else bad "Node ${want_node}" "Install Node ${want_node} (.nvmrc)."; fi

if command -v pnpm >/dev/null 2>&1; then ok "pnpm $(pnpm -v)"; else bad "pnpm" "corepack enable"; fi

if docker info >/dev/null 2>&1; then ok "Docker"; else bad "Docker" "Local Supabase runs in Docker: start Docker Desktop."; fi

if [ -d node_modules ]; then ok "Dependencies installed"; else bad "Dependencies" "pnpm install"; fi

# CI installs the version pinned in scripts/supabase-cli-version; a different
# local CLI can generate different types or fail on storage migrations.
want_cli=$(sed 's/^supabase@//' scripts/supabase-cli-version)
if have_cli=$(supabase --version 2>/dev/null); then
  if [ "$have_cli" = "$want_cli" ]; then ok "Supabase CLI $have_cli"; else warn "Supabase CLI $have_cli, CI uses $want_cli (scripts/supabase-cli-version)"; fi
else
  bad "Supabase CLI" "Install $want_cli: https://supabase.com/docs/guides/local-development/cli/getting-started"
fi

if [ -f .env.local ]; then ok ".env.local"; else warn ".env.local is missing: cp .env.local.example .env.local and fill it from 'supabase status'"; fi

exit "$failed"
