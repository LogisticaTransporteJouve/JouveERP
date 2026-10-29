#!/usr/bin/env python3
"""Fixture tests for the checkout-credentials gate.

The gate is a hand-rolled regex reader over workflow YAML, and adversarial review
has broken it five times: it accepted a sibling step's setting as evidence; it
dropped unrecognised `uses:` forms from the scan entirely; it rejected a trailing
comment on a correct line; it accepted any `persist-credentials:` anywhere in the
step, including inside a block scalar or an `env:` map; and its flow-mapping
matcher accepted a quoted string VALUE that merely contained the text. Every one
was found by hand. This suite is what stops the sixth.

Fourteen of these cases fail against the gate as it first shipped — seven by
returning 0, i.e. passing a checkout that takes the persisting default. Those
seven are the red tests, and they are why this file earns its place rather than
restating the gate's own logic.

Each case asserts BOTH the exit code and a stderr substring. Exit code alone is
not enough: a fixture that silently fails to land yields exit 2, which is exactly
what the `no_checkouts` tripwire expects, and a violation reported against the
WRONG file still exits 1.

Stdlib only, and it writes fixtures to a temp dir rather than to `.github/**`: a
fixture is a workflow-shaped file, and anything the repo root's
`.github/workflows/` can see, GitHub tries to run.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

GATE = Path(__file__).with_name("check-checkout-persist-credentials.py")

OK = 0
VIOLATION = 1
BROKEN_MATCHER = 2

W = ".github/workflows/t.yml"

# name, expected exit, {relative path: content}, expected stderr substring
CASES: list[tuple[str, int, dict[str, str], str]] = [
    ("happy", OK, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
"""}, ""),

    ("missing", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
"""}, "t.yml:4"),

    # Red for the `<` vs `<=` step-boundary bug: the walker ran past the first
    # step and accepted the second step's setting.
    ("adjacent_checkouts", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
"""}, "t.yml:4"),

    # Same bug via a shell heredoc — no second checkout at all.
    ("heredoc_decoy", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
      - name: write a config
        run: |
          cat > cfg.yml <<EOF
          persist-credentials: false
          EOF
"""}, "t.yml:4"),

    # A block scalar's body is an opaque string, not an input.
    ("block_scalar_decoy", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          ssh-key: |
            -----BEGIN KEY-----
            persist-credentials: false
            -----END KEY-----
"""}, "t.yml:4"),

    # The nastier form: a fake `with:` INSIDE the block scalar, which used to
    # re-arm the scope at a deeper indent.
    ("block_scalar_fake_with", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          ssh-key: |
            with:
              persist-credentials: false
"""}, "t.yml:4"),

    # Same shape under `env:`, where no real `with:` exists at all.
    ("env_block_scalar_fake_with", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        env:
          NOTE: |
            with:
              persist-credentials: false
"""}, "t.yml:4"),

    # `env:` is a free string map the runner accepts; checkout never sees it.
    ("env_sibling_decoy", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        env:
          persist-credentials: false
"""}, "t.yml:4"),

    ("flow_style_with", OK, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with: {fetch-depth: 0, persist-credentials: false}
"""}, ""),

    # A quoted string VALUE that merely contains the text is not an input.
    ("flow_string_value_decoy", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with: {ssh-key: "persist-credentials: false"}
"""}, "t.yml:4"),

    # 2-space indent is a house style, not a correctness rule.
    ("four_space_indent", OK, {W: """
jobs:
    a:
        steps:
            - uses: actions/checkout@v4
              with:
                  persist-credentials: false
"""}, ""),

    ("with_trailing_comment", OK, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:  # checkout inputs
          persist-credentials: false
"""}, ""),

    ("trailing_comment", OK, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false  # deploy only, no remote access
"""}, ""),

    ("quoted_value", OK, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: "false"
"""}, ""),

    # An expression cannot be checked statically, so it must not pass.
    ("expression_value", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: ${{ inputs.persist }}
"""}, "t.yml:4"),

    # An unrecognised form must fail loudly rather than drop out of the scan.
    ("quoted_uses", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: "actions/checkout@v4"
"""}, "unrecognised checkout form"),

    ("flow_style_uses", VIOLATION, {W: """
jobs:
  a:
    steps:
      - {uses: actions/checkout@v4}
"""}, "unrecognised checkout form"),

    # A `uses:` value on a continuation line puts `actions/checkout` on its own.
    ("continuation_uses", VIOLATION, {W: """
jobs:
  a:
    steps:
      - name: Checkout
        uses: >-
          actions/checkout@v4
"""}, "unrecognised checkout form"),

    # A composite cannot do the initial checkout but can check out another repo,
    # and may be nested more than one level deep.
    ("nested_composite", VIOLATION, {
        ".github/workflows/ok.yml": """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
""",
        ".github/actions/a/b/action.yml": """
runs:
  using: composite
  steps:
    - uses: actions/checkout@v4
      with:
        repository: other/repo
""",
    }, "actions/a/b/action.yml:4"),

    ("multi_job", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
  b:
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
"""}, "t.yml:9"),

    # `.yaml` is as valid an extension as `.yml`.
    ("yaml_extension", VIOLATION, {".github/workflows/t.yaml": """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
"""}, "t.yaml:4"),

    ("crlf", VIOLATION, {W: (
        "jobs:\r\n  a:\r\n    steps:\r\n"
        "      - uses: actions/checkout@v4\r\n        with:\r\n          fetch-depth: 0\r\n"
    )}, "t.yml:4"),

    # An undecodable byte must not abort the scan before a later-sorting file's
    # violation is reached.
    ("non_utf8_earlier_file", VIOLATION, {
        ".github/workflows/aaa.yml": "# \udcff bad byte\njobs:\n  a:\n    steps:\n      - run: echo hi\n",
        ".github/workflows/zzz.yml": """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
""",
    }, "zzz.yml:4"),

    # A quoted value on an earlier key — the comma is inside quotes, so a
    # character-class guard cannot reach the real key. Scanned structurally.
    ("flow_quoted_earlier_key", OK, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with: {token: "${{ secrets.T }}", persist-credentials: false}
"""}, ""),

    # A flow `with:` must also sit at the step's own key column.
    ("flow_wrong_column_decoy", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        env:
          n: 1
          with: {persist-credentials: false}
"""}, "t.yml:4"),

    # A backslash-escaped quote keeps the string open, so the comma after it is
    # part of the value and everything following is still inside that string.
    ("flow_escaped_quote_decoy", VIOLATION, {W: r"""
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with: {ssh-key: "a\", persist-credentials: false"}
"""}, "t.yml:4"),

    # Single-quoted YAML escapes a quote by doubling it, not with a backslash.
    ("flow_doubled_single_quote_decoy", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with: {ssh-key: 'a'', persist-credentials: false'}
"""}, "t.yml:4"),

    ("flow_multiline", OK, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with: {
          fetch-depth: 0,
          persist-credentials: false,
        }
"""}, ""),

    # The commonest real shape in this repo, and it had no OK fixture.
    ("name_uses_with", OK, {W: """
jobs:
  a:
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          persist-credentials: false
"""}, ""),

    # Only a DIRECT child of `with:` counts.
    ("grandchild_decoy", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          nested:
            persist-credentials: false
"""}, "t.yml:4"),

    # `with:` must sit at the step's own key column, not merely somewhere inside it.
    ("with_under_env_decoy", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
        env:
          A: 1
          with:
            persist-credentials: false
"""}, "t.yml:4"),

    # An env var may legally be named `uses`.
    ("env_named_uses_decoy", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        env:
          uses: |
            with:
              persist-credentials: false
"""}, "t.yml:4"),

    # Anchors, and indent-then-chomp indicators, are legal block-scalar syntax.
    ("block_anchor_decoy", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        env:
          NOTE: &n |
            with:
              persist-credentials: false
"""}, "t.yml:4"),

    ("block_indent_indicator_decoy", VIOLATION, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        env:
          NOTE: |2-
            with:
              persist-credentials: false
"""}, "t.yml:4"),

    # A dash-form `- run: |` is the commonest block scalar in workflow YAML.
    ("dash_run_block_decoy", OK, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - run: |
          grep "uses: actions/checkout" x
"""}, ""),

    # A `run:` body mentioning the literal string is a shell command, not a step.
    # A repo policing its own workflows writes exactly this grep.
    ("run_block_uses_decoy", OK, {W: """
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: audit
        run: |
          grep -rn "uses: actions/checkout" .github/workflows/
"""}, ""),

    # The tripwire against a silently-broken matcher.
    ("no_checkouts", BROKEN_MATCHER, {W: """
jobs:
  a:
    steps:
      - run: echo hi
"""}, "the matcher is broken"),
]


def run_case(name: str, expected: int, files: dict[str, str], expect_err: str) -> str | None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for rel, body in files.items():
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body.lstrip("\n").encode("utf-8", errors="surrogateescape"))
        proc = subprocess.run(
            [sys.executable, str(GATE)], cwd=root, capture_output=True, text=True
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
    failures = [
        msg for name, exp, files, err in CASES if (msg := run_case(name, exp, files, err))
    ]
    for msg in failures:
        print(f"FAIL {msg}", file=sys.stderr)
    if failures:
        print(f"\n{len(failures)} of {len(CASES)} cases failed", file=sys.stderr)
        return 1
    print(f"ok: {len(CASES)} gate cases pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
