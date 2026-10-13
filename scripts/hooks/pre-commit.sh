#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)

# Prettier + ESLint --fix on the staged files (package.json "lint-staged").
npx lint-staged
bash "$ROOT/scripts/check-forbidden-words.sh"

# Optional extra net before the push protection on GitHub.
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --staged --redact --no-banner
fi
