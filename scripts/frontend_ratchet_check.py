"""Refuse a pull request that loosens the frontend ratchet (ADR-0049, #1687, #1699).

The ratchet is counts and a number a PR can only tighten:
  - frontend/oxlint-suppressions.json: the old oxlint violations, per file and rule, and
    frontend/json-call-suppressions.json: the old `.json()` calls per file (residence check J1). A count may fall
    or an entry go; a count that rises, or a file or rule that appears, is a loosening (`oxlint --suppress-all`
    does both).
  - the `--at-least` threshold of `type-coverage` in frontend/package.json. It may rise; it may not fall.
  - the lint settings themselves (#1702), which `yarn lint` takes from the PR's own tree: frontend/.oxlintrc.json,
    compared by oxlint_settings_check.py (no wider ignorePatterns, no rule removed or turned down to "warn" or "off",
    at the top level or in an override, no folder taken off the typed path), no nested oxlint config, .eslintignore or
    .gitignore that hides src files, the `lint` script in frontend/package.json (no path, flag or shell word that
    narrows it), and the counts of scripts/residence_baseline.json that CI's residence checks read. A tightening
    passes: a rule switched on, a folder added to the typed path, an ignore pattern dropped, a ban-list entry added.

A base from before the switch to oxlint holds frontend/eslint-suppressions.json instead; both files are then held
to its counts (from_eslint), so the change that switches cannot loosen the ratchet either.

CI runs it on every pull request against the PR's base commit (github.event.pull_request.base.sha):

    python3 scripts/frontend_ratchet_check.py --base-ref <base sha>

It compares the working tree's files with the same files at <base-ref> and exits 1 on any loosening, naming it.
It reads the settings rather than linting the PR's code with the base's settings: a rule set to "warn" or a
narrowed path lets no violation through until a later PR, so a lint run would pass the loosening itself.
Stdlib only.
"""

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oxlint_settings_check import CONFIG, config_loosenings, parse_jsonc  # noqa: E402
from residence_check import CHECKS, CI_SUBSET, JSON_CALL_RULE, select_checks  # noqa: E402
from residence_check import JSON_CALL_SUPPRESSIONS as JSON_CALLS  # noqa: E402  (check J1's file)

OXLINT = "frontend/oxlint-suppressions.json"
ESLINT = "frontend/eslint-suppressions.json"
PACKAGE = "frontend/package.json"
RESIDENCE = "scripts/residence_baseline.json"
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


# Flags the `lint` script may gain: each only makes oxlint stricter. Any other added word may narrow it (a path, `-A`,
# `--ignore-pattern`, `-c`, `|| true`), so it is refused.
STRICTER_FLAGS = {"--deny-warnings", "--max-warnings=0", "--report-unused-disable-directives"}


def lint_script_loosenings(base_pkg, head_pkg):
    """The ways head's `lint` script (and the prelint/postlint hooks yarn runs around it) weakens base's."""
    base_scripts, head_scripts = base_pkg.get("scripts", {}), head_pkg.get("scripts", {})
    problems = [f"{PACKAGE}: a {hook} script runs around `yarn lint` and could change what it lints"
                for hook in ("prelint", "postlint") if head_scripts.get(hook) != base_scripts.get(hook)]
    if "lint" not in base_scripts:
        return problems
    if "lint" not in head_scripts:
        return problems + [f"{PACKAGE}: the lint script was removed"]
    before, after = lint_words(base_scripts["lint"]), lint_words(head_scripts["lint"])
    dropped = [word for word in before if word not in after]
    added = [word for word in after if word not in before and word not in STRICTER_FLAGS]
    if dropped or added:
        change = "; ".join(filter(None, [dropped and f"drops {' '.join(dropped)}", added and f"adds {' '.join(added)}"]))
        problems.append(f"{PACKAGE}: the lint script {change} ({base_scripts['lint']!r} -> {head_scripts['lint']!r}); "
                        f"it may only add {', '.join(sorted(STRICTER_FLAGS))}")
    return problems


