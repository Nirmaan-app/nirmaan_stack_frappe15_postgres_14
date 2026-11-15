"""Refuse a pull request that loosens the frontend ratchet (ADR-0049, #1687).

The ratchet is two numbers a PR can only tighten:
  - frontend/eslint-suppressions.json: the old ESLint violations, per file and rule. A count may fall or an entry
    go; a count that rises, or a file or rule that appears, is a loosening (`eslint --suppress-all` does both).
  - the `--at-least` threshold of `type-coverage` in frontend/package.json. It may rise; it may not fall.

CI runs it on every pull request against the PR's base branch:

    python3 scripts/frontend_ratchet_check.py --base-ref origin/<base branch>

It compares the working tree's two files with the same files at <base-ref> and exits 1 on any loosening.
Stdlib only.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

SUPPRESSIONS = "frontend/eslint-suppressions.json"
PACKAGE = "frontend/package.json"
ROOT = Path(__file__).resolve().parent.parent


def loosenings(base_supp, head_supp, base_pkg, head_pkg):
    """The ways head loosens the ratchet against base, one sentence each; empty when it does not.

    A base without a suppressions file (None) has no ratchet yet, so the change that adds it loosens nothing.
    """
    problems = []
    for path, rules in sorted(head_supp.items() if base_supp is not None else []):
        for rule, entry in sorted(rules.items()):
            count = entry.get("count", 0)
            base_entry = base_supp.get(path, {}).get(rule)
            if base_entry is None:
                problems.append(f"{SUPPRESSIONS}: {path} {rule} is new ({count})")
                continue
            before = base_entry.get("count", 0)
            if count > before:
                problems.append(f"{SUPPRESSIONS}: {path} {rule} rose {before} -> {count}")
    before, after = at_least(base_pkg), at_least(head_pkg)
    if before is not None and (after is None or after < before):
        shown = "removed" if after is None else after
        problems.append(f"{PACKAGE}: type-coverage --at-least fell {before} -> {shown}")
    return problems


def at_least(pkg):
    """The type-coverage threshold in a package.json's scripts, or None when it has none."""
    found = re.search(r"--at-least[ =]([0-9.]+)", pkg.get("scripts", {}).get("type-coverage", ""))
    return float(found.group(1)) if found else None


def read_at(root, ref, path):
    """The JSON of <path> at git <ref>; None when the file did not exist there."""
    git = ["git", "-C", str(root)]
    if subprocess.run([*git, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], capture_output=True).returncode:
        sys.exit(f"git: {ref} is not a commit here (fetch the PR's base branch first)")
    if subprocess.run([*git, "cat-file", "-e", f"{ref}:{path}"], capture_output=True).returncode:
        return None
    shown = subprocess.run([*git, "show", f"{ref}:{path}"], capture_output=True, text=True, check=True)
    return json.loads(shown.stdout)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-ref", required=True, help="the PR's base, e.g. origin/develop")
    parser.add_argument("--root", default=str(ROOT), help="the repository root (default: this script's repo)")
    args = parser.parse_args(argv)
    root = Path(args.root)
    base_supp = read_at(root, args.base_ref, SUPPRESSIONS)
    if not (root / SUPPRESSIONS).exists():
        if base_supp is None:
            print(f"✓ frontend ratchet: no {SUPPRESSIONS} on either side yet")
            return 0
        print(f"✘ {SUPPRESSIONS} was deleted: that drops the ratchet. Keep it (ADR-0049).", file=sys.stderr)
        return 1

    problems = loosenings(
        base_supp,
        json.loads((root / SUPPRESSIONS).read_text()),
        read_at(root, args.base_ref, PACKAGE) or {},
        json.loads((root / PACKAGE).read_text()),
    )
    if problems:
        print(f"✘ This change loosens the frontend ratchet against {args.base_ref} (ADR-0049):", file=sys.stderr)
        for problem in problems:
            print(f"    {problem}", file=sys.stderr)
        print("    Fix the new violations instead of suppressing them, and never lower --at-least.", file=sys.stderr)
        return 1
    print(f"✓ frontend ratchet: nothing loosened against {args.base_ref}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
