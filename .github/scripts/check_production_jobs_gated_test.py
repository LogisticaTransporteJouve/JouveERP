#!/usr/bin/env python3
"""Fixture tests for the production approval gate.

Each case asserts BOTH the exit code and a stderr substring, and fixtures are
written to a temp dir rather than to `.github/**` so GitHub never runs them.

Usage (from anywhere): python3 .github/scripts/check_production_jobs_gated_test.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

GATE = Path(__file__).with_name("check-production-jobs-gated.py")
W = ".github/workflows/t.yml"

OK = 0
VIOLATION = 1
BROKEN_MATCHER = 2

CASES: list[tuple[str, int, str, str]] = [
    ("if_always_bypasses_approval", VIOLATION, """
jobs:
  approve:
    environment: production-gate
  deploy:
    needs: approve
    if: always()
    environment: production
""", "only `needs.approve.result == 'success'` is allowed"),

    ("if_success_allowed", OK, """
jobs:
  approve:
    environment: production-gate
  deploy:
    needs: approve
    if: needs.approve.result == 'success'
    environment: production
""", ""),

    ("environment_case_insensitive", VIOLATION, """
jobs:
  approve:
    environment: production-gate
  deploy:
    environment: Production
""", "job `deploy` enters `production` without `approve`"),

    ("environment_expression", VIOLATION, """
jobs:
  approve:
    environment: production-gate
  deploy:
    needs: approve
    environment: ${{ inputs.env }}
  other:
    needs: approve
    environment: production
""", "names its environment dynamically"),

    ("environment_url_expression_allowed", OK, """
jobs:
  approve:
    environment: production-gate
  deploy:
    needs: approve
    environment: production
  preview:
    environment:
      name: vercel-preview
      url: ${{ steps.deploy.outputs.url }}
""", ""),

    ("environment_mapping_name_expression", VIOLATION, """
jobs:
  approve:
    environment: production-gate
  deploy:
    needs: approve
    environment:
      name: ${{ inputs.env }}
      url: https://x
  other:
    needs: approve
    environment: production
""", "names its environment dynamically"),

    ("gated", OK, """
jobs:
  approve:
    environment: production-gate
    steps: []
  deploy:
    needs: approve
    environment: production
""", ""),

    ("gated_list_needs_mapping_env", OK, """
jobs:
  approve:
    environment: production-gate
  deploy:
    needs:
      - build
      - approve
    environment:
      name: production
""", ""),

    ("missing_needs", VIOLATION, """
jobs:
  approve:
    environment: production-gate
  deploy:
    environment: production
""", "job `deploy` enters `production` without `approve`"),

    ("needs_other_job_only", VIOLATION, """
jobs:
  approve:
    environment: production-gate
  build:
    runs-on: ubuntu-latest
  deploy:
    needs: [build]
    environment: production
""", "job `deploy`"),

    ("approve_not_on_gate", VIOLATION, """
jobs:
  approve:
    runs-on: ubuntu-latest
  deploy:
    needs: approve
    environment: production
""", "no `approve` job on `environment: production-gate`"),

    # A comment mentioning `approve` is not a dependency.
    ("needs_in_comment_decoy", VIOLATION, """
jobs:
  approve:
    environment: production-gate
  deploy:
    needs: [build] # approve
    environment: production
""", "job `deploy`"),

    # `production-gate` alone is not `production`, so nothing enters it.
    ("no_production_job", BROKEN_MATCHER, """
jobs:
  approve:
    environment: production-gate
""", "the matcher is broken"),
]


def run_case(name: str, expected: int, body: str, expect_err: str) -> str | None:
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / W
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body.lstrip("\n"), encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(GATE)], cwd=tmp, capture_output=True, text=True
        )
    detail = f"    stdout: {proc.stdout.strip()}\n    stderr: {proc.stderr.strip()}"
    if proc.returncode != expected:
        return f"{name}: expected exit {expected}, got {proc.returncode}\n{detail}"
    if expect_err and expect_err not in proc.stderr:
        return f"{name}: stderr missing {expect_err!r}\n{detail}"
    return None


def main() -> int:
    if not GATE.is_file():
        print(f"error: gate not found at {GATE}", file=sys.stderr)
        return 2
    failures = [msg for case in CASES if (msg := run_case(*case))]
    for msg in failures:
        print(f"FAIL {msg}", file=sys.stderr)
    if failures:
        print(f"\n{len(failures)} of {len(CASES)} cases failed", file=sys.stderr)
        return 1
    print(f"ok: {len(CASES)} gate cases pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
