#!/usr/bin/env bash
# CI guard: Prettier --check on the files this branch changed, not the whole
# repo. The codebase predates the Prettier config, so a full check would fail
# on hundreds of untouched files; checking only what a PR touches formats the
# repo gradually without a mass-reformat commit.
#
# Usage: FORMAT_BASE_REF=origin/main bash scripts/ci-format-check.sh
set -euo pipefail

BASE_REF="${FORMAT_BASE_REF:-origin/main}"
PATTERN='\.(ts|tsx|js|jsx|mjs|cjs|json|css|ya?ml)$'

cd "$(git rev-parse --show-toplevel)"

if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
  echo "::error::Format check could not resolve base ref '${BASE_REF}'. Refusing to pass without checking." >&2
  exit 1
fi

# The branch diff runs alone first: inside a pipeline a git failure would be
# masked and the check would pass having seen none of the PR's files.
committed=$(git diff -z --name-only --diff-filter=ACMR "${BASE_REF}...HEAD" | tr '\0' '\n')

files=()
while IFS= read -r file; do
  [ -n "$file" ] || continue
  [ -f "$file" ] || continue
  [[ "$file" =~ $PATTERN ]] || continue
  files+=("$file")
done <<<"$committed"

if [ "${#files[@]}" -eq 0 ]; then
  echo "No changed files to format-check."
  exit 0
fi

echo "Checking formatting of ${#files[@]} changed file(s) against ${BASE_REF}:"
printf '  %s\n' "${files[@]}"
echo

if ! pnpm exec prettier --check --no-error-on-unmatched-pattern -- "${files[@]}"; then
  echo
  echo "::error::Changed files are not Prettier-formatted. Run: pnpm exec prettier --write <files> (lint-staged does it on commit)." >&2
  exit 1
fi
