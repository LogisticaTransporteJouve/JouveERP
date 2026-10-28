#!/usr/bin/env python3
"""No run script interpolates input.

A `run:` script never contains a `${{ }}` that reads `github.event`,
`github.head_ref` or `inputs`. Actions pastes the value into the script before
the shell parses it, so a crafted branch name, title or input runs as code.
Pass it through the step's `env:` and use "$VAR". Action pins are not checked
here: GitHub's Actions policy can require a full-length commit SHA.

Covers .github/workflows/ and the composite actions in .github/actions/. It
reads lines, not YAML: a quoted or flow-style `run` key, aliases and values
that only reach a script indirectly (`env.X`, `toJSON(github)`) are left to
review.
Stdlib only, like check-checkout-persist-credentials.py.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from workflow_yaml import structural_lines

RUN = re.compile(r"^\s*(?:-\s+)?run:\s*(.*)$")
UNTRUSTED = re.compile(
    r"\$\{\{(?:(?!\}\}).)*?(?<![\w.-])(?:github(?:\.|\[\s*['\"])(?:event|head_ref)\b|inputs\b)",
    re.I | re.S,
)
MAPPING_KEY = re.compile(r"^\s*[\w-]+:(\s|$)")


def comment_start(line: str) -> int:
    """Where a YAML comment begins on this line: a `#` outside quotes, at the start or after a space."""
    quote = ""
    escaped = False
    for i, ch in enumerate(line):
        if quote:
            if escaped:
                escaped = False
            elif quote == '"' and ch == "\\":
                escaped = True
            elif ch == quote:
                quote = ""
        elif ch in "'\"":
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1].isspace()):
            return i
    return len(line)


def check(text: str) -> tuple[list[tuple[int, str]], int]:
    """The violations in one workflow file as (line, message), and its `run:` count."""
    lines = text.splitlines()
    structural = list(structural_lines(lines))
    found: list[tuple[int, str]] = []
    runs = 0
    for k, (i, line) in enumerate(structural):
        if m := RUN.match(line):
            runs += 1
            # The script is everything indented past the `run` key, so a value
            # continued on the next lines is read too.
            key = len(line) - len(line.lstrip(" -"))
            end = next(
                (j for j, t in structural[k + 1 :] if len(t) - len(t.lstrip()) <= key and not t.lstrip().startswith("#")),
                len(lines),
            )
            inline = m.group(1)[: comment_start(m.group(1))]
            # An empty `run:` over a `key:` line is a mapping (`defaults.run`, a job named
            # `run`), not a script: a plain script line cannot contain ": ".
            first = next((t for t in lines[i + 1 : end] if t.strip() and not t.lstrip().startswith("#")), "")
            if not inline.strip() and MAPPING_KEY.match(first):
                continue
            # A comment no deeper than the key is YAML, not script: blank it, keeping line numbers.
            rest = ["" if len(t) - len(t.lstrip()) <= key and t.lstrip().startswith("#") else t for t in lines[i + 1 : end]]
            body = "\n".join([inline, *rest])
            for x in UNTRUSTED.finditer(body):
                line_no = i + 1 + body[: x.start()].count("\n")
                found.append((line_no, 'move the ${{ }} expression into the step\'s env: and use "$VAR" in run:'))
    return found, runs


def main() -> int:
    files = sorted([*Path(".github/workflows").glob("*.y*ml"), *Path(".github/actions").rglob("action.y*ml")])
    total = 0
    failed = False
    for f in files:
        found, runs = check(f.read_text(encoding="utf-8"))
        total += runs
        for line, msg in found:
            print(f"::error file={f},line={line}::{msg}")
            failed = True
    if total == 0:
        print("No `run:` lines found; run from the repo root.", file=sys.stderr)
        return 2
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
