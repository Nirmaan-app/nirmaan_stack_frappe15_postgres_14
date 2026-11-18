"""Residence check D1 (#1705, ADR-0049): a lint disable comment for a rule oxlint enforces can only go down.

Run as residence check D1 by scripts/residence_check.py (in CI_SUBSET, and in the commit hooks); lower the frozen
counts after removing comments with `python3 scripts/residence_check.py --prune-disable-comments`.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

from frozen_counts import REPO_ROOT, TsParserError, frozen_drift, node_cannot_run, read_frozen, run_ts_parser
from oxlint_settings_check import CONFIG, parse_jsonc, rule_name, severity


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


# --- Rule D1: disable comments for ADR-0049's rules (#1705) -----------------------
# A disable comment switches a lint rule off, so `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
# above a new `any` passed `yarn lint`. The comments that can switch off a rule frontend/.oxlintrc.json turns on (or
# every rule: one that names none) are frozen per file and rule in DISABLE_SUPPRESSIONS; a file over its frozen count
# fails. The 77 `react-hooks/exhaustive-deps` comments name a rule that is off, so they are not counted.
#
# What oxlint 1.94 reads as a directive (measured, #1705): the comment's text, trimmed, starts with `eslint-disable`
# or `oxlint-disable`, then `-next-line`, `-line` or nothing, then whitespace or the end; case counts. A `/** */` or a
# `/*` whose first word is `*` is no directive. Rules are split on commas and whitespace up to the first `--` (a
# reason); a rule matches by its last `/` segment, whatever the plugin prefix. Comments only: a string, template or
# regex literal holding the text switches nothing off (frontend/scripts/disable_comments.mjs reads the comments).

_DISABLE_DIRECTIVE = re.compile(r"(?:eslint|oxlint)-disable(-next-line|-line)?(?=\s|$)")


def _directive(comment: str) -> tuple[re.Match, str] | None:
    """The directive match in a comment and the comment's trimmed text, or None when it is no disable directive."""
    body = (comment[2:-2] if comment.startswith("/*") else comment[2:]).strip()
    found = _DISABLE_DIRECTIVE.match(body)
    return (found, body) if found else None


def disable_directive(comment: str) -> list[str] | None:
    """The rules a comment's disable directive names ([] = every rule), or None when it is no disable directive.

    ``comment`` is the whole comment, with its `//` or `/* */`."""
    directive = _directive(comment)
    if directive is None:
        return None
    found, body = directive
    rules = body[found.end():].split("--", 1)[0]
    return [rule for rule in re.split(r"[\s,]+", rules) if rule]


def is_file_wide(comment: str) -> bool:
    """A disable directive with no `-next-line` or `-line`: it holds from there to the end of the file."""
    directive = _directive(comment)
    return directive is not None and directive[0].group(1) is None


DISABLE_COMMENT_PARSER = "frontend/scripts/disable_comments.mjs"


def disable_comment_texts(sources: dict[str, str]) -> dict[str, list[str]]:
    """The comments of each source oxlint lints that hold `-disable` (TypeScript's parser), keyed as given."""
    return run_ts_parser(DISABLE_COMMENT_PARSER, sources)


# The rule key of a comment that names no rule: it switches off every rule, ADR-0049's included.
EVERY_RULE = "every-rule"
# Added to a rule key for a file-wide comment (`/* eslint-disable x */`): it switches the rule off from there to the
# end of the file, so swapping a frozen line comment for one is a new entry, not the same count.
FILE_WIDE = " (file-wide)"


def _rule_blocks(config: dict, path: str | None = None) -> list[dict]:
    """The config's `rules` blocks in order: the top level's, then each override's (with ``path``, only the overrides
    that apply to it: a `files` glob matches it and no `excludeFiles` glob does, as oxlint 1.94 reads them)."""
    def applies(override: dict) -> bool:
        return path is None or (any(override_glob_matches(g, path) for g in override.get("files", []))
                                and not any(override_glob_matches(g, path) for g in override.get("excludeFiles", [])))
    return [config.get("rules", {})] + [o.get("rules", {}) for o in config.get("overrides", []) if applies(o)]


