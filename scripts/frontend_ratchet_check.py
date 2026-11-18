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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from residence_check import JSON_CALL_RULE, JSON_CALL_SUPPRESSIONS as JSON_CALLS  # noqa: E402  (check J1's file)

OXLINT = "frontend/oxlint-suppressions.json"
ESLINT = "frontend/eslint-suppressions.json"
PACKAGE = "frontend/package.json"
CONFIG = "frontend/.oxlintrc.json"
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
                # oxlint keeps ESLint's rule names, except typescript-eslint's prefix.
                new = None if name == JSON_CALLS else rule.replace("@typescript-eslint/", "typescript/", 1)
            if new:
                out.setdefault(path, {})[new] = {"count": entry.get("count", 0)}
    return out


SEVERITY = {"error": "error", "deny": "error", 2: "error", "warn": "warn", 1: "warn", "off": "off", "allow": "off", 0: "off"}


def severity(setting):
    """"error", "warn" or "off" for a rule's setting: "error", 2, ["error", {options}], ..."""
    level = setting[0] if isinstance(setting, list) and setting else setting
    return SEVERITY.get(level.lower() if isinstance(level, str) else level, "off")


def config_loosenings(base, head):
    """The ways head's .oxlintrc.json weakens base's ADR-0049 lint, one sentence each; empty when it does not."""
    problems = []
    head_rules = head.get("rules", {})
    for rule, setting in sorted(base.get("rules", {}).items()):
        if severity(setting) != "error":
            continue
        if rule not in head_rules:
            problems.append(f"{CONFIG}: rule {rule} was removed")
        elif severity(head_rules[rule]) != "error":
            problems.append(f"{CONFIG}: rule {rule} is set to {severity(head_rules[rule])} (oxlint passes a warning)")
    return problems


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


def parse_jsonc(text):
    """JSON with comments (// and /* */) and trailing commas, as oxlint reads its config."""
    out, i, in_string = [], 0, False
    while i < len(text):
        char = text[i]
        if in_string:
            out.append(char)
            if char == "\\":
                out.append(text[i + 1])
                i += 1
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
            out.append(char)
        elif text.startswith("//", i):
            i = text.find("\n", i)
            i = len(text) if i < 0 else i
            continue
        elif text.startswith("/*", i):
            i = text.index("*/", i) + 2
            continue
        else:
            out.append(char)
        i += 1
    return json.loads(_drop_trailing_commas("".join(out)))


def _drop_trailing_commas(text):
    """<text> without a comma that only whitespace separates from a closing } or ] (outside strings)."""
    out, in_string, escaped = [], False, False
    for i, char in enumerate(text):
        if in_string:
            in_string = escaped or char != '"'
            escaped = not escaped and char == "\\"
        elif char == '"':
            in_string = True
        elif char == "," and text[i + 1:].lstrip()[:1] in ("}", "]"):
            continue
        out.append(char)
    return "".join(out)


def text_at(root, ref, path):
    """The text of <path> at git <ref>; None when the file did not exist there."""
    git = ["git", "-C", str(root)]
    if subprocess.run([*git, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], capture_output=True).returncode:
        sys.exit(f"git: {ref} is not a commit here (fetch the PR's base commit first)")
    if subprocess.run([*git, "cat-file", "-e", f"{ref}:{path}"], capture_output=True).returncode:
        return None
    return subprocess.run([*git, "show", f"{ref}:{path}"], capture_output=True, text=True, check=True).stdout


def read_at(root, ref, path):
    """The JSON of <path> at git <ref>; None when the file did not exist there."""
    text = text_at(root, ref, path)
    return None if text is None else json.loads(text)


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
    base_config = text_at(root, args.base_ref, CONFIG)
    if base_config is not None:
        head_config = (root / CONFIG).read_text() if (root / CONFIG).exists() else "{}"
        problems += config_loosenings(parse_jsonc(base_config), parse_jsonc(head_config))
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
