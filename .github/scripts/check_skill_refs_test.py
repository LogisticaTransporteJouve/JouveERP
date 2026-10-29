#!/usr/bin/env python3
"""Fixture tests for the skill path-reference gate.

Each case builds a small repo, tracks it with git (the gate resolves paths
against `git ls-files`), and asserts the exit code and that stdout names
every expected path. Stdlib only.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

GATE = Path(__file__).with_name("check-skill-refs.py")

BASE = {
    ".gitignore": "*.local\n",
    "packages/x/real.ts": "",
    ".agents/skills/_shared/real.md": "",
    ".agents/skills/bar/SKILL.md": "",
    "docs/real.md": "",
    "infra/real.tf": "",
    ".agents/skills/a/references/real.md": "",
}
PASSING = """\
`packages/x/real.ts:12` `packages/x/real.ts#L3` `packages/x/` `packages/x/real.ts:4-9`
`_shared/real.md` `.claude/skills/bar/SKILL.md` `.agents/skills/bar/`
`packages/<scope>/x.ts` `packages/x/*.ts` `packages/{a,b}/x.ts` `packages/.../x.ts` `packages/…/x.ts`
`origin/staging` `/loop` `2>/dev/null` `packages/x/.env.local` `docs/runbooks/missing.md`
`infra/missing.tf` `references/real.md`
"""

CASES: list[tuple[str, int, dict[str, str], tuple[str, ...]]] = [
    ("passing refs", 0, {".agents/skills/a/SKILL.md": PASSING}, ()),
    ("missing repo path", 1, {".agents/skills/a/SKILL.md": "see `packages/x/missing.ts:3`\n"}, ("packages/x/missing.ts:3", "line=1")),
    ("missing _shared file", 1, {".agents/skills/a/SKILL.md": "\n`_shared/missing.md`\n"}, ("_shared/missing.md", "line=2")),
    ("missing skill behind .claude/skills", 1, {".agents/skills/a/SKILL.md": "`.claude/skills/foo/SKILL.md`\n"}, (".claude/skills/foo/SKILL.md",)),
    ("missing path next to the skill file", 1, {".agents/skills/a/SKILL.md": "`references/missing.md`\n"}, ("references/missing.md",)),
    ("a skill-dir name at the package root is not relative", 0, {".agents/skills/README.md": "`a/references/real.md` `bar/missing.md`\n"}, ()),
]


def run_case(name: str, expected: int, files: dict[str, str], expect_out: tuple[str, ...], base: dict[str, str] = BASE) -> str | None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for rel, body in {**base, **files}.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(body, encoding="utf-8")
        (root / "packages/x/.env.local").write_text("")
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "add", "-A"], cwd=root, check=True)
        proc = subprocess.run([sys.executable, str(GATE)], cwd=root, capture_output=True, text=True)
    detail = f"    stdout: {proc.stdout.strip()}\n    stderr: {proc.stderr.strip()}"
    if proc.returncode != expected:
        return f"{name}: expected exit {expected}, got {proc.returncode}\n{detail}"
    missing = [s for s in expect_out if s not in proc.stdout]
    if missing:
        return f"{name}: stdout missing {missing!r}\n{detail}"
    return None


def main() -> int:
    failures = [msg for name, exp, files, out in CASES if (msg := run_case(name, exp, files, out))]
    if msg := run_case("no skills directory", 2, {}, (), base={"packages/x/real.ts": ""}):
        failures.append(msg)
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / ".agents/skills/a").mkdir(parents=True)
        (Path(tmp) / ".agents/skills/a/SKILL.md").write_text("`packages/x/missing.ts`\n")
        proc = subprocess.run([sys.executable, str(GATE)], cwd=tmp, capture_output=True, text=True)
        if proc.returncode != 2:
            failures.append(f"outside a git checkout: expected exit 2, got {proc.returncode}")
    for msg in failures:
        print(f"FAIL {msg}", file=sys.stderr)
    if failures:
        print(f"\n{len(failures)} of {len(CASES) + 2} cases failed", file=sys.stderr)
        return 1
    print(f"ok: {len(CASES) + 2} gate cases pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
