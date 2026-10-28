#!/usr/bin/env python3
"""Fixture tests for the run-script input gate.

Cases call check() on inline workflow text; subprocess runs prove the gate
refuses to pass when it found no `run:` lines at all, and that it reads nested
composite actions. Stdlib only.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

GATE = Path(__file__).with_name("check-run-script-input.py")
sys.path.insert(0, str(GATE.parent))
spec = importlib.util.spec_from_file_location("gate", GATE)
assert spec and spec.loader
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

PASSES = {
    "untrusted expression outside run": (
        "    steps:\n"
        "      - if: ${{ github.event.pull_request.draft == false }}\n"
        "        env:\n"
        "          TITLE: ${{ github.event.pull_request.title }}\n"
        "        with:\n"
        "          ref: ${{ github.head_ref }}\n"
        "          restore-keys: |\n"
        "            pr${{ github.event.pull_request.number }}-\n"
        '        run: echo "$TITLE"\n'
    ),
    "inputs inside a step id": "    steps:\n      - run: echo ${{ steps.parse-inputs.outputs.x }}\n",
    "yaml comment after a run": "    steps:\n      - run: echo hi\n      # ${{ github.event.x }} is read below\n      - name: next\n",
    "defaults.run mapping": "    defaults:\n      run:\n        working-directory: ${{ inputs.dir }}\n    steps:\n      - run: echo hi\n",
    "job named run": "jobs:\n  run:\n    if: ${{ github.event.pull_request.draft == false }}\n    runs-on: ubuntu-latest\n",
    "comment on the run line": "    steps:\n      - run: echo hi # see ${{ github.event.x }}\n",
    "trusted expressions in run": (
        "    steps:\n      - run: echo ${{ github.sha }} ${{ github.event_name }}"
        ' ${{ steps.inputs.outputs.x }} "checks inputs"\n'
    ),
}

FIRES = {
    "inline run": "    steps:\n      - run: echo ${{ github.event.pull_request.title }}\n",
    "literal run": "    steps:\n      - run: |\n          echo hi\n          git checkout ${{ github.head_ref }}\n",
    "folded run": "    steps:\n      - run: >-\n          deploy ${{ inputs.sha }}\n",
    "whole event": "    steps:\n      - run: echo '${{ toJSON(github.event) }}'\n",
    "bracket access": "    steps:\n      - run: echo ${{ github.event['pull_request'].title }}\n",
    "brace inside a literal": "    steps:\n      - run: echo ${{ format('{0}', inputs.x) }}\n",
    "bracket event": "    steps:\n      - run: echo ${{ github['event'].pull_request.title }}\n",
    "bracket head_ref": '    steps:\n      - run: git checkout ${{ github["head_ref"] }}\n',
    "shell comment in a run body": "    steps:\n      - run: |\n          # ${{ github.event.x }}\n          echo hi\n",
    "quoted # in an inline run": '    steps:\n      - run: echo "build #1 ${{ inputs.x }}"\n',
    "escaped quote before a #": '    steps:\n      - run: echo "a \\" #1 ${{ inputs.x }}"\n',
    "comment before the run value": "    steps:\n      - run:\n      # c\n          echo ${{ github.event.x }}\n",
    "plain run continued": "    steps:\n      - run: echo a\n          ${{ github.event.x }}\n",
    "run value on the next line": "    steps:\n      - run:\n          echo ${{ github.event.x }}\n",
    "split expression": "    steps:\n      - run: |\n          echo ${{\n            github.event.x }}\n",
    "commented block header": "jobs:\n#x: |\n  b:\n    steps:\n      - run: echo ${{ inputs.x }}\n",
    "upper case context": "    steps:\n      - run: echo ${{ GitHub.Event.x }}\n",
}


def main() -> int:
    failures = [f"pass case fired: {name}: {gate.check(text)[0]}" for name, text in PASSES.items() if gate.check(text)[0]]
    failures += [f"fire case passed: {name}" for name, text in FIRES.items() if len(gate.check(text)[0]) != 1]
    two = "    steps:\n      - run: |\n          echo ${{ inputs.a }}\n          echo ${{ github.head_ref }}\n"
    if [line for line, _ in gate.check(two)[0]] != [3, 4]:
        failures.append(f"two offenders in one script are not both reported: {gate.check(two)[0]}")
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / ".github/workflows").mkdir(parents=True)
        (Path(tmp) / ".github/workflows/x.yml").write_text("jobs: {}\n")
        proc = subprocess.run([sys.executable, str(GATE)], cwd=tmp, capture_output=True, text=True)
        if proc.returncode != 2:
            failures.append(f"no run: lines should exit 2, got {proc.returncode}")
        nested = Path(tmp) / ".github/actions/group/inner/action.yml"
        nested.parent.mkdir(parents=True)
        nested.write_text("runs:\n  steps:\n    - run: echo ${{ inputs.x }}\n")
        proc = subprocess.run([sys.executable, str(GATE)], cwd=tmp, capture_output=True, text=True)
        if "group/inner/action.yml" not in proc.stdout:
            failures.append(f"a nested composite action is not scanned: {proc.stdout.strip()}")
    for msg in failures:
        print(f"FAIL {msg}", file=sys.stderr)
    cases = len(PASSES) + len(FIRES) + 3
    if failures:
        print(f"\n{len(failures)} of {cases} cases failed", file=sys.stderr)
        return 1
    print(f"ok: {cases} gate cases pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
