"""The part of YAML the stdlib-only workflow gates have to model themselves.

Imported by the stdlib-only workflow gates in this directory, which read
workflow files line by line rather than through PyYAML.
"""

from __future__ import annotations

import re

# `key: |` / `key: >` opens a block scalar; everything indented under it is text.
# `uses:` is exempt — a folded `uses: >-` value IS the action reference and still
# has to be read. The key may carry a leading `- `, and the chomp/indent indicators
# come in either order (`|2-` and `|-2` are both legal). A commented-out line
# (`#x: |`) is not a header, or it would hide the real lines under it.
BLOCK_SCALAR = re.compile(
    r"^((\s*)(?:-\s+)?)(?!uses:|#)[^\s:]+:\s*[|>](?:[-+]?\d*|\d*[-+]?)\s*(?:\#.*)?$"
)


def structural_lines(lines: list[str]):
    """Yield (index, line) for lines that are YAML structure, skipping block scalars.

    A block scalar's body is an opaque string however much it looks like structure,
    so a `run: |` body mentioning `uses: actions/checkout` is a shell command, not a
    step.
    """
    block_indent: int | None = None
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        cur = len(line) - len(line.lstrip())
        if block_indent is not None:
            if cur > block_indent:
                continue
            block_indent = None
        b = BLOCK_SCALAR.match(line)
        if b is not None:
            block_indent = len(b.group(1))
            yield i, line
            continue
        yield i, line
