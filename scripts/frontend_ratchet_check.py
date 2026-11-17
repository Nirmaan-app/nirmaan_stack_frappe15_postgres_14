"""Refuse a pull request that loosens the frontend ratchet (ADR-0049, #1687, #1699).

The ratchet is counts and a number a PR can only tighten:
  - frontend/oxlint-suppressions.json: the old oxlint violations, per file and rule, and
    frontend/json-call-suppressions.json: the old `.json()` calls per file (residence check J1). A count may fall
    or an entry go; a count that rises, or a file or rule that appears, is a loosening (`oxlint --suppress-all`
    does both).
  - the `--at-least` threshold of `type-coverage` in frontend/package.json. It may rise; it may not fall.

A base from before the switch to oxlint holds frontend/eslint-suppressions.json instead; both files are then held
to its counts (from_eslint), so the change that switches cannot loosen the ratchet either.

CI runs it on every pull request against the PR's base commit (github.event.pull_request.base.sha):

    python3 scripts/frontend_ratchet_check.py --base-ref <base sha>

It compares the working tree's files with the same files at <base-ref> and exits 1 on any loosening.
Stdlib only.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

OXLINT = "frontend/oxlint-suppressions.json"
JSON_CALLS = "frontend/json-call-suppressions.json"
ESLINT = "frontend/eslint-suppressions.json"
PACKAGE = "frontend/package.json"
# ESLint's rule names, as oxlint names them. ESLint's `.json()` ban (no-restricted-syntax) is JSON_CALLS's rule.
JSON_CALL_RULE = "no-json-call"
ESLINT_PREFIXES = {"@typescript-eslint/": "typescript/"}
ROOT = Path(__file__).resolve().parent.parent


def suppression_loosenings(name, base_supp, head_supp):
    """The ways head's suppressions file <name> loosens base's, one sentence each; empty when it does not.

    A base without the file (None) has no ratchet yet, so the change that adds it loosens nothing.
    """
    if base_supp is None:
        return []
    problems = []
    gone = {path: counts(rules) for path, rules in base_supp.items() if path not in head_supp}
    for path, rules in sorted(head_supp.items()):
        renamed_from = None
        if path not in base_supp:
            renamed_from = next((old for old, before in sorted(gone.items()) if before == counts(rules)), None)
        hint = f" (it looks like a rename of {renamed_from}: same rules and counts)" if renamed_from else ""
        for rule, entry in sorted(rules.items()):
            count = entry.get("count", 0)
            base_entry = base_supp.get(path, {}).get(rule)
            if base_entry is None:
                problems.append(f"{name}: {path} {rule} is new ({count}){hint}")
                continue
            before = base_entry.get("count", 0)
            if count > before:
                problems.append(f"{name}: {path} {rule} rose {before} -> {count}")
    return problems


def threshold_loosenings(base_pkg, head_pkg):
    """A sentence when head's type-coverage --at-least is lower than base's, or gone; else empty."""
    before, after = at_least(base_pkg), at_least(head_pkg)
    if before is not None and (after is None or after < before):
        shown = "removed" if after is None else after
        return [f"{PACKAGE}: type-coverage --at-least fell {before} -> {shown}"]
    return []


def from_eslint(eslint_supp, name):
    """The base of suppressions file <name> (OXLINT or JSON_CALLS), read from an eslint-suppressions.json."""
    out = {}
    for path, rules in eslint_supp.items():
        for rule, entry in rules.items():
            if rule == "no-restricted-syntax":
                new = JSON_CALL_RULE if name == JSON_CALLS else None
            else:
                new = None if name == JSON_CALLS else oxlint_name(rule)
            if new:
                out.setdefault(path, {})[new] = {"count": entry.get("count", 0)}
    return out


def oxlint_name(rule):
    """An ESLint rule name as oxlint writes it in its suppressions file."""
    for old, new in ESLINT_PREFIXES.items():
        if rule.startswith(old):
            return new + rule[len(old):]
    return rule


def counts(rules):
    """{rule: count} of one file's suppressions entry."""
    return {rule: entry.get("count", 0) for rule, entry in rules.items()}


def at_least(pkg):
    """The type-coverage threshold in a package.json's scripts, or None when it has none.

    Raises ValueError naming the value when it is not a number (e.g. `97.4.`).
    """
    found = re.search(r"--at-least[ =]([0-9.]+)", pkg.get("scripts", {}).get("type-coverage", ""))
    if not found:
        return None
    try:
        return float(found.group(1))
    except ValueError:
        raise ValueError(f"{PACKAGE}: type-coverage --at-least {found.group(1)!r} is not a number.") from None


def read_at(root, ref, path):
    """The JSON of <path> at git <ref>; None when the file did not exist there."""
    git = ["git", "-C", str(root)]
    if subprocess.run([*git, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], capture_output=True).returncode:
        sys.exit(f"git: {ref} is not a commit here (fetch the PR's base commit first)")
    if subprocess.run([*git, "cat-file", "-e", f"{ref}:{path}"], capture_output=True).returncode:
        return None
    shown = subprocess.run([*git, "show", f"{ref}:{path}"], capture_output=True, text=True, check=True)
    return json.loads(shown.stdout)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-ref", required=True, help="the PR's base commit: a SHA or a ref, e.g. origin/develop")
    parser.add_argument("--root", default=str(ROOT), help="the repository root (default: this script's repo)")
    args = parser.parse_args(argv)
    root = Path(args.root)
    eslint_base = read_at(root, args.base_ref, ESLINT)
    problems = []
    for name in (OXLINT, JSON_CALLS):
        base_supp = read_at(root, args.base_ref, name)
        if base_supp is None and eslint_base is not None:
            base_supp = from_eslint(eslint_base, name)
        if not (root / name).exists():
            if base_supp is not None:
                print(f"✘ {name} was deleted: that drops the ratchet. Keep it (ADR-0049).", file=sys.stderr)
                return 1
            continue
        problems += suppression_loosenings(name, base_supp, json.loads((root / name).read_text()))
    base_pkg = read_at(root, args.base_ref, PACKAGE) or {}
    head_pkg = json.loads((root / PACKAGE).read_text())
    try:
        problems += threshold_loosenings(base_pkg, head_pkg)
    except ValueError as bad:  # a malformed --at-least
        print(f"✘ {bad}", file=sys.stderr)
        return 1
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
