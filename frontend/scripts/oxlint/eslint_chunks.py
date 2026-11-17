"""ESLint's whole-tree no-unsafe counts (ticket #1699), in chunks of 300 files: one ESLint run over all of src/ with
them on was killed for memory 4 times in 5 on the air box. Inside the container, from frontend/:

    python3 -I scripts/oxlint/eslint_chunks.py <out.json>

Writes the totals per rule and the counts per file and rule; suppressions are off.
"""
import collections
import json
import os
import subprocess
import sys

EMPTY_SUPPRESSIONS = "/tmp/oxlint-trial-empty-suppressions.json"
CHUNK = 300


def linted_files():
    """Every .ts/.tsx file under src/ that eslint.config.js lints (it ignores src/components/ui/)."""
    files = []
    for root, _, names in os.walk("src"):
        if root.startswith("src/components/ui"):
            continue
        files += [os.path.join(root, n) for n in names if n.endswith((".ts", ".tsx"))]
    return sorted(files)


def main():
    """Lint every chunk with the whole-tree config and write the summed counts to sys.argv[1]."""
    with open(EMPTY_SUPPRESSIONS, "w") as f:
        f.write("{}")
    files = linted_files()
    total = collections.Counter()
    per_file = collections.Counter()
    for i in range(0, len(files), CHUNK):
        part = files[i:i + CHUNK]
        run = subprocess.run(["node", "--max-old-space-size=4096", "node_modules/eslint/bin/eslint.js", "-c",
                              "scripts/oxlint/eslint.whole.config.js", "--suppressions-location", EMPTY_SUPPRESSIONS,
                              "-f", "json", *part], capture_output=True, text=True)
        if run.returncode not in (0, 1):
            sys.exit(f"chunk {i // CHUNK + 1}: exit {run.returncode}: {run.stderr[-400:]}")
        for result in json.loads(run.stdout):
            for message in result["messages"]:
                rule = message.get("ruleId") or "(no rule)"  # a parse error has none
                total[rule] += 1
                per_file[(os.path.relpath(result["filePath"]), rule)] += 1
        print(f"chunk {i // CHUNK + 1}: {len(part)} files", flush=True)
    with open(sys.argv[1], "w") as f:
        json.dump({"rules": dict(sorted(total.items())),
                   "per_file": [[path, rule, n] for (path, rule), n in sorted(per_file.items())]}, f)
    print(json.dumps(dict(sorted(total.items()))))


if __name__ == "__main__":
    main()