def rules_the_config_turns_on(config: dict) -> dict[str, str]:
    """{rule name: config key} of every rule the oxlint config turns on, at the top level or in an override.

    The name is the one oxlint matches a disable comment by (oxlint_settings_check.rule_name). Raises ValueError for
    a category switched on: its rules are oxlint's, not listed in the config, so they cannot be counted (oxlint 1.94
    refuses `categories` inside an override)."""
    on = [category for category, level in config.get("categories", {}).items() if severity(level) != "off"]
    if on:
        raise ValueError(f"{CONFIG} switches on categor{'y' if len(on) == 1 else 'ies'} {', '.join(on)}: D1 cannot "
                         "list their rules; name each rule in `rules` instead")
    rules: dict[str, str] = {}
    for block in _rule_blocks(config):
        for key, setting in block.items():
            if severity(setting) != "off":
                rules.setdefault(rule_name(key), key)
    return rules


def _glob_regex(glob: str) -> str:
    """A glob as a regex over a `/` path, as oxlint 1.94 reads one (measured, #1705): `**` as a whole path segment is
    any folders or none (`**` inside a name is `*`), `*` and `?` stay within a name, `[...]` (`[!...]` negated) never
    matches `/`, `{a,b}` nests, `\\` escapes the next character; no extglob (`!(x)` matched no file)."""
    out, i = [], 0
    while i < len(glob):
        at_segment_start = i == 0 or glob[i - 1] == "/"
        if glob.startswith("**", i) and at_segment_start and glob[i + 2:i + 3] in ("/", ""):
            out.append("(?:.*/)?" if glob[i + 2:i + 3] == "/" else ".*")
            i += 3
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 2 if glob.startswith("**", i) else 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        elif glob[i] == "\\" and i + 1 < len(glob):
            out.append(re.escape(glob[i + 1]))
            i += 2
        elif glob[i] == "[" and "]" in glob[i + 2:]:
            end = glob.index("]", i + 2)
            body = glob[i + 1:end].replace("\\", "\\\\")
            out.append("(?!/)[" + ("^" + body[1:] if body.startswith("!") else body) + "]")
            i = end + 1
        elif glob[i] == "{" and (end := _closing_brace(glob, i)) is not None:
            out.append("(?:" + "|".join(_glob_regex(part) for part in _split_top_level(glob[i + 1:end])) + ")")
            i = end + 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return "".join(out)


def _closing_brace(glob: str, start: int) -> int | None:
    depth = 0
    for i in range(start, len(glob)):
        depth += {"{": 1, "}": -1}.get(glob[i], 0)
        if depth == 0:
            return i
    return None


def _split_top_level(body: str) -> list[str]:
    """``body`` split at the commas outside nested braces."""
    parts, depth, start = [], 0, 0
    for i, char in enumerate(body):
        depth += {"{": 1, "}": -1}.get(char, 0)
        if char == "," and depth == 0:
            parts.append(body[start:i])
            start = i + 1
    return parts + [body[start:]]


def override_glob_matches(glob: str, path: str) -> bool:
    """Whether an override's `files` (or `excludeFiles`) glob picks ``path`` (relative to the config's folder), as
    oxlint 1.94 does (measured, #1705): a glob without a `/` matches a file's name in any folder, one with a `/` the
    whole path; a leading `./` is dropped."""
    glob = glob.removeprefix("./")
    target = path if "/" in glob else path.rsplit("/", 1)[-1]
    return re.fullmatch(_glob_regex(glob), target) is not None


