"""Every installed package against what the installed packages ask for, git pins included.

Run with the bench's Python, inside the container:

    env/bin/python -I <this file>              print one line per broken pin; exit 1 if any
    env/bin/python -I <this file> --fix-git    first reinstall each package a git pin is not met by

`pip check` reads version ranges only, so Frappe's `PyPika @ git+https://github.com/frappe/pypika@<commit>` passes it
when the PyPI release of PyPika is installed instead. This reads the commit pip recorded when it installed the package
(`direct_url.json`). A stale python.lock.txt once kept pypdf 3.17.4 under a Frappe that pins 6.13.3, and the card
statement reader misread every statement (ADR-0039 Amendment B); bootstrap.sh runs this so a lock like that is refused.
"""

from __future__ import annotations

import json
import subprocess
import sys
from importlib.metadata import Distribution, distributions

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


def installed() -> dict[str, Distribution]:
    return {canonicalize_name(d.metadata["Name"]): d for d in distributions()}


def git_ref(url: str) -> str | None:
    """`git+https://github.com/frappe/pypika@<commit>` -> `<commit>`; None when the URL names no revision."""
    path = url.split("://", 1)[-1]
    return path.rsplit("@", 1)[1] if "@" in path else None


def git_pin_met(dist: Distribution, url: str) -> bool:
    vcs = json.loads(dist.read_text("direct_url.json") or "{}").get("vcs_info", {})
    commit, ref = vcs.get("commit_id", ""), git_ref(url)
    return bool(commit) and (ref is None or commit.startswith(ref) or vcs.get("requested_revision") == ref)


def broken(dists: dict[str, Distribution]) -> list[tuple[str, Requirement, str]]:
    found = []
    for owner in sorted(dists.values(), key=lambda d: d.metadata["Name"].lower()):
        for line in owner.requires or []:
            req = Requirement(line)
            if req.marker and not req.marker.evaluate({"extra": ""}):
                continue
            dist = dists.get(canonicalize_name(req.name))
            if dist is None:
                found.append((owner.metadata["Name"], req, "not installed"))
            elif req.url:
                if not git_pin_met(dist, req.url):
                    origin = json.loads(dist.read_text("direct_url.json") or "{}").get("vcs_info", {}).get("commit_id")
                    found.append((owner.metadata["Name"], req, f"installed {dist.version} from {origin or 'PyPI'}"))
            elif not req.specifier.contains(dist.version, prereleases=True):
                found.append((owner.metadata["Name"], req, f"installed {dist.version}"))
    return found


def main() -> int:
    problems = broken(installed())
    if "--fix-git" in sys.argv:
        for _, req, _ in problems:
            if req.url:
                subprocess.run(
                    [sys.executable, "-m", "pip", "install", "-q", "--no-deps", "--force-reinstall", f"{req.name} @ {req.url}"],
                    check=True,
                )
        problems = broken(installed())
    for owner, req, what in problems:
        print(f"{owner} needs {req}: {what}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
