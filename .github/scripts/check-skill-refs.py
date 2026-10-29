#!/usr/bin/env python3
"""Every repo path a skill names in backticks exists.

Skills tell agents where to read and what to run, so a renamed file leaves a
skill pointing at nothing, and nothing else notices. A backticked token in
.agents/skills/**/*.md is checked when its first segment is a tracked
top-level directory, `_shared/` (read as .agents/skills/_shared/), or
`.claude/skills/` (read as .agents/skills/), or, inside a skill directory, an
existing entry next to the file (`references/x.md`). Placeholders (`<scope>`,
`*`, `{a,b}`, `...`, `…`) are skipped, and a gitignored path such as a
generated `.env.local` counts as existing. Not caught: root-level files, bare
file names, paths inside a token with spaces, and a path whose first segment
(top-level or next to the file) no longer exists at all, because it is no
longer recognised as a path.

Paths under docs/ and infra/ are not checked: a PR that touches only those
skips the ci job, so deleting one would turn a later, unrelated PR red.

Stdlib only, like check-node-version.py: it runs before dependencies are
installed.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

SKILLS = Path(".agents/skills")
TOKEN = re.compile(r"`([^`\s]+)`")
SUFFIX = re.compile(r"(:\d[\d,-]*|#.*)$")
PLACEHOLDER = re.compile(r"[<>{}*…]|\.\.\.")
UNCHECKED = {"docs", "infra"}


def git(*args: str, stdin: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], input=stdin, capture_output=True, text=True)


def main() -> int:
    files = sorted(SKILLS.rglob("*.md"))
    if not files:
        print(f"No markdown under {SKILLS}; run from the repo root.", file=sys.stderr)
        return 2
    tracked = set(git("ls-files").stdout.splitlines())
    if not tracked:
        print("git ls-files listed nothing; run from a git checkout.", file=sys.stderr)
        return 2
    known = tracked | {str(p) for f in tracked for p in Path(f).parents}
    tops = {f.split("/", 1)[0] for f in tracked if "/" in f} - UNCHECKED
    misses = []
    for f in files:
        for n, line in enumerate(f.read_text().splitlines(), 1):
            for token in TOKEN.findall(line):
                path = SUFFIX.sub("", token).rstrip("/")
                if PLACEHOLDER.search(path):
                    continue
                if path.startswith("_shared/"):
                    path = f"{SKILLS}/{path}"
                path = re.sub(r"^\.claude/skills/", f"{SKILLS}/", path)
                first = path.split("/", 1)[0]
                if f.parent != SKILLS and first not in ("", ".", "..") and str(f.parent / first) in known:
                    # relative to the skill file, e.g. references/x.md
                    path = str(f.parent / path)
                elif first not in tops:
                    continue
                if path not in known:
                    misses.append((f, n, token, path))
    ignored = set(git("check-ignore", "--no-index", "--stdin", stdin="\n".join(m[3] for m in misses)).stdout.splitlines())
    misses = [m for m in misses if m[3] not in ignored]
    for f, n, token, _ in misses:
        print(f"::error file={f},line={n}::`{token}` does not exist; write a path to be created as <placeholder> or prose")
    if misses:
        return 1
    print(f"ok: every backticked repo path in {len(files)} skill files exists")
    return 0


if __name__ == "__main__":
    sys.exit(main())
