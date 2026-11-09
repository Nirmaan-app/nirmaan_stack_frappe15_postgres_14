"""Does an env's DB need a migrate before a test run? Compares the app's schema files with the ones its last migrate saw.

    python3 -I devenv_schema.py record <app-root> <stamp-file>   after a migrate: remember the schema files
    python3 -I devenv_schema.py check  <app-root> <stamp-file>   exit 0 when nothing changed since, 10 when a migrate
                                                                  is needed (stdout says why: no record, or the files)

The schema files are what `bench migrate` applies: every doctype JSON, patches.txt and hooks.py. The stamp holds each
one's sha256 as the files stood on disk (committed or not), since that is what a migrate reads. Called by devenv.sh
(`migrate` records, `test` checks).
"""

import hashlib
import json
import os
import sys

APP = "nirmaan_stack"
NEEDED = 10
SKIP_DIRS = {"public", "node_modules", "__pycache__", ".git"}


def schema_files(root):
    """{path relative to root: sha256} of every doctype JSON, patches.txt and hooks.py."""
    pkg = os.path.join(root, APP)
    paths = [os.path.join(pkg, "patches.txt"), os.path.join(pkg, "hooks.py")]
    for d, dirs, files in os.walk(pkg):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        if os.path.basename(os.path.dirname(d)) == "doctype":
            paths += [os.path.join(d, f) for f in files if f.endswith(".json")]
    out = {}
    for p in paths:
        if os.path.isfile(p):
            with open(p, "rb") as f:
                out[os.path.relpath(p, root)] = hashlib.sha256(f.read()).hexdigest()
    return out


def main(cmd, root, stamp):
    now = schema_files(root)
    if cmd == "record":
        os.makedirs(os.path.dirname(os.path.abspath(stamp)), exist_ok=True)
        with open(stamp + ".tmp", "w") as f:
            json.dump(now, f, indent=0, sort_keys=True)
        os.replace(stamp + ".tmp", stamp)
        return 0
    if cmd != "check":
        sys.exit(f"devenv_schema: unknown command {cmd!r}")
    try:
        with open(stamp) as f:
            then = json.load(f)
    except (OSError, ValueError):
        print("no record of this env's last migrate")
        return NEEDED
    changed = sorted(p for p in now.keys() | then.keys() if now.get(p) != then.get(p))
    if not changed:
        return 0
    shown = changed[:5] + ([f"and {len(changed) - 5} more"] if len(changed) > 5 else [])
    print(f"changed since the env's last migrate: {', '.join(shown)}")
    return NEEDED


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sys.exit(main(*sys.argv[1:]))
