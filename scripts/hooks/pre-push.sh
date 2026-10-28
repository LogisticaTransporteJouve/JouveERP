#!/usr/bin/env bash
# Pre-push: forbidden words in every pushed ref, the new-migration checks and
# regenerated types, then lint + typecheck + tests. Skipped in CI (and with HUSKY=0, handled by
# husky itself).
set -euo pipefail

[ -n "${CI:-}" ] && exit 0

ROOT=$(git rev-parse --show-toplevel)
zero=0000000000000000000000000000000000000000

# git feeds one line per pushed ref (which may not be HEAD):
# <local ref> <local sha> <remote ref> <remote sha>. Each goes out with its
# commits, their messages and authors, and its name.
while read -r local_ref local_sha remote_ref remote_sha; do
  # Deleting a remote branch pushes nothing.
  [ "$local_sha" = "$zero" ] && continue

  if [ "$(git cat-file -t "$local_sha")" = "tag" ]; then
    # An annotated tag carries its own message; git log would only see the
    # commit it points to.
    tag_message=$(mktemp)
    git cat-file tag "$local_sha" > "$tag_message"
    status=0
    FORBIDDEN_WORDS_MESSAGE_FILE="$tag_message" \
      bash "$ROOT/scripts/check-forbidden-words.sh" || status=$?
    rm -f "$tag_message"
    [ "$status" -eq 0 ] || exit "$status"
  fi
  if [ "$remote_sha" != "$zero" ] && git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
    range="$remote_sha..$local_sha"
  elif ref_base="$(git merge-base "$local_sha" origin/main 2>/dev/null)"; then
    range="$ref_base..$local_sha"
  else
    range="$local_sha"
  fi
  FORBIDDEN_WORDS_BRANCH="${remote_ref#refs/heads/}" FORBIDDEN_WORDS_RANGE="$range" \
    bash "$ROOT/scripts/check-forbidden-words.sh"

  # Compare against where the branch forked from main, so main's own
  # migrations merged into the branch are never attributed to it.
  base=$(git merge-base origin/main "$local_sha" 2>/dev/null) || base=""
  if [ -z "$base" ]; then
    echo "pre-push: no merge-base with origin/main for ${local_ref}; skipping the types check (run git fetch)." >&2
    continue
  fi

  changed=$(git diff --name-only "$base" "$local_sha" 2>/dev/null) || continue

  if printf '%s\n' "$changed" | grep -q '^supabase/migrations/' \
    && ! printf '%s\n' "$changed" | grep -qx 'lib/db/database\.types\.ts'; then
    echo "pre-push: ${local_ref} changes supabase/migrations but not lib/db/database.types.ts." >&2
    echo "Regenerate the types and commit them:" >&2
    echo "  pnpm db:types:generate   (needs a running local Supabase)" >&2
    echo "If the migration really does not change the public schema types, push with --no-verify." >&2
    exit 1
  fi

  # check-migrations.sh reads base...HEAD, so it only describes this ref when
  # the ref is what is checked out.
  if printf '%s\n' "$changed" | grep -q '^supabase/migrations/' \
    && [ "$local_sha" = "$(git rev-parse HEAD)" ]; then
    bash "$ROOT/scripts/check-migrations.sh" "$base"
  fi
done

pnpm lint
pnpm typecheck
pnpm test