def _ignore_verdict(patterns: list[str], target: str, is_folder: bool) -> bool | None:
    """True (ignored) or False (re-included by a `!` pattern) by the last pattern that matches ``target`` itself;
    None when none does."""
    verdict = None
    for pattern in patterns:
        negated = pattern.startswith("!")
        pattern = pattern.removeprefix("!")
        if pattern.endswith("/") and not is_folder:
            continue
        pattern = pattern.rstrip("/")
        subject = target if "/" in pattern else target.rsplit("/", 1)[-1]
        if re.fullmatch(_glob_regex(pattern.removeprefix("/")), subject):
            verdict = not negated
    return verdict


def ignored_by(patterns: list[str], path: str) -> bool:
    """Whether the config's `ignorePatterns` skip ``path`` (relative to the config's folder), read as .gitignore
    lines, as oxlint 1.94 does (measured, #1705): a pattern without a `/` (a trailing one aside) matches a name in any
    folder, one with a `/` the path from the config's folder; a trailing `/` names folders only. The last pattern that
    matches the file itself decides (a `!` one re-includes, even under an ignored folder); when none does, the last
    that matches its nearest folder that any pattern matches."""
    parts = path.split("/")
    for n in range(len(parts), 0, -1):
        verdict = _ignore_verdict(patterns, "/".join(parts[:n]), is_folder=n < len(parts))
        if verdict is not None:
            return verdict
    return False


def rules_on_in(config: dict, path: str) -> set[str]:
    """The names (oxlint_settings_check.rule_name) of the rules the config turns on for ``path`` (relative to the
    config's folder): the top-level rules, then each override that applies to it, in order."""
    on: set[str] = set()
    for block in _rule_blocks(config, path):
        for key, setting in block.items():
            (on.add if severity(setting) != "off" else on.discard)(rule_name(key))
    return on


def disable_counts(comments: dict[str, list[str]], config: dict) -> dict[str, dict]:
    """The disable comments per file that can switch off a rule ``config`` (the oxlint config) turns on for that file,
    in oxlint's suppressions shape ({path: {rule key: {"count": n}}}), keyed by the rule's name in the config; a comment
    naming no rule counts under EVERY_RULE, and a file-wide one under its key plus FILE_WIDE. A comment counts once
    per rule it names, however many of that rule's names it gives. Files with none are left out.

    Raises ValueError as rules_the_config_turns_on does."""
    keys = rules_the_config_turns_on(config)
    out: dict[str, dict] = {}
    for path, texts in comments.items():
        on = rules_on_in(config, path)
        for text in texts:
            named = disable_directive(text)
            if named is None:
                continue
            counted = {keys[rule_name(r)] for r in named if rule_name(r) in on} if named else {EVERY_RULE}
            suffix = FILE_WIDE if is_file_wide(text) else ""
            for key in (key + suffix for key in counted):
                entry = out.setdefault(path, {}).setdefault(key, {"count": 0})
                entry["count"] += 1
    return out


DISABLE_SUPPRESSIONS = "frontend/disable-comment-suppressions.json"
PRUNE_FLAG = "--prune-disable-comments"


# The files `oxlint src` lints, by extension (measured on oxlint 1.94, #1705): D1's parser reads these. A `.d.ts`
# ends in `.ts`. oxlint also lints the script blocks of OTHER_LINTED_SUFFIXES, which TypeScript's parser cannot read.
LINTED_SUFFIXES = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
OTHER_LINTED_SUFFIXES = (".vue", ".svelte", ".astro")


def _git_files(frontend: Path, *flags: str) -> set[str]:
    run = subprocess.run(["git", "-C", str(frontend), "ls-files", "-z", *flags, "--exclude-standard", "--", "src"],
                         capture_output=True, text=True, check=True)
    return set(filter(None, run.stdout.split("\0")))


