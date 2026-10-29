#!/usr/bin/env python3
"""Every actions/checkout step must state `persist-credentials` explicitly.

The upstream default is `true` as of checkout v7, and GitHub offers no repo- or
org-level way to invert it. A local composite wrapper cannot do it either:
`uses: ./...` resolves only once the repo is in the workspace, so it can never
perform the initial checkout.

Stdlib only — no PyYAML: it runs in CI before dependencies are installed, so a
PR that touches only workflow files is still policed.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from workflow_yaml import structural_lines

WORKFLOWS = Path(".github/workflows")
COMPOSITES = Path(".github/actions")
USES_CHECKOUT = re.compile(r"^((\s*)(?:-\s+)?)uses:\s*actions/checkout@")
LOOSE_CHECKOUT = re.compile(r"uses:\s*[\"\']?actions/checkout")
# One definition of the key and of an accepted value, shared by SETTING and FLOW_WITH.
_KEY = r"""["']?persist-credentials["']?"""
_VALUE = r"""["']?(?:true|false)["']?"""

# Accepts a trailing comment and quoted scalars. The gate's own remediation text
# tells authors to explain their choice, and an inline comment on this very line
# is the natural way to do it — rejecting that would fail the build a second time
# on a line that is correct YAML. A `${{ }}` expression still fails: its value
# cannot be checked statically, so it must not be waved through.
SETTING = re.compile(rf"^\s*{_KEY}:\s*{_VALUE}\s*(?:\#.*)?$", re.IGNORECASE)

# `with: {…}` on one line, possibly spanning several. Matched structurally rather
# than by regex: a character-class guard has to decide whether a comma is a mapping
# separator or part of a quoted value, and gets it wrong in one direction or the
# other. `with: {ssh-key: "persist-credentials: false"}` must NOT pass, and
# `with: {token: "${{ secrets.T }}", persist-credentials: false}` must.
FLOW_WITH_OPEN = re.compile(r"^(\s*)with:\s*\{")
VALUE_OK = re.compile(rf"^{_VALUE}$", re.IGNORECASE)


def _split_top_level(text: str, sep: str) -> list[str]:
    """Split on `sep`, ignoring separators inside quotes or nested brackets.

    Quote handling has to follow YAML's two forms or a value can hide a separator
    and the text after it gets read as a real key:

    * double-quoted uses backslash escapes, so `"a\\", persist-credentials: false"`
      is ONE value containing a comma, not two entries;
    * single-quoted escapes a quote by doubling it (`''`), with no backslash.
    """
    parts, buf, quote, depth = [], [], "", 0
    i = 0
    while i < len(text):
        ch = text[i]
        if quote == '"':
            buf.append(ch)
            if ch == "\\" and i + 1 < len(text):      # escape: consume the next char
                buf.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                quote = ""
        elif quote == "'":
            buf.append(ch)
            if ch == "'":
                if i + 1 < len(text) and text[i + 1] == "'":   # '' is a literal quote
                    buf.append(text[i + 1])
                    i += 2
                    continue
                quote = ""
        elif ch in "\"'":
            quote = ch
            buf.append(ch)
        elif ch in "{[":
            depth += 1
            buf.append(ch)
        elif ch in "}]":
            depth -= 1
            buf.append(ch)
        elif ch == sep and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
        i += 1
    parts.append("".join(buf))
    return parts


def flow_with_sets_it(lines: list[str], start: int, key_col: int) -> bool:
    """True when a flow-style `with: {...}` at `key_col` sets persist-credentials."""
    m = FLOW_WITH_OPEN.match(lines[start])
    if m is None or len(m.group(1)) != key_col:
        return False
    # A flow mapping may span lines; gather until the braces balance.
    text, depth = "", 0
    for line in lines[start:]:
        text += line
        depth += line.count("{") - line.count("}")
        if depth <= 0:
            break
    inner = text[text.index("{") + 1 : text.rindex("}")] if "}" in text else text[text.index("{") + 1 :]
    for entry in _split_top_level(inner, ","):
        head, sep, tail = entry.partition(":")
        if not sep:
            continue
        if head.strip().strip("\"'").lower() == "persist-credentials":
            return bool(VALUE_OK.match(tail.strip()))
    return False


LIST_ITEM = re.compile(r"^(\s*)-\s+\S")
WITH_KEY = re.compile(r"^(\s*)with:\s*(?:\#.*)?$")
# A `uses:` value may sit on a continuation line, which puts `actions/checkout`
# on a line of its own. Matching only the stripped start keeps `- name: Every
# actions/checkout sets persist-credentials` from tripping it.
CONTINUATION_CHECKOUT = re.compile(r"^[\"']?actions/checkout[@\"']")


def step_lines(lines: list[str], start: int, indent: int):
    """Yield lines belonging to the checkout step whose `uses:` sits at `start`.

    The step ends at the first non-blank, non-comment line that either dedents
    below the `uses:` line or opens a new list item at or above the step's own
    level.

    `indent` is measured BEFORE the optional dash, so for `- uses: checkout@v4`
    the next sibling `- name:` sits at exactly that column — the list test is
    therefore <=. The dedent test stays strictly-less-than, because `with:`
    legitimately sits at the same indent as `uses:`.
    """
    for i in range(start + 1, len(lines)):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        cur = len(line) - len(line.lstrip())
        if cur < indent:
            return
        m = LIST_ITEM.match(line)
        if m is not None and len(m.group(1)) <= indent:
            return
        yield i, line


def has_setting_under_with(
    lines: list[str], start: int, list_indent: int, key_col: int
) -> bool:
    """True when the step sets `persist-credentials` as a direct child of its `with:`.

    `with:` is required at `key_col` — the column of the step's own keys, where
    `uses:` sits. That single constraint is what makes the check sound, and it is
    load-bearing in a way that is easy to relax by accident:

    * `env:` is a free string map, so `env: {persist-credentials: false}` is valid
      YAML and a valid workflow. The runner accepts it, checkout never receives the
      input, and the token stays persisted for every later step.
    * A block scalar's body is an opaque string. `env: {NOTE: "with:\n  persist-
      credentials: false"}` looks like structure and is not.

    Both live at a column deeper than the step's own keys — a block-scalar body is
    always indented past its key, and an `env:` child past `env:` — so pinning the
    column rejects them without needing to model block scalars here at all.

    The child level is learned from the first child rather than assumed to be two
    spaces: 3- and 4-space YAML are equally legal. A grandchild does not count.

    Known limitation: a `with:` written ABOVE `uses:` in the same step is not seen,
    because the walk starts at `uses:`. YAML mappings are unordered so that is legal,
    but it fails closed — the step is reported as unconfigured — and no workflow here
    writes it that way.
    """
    with_col: int | None = None
    child_indent: int | None = None
    for i, line in step_lines(lines, start, list_indent):
        cur = len(line) - len(line.lstrip())
        if flow_with_sets_it(lines, i, key_col):
            return True
        w = WITH_KEY.match(line)
        if w is not None and len(w.group(1)) == key_col:
            with_col, child_indent = key_col, None
            continue
        if with_col is None:
            continue
        if cur <= with_col:
            with_col = child_indent = None
            continue
        if child_indent is None:
            child_indent = cur
        if cur == child_indent and SETTING.match(line):
            return True
    return False


def main() -> int:
    if not WORKFLOWS.is_dir():
        print(f"error: {WORKFLOWS} not found — run from the repo root", file=sys.stderr)
        return 2

    violations: list[str] = []
    checked = 0

    targets = sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml"))
    # A composite cannot perform the INITIAL checkout, but it can check out a
    # different repo — which would take the `true` default unpoliced.
    targets += sorted(set(COMPOSITES.rglob("action.yml")) | set(COMPOSITES.rglob("action.yaml")))

    for path in targets:
        lines = path.read_text(encoding="utf-8", errors="replace").split("\n")
        for idx, line in structural_lines(lines):
            m = USES_CHECKOUT.match(line)
            if m is None:
                # Quoted (`uses: "actions/checkout@v4"`) and flow-style
                # (`{uses: actions/checkout@v4}`) are valid Actions YAML that the
                # matcher misses. Silently skipping them is the one failure this
                # gate must never have, so an unrecognised form is a violation.
                stripped = line.strip()
                if not stripped.startswith("#") and (
                    LOOSE_CHECKOUT.search(line)
                    or CONTINUATION_CHECKOUT.match(stripped)
                ):
                    checked += 1
                    violations.append(f"{path}:{idx + 1} (unrecognised checkout form)")
                continue
            checked += 1
            key_col, list_indent = len(m.group(1)), len(m.group(2))
            if not has_setting_under_with(lines, idx, list_indent, key_col):
                violations.append(f"{path}:{idx + 1}")

    if checked == 0:
        print("error: no actions/checkout steps found — the matcher is broken", file=sys.stderr)
        return 2

    if violations:
        print("actions/checkout steps missing an explicit `persist-credentials`:\n", file=sys.stderr)
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        print(
            "\nAdd `persist-credentials: false` under `with:`. Use `true` only when a later\n"
            "step in the SAME job runs `git push` or `git fetch` against the remote — this\n"
            "repo is private, so an unauthenticated fetch fails — and say which step in a\n"
            "comment above the checkout.",
            file=sys.stderr,
        )
        return 1

    print(f"ok: all {checked} actions/checkout steps set persist-credentials explicitly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