def lint_words(script):
    """The shell words of a `lint` script, with `--max-warnings N` written as one word, `--max-warnings=N`, and a path
    in its shortest form (`./src` and `src/` name the files `src` does)."""
    words = [word if word.startswith("-") else os.path.normpath(word) for word in shlex.split(script)]
    for index in range(len(words) - 2, -1, -1):
        if words[index] == "--max-warnings":
            words[index:index + 2] = [f"--max-warnings={words[index + 1]}"]
    return words


def residence_loosenings(base_baseline, head_baseline):
    """The entries of scripts/residence_baseline.json that CI's residence checks read and head raised.

    CI runs `residence_check.py --check --only ci` against the PR's own baseline file, so a raised count there lets
    that many new violations through. A check with a pass mark ignores the file.
    """
    problems = []
    for check in select_checks(CHECKS, CI_SUBSET):
        before = base_baseline.get(check.id, {}).get("count")
        after = head_baseline.get(check.id, {}).get("count", 0)
        if check.pass_mark is None and before is not None and after > before:
            problems.append(f"{RESIDENCE}: {check.id} (rule {check.rule}) rose {before} -> {after}")
    return problems


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


def tree_loosenings(root):
    """Files in the working tree that change what oxlint lints, from outside .oxlintrc.json, one sentence each.

    oxlint reads a config in any folder below the one it runs in (a nested .oxlintrc.json), an .eslintignore, and
    every .gitignore, even for a file git tracks. ADR-0049 has one config, in frontend/, and no ignore file.
    """
    def git_files(*args):
        listed = subprocess.run(["git", "-C", str(root), "ls-files", "-z", *args], capture_output=True, text=True,
                                check=True).stdout
        # oxlint skips a folder named exactly node_modules, not one whose name only ends in it.
        return [path for path in listed.split("\0") if path and "node_modules" not in path.split("/")[:-1]]

    problems = []
    for path in git_files("--cached", "--others", "--exclude-standard", "--", "frontend"):
        name = path.rsplit("/", 1)[-1]
        if path != CONFIG and (name in (".oxlintrc.json", ".oxlintrc.jsonc") or name.startswith("oxlint.config.")):
            problems.append(f"{path}: a nested oxlint config (oxlint reads it on its own); keep one, {CONFIG}")
        elif name == ".eslintignore":
            problems.append(f"{path}: oxlint skips the files it names; use ignorePatterns in {CONFIG}")
    problems += [f"{path}: a .gitignore hides it from oxlint" for path in
                 git_files("--cached", "--ignored", "--exclude-standard", "--", "frontend/src")]
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
        problems += lint_script_loosenings(base_pkg, head_pkg)
    except ValueError as bad:  # a malformed --at-least
        print(f"✘ {bad}", file=sys.stderr)
        return 1
    base_config = text_at(root, args.base_ref, CONFIG)
    if base_config is not None:
        head_config = (root / CONFIG).read_text() if (root / CONFIG).exists() else "{}"
        try:
            base_settings, head_settings = parse_jsonc(base_config), parse_jsonc(head_config)
        except ValueError as bad:  # json.JSONDecodeError too
            print(f"✘ {CONFIG} is not valid JSON with comments, here or at {args.base_ref}: {bad}", file=sys.stderr)
            return 1
        problems += config_loosenings(base_settings, head_settings)
    problems += tree_loosenings(root)
    if (root / RESIDENCE).exists():
        problems += residence_loosenings(read_at(root, args.base_ref, RESIDENCE) or {},
                                         json.loads((root / RESIDENCE).read_text()))
    if problems:
        print(f"✘ This change loosens the frontend ratchet against {args.base_ref} (ADR-0049):", file=sys.stderr)
        for problem in problems:
            print(f"    {problem}", file=sys.stderr)
        print("    Fix the new violations instead of suppressing them, never lower --at-least, and keep the lint settings"
              " at least as strict as the base's.", file=sys.stderr)
        return 1
    print(f"✓ frontend ratchet: nothing loosened against {args.base_ref}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
