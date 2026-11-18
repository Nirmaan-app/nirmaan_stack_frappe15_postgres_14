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


# The rules whose options are ban lists: an entry may be added (a tightening), never dropped.
BAN_LISTS = {"no-restricted-imports", "no-restricted-properties", "no-restricted-globals"}
# The top-level keys compared below, and the ones that change no finding of an ADR-0049 rule. Any other key (e.g.
# `extends`, which pulls in another config) is refused when it changes: this check cannot tell what it loosens.
COMPARED = {"plugins", "categories", "ignorePatterns", "rules", "overrides"}
HARMLESS = {"$schema", "env", "globals", "settings"}


def options_kept(rule, base_setting, head_setting):
    """True when head's options for <rule> refuse at least what base's did (equal, ban lists may grow).

    A ban's `message` is text for the reader, not a limit: it may change.
    """
    grow = rule in BAN_LISTS

    def kept(before, after):
        if isinstance(before, dict) and isinstance(after, dict):
            keys = set(before) - {"message"}
            return keys == set(after) - {"message"} and all(kept(before[k], after[k]) for k in keys)
        if isinstance(before, list) and isinstance(after, list):
            if grow:
                return all(any(kept(b, a) for a in after) for b in before)
            return len(before) == len(after) and all(map(kept, before, after))
        return before == after

    options = lambda setting: setting[1:] if isinstance(setting, list) else []  # noqa: E731
    return kept(options(base_setting), options(head_setting))


def config_loosenings(base, head):
    """The ways head's .oxlintrc.json weakens base's ADR-0049 lint, one sentence each; empty when it does not."""
    problems = [f"{CONFIG}: plugin {plugin} was dropped (its rules no longer run)"
                for plugin in base.get("plugins", []) if plugin not in head.get("plugins", [])]
    head_categories = head.get("categories", {})
    for category, setting in sorted(base.get("categories", {}).items()):
        if severity(setting) == "error" and severity(head_categories.get(category, "off")) != "error":
            problems.append(f"{CONFIG}: category {category} is set to {severity(head_categories.get(category, 'off'))}")
    problems += [f"{CONFIG}: ignorePatterns adds {pattern} (its files are no longer linted)"
                 for pattern in head.get("ignorePatterns", []) if pattern not in base.get("ignorePatterns", [])]
    head_rules = head.get("rules", {})
    for rule, setting in sorted(base.get("rules", {}).items()):
        if severity(setting) != "error":
            continue
        if rule not in head_rules:
            problems.append(f"{CONFIG}: rule {rule} was removed")
        elif severity(head_rules[rule]) != "error":
            problems.append(f"{CONFIG}: rule {rule} is set to {severity(head_rules[rule])} (oxlint passes a warning)")
        elif not options_kept(rule, setting, head_rules[rule]):
            problems.append(f"{CONFIG}: rule {rule} has weaker options than before")
    problems += override_loosenings(base, head)
    problems += [f"{CONFIG}: key {key} changed; this check cannot tell what it loosens, so it is refused"
                 for key in sorted((set(base) | set(head)) - COMPARED - HARMLESS) if base.get(key) != head.get(key)]
    return problems


RANK = {"off": 0, "warn": 1, "error": 2}


def override_entries(config):
    """(file pattern, rule, setting) for each rule each override sets, per pattern of its `files`."""
    return [(pattern, rule, setting) for override in config.get("overrides", [])
            for rule, setting in override.get("rules", {}).items() for pattern in override.get("files", [])]


def override_loosenings(base, head):
    """The ways head's `overrides` weaken base's, one sentence each.

    An override either turns a rule on for some files (the typed path: `no-unsafe-*` per folder) or relaxes one for
    them (an exception). A relaxation in head must already be in base, for the same file pattern, and no weaker. A
    rule base's overrides turn on must stay on for each of its patterns, here or at the top level.
    """
    problems = []
    head_rules = head.get("rules", {})
    base_entries = override_entries(base)
    for pattern, rule, setting in override_entries(head):
        level = severity(setting)
        weaker = level == "error" and rule in head_rules and not options_kept(rule, head_rules[rule], setting)
        if level == "error" and not weaker:
            continue
        if any(p == pattern and r == rule and RANK[severity(s)] <= RANK[level]
               and (level != "error" or options_kept(rule, s, setting)) for p, r, s in base_entries):
            continue
        shown = "error with weaker options" if weaker else level
        problems.append(f"{CONFIG}: an override sets {rule} to {shown} for {pattern}")
    head_entries = override_entries(head)
    for pattern, rule, setting in base_entries:
        if severity(setting) != "error":
            continue
        top = head_rules.get(rule)
        if top is not None and severity(top) == "error" and options_kept(rule, setting, top):
            continue
        if any(p == pattern and r == rule and severity(s) == "error" and options_kept(rule, setting, s)
               for p, r, s in head_entries):
            continue
        problems.append(f"{CONFIG}: rule {rule} no longer applies to {pattern}, as an error with the same options")
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
