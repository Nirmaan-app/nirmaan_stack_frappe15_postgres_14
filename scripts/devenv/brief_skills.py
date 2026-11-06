#!/usr/bin/env python3
"""Print each skill a task brief names that only a person can start, and exit 1 if there is any.

    brief_skills.py <brief> <claude home>

A skill whose SKILL.md frontmatter says `disable-model-invocation: true` starts only when a person types its slash
command; the Skill tool refuses it. A box agent has no person at its keyboard, so a brief that tells it to call one
sends it down a path the owner did not choose (the login-role-fix brief named implement-spec, and the agent built the
tickets another way). Names are read as `<plugin>:<skill>`, with or without a leading slash, from the plugins enabled
in <claude home>/settings.json.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

NAME = re.compile(r"(?<![\w.-])/?([a-z0-9][a-z0-9-]*):([a-z0-9][a-z0-9-]*)\b")


def load(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def user_only(skill_md: Path) -> bool:
    text = skill_md.read_text(errors="replace")
    if not text.startswith("---"):
        return False
    front = text.split("---", 2)[1]
    return re.search(r"^disable-model-invocation:\s*true\s*$", front, re.M) is not None


def main(brief: Path, home: Path) -> int:
    enabled = {k.split("@")[0] for k, v in (load(home / "settings.json").get("enabledPlugins") or {}).items() if v}
    installed = load(home / "plugins" / "installed_plugins.json").get("plugins") or {}
    roots: dict[str, list[Path]] = {}
    for key, entries in installed.items():
        if key.split("@")[0] in enabled:
            roots.setdefault(key.split("@")[0], []).extend(Path(e["installPath"]) for e in entries if e.get("installPath"))
    found = []
    for plugin, skill in sorted(set(NAME.findall(brief.read_text()))):
        for root in roots.get(plugin, []):
            if any(user_only(md) for md in (root / "skills").glob(f"**/{skill}/SKILL.md")):
                found.append(f"{plugin}:{skill}")
                break
    for name in found:
        print(name)
    return 1 if found else 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(main(Path(sys.argv[1]), Path(sys.argv[2])))