def disable_comment_sources(frontend: Path) -> tuple[dict[str, str], list[str]]:
    """(sources, unreadable) under ``frontend``/src, keyed by paths relative to ``frontend``: each file oxlint lints
    whose text holds `-disable` (a file without it holds no directive; the parser is the slow part), and each such
    file D1's parser cannot read (OTHER_LINTED_SUFFIXES).

    oxlint walks every folder (`public`, `dist` and hidden ones too) and skips what a .gitignore names, a file added
    with `git add -f` included (measured on oxlint 1.94), so git lists the files: tracked or untracked, less every
    ignored one, and less what the config's `ignorePatterns` name. Raises OSError or CalledProcessError when git
    cannot list them."""
    ignore = parse_jsonc(read(frontend / ".oxlintrc.json")).get("ignorePatterns", [])
    sources, unreadable = {}, []
    for rel in sorted(_git_files(frontend, "--cached", "--others") - _git_files(frontend, "--cached", "--ignored")):
        p = frontend / rel
        if not p.is_file() or ignored_by(ignore, rel):  # not p: deleted in the working tree, not yet staged
            continue
        if p.suffix in LINTED_SUFFIXES and "-disable" in (src := read(p)):
            sources[rel] = src
        elif p.suffix in OTHER_LINTED_SUFFIXES and "-disable" in read(p):
            unreadable.append(rel)
    return sources, unreadable


def disable_comments_found() -> tuple[dict[str, dict], list[str]]:
    """D1's counts over frontend/src, in oxlint's suppressions shape, keyed by paths relative to frontend/, and the
    files holding disable text that D1 cannot read.

    Raises TsParserError when node or TypeScript cannot run, ValueError when the config cannot be listed."""
    sources, unreadable = disable_comment_sources(REPO_ROOT / "frontend")
    config = parse_jsonc(read(REPO_ROOT / CONFIG))
    return disable_counts(disable_comment_texts(sources), config), unreadable


def _rule_label(rule: str) -> str:
    return f"{rule} (names no rule)" if rule.startswith(EVERY_RULE) else rule


def _describe(path: str, rule: str, now: int, was: int) -> str:
    return f"frontend/{path}: {now} disable comments for {_rule_label(rule)}, {was} frozen"


def disable_comments_unfrozen() -> list[str]:
    """D1 over the tree: a line per file and rule off its frozen count in DISABLE_SUPPRESSIONS
    (frozen_counts.frozen_drift, as J1's), and one per file D1 cannot parse.

    When the parser cannot run, that is D1's one finding (frozen_counts.node_cannot_run)."""
    try:
        found, unreadable = disable_comments_found()
    except TsParserError as e:
        return node_cannot_run("D1", "disable comments", e)
    except ValueError as e:
        return [f"D1 could not list ADR-0049's rules: {e}"]
    except (OSError, subprocess.CalledProcessError) as e:
        return [f"D1 could not list the files oxlint lints with git: {e}"]
    over, under = frozen_drift(found, read_frozen(DISABLE_SUPPRESSIONS), _describe)
    return (over + [f"{line} (fewer: lower it with python3 scripts/residence_check.py {PRUNE_FLAG})" for line in under]
            + [f"frontend/{path}: holds disable text in a file D1 cannot parse (oxlint lints its script blocks)"
               for path in unreadable])


def prune_disable_comments() -> int:
    """Lower DISABLE_SUPPRESSIONS to today's counts (a file or rule at 0 goes); never raise one. 0 = done."""
    try:
        found, _ = disable_comments_found()
    except (TsParserError, ValueError, OSError, subprocess.CalledProcessError) as e:
        print(f"✗ {PRUNE_FLAG}: D1 could not count disable comments: {e}", file=sys.stderr)
        return 1
    over, _ = frozen_drift(found, read_frozen(DISABLE_SUPPRESSIONS), _describe)
    if over:
        print(f"✗ {PRUNE_FLAG} lowers counts only; these rose, so nothing was written:", file=sys.stderr)
        for line in over:
            print(f"    {line}", file=sys.stderr)
        return 1
    (REPO_ROOT / DISABLE_SUPPRESSIONS).write_text(json.dumps(found, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"✓ {DISABLE_SUPPRESSIONS} now holds today's counts")
    return 0
