"""Print the backend test modules the repo CLAUDE.md calls *affected* by a worktree's changes since a base ref.

    python3 -I devenv_affected.py <worktree> <base-ref>

Changes = everything between merge-base(<base-ref>, HEAD) and the working tree (committed, staged, unstaged) plus
untracked files. Affected (the repo CLAUDE.md "Per ticket, run the affected test modules" rule):
  1. the test modules of each package a changed .py file sits in;
  2. every test module that names such a package's dotted path (the package, not the module, so
     `from <package> import <module>` is caught too);
  3. for a doctype change, every test module that names that doctype in quotes;
  4. changed test modules themselves;
  5. for any doctype change, the checks that read every doctype's JSON (`ON_EVERY_DOCTYPE`).
Modules go to stdout, one per line; notes go to stderr. Called by devenv.sh (`affected`, `test --affected`).
"""

import json
import os
import re
import subprocess
import sys

APP = "nirmaan_stack"
# Naming these would match nearly every test: a change there gets a note instead (consider the full suite).
TOO_BROAD = {APP, f"{APP}.{APP}", f"{APP}.api", f"{APP}.services"}
# They name no doctype, yet a doctype change is exactly what they guard (#1678: a URL field stored as Data).
ON_EVERY_DOCTYPE = {f"{APP}.test_url_fields"}


def git(wt, *args):
    return subprocess.run(["git", "-C", wt, *args], capture_output=True, text=True, check=True).stdout


def main(wt, base):
    try:
        mb = git(wt, "merge-base", base, "HEAD").strip()
    except subprocess.CalledProcessError as e:
        sys.exit(f"devenv affected: cannot find merge-base of {base!r} and HEAD: {e.stderr.strip()}")
    changed = set(git(wt, "diff", "--name-only", mb).split()) | set(
        git(wt, "ls-files", "--others", "--exclude-standard").split()
    )
    changed = {p for p in changed if p.startswith(f"{APP}/")}

    tests = {}  # dotted module -> source text
    for root, _dirs, files in os.walk(os.path.join(wt, APP)):
        for f in files:
            if f.startswith("test_") and f.endswith(".py"):
                path = os.path.join(root, f)
                dotted = os.path.relpath(path, wt)[:-3].replace(os.sep, ".")
                with open(path, encoding="utf-8", errors="ignore") as fh:
                    tests[dotted] = fh.read()

    packages, doctypes, picked = set(), set(), set()
    for p in sorted(changed):
        parts = p.split("/")
        if p.endswith(".py"):
            mod = p[:-3].replace("/", ".")
            if mod in tests:
                picked.add(mod)
            packages.add(".".join(parts[:-1]))
        if "doctype" in parts[:-1]:
            dt_dir = os.path.join(wt, *parts[: parts.index("doctype") + 2])
            dt_json = os.path.join(dt_dir, os.path.basename(dt_dir) + ".json")
            if os.path.exists(dt_json):
                with open(dt_json, encoding="utf-8") as fh:
                    doctypes.add(json.load(fh)["name"])

    for pkg in sorted(packages):
        picked |= {m for m in tests if m.rsplit(".", 1)[0] == pkg}
        if pkg in TOO_BROAD:
            print(f"note: {pkg.replace('.', '/')} changed at its top level; consider the full suite", file=sys.stderr)
            continue
        hit = re.compile(re.escape(pkg) + r"\b")
        picked |= {m for m, src in tests.items() if hit.search(src)}
    for dt in sorted(doctypes):
        hit = re.compile(r"[\"']" + re.escape(dt) + r"[\"']")
        picked |= {m for m, src in tests.items() if hit.search(src)}
    if doctypes:
        picked |= ON_EVERY_DOCTYPE

    picked = sorted(m for m in picked if m in tests)  # a deleted test module is not run
    print(
        f"devenv affected: {len(changed)} changed backend files since {mb[:9]} ({base}); "
        f"{len(packages)} packages, {len(doctypes)} doctypes -> {len(picked)} modules",
        file=sys.stderr,
    )
    print("\n".join(picked))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
