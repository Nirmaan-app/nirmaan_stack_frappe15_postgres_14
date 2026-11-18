"""Compare two frontend/.oxlintrc.json settings: the ways the PR's weakens the base's ADR-0049 lint (#1702).

frontend_ratchet_check.py calls config_loosenings from its main(), in CI's step "Frontend ratchet not loosened".
oxlint reads its config as JSON with comments (parse_jsonc). Stdlib only.
"""

import json
from typing import NamedTuple

CONFIG = "frontend/.oxlintrc.json"

SEVERITY = {"error": "error", "deny": "error", 2: "error", "warn": "warn", 1: "warn", "off": "off", "allow": "off", 0: "off"}
RANK = {"off": 0, "warn": 1, "error": 2}
# The rules whose options are ban lists: an entry may be added (a tightening), never dropped.
BAN_LISTS = {"no-restricted-imports", "no-restricted-properties", "no-restricted-globals"}
# The top-level keys compared below, and the ones that change no finding of an ADR-0049 rule. Any other key (e.g.
# `extends`, which pulls in another config) is refused when it changes: this check cannot tell what it loosens.
COMPARED = {"plugins", "categories", "ignorePatterns", "rules", "overrides"}
HARMLESS = {"$schema", "env", "globals", "settings"}
OVERRIDE_KEYS = {"files", "rules", "env", "globals", "plugins"}


def severity(setting):
    """"error", "warn" or "off" for a rule's setting: "error", 2, ["error", {options}], ...; "off" when malformed."""
    level = setting[0] if isinstance(setting, list) and setting else setting
    if not isinstance(level, (str, int)):
        return "off"
    return SEVERITY.get(level.lower() if isinstance(level, str) else level, "off")


def rule_name(key):
    """The rule a config key names. oxlint reads `typescript/x`, `@typescript-eslint/x`, `eslint/x` and a bare `x` as
    one rule (the key it reads last wins), so they are compared as one; two plugins' rules of one name count as one."""
    return key.rsplit("/", 1)[-1]


def options_kept(name, base_setting, head_setting):
    """True when head's options for rule <name> refuse at least what base's did (equal; ban lists may grow).

    A ban's `message` is text for the reader, not a limit: it may change. A new `!` entry in a ban list, or a new
    entry that holds one, is no growth: oxlint reads it as "but not these", so ["x/*", "!x/**"] bans nothing. Nor is
    a `!` entry moved after a plain entry it preceded: the last match wins, so it lifts that entry's ban.
    """
    grow = name in BAN_LISTS

    def kept(before, after):
        if isinstance(before, dict) and isinstance(after, dict):
            keys = set(before) - {"message"}
            return keys == set(after) - {"message"} and all(kept(before[k], after[k]) for k in keys)
        if isinstance(before, list) and isinstance(after, list):
            if grow:
                new = [a for a in after if not any(kept(b, a) for b in before)]
                return (all(any(kept(b, a) for a in after) for b in before)
                        and not any(map(negates, new)) and not negations_overtaken(after, before))
            return len(before) == len(after) and all(map(kept, before, after))
        return before == after

    return kept(options(base_setting), options(head_setting))


def negates(value):
    """True when <value> is or holds a `!` string: a ban-list entry oxlint reads as "but not these", which can lift a
    ban anywhere in the rule's options (one group's `!` lifts another group's ban)."""
    if isinstance(value, str):
        return value.startswith("!")
    if isinstance(value, dict):
        value = list(value.values())
    return isinstance(value, list) and any(map(negates, value))


def options(setting):
    """A rule setting's options: what follows the severity in ["error", {...}]."""
    return setting[1:] if isinstance(setting, list) else []


def as_strict(name, base_setting, head_setting):
    """True when head's setting of rule <name> is an error that refuses at least what base's did."""
    return severity(head_setting) == "error" and options_kept(name, base_setting, head_setting)


def config_loosenings(base, head):
    """The ways head's .oxlintrc.json weakens base's ADR-0049 lint, one sentence each; empty when it does not."""
    problems = [f"{CONFIG}: plugin {plugin} was dropped (its rules no longer run)"
                for plugin in base.get("plugins", []) if plugin not in head.get("plugins", [])]
    head_categories = head.get("categories", {})
    for category, setting in sorted(base.get("categories", {}).items()):
        if severity(setting) == "error" and severity(head_categories.get(category, "off")) != "error":
            problems.append(f"{CONFIG}: category {category} is set to {severity(head_categories.get(category, 'off'))}")
    base_ignores, head_ignores = base.get("ignorePatterns", []), head.get("ignorePatterns", [])
    problems += [f"{CONFIG}: ignorePatterns adds {pattern} (its files are no longer linted)"
                 for pattern in head_ignores if pattern not in base_ignores and not pattern.startswith("!")]
    problems += [f"{CONFIG}: ignorePatterns drops {pattern} (the files it brought back are no longer linted)"
                 for pattern in base_ignores if pattern.startswith("!") and pattern not in head_ignores]
    problems += ignore_order_loosenings(base_ignores, head_ignores)
    head_rules = head.get("rules", {})
    for key, setting in sorted(base.get("rules", {}).items()):
        if severity(setting) != "error":
            continue
        name = rule_name(key)
        found = {k: s for k, s in head_rules.items() if rule_name(k) == name}
        if not found:
            problems.append(f"{CONFIG}: rule {key} was removed")
        for head_key, head_setting in sorted(found.items()):
            alias = f" (as {head_key})" if head_key != key else ""
            if severity(head_setting) != "error":
                why = " (oxlint exits 0 on a warning)" if severity(head_setting) == "warn" else ""
                problems.append(f"{CONFIG}: rule {key} is set to {severity(head_setting)}{alias}{why}")
            elif not options_kept(name, setting, head_setting):
                problems.append(f"{CONFIG}: rule {key} has weaker options than before{alias}")
    problems += override_loosenings(base, head)
    problems += [f"{CONFIG}: key {key} changed; this check cannot tell what it loosens, so it is refused"
                 for key in sorted((set(base) | set(head)) - COMPARED - HARMLESS) if base.get(key) != head.get(key)]
    return problems


def negations_overtaken(before, after):
    """(`!` entry, plain entry) pairs, both in each list, where the `!` entry follows the plain one in <before> and
    precedes it in <after>. In a list read last-match-wins, the plain entry then wins for what both match."""
    def last_index(entries):
        return {entry: index for index, entry in enumerate(entries) if isinstance(entry, str)}

    before_at, after_at = last_index(before), last_index(after)
    kept = [entry for entry in before_at if entry in after_at]
    return [(negated, plain) for negated in kept if negated.startswith("!") for plain in kept
            if not plain.startswith("!")
            and before_at[plain] < before_at[negated] and after_at[plain] > after_at[negated]]


def ignore_order_loosenings(base_ignores, head_ignores):
    """A sentence per `!` pattern of ignorePatterns that head moved before an ignore pattern it followed in base.

    The last pattern that matches a file wins, so the `!` pattern no longer brings back the files both match. Moving
    it after one lints more and passes. Patterns are compared as written, not by the files they match.
    """
    return [f"{CONFIG}: ignorePatterns moves {negated} before {ignored}, so {ignored} wins for the files both match "
            f"(they are no longer linted)" for negated, ignored in negations_overtaken(base_ignores, head_ignores)]


class OverrideEntry(NamedTuple):
    """One rule one override sets, for one of its file patterns."""
    index: int  # the override's place in `overrides`: a later one wins
    pattern: str
    key: str  # the rule as written, e.g. `typescript/no-unsafe-call`
    setting: object
    relaxes: bool  # an exception, not the typed path


def rules_by_name(config):
    """{rule name: setting} of a config's top-level rules, aliases read as one rule (see rule_name)."""
    return {rule_name(key): setting for key, setting in config.get("rules", {}).items()}


def is_exception(name, setting, top):
    """True when an override's <setting> of rule <name> is an exception: "warn" or "off", or an error weaker than the
    top level's (<top> from rules_by_name). Otherwise it turns the rule on for its files (the typed path)."""
    return not (as_strict(name, top[name], setting) if name in top else severity(setting) == "error")


def override_entries(config, top):
    """An OverrideEntry per rule each override sets, per pattern; <top> is rules_by_name(config)."""
    return [OverrideEntry(index, pattern, key, setting, is_exception(rule_name(key), setting, top))
            for index, override in enumerate(config.get("overrides", []))
            for key, setting in override.get("rules", {}).items() for pattern in override.get("files", [])]


def relaxed_after_on(entries):
    """(relaxed pattern, rule, turned-on pattern) where an override relaxing the rule follows one turning it on.

    oxlint applies overrides in order, the later winning, so an exception placed after the typed path beats it.
    """
    return {(off.pattern, off.key, on.pattern) for off in entries if off.relaxes for on in entries
            if rule_name(on.key) == rule_name(off.key) and not on.relaxes and on.index < off.index}


def override_loosenings(base, head):
    """The ways head's `overrides` weaken base's, one sentence each.

    A relaxation in head must already be in base, for the same file pattern, no weaker, and not moved after an
    override that turns its rule on. A rule base's overrides turn on must stay on for each of its patterns, here or
    at the top level. Patterns are compared as written, not by the files they match.
    """
    problems = [f"{CONFIG}: an override sets key {key}; this check cannot tell what it loosens, so it is refused"
                for override in head.get("overrides", []) if override not in base.get("overrides", [])
                for key in sorted(set(override) - OVERRIDE_KEYS)]
    head_top = rules_by_name(head)
    base_entries, head_entries = override_entries(base, rules_by_name(base)), override_entries(head, head_top)
    for entry in head_entries:
        name, level = rule_name(entry.key), severity(entry.setting)
        if entry.relaxes and not any(
                old.pattern == entry.pattern and rule_name(old.key) == name and old.relaxes
                and RANK[severity(old.setting)] <= RANK[level]
                and (level != "error" or options_kept(name, old.setting, entry.setting))
                for old in base_entries):
            shown = level if level != "error" else "error with weaker options"
            problems.append(f"{CONFIG}: an override sets {entry.key} to {shown} for {entry.pattern}")
    for old in base_entries:
        name = rule_name(old.key)
        if old.relaxes or (name in head_top and as_strict(name, old.setting, head_top[name])):
            continue
        if not any(new.pattern == old.pattern and rule_name(new.key) == name
                   and as_strict(name, old.setting, new.setting) for new in head_entries):
            problems.append(f"{CONFIG}: rule {old.key} no longer applies to {old.pattern}, as an error with the same "
                            f"options")
    problems += [f"{CONFIG}: an override relaxing {key} for {pattern} now comes after the one that turns it on for "
                 f"{on_pattern}, so it wins there" for pattern, key, on_pattern in
                 sorted(relaxed_after_on(head_entries) - relaxed_after_on(base_entries))]
    return problems


def parse_jsonc(text):
    """JSON with comments (// and /* */) and trailing commas, as oxlint reads its config."""
    out, i, in_string = [], 0, False
    while i < len(text):
        char = text[i]
        if in_string:
            out.append(char)
            if char == "\\":
                out.append(text[i + 1:i + 2])
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
            end = text.find("*/", i)
            if end < 0:
                raise ValueError("a /* comment is never closed")
            i = end + 2
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
